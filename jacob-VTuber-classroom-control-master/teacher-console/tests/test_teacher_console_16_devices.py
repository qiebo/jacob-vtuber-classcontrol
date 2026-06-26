import base64
import io
import socket
import threading
import time
import zipfile
from contextlib import ExitStack
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.testclient import TestClient
from starlette.responses import Response

from teacher_console.app import create_app


DEVICE_COUNT = 16
TOKEN = "classroom-test-token"
SNAPSHOT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def build_simulated_student(device_id: str) -> FastAPI:
    app = FastAPI()
    state = {
        "locked": False,
        "uploaded_size": 0,
    }

    def authorize(x_classroom_token: str | None = Header(default=None)):
        if x_classroom_token != TOKEN:
            raise HTTPException(status_code=401)

    @app.get("/classroom/status", dependencies=[])
    async def status(x_classroom_token: str | None = Header(default=None)):
        authorize(x_classroom_token)
        return {
            "device_id": device_id,
            "device_name": device_id,
            "api_version": "1",
            "online": True,
            "app_ready": True,
            "current_username": f"profile-{device_id}",
            "class_name": "Integration Class",
            "character_name": "Jacob",
            "dirty": False,
            "submitted": True,
            "locked": state["locked"],
        }

    @app.post("/classroom/app-lock")
    async def app_lock(
        payload: dict,
        x_classroom_token: str | None = Header(default=None),
    ):
        authorize(x_classroom_token)
        state["locked"] = bool(payload.get("locked"))
        return {"locked": state["locked"]}

    @app.post("/classroom/profile/files/upload")
    async def upload(
        file: UploadFile = File(...),
        x_classroom_token: str | None = Header(default=None),
    ):
        authorize(x_classroom_token)
        content = await file.read()
        state["uploaded_size"] = len(content)
        return {"file": {"name": file.filename, "size": len(content)}}

    @app.post("/classroom/profile/save")
    async def save(x_classroom_token: str | None = Header(default=None)):
        authorize(x_classroom_token)
        return {"profile": {"username": device_id}}

    @app.get("/classroom/profile/{username}/export")
    async def export(
        username: str,
        x_classroom_token: str | None = Header(default=None),
    ):
        authorize(x_classroom_token)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("profile.txt", username)
        return Response(buffer.getvalue(), media_type="application/zip")

    @app.get("/classroom/snapshot")
    async def snapshot(x_classroom_token: str | None = Header(default=None)):
        authorize(x_classroom_token)
        return Response(
            SNAPSHOT_PNG,
            media_type="image/png",
            headers={"X-Snapshot-Updated-At": "2026-06-13T00:00:00+00:00"},
        )

    return app


class RunningServer:
    def __init__(self, app: FastAPI, port: int):
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
        )
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, daemon=True)
        self.port = port

    def __enter__(self):
        self.thread.start()
        deadline = time.time() + 5
        while time.time() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", self.port), timeout=0.1):
                    return self
            except OSError:
                time.sleep(0.03)
        raise RuntimeError(f"Server on port {self.port} did not start")

    def __exit__(self, exc_type, exc, traceback):
        self.server.should_exit = True
        self.thread.join(timeout=5)


def register_devices(client: TestClient, ports: list[int]) -> None:
    for index, port in enumerate(ports):
        response = client.post(
            "/api/devices",
            json={
                "id": f"pi-{index + 1:02d}",
                "name": f"Device {index + 1:02d}",
                "base_url": f"http://127.0.0.1:{port}",
                "group": "class-a",
                "token": TOKEN,
            },
        )
        assert response.status_code == 200


def test_16_device_real_http_control_and_distribution(tmp_path: Path):
    ports = [free_port() for _ in range(DEVICE_COUNT)]
    with ExitStack() as servers:
        for index, port in enumerate(ports):
            servers.enter_context(
                RunningServer(build_simulated_student(f"pi-{index + 1:02d}"), port)
            )

        with TestClient(create_app(tmp_path, enable_auth=False, enable_scan=False)) as teacher:
            register_devices(teacher, ports)

            started = time.perf_counter()
            refresh = teacher.post("/api/refresh")
            refresh_elapsed = time.perf_counter() - started
            assert refresh.status_code == 200
            assert refresh_elapsed < 3.0
            assert len(refresh.json()["devices"]) == DEVICE_COUNT
            assert all(item["online"] for item in refresh.json()["devices"])

            snapshot = teacher.get("/api/devices/pi-01/snapshot")
            assert snapshot.status_code == 200
            assert snapshot.content == SNAPSHOT_PNG
            assert snapshot.headers["content-type"] == "image/png"

            lock = teacher.post(
                "/api/batch/lock",
                json={"all": True, "locked": True},
            )
            assert lock.json()["summary"] == {
                "total": DEVICE_COUNT,
                "succeeded": DEVICE_COUNT,
                "failed": 0,
            }

            payload = b"x" * (5 * 1024 * 1024)
            started = time.perf_counter()
            distributed = teacher.post(
                "/api/batch/files/upload",
                data={"all": "true"},
                files={"file": ("lesson.bin", payload, "application/octet-stream")},
            )
            distribution_elapsed = time.perf_counter() - started
            assert distributed.status_code == 200
            assert distributed.json()["summary"] == {
                "total": DEVICE_COUNT,
                "succeeded": DEVICE_COUNT,
                "failed": 0,
            }
            assert distribution_elapsed < 15.0

            collected = teacher.post("/api/batch/collect", json={"all": True})
            assert collected.json()["summary"] == {
                "total": DEVICE_COUNT,
                "succeeded": DEVICE_COUNT,
                "failed": 0,
            }
            assert len(list((tmp_path / "collections").rglob("*.zip"))) == DEVICE_COUNT


def test_16_device_refresh_with_four_offline_devices(tmp_path: Path):
    online_count = 12
    online_ports = [free_port() for _ in range(online_count)]
    offline_ports = [free_port() for _ in range(DEVICE_COUNT - online_count)]
    with ExitStack() as servers:
        for index, port in enumerate(online_ports):
            servers.enter_context(
                RunningServer(build_simulated_student(f"pi-{index + 1:02d}"), port)
            )

        with TestClient(create_app(tmp_path, enable_auth=False, enable_scan=False)) as teacher:
            register_devices(teacher, online_ports + offline_ports)
            started = time.perf_counter()
            refresh = teacher.post("/api/refresh")
            elapsed = time.perf_counter() - started

    results = refresh.json()["devices"]
    assert elapsed < 5.0
    assert sum(item["online"] for item in results) == online_count
    assert sum(not item["online"] for item in results) == DEVICE_COUNT - online_count
