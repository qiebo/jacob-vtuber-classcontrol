"""全局用户名注册表（开发文档 §3.1 / §4.3.3）。

存储 teacher_console_data/users.json，作为用户名唯一性仲裁源。
供学生端 check-username / sync 调用。
"""
from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

USERNAME_RE = re.compile(r"^[A-Za-z0-9]{1,32}$")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class UserStore:
    """全局用户名注册表。线程安全（并发同名创建只有一个成功）。"""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.path = data_dir / "users.json"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _load(self) -> dict[str, Any]:
        if not self.path.is_file():
            return {"version": 1, "users": []}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("users"), list):
                return {"version": 1, "users": []}
            return data
        except Exception:
            return {"version": 1, "users": []}

    def _save(self, data: dict[str, Any]) -> None:
        self.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def list_users(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._load().get("users", []))

    def get(self, username: str) -> dict[str, Any] | None:
        username = _normalize_username(username)
        with self._lock:
            for user in self._load().get("users", []):
                if user.get("username") == username:
                    return user
        return None

    def exists(self, username: str) -> bool:
        return self.get(username) is not None

    def check_available(self, username: str) -> bool:
        """学生端 check-username 调用：返回是否可用。"""
        _normalize_username(username)  # 校验格式，非法抛错
        return not self.exists(username)

    def register(
        self,
        username: str,
        *,
        class_id: str | None = None,
        device_hint: str | None = None,
        status: str = "active",
    ) -> tuple[dict[str, Any], bool]:
        """登记用户名。返回 (entry, created)。created=False 表示已存在。

        线程安全：并发同名只有一个 created=True。
        """
        username = _normalize_username(username)
        now = utc_now_iso()
        with self._lock:
            data = self._load()
            users: list[dict[str, Any]] = data.get("users", [])
            for user in users:
                if user.get("username") == username:
                    user["last_seen_at"] = now
                    self._save(data)
                    return user, False
            entry = {
                "username": username,
                "class_id": class_id,
                "device_hint": device_hint,
                "created_at": now,
                "last_seen_at": now,
                "status": status,
            }
            users.append(entry)
            data["users"] = users
            self._save(data)
            return entry, True

    def sync_from_device(
        self, username: str, device_id: str
    ) -> dict[str, Any]:
        """学生端离线创建恢复在线后上报（开发文档 §4.3.3 /api/users/sync）。

        返回 {"synced": true} 或 {"synced": false, "reason": "conflict", "new_name_suggested": ...}
        """
        username = _normalize_username(username)
        with self._lock:
            data = self._load()
            users: list[dict[str, Any]] = data.get("users", [])
            for user in users:
                if user.get("username") == username:
                    # 已存在：若同设备则视为同步成功，否则冲突
                    if user.get("device_hint") == device_id or not user.get("device_hint"):
                        user["device_hint"] = device_id
                        user["last_seen_at"] = utc_now_iso()
                        user["status"] = "active"
                        self._save(data)
                        return {"synced": True}
                    suggested = f"{username}{device_id}"[:32]
                    return {
                        "synced": False,
                        "reason": "conflict",
                        "new_name_suggested": _ensure_valid(suggested),
                    }
            # 不存在：内联登记（不可调 self.register，会重复加锁死锁）
            now = utc_now_iso()
            entry = {
                "username": username,
                "class_id": None,
                "device_hint": device_id,
                "created_at": now,
                "last_seen_at": now,
                "status": "active",
            }
            users.append(entry)
            data["users"] = users
            self._save(data)
            return {"synced": True}

    def update_class(self, username: str, class_id: str | None) -> dict[str, Any] | None:
        """归班/移班。"""
        username = _normalize_username(username)
        with self._lock:
            data = self._load()
            for user in data.get("users", []):
                if user.get("username") == username:
                    user["class_id"] = class_id
                    user["last_seen_at"] = utc_now_iso()
                    self._save(data)
                    return user
        return None


def _normalize_username(username: str) -> str:
    candidate = (username or "").strip()
    if not USERNAME_RE.fullmatch(candidate):
        raise ValueError("Invalid username (must be 1–32 letters or digits)")
    return candidate


def _ensure_valid(username: str) -> str:
    """确保建议的新名合法（去非法字符，截断到 32）。"""
    cleaned = re.sub(r"[^A-Za-z0-9]", "", username)[:32]
    return cleaned or "user"
