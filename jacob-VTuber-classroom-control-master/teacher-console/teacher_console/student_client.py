from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .storage import Device


class StudentClient:
    def __init__(
        self,
        *,
        connect_timeout: float = 1.5,
        read_timeout: float = 3.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.timeout = httpx.Timeout(
            connect=connect_timeout,
            read=read_timeout,
            write=10.0,
            pool=connect_timeout,
        )
        self.http = httpx.AsyncClient(
            timeout=self.timeout,
            transport=transport,
            follow_redirects=False,
        )

    async def close(self) -> None:
        await self.http.aclose()

    @staticmethod
    def _headers(token: str) -> dict[str, str]:
        return {"X-Classroom-Token": token} if token else {}

    async def get_status(self, device: Device) -> dict[str, Any]:
        return await self.get_status_url(device.base_url, device.token)

    async def get_status_url(self, base_url: str, token: str = "") -> dict[str, Any]:
        response = await self.http.get(
            f"{base_url.rstrip('/')}/classroom/status",
            headers=self._headers(token),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid classroom status response")
        return payload

    async def get_thumbnail(self, device: Device) -> bytes:
        """拉取学生端最新缩略图（GET /classroom/snapshot，PRD T-5）。"""
        response = await self.http.get(
            f"{device.base_url.rstrip('/')}/classroom/snapshot",
            headers=self._headers(device.token),
        )
        response.raise_for_status()
        return response.content

    async def set_lock(self, device: Device, locked: bool) -> dict[str, Any]:
        response = await self.http.post(
            f"{device.base_url}/classroom/app-lock",
            json={"locked": locked},
            headers=self._headers(device.token),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid app-lock response")
        return payload

    async def force_save(self, device: Device) -> dict[str, Any]:
        """强制学生端保存（PRD T-6）。"""
        response = await self.http.post(
            f"{device.base_url.rstrip('/')}/classroom/profile/save",
            headers=self._headers(device.token),
        )
        response.raise_for_status()
        return response.json()

    async def force_submit(self, device: Device) -> dict[str, Any]:
        """强制学生端提交（PRD T-6）。"""
        response = await self.http.post(
            f"{device.base_url.rstrip('/')}/classroom/profile/submit",
            headers=self._headers(device.token),
        )
        response.raise_for_status()
        return response.json()

    async def collect_profile(
        self,
        device: Device,
        username: str,
        output_dir: Path,
    ) -> Path:
        day_dir = output_dir / datetime.now().strftime("%Y-%m-%d")
        day_dir.mkdir(parents=True, exist_ok=True)
        # username 规则已是纯字母数字（^[A-Za-z0-9]{1,32}$），此处保留清洗以防外部输入
        safe_username = "".join(
            character if character.isalnum() or character in "._-" else "_"
            for character in username
        )
        filename = f"{device.id}_{safe_username}.zip"
        path = day_dir / filename
        temporary_path = path.with_suffix(".zip.part")
        first_bytes = b""
        try:
            async with self.http.stream(
                "GET",
                f"{device.base_url}/classroom/profile/{quote(username, safe='')}/export",
                headers=self._headers(device.token),
                timeout=httpx.Timeout(
                    connect=self.timeout.connect,
                    read=30.0,
                    write=10.0,
                    pool=3.0,
                ),
            ) as response:
                response.raise_for_status()
                content_type = response.headers.get("content-type", "")
                with temporary_path.open("wb") as file_handle:
                    async for chunk in response.aiter_bytes():
                        if not first_bytes:
                            first_bytes = chunk[:2]
                        file_handle.write(chunk)
            if "zip" not in content_type and first_bytes != b"PK":
                raise ValueError("Export response is not a zip file")
            temporary_path.replace(path)
        except Exception:
            temporary_path.unlink(missing_ok=True)
            raise
        return path

    async def get_snapshot(self, device: Device) -> tuple[bytes, str, str | None]:
        response = await self.http.get(
            f"{device.base_url}/classroom/snapshot",
            headers=self._headers(device.token),
        )
        response.raise_for_status()
        if len(response.content) > 1024 * 1024:
            raise ValueError("Snapshot exceeds the 1 MB limit")
        return (
            response.content,
            response.headers.get("content-type", "application/octet-stream"),
            response.headers.get("x-snapshot-updated-at"),
        )

    async def upload_file(
        self,
        device: Device,
        path: Path,
        filename: str,
        content_type: str,
    ) -> dict[str, Any]:
        with path.open("rb") as file_handle:
            response = await self.http.post(
                f"{device.base_url}/classroom/profile/files/upload",
                headers=self._headers(device.token),
                files={"file": (filename, file_handle, content_type)},
                timeout=httpx.Timeout(
                    connect=self.timeout.connect,
                    read=30.0,
                    write=60.0,
                    pool=3.0,
                ),
            )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid file upload response")
        return payload

    async def restore_workspace(
        self,
        device: Device,
        path: Path,
        filename: str,
    ) -> dict[str, Any]:
        """下发作品 ZIP 并触发学生端 /workspace/restore（MVP T-5）。"""
        with path.open("rb") as file_handle:
            response = await self.http.post(
                f"{device.base_url.rstrip('/')}/workspace/inbox",
                headers=self._headers(device.token),
                files={"file": (filename, file_handle, "application/zip")},
                timeout=httpx.Timeout(
                    connect=self.timeout.connect,
                    read=60.0,
                    write=120.0,
                    pool=3.0,
                ),
            )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Invalid workspace restore response")
        return payload
