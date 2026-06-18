"""M5 缩略图/管控增强/进度化收集单元测试（PRD T-5/T-6/T-7）。"""
import httpx
import pytest
from fastapi.testclient import TestClient

from teacher_console.app import create_app
from teacher_console.student_client import StudentClient


def _mock_student_client(handler):
    return StudentClient(transport=httpx.MockTransport(handler))


@pytest.fixture
def app_client(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        # 默认 status 返回有 username
        if request.url.path.endswith("/classroom/status"):
            return httpx.Response(200, json={"current_username": "U01", "online": True,
                                             "snapshot_updated_at": "2026-06-18T01:00:00Z"}, request=request)
        if request.url.path.endswith("/classroom/snapshot"):
            return httpx.Response(200, content=b"\xff\xd8\xff\xe0thumbnail-bytes",
                                  headers={"content-type": "image/jpeg"}, request=request)
        if request.url.path.endswith("/classroom/app-lock"):
            return httpx.Response(200, json={"locked": True}, request=request)
        if request.url.path.endswith("/classroom/profile/save"):
            return httpx.Response(200, json={"profile": {"username": "U01"}}, request=request)
        if request.url.path.endswith("/classroom/profile/submit"):
            return httpx.Response(200, json={"profile": {"username": "U01", "submitted": True}}, request=request)
        if "/export" in request.url.path:
            return httpx.Response(200, content=b"PKzip", request=request)
        return httpx.Response(404, request=request)

    sc = _mock_student_client(handler)
    app = create_app(tmp_path, sc, enable_auth=False, enable_scan=False)
    with TestClient(app) as client:
        # 预置一台设备
        client.post("/api/devices", json={"id": "pi-01", "name": "PI", "base_url": "http://pi:12393", "token": "t"})
        yield client, sc


# --- T-5 缩略图 ---


def test_thumbnail_proxy(app_client):
    client, _ = app_client
    r = client.get("/api/devices/pi-01/thumbnail")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content.startswith(b"\xff\xd8")


def test_thumbnails_overview(app_client):
    client, _ = app_client
    # 先 refresh 让 status_cache 有 snapshot_updated_at
    client.post("/api/refresh")
    r = client.get("/api/thumbnails")
    assert r.status_code == 200
    items = r.json()["devices"]
    assert any(d["device_id"] == "pi-01" for d in items)


# --- T-6 管控增强 ---


def test_lock_unlock(app_client):
    client, _ = app_client
    # 锁（旧路由 /api/devices/{id}/lock，body {locked:true}）
    r = client.post("/api/devices/pi-01/lock", json={"locked": True})
    assert r.status_code == 200
    # 解锁（新路由 /api/devices/{id}/unlock）
    r = client.post("/api/devices/pi-01/unlock")
    assert r.status_code == 200
    assert r.json()["result"]["ok"] is True


def test_force_save_submit(app_client):
    client, _ = app_client
    r = client.post("/api/devices/pi-01/save")
    assert r.status_code == 200
    assert r.json()["result"]["ok"] is True

    r = client.post("/api/devices/pi-01/submit")
    assert r.status_code == 200
    assert r.json()["result"]["ok"] is True


def test_batch_lock(app_client):
    client, _ = app_client
    # 旧 /api/batch/lock 路由，body {device_ids, locked}
    r = client.post("/api/batch/lock", json={"device_ids": ["pi-01"], "locked": True})
    assert r.status_code == 200
    assert r.json()["results"][0]["status"]["locked"] is True


def test_control_unknown_device(app_client):
    client, _ = app_client
    r = client.post("/api/devices/no-such/unlock")
    assert r.status_code == 200
    assert r.json()["result"]["ok"] is False
    assert "not found" in r.json()["result"]["error"].lower()


# --- T-7 进度化批量收集 SSE ---


def test_batch_collect_stream(app_client):
    client, _ = app_client
    with client.stream("POST", "/api/batch/collect-stream", json={"device_ids": ["pi-01"]}) as resp:
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]
        events = []
        for line in resp.iter_lines():
            if line.startswith("data: "):
                import json
                events.append(json.loads(line[6:]))
    types = [e["type"] for e in events]
    assert types[0] == "start"
    assert types[-1] == "done"
    assert any(e["type"] == "progress" and e.get("ok") for e in events)
    assert events[-1]["succeeded"] >= 1


def test_batch_collect_stream_handles_missing_profile(tmp_path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/classroom/status"):
            return httpx.Response(200, json={"current_username": None, "online": True}, request=request)
        return httpx.Response(404, request=request)

    sc = _mock_student_client(handler)
    app = create_app(tmp_path, sc, enable_auth=False, enable_scan=False)
    with TestClient(app) as client:
        client.post("/api/devices", json={"id": "pi-empty", "name": "E", "base_url": "http://e:12393"})
        with client.stream("POST", "/api/batch/collect-stream", json={"device_ids": ["pi-empty"]}) as resp:
            events = []
            for line in resp.iter_lines():
                if line.startswith("data: "):
                    import json
                    events.append(json.loads(line[6:]))
    progress = [e for e in events if e["type"] == "progress"][0]
    assert progress["ok"] is False
    assert "No current classroom profile" in progress["error"]
    assert events[-1]["succeeded"] == 0
