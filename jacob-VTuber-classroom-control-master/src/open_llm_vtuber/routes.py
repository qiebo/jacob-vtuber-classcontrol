import json
import re
import io
import shutil
import subprocess
import zipfile
from uuid import uuid4
import numpy as np
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from fastapi import APIRouter, WebSocket, UploadFile, File, Form, Response
from starlette.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect
from loguru import logger
from .service_context import ServiceContext
from .websocket_handler import WebSocketHandler
from .proxy_handler import ProxyHandler
from .avatar_pack_manager import (
    AvatarPackError,
    UploadedAsset,
    SUPPORTED_INPUT_EXTENSIONS as SUPPORTED_AVATAR_PACK_EXTENSIONS,
    sanitize_input_filename as sanitize_avatar_input_filename,
    process_avatar_pack_upload,
    list_avatar_packs,
    delete_custom_avatar_pack,
)
from .knowledge_service import (
    add_knowledge_file,
    delete_knowledge_file,
    get_knowledge_overview,
)

SUPPORTED_BACKGROUND_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_BACKGROUND_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024
PROTECTED_BACKGROUND_FILENAMES = {"ceiling-window-room-night.jpeg"}
SUPPORTED_LIVE2D_ARCHIVE_EXTENSIONS = {".zip"}
MAX_LIVE2D_MODEL_UPLOAD_SIZE_BYTES = 120 * 1024 * 1024
MAX_LIVE2D_MODEL_ARCHIVE_TOTAL_BYTES = 512 * 1024 * 1024
MAX_AVATAR_PACK_SINGLE_FILE_BYTES = 200 * 1024 * 1024
MAX_AVATAR_PACK_TOTAL_BYTES = 500 * 1024 * 1024
MAX_AVATAR_PACK_FILE_COUNT = 300
LIVE2D_MODELS_DIR = Path("live2d-models")
AVATARS_DIR = Path("avatars")
MODEL_DICT_PATH = Path("model_dict.json")
CUSTOM_LIVE2D_MODELS_REGISTRY_PATH = LIVE2D_MODELS_DIR / ".custom_models.json"
BACKGROUND_DIR = Path("backgrounds")


def normalize_duplicate_name(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().casefold()


def sanitize_upload_filename(filename: str) -> tuple[str, str]:
    raw_name = Path(filename or "").name
    stem = Path(raw_name).stem
    extension = Path(raw_name).suffix.lower()

    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._")
    if not safe_stem:
        safe_stem = "background"

    return safe_stem, extension


def sanitize_background_filename(filename: str) -> str:
    raw_name = Path(filename or "").name
    if raw_name in {"", ".", ".."}:
        return ""
    if raw_name != filename:
        return ""
    return raw_name


def sanitize_live2d_model_name(model_name: str) -> str:
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", (model_name or "").strip())
    safe_name = safe_name.strip("._-")
    if not safe_name:
        safe_name = "live2d_model"
    return safe_name


def build_unique_live2d_model_name(base_name: str, existing_names: set[str]) -> str:
    if base_name not in existing_names:
        return base_name

    index = 1
    while True:
        candidate = f"{base_name}_{index}"
        if candidate not in existing_names:
            return candidate
        index += 1


def load_model_dict_entries() -> list[dict]:
    if not MODEL_DICT_PATH.exists():
        return []

    try:
        parsed = json.loads(MODEL_DICT_PATH.read_text(encoding="utf-8"))
        if not isinstance(parsed, list):
            return []
        return [item for item in parsed if isinstance(item, dict)]
    except Exception as exc:
        logger.error(f"Failed to load model_dict.json: {exc}")
        return []


def save_model_dict_entries(entries: list[dict]) -> None:
    MODEL_DICT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=4),
        encoding="utf-8",
    )


def load_custom_live2d_models() -> set[str]:
    if not CUSTOM_LIVE2D_MODELS_REGISTRY_PATH.exists():
        return set()

    try:
        parsed = json.loads(
            CUSTOM_LIVE2D_MODELS_REGISTRY_PATH.read_text(encoding="utf-8")
        )
        if not isinstance(parsed, list):
            return set()
        return {item for item in parsed if isinstance(item, str)}
    except Exception as exc:
        logger.error(f"Failed to load custom live2d model registry: {exc}")
        return set()


def save_custom_live2d_models(model_names: set[str]) -> None:
    LIVE2D_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    CUSTOM_LIVE2D_MODELS_REGISTRY_PATH.write_text(
        json.dumps(sorted(model_names), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_default_live2d_model_entry(model_name: str, model_url: str) -> dict:
    return {
        "name": model_name,
        "description": "Uploaded Live2D model",
        "url": model_url,
        "kScale": 0.5,
        "initialXshift": 0,
        "initialYshift": 0,
        "idleMotionGroupName": "Idle",
        "emotionMap": {
            "neutral": 0,
            "joy": 0,
            "sadness": 0,
            "anger": 0,
            "surprise": 0,
            "fear": 0,
            "disgust": 0,
            "smirk": 0,
        },
        "tapMotions": {},
    }


def get_live2d_catalog_models() -> list[dict]:
    model_dict_entries = load_model_dict_entries()
    custom_model_names = load_custom_live2d_models()
    supported_avatar_extensions = [".png", ".jpg", ".jpeg", ".webp"]
    preview_stems = [
        "preview",
        "cover",
        "portrait",
        "thumbnail",
        "thumb",
        "avatar",
        "model",
    ]
    models = []

    def resolve_avatar_directory_preview(model_name: str) -> str | None:
        if not AVATARS_DIR.is_dir():
            return None

        candidate_stems = [model_name]
        if model_name.endswith("_pro"):
            candidate_stems.append(model_name[: -len("_pro")])

        for stem in candidate_stems:
            for extension in supported_avatar_extensions:
                candidate = AVATARS_DIR / f"{stem}{extension}"
                if candidate.is_file():
                    return f"/{candidate.as_posix()}"

        return None

    def is_live2d_texture_atlas(path: Path) -> bool:
        path_parts = {part.lower() for part in path.parts}
        name = path.name.lower()
        parent = path.parent.name.lower()
        return (
            name.startswith("texture_")
            or parent.startswith("texture")
            or parent.endswith(".1024")
            or parent.endswith(".2048")
            or parent.endswith(".4096")
            or "textures" in path_parts
        )

    def resolve_live2d_preview(model_name: str) -> str | None:
        model_dir = LIVE2D_MODELS_DIR / model_name
        if not model_dir.is_dir():
            return None

        avatar_directory_preview = resolve_avatar_directory_preview(model_name)
        if avatar_directory_preview:
            return avatar_directory_preview

        preferred_candidates = []
        for extension in supported_avatar_extensions:
            preferred_candidates.append(model_dir / f"{model_name}{extension}")
            preferred_candidates.extend(
                model_dir / f"{stem}{extension}" for stem in preview_stems
            )

        for candidate in preferred_candidates:
            if candidate.is_file() and not is_live2d_texture_atlas(candidate):
                return f"/{candidate.as_posix()}"

        root_preview_images = sorted(
            (
                path
                for path in model_dir.iterdir()
                if (
                    path.is_file()
                    and path.suffix.lower() in supported_avatar_extensions
                    and not is_live2d_texture_atlas(path)
                )
            ),
            key=lambda path: path.as_posix(),
        )

        if root_preview_images:
            return f"/{root_preview_images[0].as_posix()}"

        recursive_images = sorted(
            (
                path
                for path in model_dir.rglob("*")
                if (
                    path.is_file()
                    and path.suffix.lower() in supported_avatar_extensions
                    and path.stem.lower() in preview_stems
                    and not is_live2d_texture_atlas(path)
                )
            ),
            key=lambda path: (
                len(path.parts),
                path.as_posix(),
            ),
        )

        if recursive_images:
            return f"/{recursive_images[0].as_posix()}"

        return None

    for entry in model_dict_entries:
        model_name = str(entry.get("name") or "").strip()
        model_url = str(entry.get("url") or "").strip()
        if not model_name or not model_url:
            continue

        local_path = Path(model_url.lstrip("/"))
        if not local_path.is_file():
            logger.warning(
                f"Live2D model file missing for {model_name}: {local_path.as_posix()}"
            )
            continue

        avatar_url = resolve_live2d_preview(model_name)

        is_custom = model_name in custom_model_names
        models.append(
            {
                "name": model_name,
                "url": model_url,
                "avatar": avatar_url,
                "is_custom": is_custom,
                "can_delete": is_custom,
            }
        )

    models.sort(key=lambda item: (item["is_custom"], item["name"].lower()))
    return models


def init_client_ws_route(default_context_cache: ServiceContext) -> APIRouter:
    """
    Create and return API routes for handling the `/client-ws` WebSocket connections.

    Args:
        default_context_cache: Default service context cache for new sessions.

    Returns:
        APIRouter: Configured router with WebSocket endpoint.
    """

    router = APIRouter()
    ws_handler = WebSocketHandler(default_context_cache)
    default_context_cache.ws_handler = ws_handler

    @router.websocket("/client-ws")
    async def websocket_endpoint(websocket: WebSocket):
        """WebSocket endpoint for client connections"""
        await websocket.accept()
        client_uid = str(uuid4())

        try:
            await ws_handler.handle_new_connection(websocket, client_uid)
            await ws_handler.handle_websocket_communication(websocket, client_uid)
        except WebSocketDisconnect:
            await ws_handler.handle_disconnect(client_uid)
        except Exception as e:
            logger.error(f"Error in WebSocket connection: {e}")
            await ws_handler.handle_disconnect(client_uid)
            raise

    return router


def init_proxy_route(server_url: str) -> APIRouter:
    """
    Create and return API routes for handling proxy connections.

    Args:
        server_url: The WebSocket URL of the actual server

    Returns:
        APIRouter: Configured router with proxy WebSocket endpoint
    """
    router = APIRouter()
    proxy_handler = ProxyHandler(server_url)

    @router.websocket("/proxy-ws")
    async def proxy_endpoint(websocket: WebSocket):
        """WebSocket endpoint for proxy connections"""
        try:
            await proxy_handler.handle_client_connection(websocket)
        except Exception as e:
            logger.error(f"Error in proxy connection: {e}")
            raise

    return router


def init_webtool_routes(default_context_cache: ServiceContext) -> APIRouter:
    """
    Create and return API routes for handling web tool interactions.

    Args:
        default_context_cache: Default service context cache for new sessions.

    Returns:
        APIRouter: Configured router with WebSocket endpoint.
    """

    router = APIRouter()

    @router.get("/web-tool")
    async def web_tool_redirect():
        """Redirect /web-tool to /web_tool/index.html"""
        return Response(status_code=302, headers={"Location": "/web-tool/index.html"})

    @router.get("/web_tool")
    async def web_tool_redirect_alt():
        """Redirect /web_tool to /web_tool/index.html"""
        return Response(status_code=302, headers={"Location": "/web-tool/index.html"})

    @router.get("/live2d-models/info")
    async def get_live2d_folder_info():
        """Get information about available Live2D models"""
        if not LIVE2D_MODELS_DIR.exists():
            return JSONResponse(
                {"error": "Live2D models directory not found"}, status_code=404
            )

        catalog_models = get_live2d_catalog_models()
        valid_characters = [
            {
                "name": model["name"],
                "avatar": model["avatar"],
                "model_path": model["url"].lstrip("/"),
            }
            for model in catalog_models
        ]

        return JSONResponse(
            {
                "type": "live2d-models/info",
                "count": len(valid_characters),
                "characters": valid_characters,
            }
        )

    @router.get("/live2d-models/catalog")
    async def get_live2d_catalog():
        """Get available Live2D models for settings UI."""
        return JSONResponse(
            {
                "type": "live2d-models/catalog",
                "models": get_live2d_catalog_models(),
            }
        )

    @router.get("/avatar-packs/catalog")
    async def get_avatar_pack_catalog():
        """Get available avatar packs for settings UI."""
        return JSONResponse(
            {
                "type": "avatar-packs/catalog",
                "packs": list_avatar_packs(),
            }
        )

    @router.post("/avatar-packs/upload")
    async def upload_avatar_pack(
        pack_name: str = Form(...),
        files: list[UploadFile] = File(...),
    ):
        """Upload prepared avatar assets or a zip archive and convert to runtime AvatarPack."""
        if not files:
            return JSONResponse({"error": "No files uploaded"}, status_code=400)

        if len(files) > MAX_AVATAR_PACK_FILE_COUNT:
            return JSONResponse(
                {"error": f"Too many files. Maximum is {MAX_AVATAR_PACK_FILE_COUNT}"},
                status_code=400,
            )

        uploaded_assets: list[UploadedAsset] = []
        total_bytes = 0
        try:
            with TemporaryDirectory(prefix="avatar_pack_upload_") as temp_dir:
                temp_root = Path(temp_dir)
                for index, upload_file in enumerate(files):
                    safe_stem, extension = sanitize_avatar_input_filename(
                        upload_file.filename or ""
                    )
                    if extension not in SUPPORTED_AVATAR_PACK_EXTENSIONS:
                        return JSONResponse(
                            {
                                "error": (
                                    "Unsupported avatar asset format. Allowed: "
                                    ".png .jpg .jpeg .webp .gif .zip"
                                )
                            },
                            status_code=400,
                        )

                    content = await upload_file.read()
                    await upload_file.close()

                    if not content:
                        return JSONResponse(
                            {"error": f"Empty file is not allowed: {upload_file.filename}"},
                            status_code=400,
                        )

                    if len(content) > MAX_AVATAR_PACK_SINGLE_FILE_BYTES:
                        return JSONResponse(
                            {
                                "error": (
                                    "One file is too large. "
                                    f"Max {MAX_AVATAR_PACK_SINGLE_FILE_BYTES // (1024 * 1024)}MB"
                                )
                            },
                            status_code=400,
                        )

                    total_bytes += len(content)
                    if total_bytes > MAX_AVATAR_PACK_TOTAL_BYTES:
                        return JSONResponse(
                            {
                                "error": (
                                    "Total upload size is too large. "
                                    f"Max {MAX_AVATAR_PACK_TOTAL_BYTES // (1024 * 1024)}MB"
                                )
                            },
                            status_code=400,
                        )

                    temp_file = temp_root / f"{index:04d}_{safe_stem}{extension}"
                    temp_file.write_bytes(content)
                    uploaded_assets.append(
                        UploadedAsset(
                            path=temp_file,
                            original_name=upload_file.filename or temp_file.name,
                            extension=extension,
                        )
                    )

                pack_payload = process_avatar_pack_upload(
                    pack_name=pack_name,
                    uploaded_files=uploaded_assets,
                )

        except AvatarPackError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            logger.error(f"Failed to upload avatar pack: {exc}")
            return JSONResponse(
                {"error": "Failed to process avatar pack upload"},
                status_code=500,
            )

        return JSONResponse(
            {
                "type": "avatar-pack-uploaded",
                "pack": pack_payload,
            }
        )

    @router.delete("/avatar-packs/custom/{pack_id}")
    async def delete_avatar_pack(pack_id: str):
        """Delete a custom uploaded avatar pack."""
        try:
            delete_custom_avatar_pack(pack_id)
        except AvatarPackError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            logger.error(f"Failed to delete avatar pack: {exc}")
            return JSONResponse(
                {"error": "Failed to delete avatar pack"},
                status_code=500,
            )

        return JSONResponse(
            {
                "type": "avatar-pack-deleted",
                "pack_id": pack_id,
            }
        )

    @router.post("/live2d-models/upload")
    async def upload_live2d_model(file: UploadFile = File(...)):
        """Upload a Live2D model zip and register it into model_dict.json."""
        LIVE2D_MODELS_DIR.mkdir(parents=True, exist_ok=True)

        safe_stem, extension = sanitize_upload_filename(file.filename or "")
        if extension not in SUPPORTED_LIVE2D_ARCHIVE_EXTENSIONS:
            return JSONResponse(
                {
                    "error": "Unsupported model archive type. Allowed: .zip",
                },
                status_code=400,
            )

        content = await file.read()
        await file.close()

        if not content:
            return JSONResponse({"error": "Empty file is not allowed"}, status_code=400)

        if len(content) > MAX_LIVE2D_MODEL_UPLOAD_SIZE_BYTES:
            return JSONResponse(
                {"error": "Model archive is too large (max 120MB)"},
                status_code=400,
            )

        model_dict_entries = load_model_dict_entries()
        existing_model_names = {
            str(item.get("name") or "").strip()
            for item in model_dict_entries
            if str(item.get("name") or "").strip()
        }
        existing_model_names.update(
            {
                entry.name
                for entry in LIVE2D_MODELS_DIR.iterdir()
                if entry.is_dir()
            }
        )

        base_model_name = sanitize_live2d_model_name(safe_stem)
        normalized_existing_model_names = {
            normalize_duplicate_name(name)
            for name in existing_model_names
            if normalize_duplicate_name(name)
        }
        if normalize_duplicate_name(base_model_name) in normalized_existing_model_names:
            return JSONResponse(
                {
                    "error": (
                        f"人物形象名称已存在：{base_model_name}，"
                        "请修改压缩包文件名后再上传"
                    )
                },
                status_code=400,
            )
        model_name = base_model_name

        try:
            with TemporaryDirectory(prefix="live2d_upload_") as temp_dir:
                temp_root = Path(temp_dir)
                extract_root = temp_root / "extracted"
                extract_root.mkdir(parents=True, exist_ok=True)

                try:
                    with zipfile.ZipFile(io.BytesIO(content)) as archive:
                        files_in_zip = [item for item in archive.infolist() if not item.is_dir()]
                        if not files_in_zip:
                            return JSONResponse(
                                {"error": "The archive does not contain any files"},
                                status_code=400,
                            )

                        total_uncompressed_size = sum(
                            max(item.file_size, 0) for item in files_in_zip
                        )
                        if total_uncompressed_size > MAX_LIVE2D_MODEL_ARCHIVE_TOTAL_BYTES:
                            return JSONResponse(
                                {"error": "Archive content is too large after extraction"},
                                status_code=400,
                            )

                        for item in files_in_zip:
                            normalized_path = Path(item.filename)
                            if normalized_path.is_absolute() or ".." in normalized_path.parts:
                                return JSONResponse(
                                    {"error": "Archive contains invalid file paths"},
                                    status_code=400,
                                )

                        archive.extractall(extract_root)
                except zipfile.BadZipFile:
                    return JSONResponse({"error": "Invalid zip archive"}, status_code=400)

                top_level_entries = [
                    item for item in extract_root.iterdir() if item.name != "__MACOSX"
                ]
                top_level_dirs = [item for item in top_level_entries if item.is_dir()]
                top_level_files = [item for item in top_level_entries if item.is_file()]
                source_root = extract_root
                if len(top_level_dirs) == 1 and not top_level_files:
                    source_root = top_level_dirs[0]

                model_json_candidates = sorted(
                    [
                        path
                        for path in source_root.rglob("*.model3.json")
                        if path.is_file() and "__MACOSX" not in path.parts
                    ],
                    key=lambda path: (len(path.parts), len(path.as_posix())),
                )
                if not model_json_candidates:
                    return JSONResponse(
                        {"error": "No .model3.json file found in the archive"},
                        status_code=400,
                    )

                selected_model_json = model_json_candidates[0]
                relative_model_json = selected_model_json.relative_to(source_root)
                if relative_model_json.as_posix().startswith("."):
                    return JSONResponse(
                        {"error": "Invalid model path in archive"},
                        status_code=400,
                    )

                target_dir = LIVE2D_MODELS_DIR / model_name
                shutil.copytree(source_root, target_dir)

                target_model_json = target_dir / relative_model_json
                if not target_model_json.is_file():
                    return JSONResponse(
                        {"error": "Failed to locate model file after extraction"},
                        status_code=500,
                    )

                model_url = f"/{target_model_json.as_posix()}"

        except Exception as exc:
            logger.error(f"Failed to upload live2d model: {exc}")
            return JSONResponse(
                {"error": "Failed to save uploaded live2d model"},
                status_code=500,
            )

        new_model_entry = create_default_live2d_model_entry(model_name, model_url)
        model_dict_entries = [
            item
            for item in model_dict_entries
            if str(item.get("name") or "").strip() != model_name
        ]
        model_dict_entries.append(new_model_entry)
        save_model_dict_entries(model_dict_entries)

        custom_model_names = load_custom_live2d_models()
        custom_model_names.add(model_name)
        save_custom_live2d_models(custom_model_names)

        return JSONResponse(
            {
                "type": "live2d-model-uploaded",
                "model": {
                    "name": model_name,
                    "url": model_url,
                    "is_custom": True,
                    "can_delete": True,
                },
            }
        )

    @router.delete("/live2d-models/custom/{model_name}")
    async def delete_custom_live2d_model(model_name: str):
        """Delete a custom uploaded Live2D model."""
        safe_model_name = sanitize_live2d_model_name(model_name)
        if safe_model_name != model_name:
            return JSONResponse({"error": "Invalid model name"}, status_code=400)

        custom_model_names = load_custom_live2d_models()
        if model_name not in custom_model_names:
            return JSONResponse(
                {"error": "Only custom uploaded models can be deleted"},
                status_code=403,
            )

        target_model_dir = LIVE2D_MODELS_DIR / model_name
        if target_model_dir.exists():
            try:
                shutil.rmtree(target_model_dir)
            except Exception as exc:
                logger.error(f"Failed to delete live2d model directory: {exc}")
                return JSONResponse(
                    {"error": "Failed to delete live2d model files"},
                    status_code=500,
                )

        model_dict_entries = load_model_dict_entries()
        updated_entries = [
            item
            for item in model_dict_entries
            if str(item.get("name") or "").strip() != model_name
        ]
        save_model_dict_entries(updated_entries)

        custom_model_names.discard(model_name)
        save_custom_live2d_models(custom_model_names)

        return JSONResponse(
            {
                "type": "live2d-model-deleted",
                "name": model_name,
            }
        )

    @router.delete("/backgrounds/{background_filename}")
    async def delete_background(background_filename: str):
        safe_filename = sanitize_background_filename(background_filename)
        if not safe_filename:
            return JSONResponse({"error": "Invalid background filename"}, status_code=400)

        file_extension = Path(safe_filename).suffix.lower()
        if file_extension not in SUPPORTED_BACKGROUND_EXTENSIONS:
            return JSONResponse(
                {
                    "error": "Unsupported background file type. Allowed: .jpg, .jpeg, .png, .gif, .webp"
                },
                status_code=400,
            )

        if safe_filename in PROTECTED_BACKGROUND_FILENAMES:
            return JSONResponse(
                {"error": "Protected background image cannot be deleted"},
                status_code=403,
            )

        target_path = BACKGROUND_DIR / safe_filename
        if not target_path.exists() or not target_path.is_file():
            return JSONResponse({"error": "Background image not found"}, status_code=404)

        try:
            target_path.unlink()
        except Exception as exc:
            logger.error(f"Failed to delete background image: {exc}")
            return JSONResponse(
                {"error": "Failed to delete background image"},
                status_code=500,
            )

        return JSONResponse(
            {
                "type": "background-deleted",
                "filename": safe_filename,
            }
        )

    @router.post("/backgrounds/upload")
    async def upload_background(file: UploadFile = File(...)):
        BACKGROUND_DIR.mkdir(parents=True, exist_ok=True)

        safe_stem, extension = sanitize_upload_filename(file.filename or "")
        if extension not in SUPPORTED_BACKGROUND_EXTENSIONS:
            return JSONResponse(
                {
                    "error": "Unsupported background file type. Allowed: .jpg, .jpeg, .png, .gif, .webp"
                },
                status_code=400,
            )

        content = await file.read()
        await file.close()

        if not content:
            return JSONResponse({"error": "Empty file is not allowed"}, status_code=400)

        if len(content) > MAX_BACKGROUND_UPLOAD_SIZE_BYTES:
            return JSONResponse(
                {"error": "File is too large (max 10MB)"},
                status_code=400,
            )

        target_filename = f"{safe_stem}{extension}"
        target_path = BACKGROUND_DIR / target_filename
        duplicate_index = 1
        while target_path.exists():
            target_filename = f"{safe_stem}_{duplicate_index}{extension}"
            target_path = BACKGROUND_DIR / target_filename
            duplicate_index += 1

        try:
            target_path.write_bytes(content)
        except Exception as exc:
            logger.error(f"Failed to save uploaded background image: {exc}")
            return JSONResponse(
                {"error": "Failed to save uploaded background image"},
                status_code=500,
            )

        return JSONResponse(
            {
                "type": "background-uploaded",
                "filename": target_filename,
                "url": f"/bg/{target_filename}",
            }
        )

    @router.get("/knowledge/files")
    async def list_knowledge_files():
        """Get uploaded knowledge files and usage limits."""
        overview = get_knowledge_overview()
        return JSONResponse(
            {
                "type": "knowledge-files",
                **overview,
            }
        )

    @router.post("/knowledge/upload")
    async def upload_knowledge(file: UploadFile = File(...)):
        """Upload a knowledge file and update lightweight retrieval index."""
        content = await file.read()
        await file.close()
        try:
            file_entry = add_knowledge_file(file.filename or "", content)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            logger.error(f"Failed to upload knowledge file: {exc}")
            return JSONResponse(
                {"error": "Failed to upload knowledge file"},
                status_code=500,
            )

        overview = get_knowledge_overview()
        return JSONResponse(
            {
                "type": "knowledge-file-uploaded",
                "file": file_entry,
                "file_count": overview["file_count"],
                "total_size_bytes": overview["total_size_bytes"],
            }
        )

    @router.delete("/knowledge/files/{file_id}")
    async def delete_knowledge(file_id: str):
        """Delete a knowledge file by id."""
        try:
            removed = delete_knowledge_file(file_id)
        except KeyError:
            return JSONResponse({"error": "Knowledge file not found"}, status_code=404)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            logger.error(f"Failed to delete knowledge file: {exc}")
            return JSONResponse(
                {"error": "Failed to delete knowledge file"},
                status_code=500,
            )

        overview = get_knowledge_overview()
        return JSONResponse(
            {
                "type": "knowledge-file-deleted",
                "file": removed,
                "file_count": overview["file_count"],
                "total_size_bytes": overview["total_size_bytes"],
            }
        )

    async def _trigger_system_exit():
        stop_script = Path("scripts/raspberry_pi/stop_vtuber.sh")
        if not stop_script.exists():
            return JSONResponse(
                {"error": "Stop script not found", "path": str(stop_script)},
                status_code=500,
            )

        try:
            # Delay shutdown slightly so HTTP response can return before self-termination.
            subprocess.Popen(
                ["bash", str(stop_script), "1"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except Exception as exc:
            logger.error(f"Failed to trigger system exit: {exc}")
            return JSONResponse(
                {"error": f"Failed to trigger system exit: {exc}"},
                status_code=500,
            )

        return JSONResponse({"type": "system-exit-requested", "ok": True})

    @router.post("/system/exit")
    async def system_exit_post():
        return await _trigger_system_exit()

    @router.get("/system/exit")
    async def system_exit_get():
        return await _trigger_system_exit()

    @router.post("/asr")
    async def transcribe_audio(file: UploadFile = File(...)):
        """
        Endpoint for transcribing audio using the ASR engine
        """
        logger.info(f"Received audio file for transcription: {file.filename}")

        try:
            contents = await file.read()

            # Validate minimum file size
            if len(contents) < 44:  # Minimum WAV header size
                raise ValueError("Invalid WAV file: File too small")

            # Decode the WAV header and get actual audio data
            wav_header_size = 44  # Standard WAV header size
            audio_data = contents[wav_header_size:]

            # Validate audio data size
            if len(audio_data) % 2 != 0:
                raise ValueError("Invalid audio data: Buffer size must be even")

            # Convert to 16-bit PCM samples to float32
            try:
                audio_array = (
                    np.frombuffer(audio_data, dtype=np.int16).astype(np.float32)
                    / 32768.0
                )
            except ValueError as e:
                raise ValueError(
                    f"Audio format error: {str(e)}. Please ensure the file is 16-bit PCM WAV format."
                )

            # Validate audio data
            if len(audio_array) == 0:
                raise ValueError("Empty audio data")

            text = await default_context_cache.asr_engine.async_transcribe_np(
                audio_array
            )
            logger.info(f"Transcription result: {text}")
            return {"text": text}

        except ValueError as e:
            logger.error(f"Audio format error: {e}")
            return Response(
                content=json.dumps({"error": str(e)}),
                status_code=400,
                media_type="application/json",
            )
        except Exception as e:
            logger.error(f"Error during transcription: {e}")
            return Response(
                content=json.dumps(
                    {"error": "Internal server error during transcription"}
                ),
                status_code=500,
                media_type="application/json",
            )

    @router.websocket("/tts-ws")
    async def tts_endpoint(websocket: WebSocket):
        """WebSocket endpoint for TTS generation"""
        await websocket.accept()
        logger.info("TTS WebSocket connection established")

        try:
            while True:
                data = await websocket.receive_json()
                text = data.get("text")
                if not text:
                    continue

                logger.info(f"Received text for TTS: {text}")

                # Split text into sentences
                sentences = [s.strip() for s in text.split(".") if s.strip()]

                try:
                    # Generate and send audio for each sentence
                    for sentence in sentences:
                        sentence = sentence + "."  # Add back the period
                        file_name = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{str(uuid4())[:8]}"
                        audio_path = (
                            await default_context_cache.tts_engine.async_generate_audio(
                                text=sentence, file_name_no_ext=file_name
                            )
                        )
                        logger.info(
                            f"Generated audio for sentence: {sentence} at: {audio_path}"
                        )

                        await websocket.send_json(
                            {
                                "status": "partial",
                                "audioPath": audio_path,
                                "text": sentence,
                            }
                        )

                    # Send completion signal
                    await websocket.send_json({"status": "complete"})

                except Exception as e:
                    logger.error(f"Error generating TTS: {e}")
                    await websocket.send_json({"status": "error", "message": str(e)})

        except WebSocketDisconnect:
            logger.info("TTS WebSocket client disconnected")
        except Exception as e:
            logger.error(f"Error in TTS WebSocket connection: {e}")
            await websocket.close()

    return router
