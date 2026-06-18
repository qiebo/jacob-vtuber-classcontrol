from __future__ import annotations

import os
import secrets
from typing import TYPE_CHECKING

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field
from starlette.responses import JSONResponse

from ..knowledge_service import (
    initialize_empty_knowledge_snapshot,
    restore_knowledge_snapshot,
)
from .models import USERNAME_RE_PATTERN
from .routes import (
    apply_profile_to_open_contexts,
    require_classroom_token,
)
from .storage import (
    UserRegistry,
    attach_profile_metadata,
    create_profile,
    ensure_safe_username,
    get_profile,
    load_runtime_state,
    profile_knowledge_directory,
    restore_profile_chat_history,
    save_profile_from_context,
    save_runtime_state,
    snapshot_profile_chat_history,
    utc_now_iso,
)

if TYPE_CHECKING:
    from ..service_context import ServiceContext

# 教师机校验超时（秒）。超时即视为离线降级（开发文档 §4.4 / §5.1）
TEACHER_CHECK_TIMEOUT = 2.0


class CheckUsernameRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32, pattern=USERNAME_RE_PATTERN)


class CreateAuthRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32, pattern=USERNAME_RE_PATTERN)
    class_name: str | None = None


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32, pattern=USERNAME_RE_PATTERN)


class LogoutRequest(BaseModel):
    save_before_exit: bool = False


def _teacher_url() -> str:
    return os.getenv("JACOB_TEACHER_URL", "").strip()


def _device_token() -> str:
    return os.getenv("JACOB_CLASSROOM_TOKEN", "").strip()


def _new_session_token() -> str:
    return secrets.token_urlsafe(32)


# 默认 character_config 快照：首次访问 auth 路由时缓存，logout 时恢复（PRD T-8）
_default_config_snapshot: dict[str, Any] | None = None


def _capture_default_config(context: ServiceContext) -> None:
    global _default_config_snapshot
    if _default_config_snapshot is None and context.character_config is not None:
        try:
            _default_config_snapshot = context.character_config.model_dump(
                by_alias=True, exclude_none=True
            )
        except Exception:
            _default_config_snapshot = None


async def _restore_default_config(context: ServiceContext) -> None:
    """logout 后恢复默认人设配置，避免下一用户继承上一用户设置。"""
    if _default_config_snapshot is None:
        return
    try:
        from ..config_manager import CharacterConfig

        default_config = CharacterConfig.model_validate(_default_config_snapshot)
        await context.apply_character_config(default_config)
        context.classroom_username = None
        context.classroom_class_name = None
        context.classroom_dirty = False
        context.classroom_submitted = False
        context.classroom_last_saved_at = None
    except Exception:
        pass


async def _check_username_with_teacher(username: str) -> tuple[bool, str]:
    """向教师机校验用户名唯一性。返回 (available, checked_by)。

    checked_by: "teacher" 在线校验；"local" 教师机不可达，离线降级。
    """
    teacher_url = _teacher_url()
    if not teacher_url:
        return True, "local"
    headers = {}
    token = _device_token()
    if token:
        headers["X-Device-Token"] = token
    try:
        async with httpx.AsyncClient(timeout=TEACHER_CHECK_TIMEOUT) as client:
            resp = await client.post(
                f"{teacher_url.rstrip('/')}/api/users/check",
                json={"username": username},
                headers=headers,
            )
        if resp.status_code == 404:
            # 教师机尚未实现该端点（M4），按离线降级处理
            return True, "local"
        resp.raise_for_status()
        payload = resp.json()
        available = bool(payload.get("available", False))
        return available, "teacher"
    except Exception:
        # 网络超时/连接失败 → 离线降级
        return True, "local"


def init_auth_routes(default_context_cache: ServiceContext) -> APIRouter:
    router = APIRouter(
        prefix="/auth",
        dependencies=[Depends(require_classroom_token)],
    )

    # 每次后端启动时清空登录态：课堂场景下设备可能由不同学生轮流使用，
    # 启动后必须显示登录页，不能自动登录上一个用户（PRD S-1）。
    try:
        save_runtime_state(current_username=None, session_token=None)
    except Exception:
        pass

    @router.post("/check-username")
    async def auth_check_username(request: CheckUsernameRequest):
        username = ensure_safe_username(request.username)
        registry = UserRegistry()

        # 1. 本地注册表去重
        if registry.exists(username):
            return JSONResponse(
                {
                    "available": False,
                    "checked_by": "local",
                    "conflict": "username_exists_local",
                }
            )

        # 2. 教师机校验（超时离线降级）
        available, checked_by = await _check_username_with_teacher(username)
        result: dict = {"available": available, "checked_by": checked_by, "conflict": None}
        if not available:
            result["conflict"] = "username_exists"
        elif checked_by == "local":
            result["offline"] = True
        return JSONResponse(result)

    @router.post("/create")
    async def auth_create(request: CreateAuthRequest):
        if not default_context_cache.character_config:
            return JSONResponse(
                {"error": "Application context is not ready"}, status_code=400
            )
        _capture_default_config(default_context_cache)

        username = ensure_safe_username(request.username)
        registry = UserRegistry()

        # 本地去重
        if registry.exists(username):
            return JSONResponse(
                {"error": "用户名已存在", "conflict": "username_exists_local"},
                status_code=409,
            )

        # 教师机校验决定 pending_sync
        available, checked_by = await _check_username_with_teacher(username)
        if not available:
            return JSONResponse(
                {"error": "用户名已被其他设备占用", "conflict": "username_exists"},
                status_code=409,
            )
        pending_sync = checked_by == "local"  # 离线降级创建

        character_config = default_context_cache.character_config.model_dump(
            by_alias=True, exclude_none=True
        )
        try:
            profile = create_profile(
                username,
                character_config,
                class_name=request.class_name,
                pending_sync=pending_sync,
            )
            registry.register(username, pending_sync=pending_sync)
            knowledge_dir = profile_knowledge_directory(profile.username)
            initialize_empty_knowledge_snapshot(knowledge_dir)
            restore_knowledge_snapshot(knowledge_dir)
            restore_profile_chat_history(profile.username)
            await apply_profile_to_open_contexts(default_context_cache, profile)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        session_token = _new_session_token()
        save_runtime_state(
            current_username=profile.username,
            session_token=session_token,
        )
        return JSONResponse(
            {
                "username": profile.username,
                "profile": profile.model_dump(),
                "pending_sync": profile.pending_sync,
                "session_token": session_token,
                "redirect": "/main",
            }
        )

    @router.post("/login")
    async def auth_login(request: LoginRequest):
        username = ensure_safe_username(request.username)
        profile = get_profile(username)
        if profile is None:
            return JSONResponse(
                {"error": "用户名不存在，是否创建？", "suggest_create": True},
                status_code=404,
            )

        try:
            restore_knowledge_snapshot(profile_knowledge_directory(profile.username))
            restore_profile_chat_history(profile.username)
            await apply_profile_to_open_contexts(default_context_cache, profile)
        except Exception as exc:
            return JSONResponse(
                {"error": f"载入档案失败: {exc}"}, status_code=500
            )

        # 更新注册表 last_login
        UserRegistry().register(profile.username, pending_sync=profile.pending_sync)

        session_token = _new_session_token()
        save_runtime_state(
            current_username=profile.username,
            session_token=session_token,
        )
        return JSONResponse(
            {
                "username": profile.username,
                "profile": profile.model_dump(),
                "pending_sync": profile.pending_sync,
                "session_token": session_token,
            }
        )

    @router.post("/logout")
    async def auth_logout(request: LogoutRequest | None = None):
        save_before = bool(request and request.save_before_exit)
        username = load_runtime_state().get("current_username")
        if save_before and username:
            try:
                profile = save_profile_from_context(
                    default_context_cache, dirty=False
                )
                snapshot_profile_chat_history(profile.username)
            except (ValueError, KeyError):
                pass  # 无当前档案，直接退出
        # 清空当前会话
        save_runtime_state(current_username=None, session_token=None)
        # 恢复默认配置（PRD T-8）：避免下一用户继承上一用户人设
        try:
            await _restore_default_config(default_context_cache)
        except Exception:
            pass
        return JSONResponse({"ok": True})

    @router.get("/me")
    async def auth_me():
        state = load_runtime_state()
        username = state.get("current_username")
        if not username:
            return JSONResponse({"username": None, "profile": None})
        profile = get_profile(username)
        return JSONResponse(
            {
                "username": username,
                "profile": profile.model_dump() if profile else None,
                "pending_sync": profile.pending_sync if profile else None,
                "session_token": state.get("session_token"),
            }
        )

    return router
