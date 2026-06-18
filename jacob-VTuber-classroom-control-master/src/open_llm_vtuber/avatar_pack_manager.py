import hashlib
import json
import re
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Dict, List, Tuple

from loguru import logger
from PIL import Image, ImageSequence

AVATAR_PACKS_DIR = Path("avatar_pack")
CUSTOM_AVATAR_PACKS_REGISTRY_PATH = AVATAR_PACKS_DIR / ".custom_packs.json"
DEFAULT_PACK_NAME = "默认形象"
DEFAULT_PACK_ID = "default_avatarpack"

SUPPORTED_INPUT_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".zip",
}

ACTION_ALIASES = {
    "idle": "idle",
    "waiting": "idle",
    "waitiing": "idle",
    "talk": "speaking",
    "speaking": "speaking",
    "thinking": "thinking",
    "listening": "listening",
    "action": "action",
}

DEFAULT_ACTION_FPS = {
    "idle": 6,
    "listening": 8,
    "thinking": 8,
    "speaking": 12,
    "action": 12,
}

MAX_FRAMES_PER_ACTION = 240
MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES = 500 * 1024 * 1024
IGNORED_ARCHIVE_FILENAMES = {".ds_store", "thumbs.db"}
STANDARD_ACTIONS = ("idle", "listening", "thinking", "speaking")


class AvatarPackError(RuntimeError):
    """Raised when avatar pack conversion fails."""


@dataclass
class UploadedAsset:
    path: Path
    original_name: str
    extension: str


@dataclass(frozen=True)
class ClassifiedAction:
    action_name: str
    action_group_name: str | None = None


def ensure_avatar_pack_root() -> None:
    AVATAR_PACKS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_stem(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip()).strip("._-")
    return normalized


def _normalize_display_name(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().casefold()


def resolve_pack_id(pack_name: str) -> str:
    safe = _safe_stem(pack_name)
    if safe:
        return safe.lower()
    hashed = hashlib.sha1(pack_name.encode("utf-8")).hexdigest()[:10]
    return f"pack_{hashed}"


def _validated_pack_id(pack_id: str) -> str:
    safe_pack_id = _safe_stem(pack_id).lower()
    if not safe_pack_id or safe_pack_id != (pack_id or "").strip().lower():
        return ""
    return safe_pack_id


def _resolve_upload_pack_id(resolved_pack_name: str, custom_pack_ids: set[str]) -> str:
    base_pack_id = resolve_pack_id(resolved_pack_name)

    existing_pack_ids = {
        entry.name
        for entry in AVATAR_PACKS_DIR.iterdir()
        if entry.is_dir() and not entry.name.startswith(".")
    }
    if base_pack_id not in existing_pack_ids and base_pack_id not in custom_pack_ids:
        return base_pack_id

    index = 1
    while True:
        candidate = f"{base_pack_id}_{index}"
        if candidate not in existing_pack_ids and candidate not in custom_pack_ids:
            return candidate
        index += 1


def sanitize_pack_name(pack_name: str) -> str:
    normalized = (pack_name or "").strip()
    if not normalized:
        raise AvatarPackError("人物形象名称不能为空")
    return normalized[:80]


def sanitize_input_filename(filename: str) -> Tuple[str, str]:
    raw_name = Path(filename or "").name
    stem = Path(raw_name).stem
    extension = Path(raw_name).suffix.lower()
    safe_stem = _safe_stem(stem)
    if not safe_stem:
        safe_stem = "asset"
    return safe_stem, extension


def _load_custom_packs() -> set[str]:
    ensure_avatar_pack_root()
    if not CUSTOM_AVATAR_PACKS_REGISTRY_PATH.exists():
        return set()
    try:
        parsed = json.loads(CUSTOM_AVATAR_PACKS_REGISTRY_PATH.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            return set()
        return {item for item in parsed if isinstance(item, str)}
    except Exception as exc:
        logger.error(f"Failed to load custom avatar pack registry: {exc}")
        return set()


def _save_custom_packs(pack_ids: set[str]) -> None:
    ensure_avatar_pack_root()
    CUSTOM_AVATAR_PACKS_REGISTRY_PATH.write_text(
        json.dumps(sorted(pack_ids), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def classify_action_from_name(filename: str) -> ClassifiedAction:
    stem = Path(filename).stem.lower()
    parts = [part for part in re.split(r"[_-]+", stem) if part]
    if not parts:
        raise AvatarPackError(
            f"素材命名不符合规则：{Path(filename).name}。"
            "请使用 idle/listening/thinking/speaking/action 前缀。"
        )

    action_alias = ACTION_ALIASES.get(parts[0])
    if not action_alias:
        raise AvatarPackError(
            f"素材命名不符合规则：{Path(filename).name}。"
            "请使用 idle/listening/thinking/speaking/action 前缀。"
        )

    if action_alias != "action":
        return ClassifiedAction(action_name=action_alias)

    action_index = 1
    if len(parts) >= 2 and parts[1].isdigit():
        action_index = max(1, int(parts[1]))

    return ClassifiedAction(
        action_name="action",
        action_group_name=f"action_{action_index:02d}",
    )


def _read_gif_frames(gif_path: Path) -> List[Image.Image]:
    frames: List[Image.Image] = []
    with Image.open(gif_path) as image:
        for frame in ImageSequence.Iterator(image):
            frames.append(frame.convert("RGBA").copy())
            if len(frames) >= MAX_FRAMES_PER_ACTION:
                break
    if not frames:
        raise AvatarPackError("GIF 中未提取到有效帧。")
    return frames


def _read_single_image(image_path: Path) -> List[Image.Image]:
    with Image.open(image_path) as image:
        return [image.convert("RGBA").copy()]


def _read_asset_frames(asset: UploadedAsset, temp_root: Path) -> List[Image.Image]:
    extension = asset.extension
    if extension in {".png", ".jpg", ".jpeg", ".webp"}:
        return _read_single_image(asset.path)
    if extension == ".gif":
        return _read_gif_frames(asset.path)
    raise AvatarPackError(f"不支持的素材格式: {extension}")


def _should_skip_archive_member(relative_path: Path) -> bool:
    if not relative_path.parts:
        return True
    if "__MACOSX" in relative_path.parts:
        return True
    if any(part.startswith(".") for part in relative_path.parts):
        return True
    if relative_path.name.lower() in IGNORED_ARCHIVE_FILENAMES:
        return True
    return False


def _extract_zip_assets(archive_asset: UploadedAsset, temp_root: Path) -> List[UploadedAsset]:
    extract_root = temp_root / f"archive_{_safe_stem(Path(archive_asset.original_name).stem)}"
    extract_root.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(archive_asset.path) as archive:
            file_members = [item for item in archive.infolist() if not item.is_dir()]
            if not file_members:
                raise AvatarPackError("压缩包中未找到可用素材文件。")

            total_uncompressed_bytes = sum(max(item.file_size, 0) for item in file_members)
            if total_uncompressed_bytes > MAX_ARCHIVE_TOTAL_UNCOMPRESSED_BYTES:
                raise AvatarPackError("压缩包解压后的内容过大，请拆分后重试。")

            extracted_assets: List[UploadedAsset] = []
            extracted_index = 0
            for member in sorted(file_members, key=lambda item: item.filename.lower()):
                relative_path = Path(member.filename)
                if relative_path.is_absolute() or ".." in relative_path.parts:
                    raise AvatarPackError("压缩包包含非法文件路径，请重新打包后上传。")
                if _should_skip_archive_member(relative_path):
                    continue

                safe_stem, extension = sanitize_input_filename(relative_path.name)
                if extension not in SUPPORTED_INPUT_EXTENSIONS - {".zip"}:
                    raise AvatarPackError(
                        f"压缩包包含不支持的素材格式：{relative_path.name}。"
                        "仅支持 png/jpg/jpeg/webp/gif。"
                    )

                target_path = extract_root / f"{extracted_index:04d}_{safe_stem}{extension}"
                with archive.open(member) as source, target_path.open("wb") as target:
                    shutil.copyfileobj(source, target)

                extracted_assets.append(
                    UploadedAsset(
                        path=target_path,
                        original_name=relative_path.as_posix(),
                        extension=extension,
                    )
                )
                extracted_index += 1
    except zipfile.BadZipFile as exc:
        raise AvatarPackError("上传的 zip 压缩包无效，请重新打包后重试。") from exc

    if not extracted_assets:
        raise AvatarPackError("压缩包中未找到可用素材文件。")

    return extracted_assets


def _expand_uploaded_assets(uploaded_files: List[UploadedAsset], temp_root: Path) -> List[UploadedAsset]:
    expanded_assets: List[UploadedAsset] = []
    for asset in sorted(uploaded_files, key=lambda item: item.original_name.lower()):
        if asset.extension == ".zip":
            expanded_assets.extend(_extract_zip_assets(asset, temp_root=temp_root))
            continue
        expanded_assets.append(asset)

    if not expanded_assets:
        raise AvatarPackError("未检测到可用素材，请检查上传内容。")

    return expanded_assets


def _normalize_frame_size(frame: Image.Image, canvas_size: Tuple[int, int]) -> Image.Image:
    canvas_width, canvas_height = canvas_size
    resized = frame.copy()
    resized.thumbnail((canvas_width, canvas_height), Image.Resampling.LANCZOS)
    normalized = Image.new("RGBA", (canvas_width, canvas_height), (0, 0, 0, 0))
    offset_x = (canvas_width - resized.width) // 2
    offset_y = canvas_height - resized.height
    normalized.paste(resized, (offset_x, offset_y), resized)
    return normalized


def _determine_canvas_size(frames_by_action: Dict[str, List[Image.Image]]) -> Tuple[int, int]:
    action_order = ["idle", "listening", "thinking", "speaking", "action"]
    for action in action_order:
        if frames_by_action.get(action):
            first_frame = frames_by_action[action][0]
            return first_frame.width, first_frame.height

    raise AvatarPackError("未检测到可用帧，无法构建人物形象。")


def _write_action_frames(
    pack_root: Path,
    action_name: str,
    frames: List[Image.Image],
    canvas_size: Tuple[int, int],
) -> List[str]:
    action_dir = pack_root / "actions" / action_name
    action_dir.mkdir(parents=True, exist_ok=True)
    existing_files = [item for item in action_dir.iterdir() if item.is_file()]
    for existing in existing_files:
        existing.unlink()

    written_files: List[str] = []
    for index, frame in enumerate(frames, start=1):
        normalized = _normalize_frame_size(frame, canvas_size)
        output_file = action_dir / f"{index:04d}.png"
        normalized.save(output_file, format="PNG", optimize=True)
        written_files.append(f"actions/{action_name}/{output_file.name}")

    return written_files


def _create_thumbnail(pack_root: Path, frame: Image.Image) -> str:
    thumb = frame.copy()
    thumb.thumbnail((256, 256), Image.Resampling.LANCZOS)
    thumb_path = pack_root / "thumb.png"
    thumb.save(thumb_path, format="PNG", optimize=True)
    return "thumb.png"


def _build_manifest(
    pack_id: str,
    pack_name: str,
    canvas_size: Tuple[int, int],
    action_frames: Dict[str, List[str]],
    action_group_frames: Dict[str, List[str]],
) -> Dict:
    actions: Dict[str, Dict] = {}
    for action_name in STANDARD_ACTIONS:
        frames = action_frames.get(action_name) or []
        if not frames:
            continue
        actions[action_name] = {
            "fps": DEFAULT_ACTION_FPS.get(action_name, 8),
            "loop": True,
            "frames": frames,
        }

    if "idle" not in actions:
        raise AvatarPackError("缺少 idle 动作，无法生成人物形象包。")

    action_groups = []
    for action_group_name in sorted(action_group_frames.keys()):
        frames = action_group_frames[action_group_name]
        if not frames:
            continue
        action_groups.append(
            {
                "name": action_group_name,
                "fps": DEFAULT_ACTION_FPS["action"],
                "loop": False,
                "frames": frames,
            }
        )

    return {
        "pack_id": pack_id,
        "name": pack_name,
        "version": 2,
        "canvas": {"width": canvas_size[0], "height": canvas_size[1]},
        "anchor": {"x": 0.5, "y": 0.5},
        "actions": actions,
        "action_groups": action_groups,
        "fallback_map": {
            "listening": "idle",
            "thinking": "idle",
            "speaking": "idle",
        },
    }


def _load_manifest(pack_dir: Path) -> Dict | None:
    manifest_path = pack_dir / "manifest.json"
    if not manifest_path.is_file():
        return None
    try:
        parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(parsed, dict):
            return None
        return parsed
    except Exception as exc:
        logger.error(f"Failed to read avatar pack manifest {manifest_path}: {exc}")
        return None


def _avatar_pack_name_exists(pack_name: str) -> bool:
    target_name = _normalize_display_name(pack_name)
    if not target_name:
        return False

    ensure_avatar_pack_root()
    for pack_dir in AVATAR_PACKS_DIR.iterdir():
        if not pack_dir.is_dir() or pack_dir.name.startswith("."):
            continue
        manifest = _load_manifest(pack_dir)
        if not manifest:
            continue
        existing_name = str(manifest.get("name") or pack_dir.name)
        if _normalize_display_name(existing_name) == target_name:
            return True

    return False


def ensure_default_avatar_pack() -> None:
    ensure_avatar_pack_root()
    default_pack_root = AVATAR_PACKS_DIR / DEFAULT_PACK_ID
    manifest_path = default_pack_root / "manifest.json"
    if manifest_path.is_file():
        return

    avatar_candidates = sorted(Path("avatars").glob("*.png"))
    if not avatar_candidates:
        logger.warning("No avatar PNG found to bootstrap default avatar pack.")
        return

    source_avatar = avatar_candidates[0]
    default_pack_root.mkdir(parents=True, exist_ok=True)

    with Image.open(source_avatar) as image:
        base_frame = image.convert("RGBA")
        canvas_size = (base_frame.width, base_frame.height)
        idle_frames = _write_action_frames(default_pack_root, "idle", [base_frame], canvas_size)
        speaking_frames = _write_action_frames(
            default_pack_root,
            "speaking",
            [base_frame],
            canvas_size,
        )
        thumbnail_path = _create_thumbnail(default_pack_root, base_frame)

    manifest = _build_manifest(
        pack_id=DEFAULT_PACK_ID,
        pack_name=DEFAULT_PACK_NAME,
        canvas_size=canvas_size,
        action_frames={
            "idle": idle_frames,
            "speaking": speaking_frames,
        },
        action_group_frames={},
    )
    manifest["thumb"] = thumbnail_path
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def list_avatar_packs() -> List[Dict]:
    ensure_default_avatar_pack()
    custom_pack_ids = _load_custom_packs()
    packs: List[Dict] = []

    for pack_dir in AVATAR_PACKS_DIR.iterdir():
        if not pack_dir.is_dir() or pack_dir.name.startswith("."):
            continue
        manifest = _load_manifest(pack_dir)
        if not manifest:
            continue

        pack_id = str(manifest.get("pack_id") or pack_dir.name)
        pack_name = str(manifest.get("name") or pack_id)
        actions = manifest.get("actions")
        if not isinstance(actions, dict):
            actions = {}

        has_action = False
        action_groups = manifest.get("action_groups")
        if isinstance(action_groups, list):
            has_action = any(
                isinstance(item, dict)
                and isinstance(item.get("frames"), list)
                and len(item.get("frames") or []) > 0
                for item in action_groups
            )
        if not has_action:
            action_entry = actions.get("action")
            if isinstance(action_entry, dict):
                frames = action_entry.get("frames")
                if isinstance(frames, list) and len(frames) > 0:
                    has_action = True

        thumb = str(manifest.get("thumb") or "thumb.png")
        thumb_url = f"/avatar-packs/{pack_dir.name}/{thumb}"
        is_custom = pack_id in custom_pack_ids
        packs.append(
            {
                "pack_id": pack_id,
                "name": pack_name,
                "thumb_url": thumb_url,
                "is_custom": is_custom,
                "can_delete": is_custom,
                "has_action": has_action,
            }
        )

    packs.sort(key=lambda item: (item["is_custom"], item["name"].lower()))
    return packs


def avatar_pack_exists(pack_id: str) -> bool:
    safe_pack_id = _validated_pack_id(pack_id)
    if not safe_pack_id:
        return False
    pack_dir = AVATAR_PACKS_DIR / safe_pack_id
    return (pack_dir / "manifest.json").is_file()


def delete_custom_avatar_pack(pack_id: str) -> bool:
    safe_pack_id = _validated_pack_id(pack_id)
    if not safe_pack_id:
        raise AvatarPackError("无效的人物形象 ID")

    custom_pack_ids = _load_custom_packs()
    if safe_pack_id not in custom_pack_ids:
        raise AvatarPackError("仅支持删除自定义上传的人物形象")

    target_dir = AVATAR_PACKS_DIR / safe_pack_id
    if target_dir.exists():
        shutil.rmtree(target_dir)

    custom_pack_ids.discard(safe_pack_id)
    _save_custom_packs(custom_pack_ids)
    return True


def process_avatar_pack_upload(pack_name: str, uploaded_files: List[UploadedAsset]) -> Dict:
    resolved_pack_name = sanitize_pack_name(pack_name)
    if not uploaded_files:
        raise AvatarPackError("请至少上传一个素材文件")

    ensure_default_avatar_pack()
    if _avatar_pack_name_exists(resolved_pack_name):
        raise AvatarPackError(f"人物形象名称已存在：{resolved_pack_name}，请修改后再上传")

    custom_pack_ids = _load_custom_packs()
    pack_id = _resolve_upload_pack_id(resolved_pack_name, custom_pack_ids)
    pack_root = AVATAR_PACKS_DIR / pack_id
    pack_root.mkdir(parents=True, exist_ok=True)

    frames_by_action: Dict[str, List[Image.Image]] = {
        "idle": [],
        "listening": [],
        "thinking": [],
        "speaking": [],
    }
    frames_by_action_group: Dict[str, List[Image.Image]] = {}

    with TemporaryDirectory(prefix="avatarpack_frames_") as temp_dir:
        temp_root = Path(temp_dir)
        expanded_assets = _expand_uploaded_assets(uploaded_files, temp_root=temp_root)

        for asset in expanded_assets:
            classified_action = classify_action_from_name(asset.original_name)
            asset_frames = _read_asset_frames(asset, temp_root=temp_root)
            if classified_action.action_name == "action":
                action_group_name = classified_action.action_group_name or "action_01"
                frames_by_action_group.setdefault(action_group_name, []).extend(
                    asset_frames[:MAX_FRAMES_PER_ACTION]
                )
                continue
            frames_by_action[classified_action.action_name].extend(
                asset_frames[:MAX_FRAMES_PER_ACTION]
            )

    canvas_candidates = {
        **frames_by_action,
        "action": next(iter(frames_by_action_group.values()), []),
    }
    canvas_size = _determine_canvas_size(canvas_candidates)
    action_frames: Dict[str, List[str]] = {}
    for action_name, frames in frames_by_action.items():
        if not frames:
            continue
        action_frames[action_name] = _write_action_frames(
            pack_root=pack_root,
            action_name=action_name,
            frames=frames,
            canvas_size=canvas_size,
        )

    action_group_frames: Dict[str, List[str]] = {}
    for action_group_name, frames in frames_by_action_group.items():
        if not frames:
            continue
        action_group_frames[action_group_name] = _write_action_frames(
            pack_root=pack_root,
            action_name=action_group_name,
            frames=frames,
            canvas_size=canvas_size,
        )

    preview_source = None
    for candidate_action in ["idle", "listening", "thinking", "speaking"]:
        frames = frames_by_action.get(candidate_action) or []
        if frames:
            preview_source = frames[0]
            break
    if preview_source is None:
        for frames in frames_by_action_group.values():
            if frames:
                preview_source = frames[0]
                break
    if preview_source is None:
        raise AvatarPackError("未生成有效帧，请检查上传素材。")

    thumb = _create_thumbnail(pack_root, preview_source)
    manifest = _build_manifest(
        pack_id=pack_id,
        pack_name=resolved_pack_name,
        canvas_size=canvas_size,
        action_frames=action_frames,
        action_group_frames=action_group_frames,
    )
    manifest["thumb"] = thumb

    (pack_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    custom_pack_ids.add(pack_id)
    _save_custom_packs(custom_pack_ids)

    return {
        "pack_id": pack_id,
        "name": resolved_pack_name,
        "thumb_url": f"/avatar-packs/{pack_id}/{thumb}",
        "is_custom": True,
        "can_delete": True,
    }
