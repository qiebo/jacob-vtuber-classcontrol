from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# 用户名规则：仅字母与数字，1–32 字符（见 PRD S-2 / 开发文档 §13.1）
USERNAME_RE_PATTERN = r"^[A-Za-z0-9]{1,32}$"


class CreateProfileRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32, pattern=USERNAME_RE_PATTERN)
    class_name: str | None = None
    workspace_state: dict[str, Any] | None = None


class LoadProfileRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=32, pattern=USERNAME_RE_PATTERN)


class AppLockRequest(BaseModel):
    locked: bool


class SaveProfileRequest(BaseModel):
    workspace_state: dict[str, Any] | None = None


class DirtyProfileRequest(BaseModel):
    dirty: bool = True


class ProfileFileItem(BaseModel):
    name: str
    size: int
    updated_at: str


class SnapshotItem(BaseModel):
    username: str | None = None
    content_type: str
    size: int
    updated_at: str


class ClassroomProfile(BaseModel):
    schema_version: int = 2
    username: str
    class_name: str | None = None
    character_config: dict[str, Any]
    workspace_state: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    last_saved_at: str | None = None
    dirty: bool = False
    submitted: bool = False
    pending_sync: bool = False


class ClassroomStatus(BaseModel):
    device_id: str
    device_name: str
    api_version: str
    online: bool
    app_ready: bool
    server_time: str
    current_username: str | None = None
    class_name: str | None = None
    character_name: str | None = None
    avatar_mode: str | None = None
    avatar_pack_id: str | None = None
    live2d_model_name: str | None = None
    dirty: bool = False
    submitted: bool = False
    last_saved_at: str | None = None
    snapshot_updated_at: str | None = None
    locked: bool = False
