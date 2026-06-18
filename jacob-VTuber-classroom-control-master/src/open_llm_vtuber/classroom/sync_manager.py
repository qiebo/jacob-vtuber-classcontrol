from __future__ import annotations

import asyncio
import os
from typing import TYPE_CHECKING

import httpx
from loguru import logger

from .storage import (
    UserRegistry,
    ensure_safe_username,
    rename_user,
)

if TYPE_CHECKING:
    pass

# 后台同步循环间隔（秒）
SYNC_INTERVAL = 30.0
# 单次教师机请求超时
SYNC_TIMEOUT = 3.0


def _teacher_url() -> str:
    return os.getenv("JACOB_TEACHER_URL", "").strip()


def _device_token() -> str:
    return os.getenv("JACOB_CLASSROOM_TOKEN", "").strip()


def _device_id() -> str:
    return os.getenv("JACOB_DEVICE_ID", "").strip() or "unknown-device"


class SyncManager:
    """离线创建同步管理器（开发文档 §5.2 / §8.2）。

    后台循环：每 SYNC_INTERVAL 秒探测教师机可达性，遍历本地 pending_sync
    用户，向教师机 POST /api/users/sync。冲突时返回 suggested 新名，
    本地执行 rename_user 完成目录迁移与数据保留。

    冲突改名的"提示学生"交互由前端监听 runtime_state 的 sync_conflict
    字段实现；本管理器只负责检测与执行改名。
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()

    async def _probe_and_sync_once(self) -> None:
        teacher_url = _teacher_url()
        if not teacher_url:
            return  # 未配置教师机地址，跳过
        registry = UserRegistry()
        pending = registry.list_pending()
        if not pending:
            return

        headers = {}
        token = _device_token()
        if token:
            headers["X-Device-Token"] = token

        async with httpx.AsyncClient(timeout=SYNC_TIMEOUT) as client:
            for entry in pending:
                username = entry.get("username")
                if not username:
                    continue
                try:
                    username = ensure_safe_username(username)
                except ValueError:
                    continue
                try:
                    resp = await client.post(
                        f"{teacher_url.rstrip('/')}/api/users/sync",
                        json={"username": username, "device_id": _device_id()},
                        headers=headers,
                    )
                except Exception as exc:
                    logger.debug(f"sync: teacher unreachable for {username}: {exc}")
                    return  # 教师机不可达，本轮放弃，等下次

                if resp.status_code == 404:
                    # 教师机尚未实现 /api/users/sync（M4），本轮跳过
                    return

                try:
                    payload = resp.json()
                except Exception:
                    payload = {}

                if payload.get("synced"):
                    registry.mark_synced(username)
                    logger.info(f"sync: {username} synced with teacher")
                    _clear_conflict(username)
                elif payload.get("reason") == "conflict":
                    suggested = payload.get("new_name_suggested") or payload.get(
                        "suggested"
                    )
                    if suggested and suggested != username:
                        try:
                            ensure_safe_username(suggested)
                            rename_user(username, suggested)
                            registry.rename(username, suggested)
                            _set_conflict(suggested, original=username)
                            logger.info(
                                f"sync: conflict, renamed {username} -> {suggested}"
                            )
                        except (ValueError, KeyError) as exc:
                            logger.warning(
                                f"sync: rename {username}->{suggested} failed: {exc}"
                            )
                            _set_conflict(username, original=username)
                    else:
                        _set_conflict(username, original=username)

    async def _loop(self) -> None:
        logger.info("SyncManager background loop started")
        while not self._stop.is_set():
            try:
                await self._probe_and_sync_once()
            except Exception as exc:
                logger.debug(f"sync loop error: {exc}")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=SYNC_INTERVAL)
            except asyncio.TimeoutError:
                pass
        logger.info("SyncManager background loop stopped")

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=SYNC_INTERVAL + 1)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None


# --- 冲突状态记录（供前端轮询 /auth/me 或 status 读取） ---
# 写入 classroom_data/runtime_state.json 的 sync_conflict 字段。
def _set_conflict(username: str, *, original: str) -> None:
    from .storage import load_runtime_state, save_runtime_state

    save_runtime_state(
        sync_conflict={"username": username, "original": original, "reason": "conflict"}
    )


def _clear_conflict(username: str) -> None:
    from .storage import load_runtime_state, save_runtime_state

    state = load_runtime_state()
    if state.get("sync_conflict"):
        save_runtime_state(sync_conflict=None)


# 模块级单例，供 server 启动
sync_manager = SyncManager()
