from __future__ import annotations

import os
import secrets
import socket
from typing import TYPE_CHECKING

from fastapi import (
    APIRouter,
    Depends,
    File,
    Header,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from loguru import logger
from starlette.responses import FileResponse, JSONResponse, Response

from ..config_manager import CharacterConfig
from ..knowledge_service import (
    export_knowledge_snapshot,
    initialize_empty_knowledge_snapshot,
    restore_knowledge_snapshot,
)
from .models import (
    AppLockRequest,
    CreateProfileRequest,
    DirtyProfileRequest,
    LoadProfileRequest,
    SaveProfileRequest,
)
from .storage import (
    attach_profile_metadata,
    build_export_zip,
    create_profile,
    delete_profile_file,
    get_profile_file,
    get_profile,
    get_snapshot,
    list_profile_files,
    list_profiles,
    load_runtime_state,
    MAX_PROFILE_FILE_BYTES,
    MAX_SNAPSHOT_BYTES,
    merge_profile_character_config,
    profile_knowledge_directory,
    restore_profile_chat_history,
    save_profile_from_context,
    save_profile_file,
    save_runtime_state,
    save_snapshot,
    set_profile_dirty,
    snapshot_profile_chat_history,
    utc_now_iso,
)

if TYPE_CHECKING:
    from ..service_context import ServiceContext

CLASSROOM_API_VERSION = "1"
UPLOAD_CHUNK_BYTES = 1024 * 1024


def device_identity() -> tuple[str, str]:
    hostname = socket.gethostname().strip() or "unknown-device"
    device_id = os.getenv("JACOB_DEVICE_ID", "").strip() or hostname
    device_name = os.getenv("JACOB_DEVICE_NAME", "").strip() or hostname
    return device_id, device_name


async def require_classroom_token(
    request: Request,
    x_classroom_token: str | None = Header(
        default=None,
        alias="X-Classroom-Token",
    ),
) -> None:
    expected = os.getenv("JACOB_CLASSROOM_TOKEN", "")
    if not expected:
        return
    if request.client and request.client.host in {"127.0.0.1", "::1"}:
        return
    if x_classroom_token is None or not secrets.compare_digest(
        x_classroom_token,
        expected,
    ):
        raise HTTPException(status_code=401, detail="Invalid classroom token")


async def read_upload_limited(file: UploadFile, max_bytes: int) -> bytes:
    content = bytearray()
    while chunk := await file.read(UPLOAD_CHUNK_BYTES):
        content.extend(chunk)
        if len(content) > max_bytes:
            raise ValueError(f"Upload exceeds the {max_bytes // (1024 * 1024)} MB limit")
    return bytes(content)


async def apply_profile_to_context(context: ServiceContext, profile) -> None:
    if context.character_config is None:
        raise ValueError("Application context is not ready")
    base_config = context.character_config.model_dump(
        by_alias=True,
        exclude_none=True,
    )
    character_config = CharacterConfig.model_validate(
        merge_profile_character_config(base_config, profile.character_config)
    )
    if hasattr(context, "apply_character_config"):
        await context.apply_character_config(character_config)
    else:
        context.character_config = character_config
        if context.config:
            context.config.character_config = character_config
    attach_profile_metadata(context, profile)


async def apply_profile_to_open_contexts(
    default_context_cache: ServiceContext,
    profile,
) -> None:
    await apply_profile_to_context(default_context_cache, profile)
    ws_handler = getattr(default_context_cache, "ws_handler", None)
    if not ws_handler:
        return

    for client_uid, context in list(getattr(ws_handler, "client_contexts", {}).items()):
        try:
            await apply_profile_to_context(context, profile)
        except Exception as exc:
            logger.error(f"Failed to load classroom profile for {client_uid}: {exc}")


def build_status(default_context_cache: ServiceContext) -> dict:
    state = load_runtime_state()
    character_config = default_context_cache.character_config
    username = (
        getattr(default_context_cache, "classroom_username", None)
        or state.get("current_username")
    )
    profile = None
    if username:
        try:
            profile = get_profile(username)
        except ValueError:
            profile = None
    profile_character_config = profile.character_config if profile else {}
    device_id, device_name = device_identity()
    snapshot_updated_at = None
    try:
        _, snapshot = get_snapshot(username)
        snapshot_updated_at = snapshot.updated_at
    except (FileNotFoundError, KeyError, ValueError):
        pass

    return {
        "device_id": device_id,
        "device_name": device_name,
        "api_version": CLASSROOM_API_VERSION,
        "online": True,
        "app_ready": character_config is not None,
        "server_time": utc_now_iso(),
        "current_username": username,
        "class_name": getattr(default_context_cache, "classroom_class_name", None)
        or (profile.class_name if profile else None),
        "character_name": profile_character_config.get("character_name")
        or getattr(character_config, "character_name", None),
        "avatar_mode": profile_character_config.get("avatar_mode")
        or getattr(character_config, "avatar_mode", None),
        "avatar_pack_id": profile_character_config.get("avatar_pack_id")
        or getattr(character_config, "avatar_pack_id", None),
        "live2d_model_name": profile_character_config.get("live2d_model_name")
        or getattr(character_config, "live2d_model_name", None),
        "dirty": bool(
            getattr(default_context_cache, "classroom_dirty", False)
            or (profile.dirty if profile else False)
        ),
        "submitted": bool(
            getattr(default_context_cache, "classroom_submitted", False)
            or (profile.submitted if profile else False)
        ),
        "last_saved_at": getattr(default_context_cache, "classroom_last_saved_at", None)
        or (profile.last_saved_at if profile else None),
        "snapshot_updated_at": snapshot_updated_at,
        "locked": bool(state.get("locked", False)),
    }


def current_username(default_context_cache: ServiceContext) -> str | None:
    return (
        getattr(default_context_cache, "classroom_username", None)
        or load_runtime_state().get("current_username")
    )


def file_error_response(exc: Exception) -> JSONResponse:
    if isinstance(exc, ValueError):
        return JSONResponse({"error": str(exc)}, status_code=400)
    if isinstance(exc, KeyError):
        return JSONResponse({"error": "Profile not found"}, status_code=404)
    if isinstance(exc, FileNotFoundError):
        return JSONResponse({"error": "File not found"}, status_code=404)
    return JSONResponse({"error": str(exc)}, status_code=500)


def init_classroom_routes(default_context_cache: ServiceContext) -> APIRouter:
    router = APIRouter(
        prefix="/classroom",
        dependencies=[Depends(require_classroom_token)],
    )

    @router.get("/status")
    async def classroom_status():
        return JSONResponse(build_status(default_context_cache))

    @router.get("/profiles")
    async def classroom_profiles(class_name: str | None = Query(default=None)):
        profiles = list_profiles(class_name=class_name)
        return JSONResponse(
            {"profiles": [profile.model_dump() for profile in profiles]}
        )

    @router.post("/profile/create")
    async def classroom_profile_create(request: CreateProfileRequest):
        if not default_context_cache.character_config:
            return JSONResponse({"error": "Application context is not ready"}, status_code=400)

        character_config = default_context_cache.character_config.model_dump(
            by_alias=True,
            exclude_none=True,
        )
        try:
            profile = create_profile(
                username=request.username,
                character_config=character_config,
                class_name=request.class_name,
                workspace_state=request.workspace_state,
            )
            knowledge_dir = profile_knowledge_directory(profile.username)
            initialize_empty_knowledge_snapshot(knowledge_dir)
            restore_knowledge_snapshot(knowledge_dir)
            restore_profile_chat_history(profile.username)
            await apply_profile_to_open_contexts(default_context_cache, profile)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        save_runtime_state(current_username=profile.username)
        return JSONResponse({"profile": profile.model_dump()})

    @router.post("/profile/load")
    async def classroom_profile_load(request: LoadProfileRequest):
        try:
            profile = get_profile(request.username)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        if profile is None:
            return JSONResponse({"error": "Profile not found"}, status_code=404)

        try:
            restore_knowledge_snapshot(
                profile_knowledge_directory(profile.username)
            )
            restore_profile_chat_history(profile.username)
            await apply_profile_to_open_contexts(default_context_cache, profile)
        except Exception as exc:
            logger.error(f"Failed to load classroom profile: {exc}")
            return JSONResponse({"error": f"Failed to load profile: {exc}"}, status_code=500)

        save_runtime_state(current_username=profile.username)
        return JSONResponse({"profile": profile.model_dump()})

    @router.post("/profile/save")
    async def classroom_profile_save(request: SaveProfileRequest | None = None):
        try:
            profile = save_profile_from_context(
                default_context_cache,
                dirty=False,
                workspace_state=request.workspace_state if request else None,
            )
            export_knowledge_snapshot(profile_knowledge_directory(profile.username))
            snapshot_profile_chat_history(profile.username)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)
        save_runtime_state(current_username=profile.username)
        return JSONResponse({"profile": profile.model_dump()})

    @router.post("/profile/submit")
    async def classroom_profile_submit(request: SaveProfileRequest | None = None):
        try:
            profile = save_profile_from_context(
                default_context_cache,
                submitted=True,
                dirty=False,
                workspace_state=request.workspace_state if request else None,
            )
            export_knowledge_snapshot(profile_knowledge_directory(profile.username))
            snapshot_profile_chat_history(profile.username)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)
        save_runtime_state(current_username=profile.username)
        return JSONResponse({"profile": profile.model_dump()})

    @router.post("/profile/dirty")
    async def classroom_profile_dirty(request: DirtyProfileRequest):
        username = current_username(default_context_cache)
        if not username:
            return JSONResponse({"error": "No current classroom profile"}, status_code=400)
        try:
            profile = set_profile_dirty(username, request.dirty)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)
        attach_profile_metadata(default_context_cache, profile)
        return JSONResponse({"profile": profile.model_dump()})

    @router.get("/profile/{username}/export")
    async def classroom_profile_export(username: str):
        try:
            content = build_export_zip(username)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)

        return Response(
            content=content,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{username}.zip"'
            },
        )

    @router.get("/profile/files")
    async def classroom_profile_files():
        username = current_username(default_context_cache)
        if not username:
            return JSONResponse({"error": "No current classroom profile"}, status_code=400)
        try:
            files = list_profile_files(username)
        except Exception as exc:
            return file_error_response(exc)
        return JSONResponse({"files": [item.model_dump() for item in files]})

    @router.post("/profile/files/upload")
    async def classroom_profile_file_upload(file: UploadFile = File(...)):
        username = current_username(default_context_cache)
        if not username:
            return JSONResponse({"error": "No current classroom profile"}, status_code=400)
        try:
            content = await read_upload_limited(file, MAX_PROFILE_FILE_BYTES)
            item = save_profile_file(username, file.filename or "upload.bin", content)
        except Exception as exc:
            return file_error_response(exc)
        return JSONResponse({"file": item.model_dump()})

    @router.post("/snapshot")
    async def classroom_snapshot_upload(file: UploadFile = File(...)):
        try:
            content = await read_upload_limited(file, MAX_SNAPSHOT_BYTES)
            snapshot = save_snapshot(
                current_username(default_context_cache),
                content,
                file.content_type or "",
            )
        except Exception as exc:
            return file_error_response(exc)
        return JSONResponse({"snapshot": snapshot.model_dump()})

    @router.get("/snapshot")
    async def classroom_snapshot_download():
        try:
            path, snapshot = get_snapshot(current_username(default_context_cache))
        except Exception as exc:
            return file_error_response(exc)
        return FileResponse(
            path,
            media_type=snapshot.content_type,
            headers={"X-Snapshot-Updated-At": snapshot.updated_at},
        )

    @router.get("/profile/files/{filename}")
    async def classroom_profile_file_download(filename: str):
        username = current_username(default_context_cache)
        if not username:
            return JSONResponse({"error": "No current classroom profile"}, status_code=400)
        try:
            path = get_profile_file(username, filename)
        except Exception as exc:
            return file_error_response(exc)
        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=path.name,
        )

    @router.delete("/profile/files/{filename}")
    async def classroom_profile_file_delete(filename: str):
        username = current_username(default_context_cache)
        if not username:
            return JSONResponse({"error": "No current classroom profile"}, status_code=400)
        try:
            delete_profile_file(username, filename)
        except Exception as exc:
            return file_error_response(exc)
        return JSONResponse({"ok": True})

    @router.post("/app-lock")
    async def classroom_app_lock(request: AppLockRequest):
        state = save_runtime_state(locked=request.locked)
        default_context_cache.classroom_locked = bool(state.get("locked", False))
        return JSONResponse(build_status(default_context_cache))

    return router
