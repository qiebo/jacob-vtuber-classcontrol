from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from starlette.responses import JSONResponse, Response

from .routes import (
    apply_profile_to_open_contexts,
    current_username,
    read_upload_limited,
    require_classroom_token,
)
from .storage import (
    SavePointStore,
    build_export_zip,
    ensure_safe_username,
    get_profile,
    profile_dir_for_username,
    profile_paths,
    save_runtime_state,
    safe_save_id,
    utc_now_iso,
    write_profile,
)

if TYPE_CHECKING:
    from ..service_context import ServiceContext

# 存档点 ZIP 大小上限（含素材全量打包，放宽到 100MB）
MAX_PACK_BYTES = 100 * 1024 * 1024


class CreateSaveRequest(BaseModel):
    label: str | None = None


def _save_id_from_time() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def init_workspace_routes(default_context_cache: ServiceContext) -> APIRouter:
    router = APIRouter(
        prefix="/workspace",
        dependencies=[Depends(require_classroom_token)],
    )

    def _require_username() -> str | None:
        uname = current_username(default_context_cache)
        if not uname:
            return None
        return uname

    @router.post("/pack")
    async def workspace_pack():
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        try:
            content = build_export_zip(username)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)
        return Response(
            content=content,
            media_type="application/zip",
            headers={
                "Content-Disposition": f'attachment; filename="{username}.zip"'
            },
        )

    @router.post("/restore")
    async def workspace_restore(file: UploadFile = File(...)):
        """从上传的 ZIP 恢复工作区（支持教师端分发的作品）。

        ZIP 结构需含 profile.yaml；解压覆盖到 profiles/{username}/。
        username 以 ZIP 内 profile.yaml 的 username 为准。
        """
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        try:
            content = await read_upload_limited(file, MAX_PACK_BYTES)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        try:
            buf = io.BytesIO(content)
            with zipfile.ZipFile(buf) as archive:
                names = set(archive.namelist())
                if "profile.yaml" not in names:
                    return JSONResponse(
                        {"error": "ZIP 缺少 profile.yaml"}, status_code=400
                    )
                # 读取档案内的 username，决定目标目录
                import yaml
                meta = yaml.safe_load(archive.read("profile.yaml")) or {}
                target_username = ensure_safe_username(meta.get("username", username))

                target_dir = profile_dir_for_username(target_username)
                target_dir.mkdir(parents=True, exist_ok=True)
                # 清空目标目录下旧内容（除 saves/ 保留存档）
                for child in target_dir.iterdir():
                    if child.name == "saves":
                        continue
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
                # 解压（防 zip slip）
                base = target_dir.resolve()
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    dest = (target_dir / member.filename).resolve()
                    if not dest.is_relative_to(base):
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(archive.read(member.filename))

            # 重新载入并应用到上下文
            profile = get_profile(target_username)
            if profile is not None:
                await apply_profile_to_open_contexts(default_context_cache, profile)
                save_runtime_state(current_username=target_username)
                return JSONResponse(
                    {"username": target_username, "profile": profile.model_dump()}
                )
            return JSONResponse({"error": "恢复后档案不可读"}, status_code=500)
        except (ValueError, KeyError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)
        except Exception as exc:
            return JSONResponse({"error": f"恢复失败: {exc}"}, status_code=500)

    @router.get("/saves")
    async def workspace_list_saves():
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        store = SavePointStore(username)
        return JSONResponse({"saves": store.list_saves()})

    @router.post("/saves")
    async def workspace_create_save(request: CreateSaveRequest | None = None):
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        try:
            snapshot_bytes = build_export_zip(username)
        except KeyError:
            return JSONResponse({"error": "Profile not found"}, status_code=404)
        save_id = _save_id_from_time()
        store = SavePointStore(username)
        meta = store.create(
            save_id, snapshot_bytes, label=request.label if request else None
        )
        return JSONResponse({"save": meta})

    @router.post("/saves/{save_id}/load")
    async def workspace_load_save(save_id: str):
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        try:
            safe_save_id(save_id)
        except ValueError:
            return JSONResponse({"error": "Invalid save_id"}, status_code=400)
        store = SavePointStore(username)
        meta = store.get(save_id)
        if meta is None:
            return JSONResponse({"error": "存档点不存在"}, status_code=404)
        # 读取存档 ZIP 并走恢复逻辑
        snapshot_path = store.snapshot_path(save_id)
        content = snapshot_path.read_bytes()
        buf = io.BytesIO(content)
        try:
            with zipfile.ZipFile(buf) as archive:
                import yaml
                meta_inner = yaml.safe_load(archive.read("profile.yaml")) or {}
                target_username = ensure_safe_username(
                    meta_inner.get("username", username)
                )
                target_dir = profile_dir_for_username(target_username)
                target_dir.mkdir(parents=True, exist_ok=True)
                for child in target_dir.iterdir():
                    if child.name == "saves":
                        continue
                    if child.is_dir():
                        shutil.rmtree(child)
                    else:
                        child.unlink()
                base = target_dir.resolve()
                for member in archive.infolist():
                    if member.is_dir():
                        continue
                    dest = (target_dir / member.filename).resolve()
                    if not dest.is_relative_to(base):
                        continue
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(archive.read(member.filename))
            profile = get_profile(target_username)
            if profile is not None:
                await apply_profile_to_open_contexts(default_context_cache, profile)
                save_runtime_state(current_username=target_username)
                return JSONResponse(
                    {"username": target_username, "profile": profile.model_dump()}
                )
            return JSONResponse({"error": "载入后档案不可读"}, status_code=500)
        except Exception as exc:
            return JSONResponse({"error": f"载入存档失败: {exc}"}, status_code=500)

    @router.delete("/saves/{save_id}")
    async def workspace_delete_save(save_id: str):
        username = _require_username()
        if not username:
            return JSONResponse(
                {"error": "No current classroom profile"}, status_code=400
            )
        try:
            safe_save_id(save_id)
        except ValueError:
            return JSONResponse({"error": "Invalid save_id"}, status_code=400)
        store = SavePointStore(username)
        if store.get(save_id) is None:
            return JSONResponse({"error": "存档点不存在"}, status_code=404)
        store.delete(save_id)
        return JSONResponse({"ok": True})

    return router
