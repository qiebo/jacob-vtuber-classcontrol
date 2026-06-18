from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


@dataclass
class Device:
    id: str
    name: str
    base_url: str
    group: str = ""
    enabled: bool = True
    token: str = ""
    last_seen: str | None = None
    status_cache: dict[str, Any] | None = None
    latency_ms: int | None = None
    last_error: str | None = None

    def public_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload.pop("token", None)
        return payload


class DeviceStore:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.devices_path = data_dir / "devices.json"
        self.collections_dir = data_dir / "collections"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.collections_dir.mkdir(parents=True, exist_ok=True)

    def load_devices(self) -> list[Device]:
        if not self.devices_path.is_file():
            return []
        payload = json.loads(self.devices_path.read_text(encoding="utf-8"))
        devices = payload.get("devices", []) if isinstance(payload, dict) else []
        field_names = set(Device.__dataclass_fields__)
        return [
            Device(**{key: value for key, value in item.items() if key in field_names})
            for item in devices
            if isinstance(item, dict)
        ]

    def save_devices(self, devices: list[Device]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.devices_path.write_text(
            json.dumps(
                {"devices": [asdict(device) for device in devices]},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def get_device(self, device_id: str) -> Device:
        for device in self.load_devices():
            if device.id == device_id:
                return device
        raise KeyError(device_id)

    def upsert_device(self, device: Device) -> Device:
        devices = [item for item in self.load_devices() if item.id != device.id]
        devices.append(device)
        devices.sort(key=lambda item: (item.group, item.name, item.id))
        self.save_devices(devices)
        return device

    def delete_device(self, device_id: str) -> bool:
        devices = self.load_devices()
        remaining = [item for item in devices if item.id != device_id]
        self.save_devices(remaining)
        return len(remaining) != len(devices)


def normalize_device_id(value: str) -> str:
    candidate = (value or "").strip()
    if not DEVICE_ID_RE.fullmatch(candidate):
        raise ValueError("Invalid device id")
    return candidate


def normalize_base_url(value: str) -> str:
    candidate = (value or "").strip().rstrip("/")
    if not candidate.startswith(("http://", "https://")):
        raise ValueError("base_url must start with http:// or https://")
    return candidate


def device_from_payload(
    payload: dict[str, Any],
    existing: Device | None = None,
) -> Device:
    token = payload.get("token")
    if token is None and existing is not None:
        token = existing.token
    return Device(
        id=normalize_device_id(str(payload.get("id") or "")),
        name=str(payload.get("name") or payload.get("id") or "").strip(),
        base_url=normalize_base_url(str(payload.get("base_url") or "")),
        group=str(payload.get("group") or "").strip(),
        enabled=bool(payload.get("enabled", True)),
        token=str(token or "").strip(),
        last_seen=existing.last_seen if existing else None,
        status_cache=existing.status_cache if existing else None,
        latency_ms=existing.latency_ms if existing else None,
        last_error=existing.last_error if existing else None,
    )
