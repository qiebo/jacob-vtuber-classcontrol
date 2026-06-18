"""后台设备/用户扫描服务（PRD T-3 / 开发文档 §4.3.4）。

每 SCAN_INTERVAL 秒扫描所有已启用设备的状态，并拉取在线设备的用户列表。
扫描结果写回 DeviceStore（device.status_cache/last_seen/last_error）。
"""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from loguru import logger

if TYPE_CHECKING:
    from .app import DeviceStore, StudentClient  # type: ignore

DEFAULT_SCAN_INTERVAL = 60.0


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScanService:
    def __init__(
        self,
        store,
        client,
        *,
        interval: float | None = None,
    ) -> None:
        self.store = store
        self.client = client
        self.interval = (
            interval
            if interval is not None
            else float(os.getenv("JACOB_SCAN_INTERVAL", "60") or "60")
        )
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.last_scan_at: str | None = None
        self.next_scan_at: str | None = None

    async def scan_once(self) -> dict:
        """扫描所有设备一次，返回摘要。"""
        from .app import refresh_device_status  # 避免循环 import

        devices = self.store.load_devices()
        semaphore = asyncio.Semaphore(8)

        async def scan_one(device):
            async with semaphore:
                try:
                    if not device.enabled:
                        return {"device_id": device.id, "online": False, "error": "disabled"}
                    result = await refresh_device_status(self.client, device)
                    self.store.upsert_device(device)
                    return {
                        "device_id": device.id,
                        "online": result.get("online", False),
                        "error": result.get("error"),
                    }
                except Exception as exc:
                    return {"device_id": device.id, "online": False, "error": str(exc)}

        results = await asyncio.gather(*(scan_one(d) for d in devices))
        online = sum(1 for r in results if r.get("online"))
        self.last_scan_at = utc_now_iso()
        return {
            "scanned_at": self.last_scan_at,
            "total": len(devices),
            "online": online,
            "results": results,
        }

    async def _loop(self) -> None:
        logger.info(f"ScanService started (interval={self.interval}s)")
        while not self._stop.is_set():
            try:
                await self.scan_once()
            except Exception as exc:
                logger.debug(f"scan loop error: {exc}")
            self.next_scan_at = utc_now_iso()  # 近似
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval)
            except asyncio.TimeoutError:
                pass
        logger.info("ScanService stopped")

    def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        try:
            self._task = asyncio.create_task(self._loop())
        except RuntimeError:
            pass  # 无事件循环

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            try:
                await asyncio.wait_for(self._task, timeout=self.interval + 2)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None

    def status(self) -> dict:
        return {
            "last_scan_at": self.last_scan_at,
            "next_scan_in": self.interval,
            "interval": self.interval,
        }
