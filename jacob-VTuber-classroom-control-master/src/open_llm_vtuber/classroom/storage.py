from __future__ import annotations

import io
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import yaml
from PIL import Image, UnidentifiedImageError

from .models import ClassroomProfile, ProfileFileItem, SnapshotItem

CLASSROOM_DATA_DIR = Path("classroom_data")
PROFILE_ROOT = CLASSROOM_DATA_DIR / "profiles"
RUNTIME_STATE_PATH = CLASSROOM_DATA_DIR / "runtime_state.json"
REGISTRY_DIR = CLASSROOM_DATA_DIR / "registry"
LOCAL_USERS_PATH = REGISTRY_DIR / "local_users.json"

# 用户名规则：仅字母与数字，1–32 字符（PRD S-2 / 开发文档 §13.1）
USERNAME_RE = re.compile(r"^[A-Za-z0-9]{1,32}$")
PROFILE_FILE_NAME_RE = re.compile(r"^[\w .()（）\u4e00-\u9fff-]{1,160}$", re.UNICODE)
MAX_PROFILE_FILE_BYTES = 50 * 1024 * 1024
MAX_SNAPSHOT_BYTES = 1024 * 1024
SNAPSHOT_FORMATS = {
    "image/jpeg": ("JPEG", "jpg"),
    "image/png": ("PNG", "png"),
    "image/webp": ("WEBP", "webp"),
}
PROFILE_CHARACTER_FIELDS = {
    "conf_name",
    "conf_uid",
    "avatar_mode",
    "avatar_pack_id",
    "live2d_model_name",
    "character_name",
    "human_name",
    "avatar",
    "persona_prompt",
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sanitize_profile_character_config(
    character_config: dict[str, Any],
) -> dict[str, Any]:
    return {
        key: value
        for key, value in character_config.items()
        if key in PROFILE_CHARACTER_FIELDS
    }


def merge_profile_character_config(
    base_config: dict[str, Any],
    profile_config: dict[str, Any],
) -> dict[str, Any]:
    merged = dict(base_config)
    merged.update(sanitize_profile_character_config(profile_config))
    return merged


def ensure_safe_username(username: str) -> str:
    """校验用户名合法性：仅字母数字，1–32 字符。返回去除首尾空白后的值。"""
    candidate = (username or "").strip()
    if not USERNAME_RE.fullmatch(candidate):
        raise ValueError("Invalid username (must be 1–32 letters or digits)")
    return candidate


def profile_dir_for_username(username: str) -> Path:
    """用户名作目录名：profiles/{username}/"""
    safe = ensure_safe_username(username)
    return PROFILE_ROOT / safe


def profile_paths(profile: ClassroomProfile) -> tuple[Path, Path, Path]:
    profile_dir = profile_dir_for_username(profile.username)
    return profile_dir, profile_dir / "profile.yaml", profile_dir / "manifest.json"


def manifest_from_profile(profile: ClassroomProfile) -> dict[str, Any]:
    return {
        "schema_version": profile.schema_version,
        "username": profile.username,
        "class_name": profile.class_name,
        "created_at": profile.created_at,
        "updated_at": profile.updated_at,
        "last_saved_at": profile.last_saved_at,
        "dirty": profile.dirty,
        "submitted": profile.submitted,
        "pending_sync": profile.pending_sync,
    }


def write_profile(profile: ClassroomProfile) -> ClassroomProfile:
    profile.schema_version = 2
    profile.character_config = sanitize_profile_character_config(
        profile.character_config
    )
    profile.character_config["conf_uid"] = profile.username
    profile_dir, profile_yaml_path, manifest_path = profile_paths(profile)
    profile_dir.mkdir(parents=True, exist_ok=True)
    profile_yaml_path.write_text(
        yaml.safe_dump(
            profile.model_dump(),
            allow_unicode=True,
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    manifest_path.write_text(
        json.dumps(manifest_from_profile(profile), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return profile


def create_profile(
    username: str,
    character_config: dict[str, Any],
    class_name: str | None = None,
    workspace_state: dict[str, Any] | None = None,
    pending_sync: bool = False,
) -> ClassroomProfile:
    username = ensure_safe_username(username)
    class_name = (class_name or "").strip() or None

    existing = get_profile(username)
    now = utc_now_iso()
    if existing:
        existing.character_config = sanitize_profile_character_config(character_config)
        if class_name is not None:
            existing.class_name = class_name
        if workspace_state is not None:
            existing.workspace_state = workspace_state
        existing.updated_at = now
        existing.last_saved_at = now
        existing.dirty = False
        existing.submitted = False
        return write_profile(existing)

    return write_profile(
        ClassroomProfile(
            username=username,
            class_name=class_name,
            character_config=sanitize_profile_character_config(character_config),
            workspace_state=workspace_state or {},
            created_at=now,
            updated_at=now,
            last_saved_at=now,
            pending_sync=pending_sync,
        )
    )


def read_profile_from_dir(profile_dir: Path) -> ClassroomProfile | None:
    profile_yaml_path = profile_dir / "profile.yaml"
    if not profile_yaml_path.is_file():
        return None
    data = yaml.safe_load(profile_yaml_path.read_text(encoding="utf-8")) or {}
    profile = ClassroomProfile.model_validate(data)
    profile.character_config = sanitize_profile_character_config(
        profile.character_config
    )
    profile.character_config["conf_uid"] = profile.username
    return profile


def iter_profiles() -> Iterable[ClassroomProfile]:
    if not PROFILE_ROOT.is_dir():
        return []

    profiles: list[ClassroomProfile] = []
    for profile_yaml_path in PROFILE_ROOT.glob("*/profile.yaml"):
        try:
            profile = read_profile_from_dir(profile_yaml_path.parent)
            if profile:
                profiles.append(profile)
        except Exception:
            continue
    return sorted(profiles, key=lambda item: (item.class_name or "", item.username))


def list_profiles(class_name: str | None = None) -> list[ClassroomProfile]:
    profiles = list(iter_profiles())
    if class_name:
        profiles = [item for item in profiles if item.class_name == class_name]
    return profiles


def get_profile(username: str) -> ClassroomProfile | None:
    username = ensure_safe_username(username)
    profile_dir = profile_dir_for_username(username)
    if not profile_dir.is_dir():
        return None
    return read_profile_from_dir(profile_dir)


def save_profile_from_character_config(
    username: str,
    character_config: dict[str, Any],
    *,
    submitted: bool | None = None,
    dirty: bool = False,
    workspace_state: dict[str, Any] | None = None,
) -> ClassroomProfile:
    profile = get_profile(username)
    if profile is None:
        raise KeyError(f"Profile not found: {username}")

    now = utc_now_iso()
    profile.character_config = sanitize_profile_character_config(character_config)
    if workspace_state is not None:
        profile.workspace_state = workspace_state
    profile.updated_at = now
    profile.last_saved_at = now
    profile.dirty = dirty
    if submitted is not None:
        profile.submitted = submitted
    return write_profile(profile)


def set_profile_dirty(username: str, dirty: bool = True) -> ClassroomProfile:
    profile = get_profile(username)
    if profile is None:
        raise KeyError(f"Profile not found: {username}")
    profile.dirty = dirty
    profile.updated_at = utc_now_iso()
    return write_profile(profile)


def save_profile_from_context(
    context: Any,
    *,
    submitted: bool | None = None,
    dirty: bool = False,
    workspace_state: dict[str, Any] | None = None,
) -> ClassroomProfile:
    username = getattr(context, "classroom_username", None)
    if not username:
        raise ValueError("No current classroom profile")
    character_config = context.character_config.model_dump(
        by_alias=True,
        exclude_none=True,
    )
    profile = save_profile_from_character_config(
        username,
        character_config,
        submitted=submitted,
        dirty=dirty,
        workspace_state=workspace_state,
    )
    attach_profile_metadata(context, profile)
    return profile


def attach_profile_metadata(context: Any, profile: ClassroomProfile) -> None:
    context.classroom_username = profile.username
    context.classroom_class_name = profile.class_name
    context.classroom_dirty = profile.dirty
    context.classroom_submitted = profile.submitted
    context.classroom_last_saved_at = profile.last_saved_at


def load_runtime_state() -> dict[str, Any]:
    if not RUNTIME_STATE_PATH.is_file():
        return {"current_username": None, "locked": False}
    try:
        data = json.loads(RUNTIME_STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"current_username": None, "locked": False}
        return {
            "current_username": data.get("current_username"),
            "locked": bool(data.get("locked", False)),
        }
    except Exception:
        return {"current_username": None, "locked": False}


def save_runtime_state(**updates: Any) -> dict[str, Any]:
    CLASSROOM_DATA_DIR.mkdir(parents=True, exist_ok=True)
    state = load_runtime_state()
    state.update(updates)
    RUNTIME_STATE_PATH.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return state


def profile_directory(username: str) -> Path:
    profile = get_profile(username)
    if profile is None:
        raise KeyError(f"Profile not found: {username}")
    profile_dir, _, _ = profile_paths(profile)
    return profile_dir


def profile_knowledge_directory(username: str) -> Path:
    return profile_directory(username) / "assets" / "knowledge"


def snapshot_profile_chat_history(username: str) -> None:
    username = ensure_safe_username(username)
    source = Path("chat_history") / username
    target = profile_directory(username) / "chat_history"
    if target.exists():
        shutil.rmtree(target)
    if source.is_dir():
        shutil.copytree(source, target)


def restore_profile_chat_history(username: str) -> None:
    username = ensure_safe_username(username)
    source = profile_directory(username) / "chat_history"
    target = Path("chat_history") / username
    if target.exists() or not source.is_dir():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, target)


def safe_profile_filename(filename: str) -> str:
    candidate = (filename or "").strip()
    if (
        not candidate
        or candidate in {".", ".."}
        or "/" in candidate
        or "\\" in candidate
        or not PROFILE_FILE_NAME_RE.fullmatch(candidate)
    ):
        raise ValueError("Invalid file name")
    return candidate


def profile_files_directory(username: str) -> Path:
    files_dir = profile_directory(username) / "files"
    files_dir.mkdir(parents=True, exist_ok=True)
    return files_dir


def profile_file_path(username: str, filename: str) -> Path:
    safe_name = safe_profile_filename(filename)
    files_dir = profile_files_directory(username)
    path = files_dir / safe_name
    if not path.resolve().is_relative_to(files_dir.resolve()):
        raise ValueError("Invalid file path")
    return path


def list_profile_files(username: str) -> list[ProfileFileItem]:
    files_dir = profile_files_directory(username)
    items: list[ProfileFileItem] = []
    for path in sorted(files_dir.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file():
            continue
        stat = path.stat()
        items.append(
            ProfileFileItem(
                name=path.name,
                size=stat.st_size,
                updated_at=datetime.fromtimestamp(
                    stat.st_mtime,
                    tz=timezone.utc,
                ).isoformat(),
            )
        )
    return items


def save_profile_file(username: str, filename: str, content: bytes) -> ProfileFileItem:
    if len(content) > MAX_PROFILE_FILE_BYTES:
        raise ValueError("File exceeds the 50 MB upload limit")
    path = profile_file_path(username, filename)
    path.write_bytes(content)
    stat = path.stat()
    return ProfileFileItem(
        name=path.name,
        size=stat.st_size,
        updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    )


def get_profile_file(username: str, filename: str) -> Path:
    path = profile_file_path(username, filename)
    if not path.is_file():
        raise FileNotFoundError(filename)
    return path


def delete_profile_file(username: str, filename: str) -> None:
    path = get_profile_file(username, filename)
    path.unlink()


def snapshot_directory(username: str | None) -> Path:
    if username:
        return profile_directory(username)
    return CLASSROOM_DATA_DIR


def validate_snapshot(content: bytes, content_type: str) -> str:
    expected = SNAPSHOT_FORMATS.get(content_type)
    if expected is None:
        raise ValueError("Snapshot must be a JPEG, PNG, or WebP image")
    if len(content) > MAX_SNAPSHOT_BYTES:
        raise ValueError("Snapshot exceeds the 1 MB upload limit")

    expected_format, extension = expected
    try:
        with Image.open(io.BytesIO(content)) as image:
            image.verify()
            actual_format = image.format
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ValueError("Snapshot is not a valid image") from exc
    if actual_format != expected_format:
        raise ValueError("Snapshot content does not match its content type")
    return extension


def save_snapshot(
    username: str | None,
    content: bytes,
    content_type: str,
) -> SnapshotItem:
    extension = validate_snapshot(content, content_type)
    directory = snapshot_directory(username)
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / f"snapshot.{extension}"
    temporary = directory / ".snapshot.tmp"
    temporary.write_bytes(content)
    temporary.replace(target)

    for _, other_extension in SNAPSHOT_FORMATS.values():
        other_path = directory / f"snapshot.{other_extension}"
        if other_path != target and other_path.is_file():
            other_path.unlink()

    stat = target.stat()
    return SnapshotItem(
        username=username,
        content_type=content_type,
        size=stat.st_size,
        updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    )


def get_snapshot(username: str | None) -> tuple[Path, SnapshotItem]:
    directory = snapshot_directory(username)
    candidates: list[tuple[Path, str]] = []
    for content_type, (_, extension) in SNAPSHOT_FORMATS.items():
        path = directory / f"snapshot.{extension}"
        if path.is_file():
            candidates.append((path, content_type))
    if not candidates:
        raise FileNotFoundError("Snapshot not found")

    path, content_type = max(candidates, key=lambda item: item[0].stat().st_mtime_ns)
    stat = path.stat()
    return path, SnapshotItem(
        username=username,
        content_type=content_type,
        size=stat.st_size,
        updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    )


def build_export_zip(username: str) -> bytes:
    profile = get_profile(username)
    if profile is None:
        raise KeyError(f"Profile not found: {username}")

    profile_dir, profile_yaml_path, manifest_path = profile_paths(profile)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(manifest_path, "manifest.json")
        archive.write(profile_yaml_path, "profile.yaml")

        for optional_name in (
            "snapshot.jpg",
            "snapshot.png",
            "snapshot.webp",
            "assets",
            "chat_history",
            "files",
        ):
            optional_path = profile_dir / optional_name
            if optional_path.is_file():
                archive.write(optional_path, optional_name)
            elif optional_path.is_dir():
                for child in optional_path.rglob("*"):
                    if child.is_file():
                        archive.write(child, child.relative_to(profile_dir).as_posix())

    return buffer.getvalue()


# ---------------------------------------------------------------------------
# 本地用户注册表（开发文档 §3.4 / §6.1）
# classroom_data/registry/local_users.json
# ---------------------------------------------------------------------------


class UserRegistry:
    """本地用户名注册表：离线去重 + pending_sync 标记。

    数据结构见开发文档 §3.4：
        { "version": 1, "users": [ {username, created_at, pending_sync, last_login_at} ] }
    """

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or LOCAL_USERS_PATH

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
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def list_users(self) -> list[dict[str, Any]]:
        return list(self._load().get("users", []))

    def get(self, username: str) -> dict[str, Any] | None:
        username = ensure_safe_username(username)
        for user in self._load().get("users", []):
            if user.get("username") == username:
                return user
        return None

    def exists(self, username: str) -> bool:
        return self.get(username) is not None

    def register(
        self,
        username: str,
        *,
        pending_sync: bool = False,
    ) -> dict[str, Any]:
        """登记一个用户名。已存在则更新 last_login_at / pending_sync。"""
        username = ensure_safe_username(username)
        data = self._load()
        users: list[dict[str, Any]] = data.get("users", [])
        now = utc_now_iso()
        for user in users:
            if user.get("username") == username:
                user["pending_sync"] = pending_sync
                user["last_login_at"] = now
                self._save(data)
                return user
        entry = {
            "username": username,
            "created_at": now,
            "pending_sync": pending_sync,
            "last_login_at": now,
        }
        users.append(entry)
        data["users"] = users
        self._save(data)
        return entry

    def mark_synced(self, username: str) -> None:
        username = ensure_safe_username(username)
        data = self._load()
        for user in data.get("users", []):
            if user.get("username") == username:
                user["pending_sync"] = False
                break
        self._save(data)

    def list_pending(self) -> list[dict[str, Any]]:
        return [
            user
            for user in self._load().get("users", [])
            if user.get("pending_sync")
        ]

    def rename(self, old_username: str, new_username: str) -> None:
        """改名：更新注册表条目。物理目录迁移由调用方负责。"""
        old_username = ensure_safe_username(old_username)
        new_username = ensure_safe_username(new_username)
        data = self._load()
        for user in data.get("users", []):
            if user.get("username") == old_username:
                user["username"] = new_username
                user["pending_sync"] = False
                user["last_login_at"] = utc_now_iso()
                break
        self._save(data)

    def remove(self, username: str) -> None:
        username = ensure_safe_username(username)
        data = self._load()
        data["users"] = [
            user
            for user in data.get("users", [])
            if user.get("username") != username
        ]
        self._save(data)


# ---------------------------------------------------------------------------
# 存档点（开发文档 §3.6 / §6.1）
# classroom_data/profiles/{username}/saves/{save_id}/
# ---------------------------------------------------------------------------


class SavePointStore:
    """存档点 CRUD：每个用户名下的 saves/ 子目录。

    数据结构见开发文档 §3.6：
        saves/{save_id}/save_meta.json  +  save.zip
    """

    META_NAME = "save_meta.json"
    SNAPSHOT_NAME = "save.zip"

    def __init__(self, username: str) -> None:
        self.username = ensure_safe_username(username)
        self.saves_dir = profile_dir_for_username(self.username) / "saves"

    def _meta_path(self, save_id: str) -> Path:
        safe = safe_save_id(save_id)
        return self.saves_dir / safe / self.META_NAME

    def list_saves(self) -> list[dict[str, Any]]:
        if not self.saves_dir.is_dir():
            return []
        metas: list[dict[str, Any]] = []
        for child in self.saves_dir.iterdir():
            meta_path = child / self.META_NAME
            if not meta_path.is_file():
                continue
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
                if isinstance(meta, dict):
                    metas.append(meta)
            except Exception:
                continue
        return sorted(metas, key=lambda item: item.get("created_at", ""), reverse=True)

    def get(self, save_id: str) -> dict[str, Any] | None:
        meta_path = self._meta_path(save_id)
        if not meta_path.is_file():
            return None
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            return meta if isinstance(meta, dict) else None
        except Exception:
            return None

    def create(
        self,
        save_id: str,
        snapshot_bytes: bytes,
        *,
        label: str | None = None,
    ) -> dict[str, Any]:
        safe = safe_save_id(save_id)
        save_dir = self.saves_dir / safe
        save_dir.mkdir(parents=True, exist_ok=True)
        (save_dir / self.SNAPSHOT_NAME).write_bytes(snapshot_bytes)
        now = utc_now_iso()
        meta = {
            "save_id": safe,
            "username": self.username,
            "created_at": now,
            "label": (label or "").strip() or None,
            "snapshot_file": self.SNAPSHOT_NAME,
        }
        (save_dir / self.META_NAME).write_text(
            json.dumps(meta, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return meta

    def snapshot_path(self, save_id: str) -> Path:
        safe = safe_save_id(save_id)
        path = self.saves_dir / safe / self.SNAPSHOT_NAME
        if not path.is_file():
            raise FileNotFoundError(f"Save snapshot not found: {save_id}")
        return path

    def delete(self, save_id: str) -> None:
        safe = safe_save_id(save_id)
        save_dir = self.saves_dir / safe
        if save_dir.is_dir():
            shutil.rmtree(save_dir)


def safe_save_id(save_id: str) -> str:
    """存档点 ID 安全校验：仅字母数字与 -，1–64 字符。"""
    candidate = (save_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9-]{1,64}", candidate):
        raise ValueError("Invalid save_id")
    return candidate


def rename_user(old_username: str, new_username: str) -> ClassroomProfile:
    """改名：物理迁移目录 + 更新 profile.yaml 内的 username/conf_uid。

    用于离线创建冲突后的改名场景（开发文档 §5.2）。
    注册表的更新由调用方经 UserRegistry.rename 完成。
    """
    old_username = ensure_safe_username(old_username)
    new_username = ensure_safe_username(new_username)
    old_dir = profile_dir_for_username(old_username)
    new_dir = profile_dir_for_username(new_username)
    if not old_dir.is_dir():
        raise KeyError(f"Profile not found: {old_username}")
    if new_dir.exists():
        raise ValueError(f"Username already exists: {new_username}")

    old_dir.rename(new_dir)
    profile = read_profile_from_dir(new_dir)
    if profile is None:
        raise KeyError(f"Profile corrupted after rename: {new_username}")
    profile.username = new_username
    profile = write_profile(profile)

    # 同步迁移 chat_history 顶层目录（如果存在）
    old_chat = Path("chat_history") / old_username
    new_chat = Path("chat_history") / new_username
    if old_chat.is_dir() and not new_chat.exists():
        new_chat.parent.mkdir(parents=True, exist_ok=True)
        old_chat.rename(new_chat)

    # 更新运行时状态
    state = load_runtime_state()
    if state.get("current_username") == old_username:
        save_runtime_state(current_username=new_username)

    return profile
