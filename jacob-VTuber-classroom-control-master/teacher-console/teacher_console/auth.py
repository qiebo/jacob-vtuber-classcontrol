"""教师端登录鉴权（PRD T-2 / 开发文档 §4.3.1）。

- 默认账号 ybszr / 123456，密码以 bcrypt hash 存储。
- 登录成功下发会话 token，前端存 localStorage，后续请求带 Authorization: Bearer。
- 会话级（服务端内存 token 集合），关闭服务即失效。
- 密码可在 /api/auth/password 修改。
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path
from typing import Any

import bcrypt
from fastapi import Depends, Header, HTTPException, Request
from pydantic import BaseModel

DEFAULT_USERNAME = "ybszr"
DEFAULT_PASSWORD = "123456"


class LoginRequest(BaseModel):
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str


class AuthStore:
    """教师凭证持久化 + 会话 token 管理。"""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.config_path = data_dir / "config.json"
        self._tokens: set[str] = set()
        data_dir.mkdir(parents=True, exist_ok=True)
        self._ensure_config()

    def _ensure_config(self) -> None:
        if not self.config_path.is_file():
            self._write_config({
                "username": DEFAULT_USERNAME,
                "password_hash": self._hash(DEFAULT_PASSWORD),
            })

    def _read_config(self) -> dict[str, Any]:
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except Exception:
            return {
                "username": DEFAULT_USERNAME,
                "password_hash": self._hash(DEFAULT_PASSWORD),
            }

    def _write_config(self, data: dict[str, Any]) -> None:
        self.config_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @staticmethod
    def _hash(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def verify(self, username: str, password: str) -> bool:
        cfg = self._read_config()
        if cfg.get("username") != username:
            return False
        stored = cfg.get("password_hash", "")
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored.encode("utf-8"))
        except (ValueError, TypeError):
            return False

    def login(self, username: str, password: str) -> str | None:
        if not self.verify(username, password):
            return None
        token = secrets.token_urlsafe(32)
        self._tokens.add(token)
        return token

    def logout(self, token: str) -> None:
        self._tokens.discard(token)

    def is_valid_token(self, token: str | None) -> bool:
        return bool(token and token in self._tokens)

    def change_password(self, old_password: str, new_password: str) -> bool:
        cfg = self._read_config()
        stored = cfg.get("password_hash", "")
        try:
            if not bcrypt.checkpw(old_password.encode("utf-8"), stored.encode("utf-8")):
                return False
        except (ValueError, TypeError):
            return False
        if len(new_password) < 1:
            return False
        cfg["password_hash"] = self._hash(new_password)
        self._write_config(cfg)
        # 改密后所有旧 token 失效，强制重新登录
        self._tokens.clear()
        return True


# 每个应用实例一个 AuthStore，挂到 app.state.auth_store
async def require_teacher_auth(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    """鉴权依赖：校验 Authorization: Bearer <token>。

    放行路径：/api/auth/login、/（首页）、/static/*。
    """
    path = request.url.path
    # 公开路径放行
    if path == "/" or path.startswith("/static") or path == "/api/auth/login":
        return
    auth_store: AuthStore | None = getattr(request.app.state, "auth_store", None)
    if auth_store is None:
        return  # 未启用鉴权（兼容旧测试）
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not auth_store.is_valid_token(token):
        raise HTTPException(status_code=401, detail="未登录或会话过期")


def init_auth_routes(app, auth_store: AuthStore) -> None:
    """在 app 上注册 /api/auth/* 路由。"""

    @app.post("/api/auth/login")
    async def teacher_login(request: LoginRequest):
        token = auth_store.login(request.username, request.password)
        if token is None:
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        return {"token": token, "username": request.username}

    @app.post("/api/auth/logout")
    async def teacher_logout(authorization: str | None = Header(default=None)):
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if token:
            auth_store.logout(token)
        return {"ok": True}

    @app.get("/api/auth/me")
    async def teacher_me(authorization: str | None = Header(default=None)):
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if not auth_store.is_valid_token(token):
            raise HTTPException(status_code=401, detail="未登录")
        cfg = auth_store._read_config()
        return {"username": cfg.get("username", DEFAULT_USERNAME)}

    @app.post("/api/auth/password")
    async def teacher_change_password(
        request: PasswordChangeRequest,
        authorization: str | None = Header(default=None),
    ):
        token = None
        if authorization and authorization.lower().startswith("bearer "):
            token = authorization[7:].strip()
        if not auth_store.is_valid_token(token):
            raise HTTPException(status_code=401, detail="未登录")
        ok = auth_store.change_password(request.old_password, request.new_password)
        if not ok:
            raise HTTPException(status_code=400, detail="原密码错误或新密码无效")
        return {"ok": True}
