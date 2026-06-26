import asyncio
import json
import time
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from teacher_console.app import create_app
from teacher_console.student_client import StudentClient


def add_device(
    client: TestClient,
    device_id: str,
    *,
    group: str = "",
    token: str = "",
    enabled: bool = True,
) -> None:
    response = client.post(
        "/api/devices",
        json={
            "id": device_id,
            "name": device_id,
            "base_url": f"http://{device_id}.local:12393",
            "group": group,
            "token": token,
            "enabled": enabled,
        },
    )
    assert response.status_code == 200


def test_device_crud_redacts_token_and_loads_legacy_json(tmp_path: Path):
    (tmp_path / "devices.json").write_text(
        json.dumps(
            {
                "devices": [
                    {
                        "id": "legacy",
                        "name": "Legacy",
                        "base_url": "http://legacy.local:12393",
                        "enabled": True,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    with TestClient(create_app(tmp_path, enable_auth=False, enable_scan=False)) as client:
        assert client.get("/api/devices").json()["devices"][0]["id"] == "legacy"
        add_device(client, "pi-01", token="secret-token")
        devices = client.get("/api/devices").json()["devices"]
        assert all("token" not in device for device in devices)
        assert client.delete("/api/devices/pi-01").status_code == 200

    saved = json.loads((tmp_path / "devices.json").read_text(encoding="utf-8"))
    legacy = next(item for item in saved["devices"] if item["id"] == "legacy")
    assert legacy["token"] == ""


def test_refresh_16_devices_runs_concurrently(tmp_path: Path):
    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.08)
        return httpx.Response(200, json={"online": True}, request=request)

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        for index in range(16):
            add_device(client, f"device-{index:02d}")

        started = time.perf_counter()
        response = client.post("/api/refresh")
        elapsed = time.perf_counter() - started

    assert response.status_code == 200
    assert elapsed < 0.55
    results = response.json()["devices"]
    assert len(results) == 16
    assert all(item["online"] for item in results)
    assert all(item["latency_ms"] >= 70 for item in results)
    assert all(item["last_seen"] for item in results)
    assert all(item["error"] is None for item in results)


def test_four_offline_devices_do_not_block_online_refresh(tmp_path: Path):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host.startswith("offline"):
            await asyncio.sleep(0.30)
            raise httpx.ConnectError("offline", request=request)
        await asyncio.sleep(0.02)
        return httpx.Response(200, json={"online": True}, request=request)

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        for index in range(4):
            add_device(client, f"offline-{index}")
            add_device(client, f"online-{index}")

        started = time.perf_counter()
        response = client.post("/api/refresh")
        elapsed = time.perf_counter() - started

    assert elapsed < 0.70
    results = response.json()["devices"]
    online = [item for item in results if item["device"]["id"].startswith("online")]
    offline = [item for item in results if item["device"]["id"].startswith("offline")]
    assert len(online) == len(offline) == 4
    assert all(item["online"] and item["error"] is None for item in online)
    assert all(not item["online"] and item["error"] for item in offline)


def test_batch_lock_and_collect_return_per_device_results(tmp_path: Path):
    async def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if request.url.path == "/classroom/app-lock":
            if host == "bad.local":
                return httpx.Response(503, request=request)
            return httpx.Response(200, json={"locked": True}, request=request)
        if request.url.path == "/classroom/profile/save":
            return httpx.Response(200, json={"profile": {"username": f"profile-{host}"}}, request=request)
        if request.url.path == "/classroom/status":
            return httpx.Response(
                200,
                json={"current_username": f"profile-{host}"},
                request=request,
            )
        if request.url.path.endswith("/export"):
            if host == "bad.local":
                return httpx.Response(503, request=request)
            return httpx.Response(
                200,
                content=b"PK\x03\x04archive",
                headers={"content-type": "application/zip"},
                request=request,
            )
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        add_device(client, "good", group="class-a")
        add_device(client, "bad", group="class-a")
        add_device(client, "other", group="class-b")

        lock_response = client.post(
            "/api/batch/lock",
            json={"group": "class-a", "locked": True},
        )
        collect_response = client.post(
            "/api/batch/collect",
            json={"device_ids": ["good", "bad"]},
        )

    assert lock_response.json()["summary"] == {
        "total": 2,
        "succeeded": 1,
        "failed": 1,
    }
    collect_payload = collect_response.json()
    assert collect_payload["summary"] == {"total": 2, "succeeded": 1, "failed": 1}
    assert [item["device"]["id"] for item in collect_payload["results"]] == [
        "good",
        "bad",
    ]
    assert collect_payload["results"][0]["path"].endswith(".zip")
    assert collect_payload["results"][1]["error"]


def test_file_distribution_reuses_upload_and_cleans_temp_file(tmp_path: Path):
    received: list[tuple[str, str, bytes]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/classroom/profile/files/upload"
        body = await request.aread()
        received.append((request.url.host, request.headers["x-classroom-token"], body))
        return httpx.Response(
            200, json={"file": {"name": "lesson.txt"}}, request=request
        )

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        add_device(client, "one", token="token-one")
        add_device(client, "two", token="token-two")
        response = client.post(
            "/api/batch/files/upload",
            data={"device_ids": json.dumps(["one", "two"])},
            files={"file": ("lesson.txt", b"same payload", "text/plain")},
        )
        single_response = client.post(
            "/api/devices/one/files/upload",
            files={"file": ("lesson.txt", b"single payload", "text/plain")},
        )

    assert response.status_code == 200
    assert response.json()["summary"] == {"total": 2, "succeeded": 2, "failed": 0}
    assert single_response.json()["summary"] == {
        "total": 1,
        "succeeded": 1,
        "failed": 0,
    }
    assert {(host, token) for host, token, _ in received} == {
        ("one.local", "token-one"),
        ("two.local", "token-two"),
    }
    assert sum(b"same payload" in body for _, _, body in received) == 2
    assert not list(tmp_path.glob("teacher-upload-*.tmp"))


def test_token_header_is_sent_and_not_returned(tmp_path: Path):
    headers: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        headers.append(request.headers.get("x-classroom-token", ""))
        return httpx.Response(200, json={"online": True}, request=request)

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        add_device(client, "secured", token="device-secret")
        response = client.post("/api/devices/secured/refresh")
        listed = client.get("/api/devices").json()["devices"][0]

    assert response.status_code == 200
    assert headers == ["device-secret"]
    assert "token" not in response.json()["device"]
    assert "token" not in listed


def test_discover_validates_cidr_and_probes_with_token(tmp_path: Path):
    seen: list[tuple[str, str]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        seen.append((request.url.host, request.headers.get("x-classroom-token", "")))
        if request.url.host == "192.0.2.1":
            return httpx.Response(200, json={"online": True}, request=request)
        raise httpx.ConnectError("offline", request=request)

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        too_large = client.post(
            "/api/discover",
            json={"cidr": "192.0.0.0/23", "port": 12393, "token": "scan-token"},
        )
        bad_port = client.post(
            "/api/discover",
            json={"cidr": "192.0.2.0/30", "port": 70000},
        )
        response = client.post(
            "/api/discover",
            json={"cidr": "192.0.2.0/30", "port": 12393, "token": "scan-token"},
        )

    assert too_large.status_code == 400
    assert bad_port.status_code == 400
    payload = response.json()
    assert payload["scanned"] == 2
    assert len(payload["devices"]) == 1
    assert payload["devices"][0]["device"]["base_url"] == "http://192.0.2.1:12393"
    assert "token" not in payload["devices"][0]["device"]
    assert seen == [("192.0.2.1", "scan-token"), ("192.0.2.2", "scan-token")]


def test_snapshot_is_proxied_with_device_token(tmp_path: Path):
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/classroom/snapshot"
        assert request.headers["x-classroom-token"] == "snapshot-secret"
        return httpx.Response(
            200,
            content=b"\x89PNG\r\nsnapshot",
            headers={
                "content-type": "image/png",
                "x-snapshot-updated-at": "2026-06-13T08:00:00+00:00",
            },
            request=request,
        )

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    with TestClient(create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)) as client:
        add_device(client, "snapshot-device", token="snapshot-secret")
        response = client.get("/api/devices/snapshot-device/snapshot")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/png"
    assert response.headers["cache-control"] == "no-store"
    assert response.content == b"\x89PNG\r\nsnapshot"
