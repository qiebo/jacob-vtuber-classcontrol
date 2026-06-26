from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import tempfile
import time
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from starlette.responses import FileResponse, JSONResponse, Response, StreamingResponse

from .storage import Device, DeviceStore, device_from_payload
from .student_client import StudentClient

PACKAGE_DIR = Path(__file__).resolve().parent
STATIC_DIR = PACKAGE_DIR / "static"
DEFAULT_CONCURRENCY = 32
MAX_UPLOAD_BYTES = 50 * 1024 * 1024


def json_error(message: str, status_code: int = 400) -> JSONResponse:
    return JSONResponse({"error": message}, status_code=status_code)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_device(device: Device) -> dict[str, Any]:
    return device.public_dict()


def operation_summary(results: list[dict[str, Any]]) -> dict[str, int]:
    succeeded = sum(bool(item.get("ok")) for item in results)
    return {
        "total": len(results),
        "succeeded": succeeded,
        "failed": len(results) - succeeded,
    }


def select_devices(store: DeviceStore, selection: dict[str, Any]) -> list[Device]:
    all_selected = selection.get("all") is True
    group = str(selection.get("group") or "").strip()
    raw_ids = selection.get("device_ids")
    has_ids = raw_ids is not None
    selector_count = int(all_selected) + int(bool(group)) + int(has_ids)
    if selector_count != 1:
        raise ValueError("Select exactly one of device_ids, group, or all=true")

    devices = store.load_devices()
    if all_selected:
        return devices
    if group:
        return [device for device in devices if device.group == group]
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ValueError("device_ids must be a non-empty list")

    requested_ids = list(dict.fromkeys(str(item) for item in raw_ids))
    by_id = {device.id: device for device in devices}
    missing = [device_id for device_id in requested_ids if device_id not in by_id]
    if missing:
        raise ValueError(f"Unknown device_ids: {', '.join(missing)}")
    return [by_id[device_id] for device_id in requested_ids]


def parse_multipart_selection(
    device_ids: str | None,
    group: str | None,
    all_devices: bool,
) -> dict[str, Any]:
    selection: dict[str, Any] = {"all": all_devices}
    if group:
        selection["group"] = group
    if device_ids is not None:
        try:
            parsed = json.loads(device_ids)
        except json.JSONDecodeError:
            parsed = [item.strip() for item in device_ids.split(",") if item.strip()]
        selection["device_ids"] = parsed
    return selection


async def run_device_operations(
    devices: list[Device],
    operation: Callable[[Device], Awaitable[dict[str, Any]]],
    concurrency: int = DEFAULT_CONCURRENCY,
) -> list[dict[str, Any]]:
    semaphore = asyncio.Semaphore(concurrency)

    async def run_one(device: Device) -> dict[str, Any]:
        started = time.perf_counter()
        if not device.enabled:
            return {
                "device": public_device(device),
                "ok": False,
                "latency_ms": 0,
                "error": "Device disabled",
            }
        try:
            async with semaphore:
                detail = await operation(device)
            return {
                "device": public_device(device),
                "ok": True,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "error": None,
                **detail,
            }
        except Exception as exc:
            return {
                "device": public_device(device),
                "ok": False,
                "latency_ms": round((time.perf_counter() - started) * 1000),
                "error": str(exc),
            }

    return await asyncio.gather(*(run_one(device) for device in devices))


async def refresh_device_status(
    client: StudentClient,
    device: Device,
) -> dict[str, Any]:
    started = time.perf_counter()
    status: dict[str, Any] | None = None
    error: str | None = None
    online = False
    if not device.enabled:
        error = "Device disabled"
    else:
        try:
            status = await client.get_status(device)
            online = True
            device.last_seen = utc_now_iso()
            device.status_cache = status
            device.last_error = None
        except Exception as exc:
            error = str(exc)
            device.last_error = error
    device.latency_ms = round((time.perf_counter() - started) * 1000)
    return {
        "device": public_device(device),
        "online": online,
        "status": status,
        "latency_ms": device.latency_ms,
        "last_seen": device.last_seen,
        "error": error,
    }


async def save_upload(upload: UploadFile, directory: Path) -> tuple[Path, str, str]:
    filename = Path(upload.filename or "upload.bin").name or "upload.bin"
    content_type = upload.content_type or "application/octet-stream"
    temporary = tempfile.NamedTemporaryFile(
        prefix="teacher-upload-",
        suffix=".tmp",
        dir=directory,
        delete=False,
    )
    path = Path(temporary.name)
    size = 0
    try:
        with temporary:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise ValueError("File exceeds 50 MB limit")
                temporary.write(chunk)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()
    return path, filename, content_type


def create_app(
    data_dir: Path | None = None,
    student_client: StudentClient | None = None,
    enable_auth: bool = True,
    enable_scan: bool = True,
) -> FastAPI:
    store = DeviceStore(data_dir or Path("teacher_console_data"))
    client = student_client or StudentClient()
    app = FastAPI(title="Jacob VTuber Teacher Console")
    app.state.store = store
    app.state.client = client
    # 教师登录鉴权（PRD T-2）
    from .auth import AuthStore, init_auth_routes, require_teacher_auth
    auth_store = AuthStore(data_dir or Path("teacher_console_data"))
    app.state.auth_store = auth_store
    init_auth_routes(app, auth_store)
    # 班级/用户/扫描（PRD T-3/T-4）
    from .class_store import ClassStore
    from .user_store import UserStore
    from .scan_service import ScanService
    class_store = ClassStore(data_dir or Path("teacher_console_data"))
    user_store = UserStore(data_dir or Path("teacher_console_data"))
    scan_service = ScanService(store, client)
    app.state.class_store = class_store
    app.state.user_store = user_store
    app.state.scan_service = scan_service
    if enable_auth:
        # 鉴权中间件：放行 /、/static/*、/api/auth/login，其余校验 Bearer token
        @app.middleware("http")
        async def _auth_middleware(request: Request, call_next):
            from .auth import require_teacher_auth
            try:
                await require_teacher_auth(request, request.headers.get("authorization"))
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
            return await call_next(request)
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.add_event_handler("shutdown", client.close)

    if enable_scan:
        async def _start_scan_service():
            scan_service.start()

        async def _stop_scan_service():
            await scan_service.stop()

        app.add_event_handler("startup", _start_scan_service)
        app.add_event_handler("shutdown", _stop_scan_service)

    @app.get("/")
    async def index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/devices")
    async def list_devices():
        return {"devices": [public_device(device) for device in store.load_devices()]}

    @app.post("/api/devices")
    async def add_device(request: Request):
        try:
            payload = await request.json()
            existing = None
            if payload.get("id"):
                try:
                    existing = store.get_device(str(payload["id"]).strip())
                except KeyError:
                    pass
            device = device_from_payload(payload, existing)
        except Exception as exc:
            return json_error(str(exc), 400)
        store.upsert_device(device)
        return {"device": public_device(device)}

    @app.delete("/api/devices/{device_id}")
    async def delete_device(device_id: str):
        if not store.delete_device(device_id):
            return json_error("Device not found", 404)
        return {"ok": True}

    @app.post("/api/devices/{device_id}/refresh")
    async def refresh_device(device_id: str):
        try:
            device = store.get_device(device_id)
        except KeyError:
            return json_error("Device not found", 404)
        result = await refresh_device_status(client, device)
        store.upsert_device(device)
        return result

    @app.get("/api/devices/{device_id}/snapshot")
    async def device_snapshot(device_id: str):
        try:
            device = store.get_device(device_id)
            content, content_type, updated_at = await client.get_snapshot(device)
        except KeyError:
            return json_error("Device not found", 404)
        except httpx.HTTPStatusError as exc:
            return json_error(
                "Snapshot not found" if exc.response.status_code == 404 else str(exc),
                404 if exc.response.status_code == 404 else 502,
            )
        except Exception as exc:
            return json_error(str(exc), 502)
        headers = {"Cache-Control": "no-store"}
        if updated_at:
            headers["X-Snapshot-Updated-At"] = updated_at
        return Response(content=content, media_type=content_type, headers=headers)

    @app.post("/api/refresh")
    async def refresh_all():
        devices = store.load_devices()
        semaphore = asyncio.Semaphore(DEFAULT_CONCURRENCY)

        async def refresh_one(device: Device) -> dict[str, Any]:
            async with semaphore:
                return await refresh_device_status(client, device)

        results = await asyncio.gather(*(refresh_one(device) for device in devices))
        store.save_devices(devices)
        return {"devices": results}

    @app.post("/api/devices/{device_id}/lock")
    async def lock_device(device_id: str, request: Request):
        try:
            payload = await request.json()
            locked = bool(payload.get("locked", True))
            device = store.get_device(device_id)
            status = await client.set_lock(device, locked)
            return {"device": public_device(device), "status": status}
        except KeyError:
            return json_error("Device not found", 404)
        except Exception as exc:
            return json_error(str(exc), 502)

    @app.post("/api/batch/lock")
    async def batch_lock(request: Request):
        try:
            payload = await request.json()
            devices = select_devices(store, payload)
            locked = bool(payload.get("locked", True))
        except Exception as exc:
            return json_error(str(exc), 400)

        async def apply_lock(device: Device) -> dict[str, Any]:
            return {"status": await client.set_lock(device, locked)}

        results = await run_device_operations(devices, apply_lock)
        return {
            "locked": locked,
            "results": results,
            "summary": operation_summary(results),
        }

    async def collect(device: Device) -> dict[str, Any]:
        status = await client.get_status(device)
        username = status.get("current_username")
        if not username:
            raise ValueError("No current classroom profile on device")
        # MVP：收取前先触发学生端保存，避免刚修改但未手动保存导致收取旧状态
        await client.force_save(device)
        path = await client.collect_profile(
            device, str(username), store.collections_dir
        )
        return {"username": username, "path": str(path)}

    @app.post("/api/devices/{device_id}/collect")
    async def collect_device(device_id: str):
        try:
            device = store.get_device(device_id)
        except KeyError:
            return json_error("Device not found", 404)
        results = await run_device_operations([device], collect)
        result = results[0]
        if not result["ok"]:
            return json_error(str(result["error"]), 502)
        return result

    @app.post("/api/batch/collect")
    async def batch_collect(request: Request):
        try:
            devices = select_devices(store, await request.json())
        except Exception as exc:
            return json_error(str(exc), 400)
        results = await run_device_operations(devices, collect)
        return {"results": results, "summary": operation_summary(results)}

    @app.post("/api/collect-all")
    async def collect_all():
        devices = select_devices(store, {"all": True})
        results = await run_device_operations(devices, collect)
        return {"results": results, "summary": operation_summary(results)}

    async def distribute_file(
        devices: list[Device],
        upload: UploadFile,
    ) -> JSONResponse | dict[str, Any]:
        try:
            path, filename, content_type = await save_upload(upload, store.data_dir)
        except ValueError as exc:
            return json_error(str(exc), 413)
        except Exception as exc:
            return json_error(str(exc), 400)

        async def send(device: Device) -> dict[str, Any]:
            response = await client.upload_file(device, path, filename, content_type)
            return {"response": response}

        try:
            results = await run_device_operations(devices, send)
            return {
                "filename": filename,
                "results": results,
                "summary": operation_summary(results),
            }
        finally:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    @app.post("/api/devices/{device_id}/files/upload")
    async def upload_file_to_device(device_id: str, file: UploadFile = File(...)):
        try:
            device = store.get_device(device_id)
        except KeyError:
            await file.close()
            return json_error("Device not found", 404)
        return await distribute_file([device], file)

    @app.post("/api/batch/files/upload")
    async def upload_file_to_batch(
        file: UploadFile = File(...),
        device_ids: str | None = Form(default=None),
        group: str | None = Form(default=None),
        all_devices: bool = Form(default=False, alias="all"),
    ):
        try:
            selection = parse_multipart_selection(device_ids, group, all_devices)
            devices = select_devices(store, selection)
        except Exception as exc:
            await file.close()
            return json_error(str(exc), 400)
        return await distribute_file(devices, file)

    async def restore_workspace_package(
        devices: list[Device],
        upload: UploadFile,
    ) -> JSONResponse | dict[str, Any]:
        """下发作品 ZIP 并触发学生端一键恢复（MVP T-5）。"""
        try:
            path, filename, _ = await save_upload(upload, store.data_dir)
            if not filename.lower().endswith(".zip"):
                raise ValueError("Only .zip workspace packages are supported")
        except ValueError as exc:
            return json_error(str(exc), 413)
        except Exception as exc:
            return json_error(str(exc), 400)

        async def send(device: Device) -> dict[str, Any]:
            response = await client.restore_workspace(device, path, filename)
            return {"response": response}

        try:
            results = await run_device_operations(devices, send)
            return {
                "filename": filename,
                "results": results,
                "summary": operation_summary(results),
            }
        finally:
            try:
                os.remove(path)
            except FileNotFoundError:
                pass

    @app.post("/api/devices/{device_id}/workspace/restore")
    async def restore_workspace_to_device(device_id: str, file: UploadFile = File(...)):
        try:
            device = store.get_device(device_id)
        except KeyError:
            await file.close()
            return json_error("Device not found", 404)
        return await restore_workspace_package([device], file)

    @app.post("/api/batch/workspace/restore")
    async def restore_workspace_to_batch(
        file: UploadFile = File(...),
        device_ids: str | None = Form(default=None),
        group: str | None = Form(default=None),
        all_devices: bool = Form(default=False, alias="all"),
    ):
        try:
            selection = parse_multipart_selection(device_ids, group, all_devices)
            devices = select_devices(store, selection)
        except Exception as exc:
            await file.close()
            return json_error(str(exc), 400)
        return await restore_workspace_package(devices, file)

    @app.post("/api/discover")
    async def discover(request: Request):
        try:
            payload = await request.json()
            network = ipaddress.ip_network(str(payload.get("cidr") or ""), strict=False)
            if network.version != 4:
                raise ValueError("Only IPv4 CIDR ranges are supported")
            if network.num_addresses > 256:
                raise ValueError("CIDR range must be /24 or smaller")
            port = int(payload.get("port", 12393))
            if not 1 <= port <= 65535:
                raise ValueError("port must be between 1 and 65535")
            token = str(payload.get("token") or "")
        except Exception as exc:
            return json_error(str(exc), 400)

        addresses = list(network.hosts())
        semaphore = asyncio.Semaphore(DEFAULT_CONCURRENCY)

        async def probe(address: ipaddress.IPv4Address) -> dict[str, Any] | None:
            base_url = f"http://{address}:{port}"
            started = time.perf_counter()
            try:
                async with semaphore:
                    status = await client.get_status_url(base_url, token)
            except Exception:
                return None
            return {
                "device": {
                    "id": str(address),
                    "name": str(address),
                    "base_url": base_url,
                    "group": "",
                    "enabled": True,
                },
                "status": status,
                "latency_ms": round((time.perf_counter() - started) * 1000),
            }

        probed = await asyncio.gather(*(probe(address) for address in addresses))
        discovered = [item for item in probed if item is not None]
        return {"devices": discovered, "scanned": len(addresses)}

    @app.get("/api/collections")
    async def list_collections():
        files = []
        for path in sorted(store.collections_dir.rglob("*.zip")):
            stat = path.stat()
            files.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "size": stat.st_size,
                    "updated_at": stat.st_mtime,
                }
            )
        return {"files": files}

    # --- 班级管理（PRD T-4 / 开发文档 §4.3.2）---
    @app.get("/api/classes")
    async def list_classes():
        return {"classes": class_store.list_classes()}

    @app.post("/api/classes")
    async def create_class(request: Request):
        try:
            payload = await request.json()
            cls = class_store.create(str(payload.get("name") or ""))
        except ValueError as exc:
            return json_error(str(exc), 400)
        return {"class": cls}

    @app.patch("/api/classes/{class_id}")
    async def rename_class(class_id: str, request: Request):
        try:
            payload = await request.json()
            cls = class_store.rename(class_id, str(payload.get("name") or ""))
        except ValueError as exc:
            return json_error(str(exc), 400)
        if cls is None:
            return json_error("Class not found", 404)
        return {"class": cls}

    @app.delete("/api/classes/{class_id}")
    async def delete_class(class_id: str):
        # 删除班级前，该班学生回未分班
        for user in user_store.list_users():
            if user.get("class_id") == class_id:
                user_store.update_class(user["username"], None)
        if not class_store.delete(class_id):
            return json_error("Class not found", 404)
        return {"ok": True}

    # --- 用户管理（PRD T-4 / 开发文档 §4.3.3）---
    @app.get("/api/users")
    async def list_users():
        users = user_store.list_users()
        # 附带班级名称
        classes = {c["class_id"]: c["name"] for c in class_store.list_classes()}
        for u in users:
            cid = u.get("class_id")
            u["class_name"] = classes.get(cid) if cid else None
        return {"users": users}

    @app.patch("/api/users/{username}")
    async def update_user(username: str, request: Request):
        try:
            payload = await request.json()
        except Exception:
            return json_error("Invalid body", 400)
        class_id = payload.get("class_id")
        if class_id:
            class_id = str(class_id)
            if class_store.get(class_id) is None:
                return json_error("Class not found", 404)
        try:
            updated = user_store.update_class(username, class_id)
        except ValueError as exc:
            return json_error(str(exc), 400)
        if updated is None:
            return json_error("User not found", 404)
        return {"user": updated}

    @app.post("/api/users/check")
    async def check_username(request: Request):
        """学生端创建前调用（开发文档 §4.3.3）。"""
        try:
            payload = await request.json()
            available = user_store.check_available(str(payload.get("username") or ""))
        except ValueError as exc:
            return json_error(str(exc), 400)
        return {"available": available}

    @app.post("/api/users/sync")
    async def sync_user(request: Request):
        """学生端离线创建恢复在线后上报（开发文档 §4.3.3）。"""
        try:
            payload = await request.json()
            result = user_store.sync_from_device(
                str(payload.get("username") or ""),
                str(payload.get("device_id") or ""),
            )
        except ValueError as exc:
            return json_error(str(exc), 400)
        return result

    # --- 扫描（PRD T-3 / 开发文档 §4.3.4）---
    @app.post("/api/scan/now")
    async def scan_now():
        result = await scan_service.scan_once()
        return result

    @app.get("/api/scan/status")
    async def scan_status():
        return scan_service.status()

    # --- 缩略图（PRD T-5）---
    @app.get("/api/devices/{device_id}/thumbnail")
    async def device_thumbnail(device_id: str):
        try:
            device = store.get_device(device_id)
        except KeyError:
            return json_error("Device not found", 404)
        try:
            content = await client.get_thumbnail(device)
        except Exception as exc:
            return json_error(f"获取缩略图失败: {exc}", 502)
        return Response(content=content, media_type="image/jpeg")

    # --- 管控增强（PRD T-6）：解锁/强制保存/提交（锁屏复用上方 /api/devices/{id}/lock）---
    async def _control_one(device_id: str, action: str) -> dict:
        try:
            device = store.get_device(device_id)
        except KeyError:
            return {"device_id": device_id, "ok": False, "error": "Device not found"}
        try:
            if action == "unlock":
                await client.set_lock(device, False)
            elif action == "save":
                await client.force_save(device)
            elif action == "submit":
                await client.force_submit(device)
            else:
                return {"device_id": device_id, "ok": False, "error": f"Unknown action: {action}"}
            return {"device_id": device_id, "ok": True}
        except Exception as exc:
            return {"device_id": device_id, "ok": False, "error": str(exc)}

    @app.post("/api/devices/{device_id}/unlock")
    async def device_unlock(device_id: str):
        return {"result": await _control_one(device_id, "unlock")}

    @app.post("/api/devices/{device_id}/save")
    async def device_save(device_id: str):
        return {"result": await _control_one(device_id, "save")}

    @app.post("/api/devices/{device_id}/submit")
    async def device_submit(device_id: str):
        return {"result": await _control_one(device_id, "submit")}

    @app.post("/api/batch/collect-stream")
    async def batch_collect_stream(request: Request):
        """进度化批量收集（PRD T-7）：SSE 流式推送每个设备的收集结果。

        事件格式：
          data: {"type":"start","total":N}
          data: {"type":"progress","index":i,"device_id":"...","ok":true,"path":"..."}
          data: {"type":"progress","index":i,"device_id":"...","ok":false,"error":"..."}
          data: {"type":"done","total":N,"succeeded":K}
        """
        try:
            payload = await request.json()
        except Exception:
            payload = {}
        devices = select_devices(store, payload)
        total = len(devices)

        async def event_stream():
            import json as _json
            yield f"data: {_json.dumps({'type': 'start', 'total': total}, ensure_ascii=False)}\n\n"
            succeeded = 0
            for index, device in enumerate(devices):
                try:
                    status = await client.get_status(device)
                    username = status.get("current_username")
                    if not username:
                        result = {"type": "progress", "index": index,
                                  "device_id": device.id, "ok": False,
                                  "error": "No current classroom profile"}
                    else:
                        # MVP：流式收取同样先保存再导出
                        await client.force_save(device)
                        path = await client.collect_profile(
                            device, str(username), store.collections_dir
                        )
                        succeeded += 1
                        result = {"type": "progress", "index": index,
                                  "device_id": device.id, "ok": True,
                                  "username": username, "path": str(path)}
                except Exception as exc:
                    result = {"type": "progress", "index": index,
                              "device_id": device.id, "ok": False, "error": str(exc)}
                yield f"data: {_json.dumps(result, ensure_ascii=False)}\n\n"
            yield f"data: {_json.dumps({'type': 'done', 'total': total, 'succeeded': succeeded}, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/api/thumbnails")
    async def thumbnails_overview():
        """批量返回各设备缩略图可用性（基于 status_cache 的 snapshot_updated_at）。"""
        devices = store.load_devices()
        items = []
        for d in devices:
            cache = d.status_cache or {}
            items.append({
                "device_id": d.id,
                "name": d.name,
                "online": bool(cache.get("online")),
                "snapshot_updated_at": cache.get("snapshot_updated_at"),
                "has_snapshot": bool(cache.get("snapshot_updated_at")),
            })
        return {"devices": items}

    return app
