import io
import socket

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from open_llm_vtuber.classroom import routes as classroom_routes
from open_llm_vtuber.classroom.routes import init_classroom_routes
from open_llm_vtuber.classroom.storage import create_profile
from open_llm_vtuber.knowledge_service import add_knowledge_file, get_knowledge_overview


class DummyCharacterConfig:
    def __init__(self, payload=None):
        self.payload = payload or {
            "conf_name": "default",
            "conf_uid": "default_uid",
            "character_name": "Jacob",
            "human_name": "Student",
            "persona_prompt": "You are a classroom assistant.",
            "avatar_mode": "live2d",
            "avatar_pack_id": "",
            "live2d_model_name": "shizuku",
        }
        for key, value in self.payload.items():
            setattr(self, key, value)

    def model_dump(self, **kwargs):
        return dict(self.payload)


class DummyContext:
    def __init__(self):
        self.character_config = DummyCharacterConfig()
        self.classroom_username = None

    async def apply_character_config(self, character_config):
        self.character_config = character_config


def make_client(context=None):
    app = FastAPI()
    context = context or DummyContext()

    @app.get("/health")
    async def health():
        return {"ok": True}

    app.include_router(init_classroom_routes(context))
    return TestClient(app), context


def image_bytes(image_format="PNG"):
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), color="red").save(buffer, format=image_format)
    return buffer.getvalue()


def test_status_uses_configured_device_identity(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.setenv("JACOB_DEVICE_ID", "device-17")
    monkeypatch.setenv("JACOB_DEVICE_NAME", "Student Laptop 17")
    client, _ = make_client()

    response = client.get("/classroom/status")

    assert response.status_code == 200
    assert response.json()["device_id"] == "device-17"
    assert response.json()["device_name"] == "Student Laptop 17"
    assert response.json()["api_version"] == "1"
    # 新字段 current_username，不再有 current_profile_id
    assert "current_username" in response.json()
    assert "current_profile_id" not in response.json()


def test_status_falls_back_to_stable_hostname(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.delenv("JACOB_DEVICE_ID", raising=False)
    monkeypatch.delenv("JACOB_DEVICE_NAME", raising=False)
    client, _ = make_client()

    response = client.get("/classroom/status")

    assert response.status_code == 200
    assert response.json()["device_id"] == socket.gethostname()
    assert response.json()["device_name"] == socket.gethostname()


def test_classroom_token_is_required_only_when_configured(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JACOB_CLASSROOM_TOKEN", "class-secret")
    client, _ = make_client()

    assert client.get("/health").status_code == 200
    assert client.get("/classroom/status").status_code == 401
    assert (
        client.get(
            "/classroom/status",
            headers={"X-Classroom-Token": "wrong"},
        ).status_code
        == 401
    )
    assert (
        client.get(
            "/classroom/status",
            headers={"X-Classroom-Token": "class-secret"},
        ).status_code
        == 200
    )


def test_classroom_routes_remain_compatible_without_token(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    assert client.get("/classroom/status").status_code == 200


def test_creating_new_profile_switches_identity_and_starts_empty_knowledge(
    tmp_path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.setattr(
        classroom_routes.CharacterConfig,
        "model_validate",
        staticmethod(lambda payload: DummyCharacterConfig(payload)),
    )
    client, context = make_client()

    alice = client.post(
        "/classroom/profile/create",
        json={"username": "Alice01", "class_name": "Class A"},
    )
    assert alice.status_code == 200
    assert alice.json()["profile"]["username"] == "Alice01"
    add_knowledge_file("alice.txt", b"Alice private notes")

    bob = client.post(
        "/classroom/profile/create",
        json={"username": "Bob02", "class_name": "Class A"},
    )

    assert bob.status_code == 200
    assert bob.json()["profile"]["username"] == "Bob02"
    assert context.character_config.conf_uid == "Bob02"
    assert get_knowledge_overview()["file_count"] == 0

    # runtime state 应记录 current_username
    status = client.get("/classroom/status").json()
    assert status["current_username"] == "Bob02"


def test_create_profile_rejects_invalid_username(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    # 含空格 / 符号 / 中文 都应被拒
    for bad_username in ["has space", "has-dash", "中文名", "a" * 33]:
        resp = client.post(
            "/classroom/profile/create", json={"username": bad_username}
        )
        assert resp.status_code == 422, f"{bad_username!r} should be rejected"


def test_load_profile_by_username(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.setattr(
        classroom_routes.CharacterConfig,
        "model_validate",
        staticmethod(lambda payload: DummyCharacterConfig(payload)),
    )
    client, _ = make_client()

    client.post("/classroom/profile/create", json={"username": "Carol03"})

    resp = client.post("/classroom/profile/load", json={"username": "Carol03"})
    assert resp.status_code == 200
    assert resp.json()["profile"]["username"] == "Carol03"

    # 不存在的用户名
    missing = client.post(
        "/classroom/profile/load", json={"username": "Nobody99"}
    )
    assert missing.status_code == 404


def test_snapshot_rejects_format_and_oversize(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    invalid = client.post(
        "/classroom/snapshot",
        files={"file": ("snapshot.gif", b"GIF89a", "image/gif")},
    )
    oversized = client.post(
        "/classroom/snapshot",
        files={"file": ("snapshot.png", b"x" * (1024 * 1024 + 1), "image/png")},
    )

    assert invalid.status_code == 400
    assert oversized.status_code == 400


def test_snapshot_rejects_mismatched_content_type(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    response = client.post(
        "/classroom/snapshot",
        files={"file": ("snapshot.jpg", image_bytes("PNG"), "image/jpeg")},
    )

    assert response.status_code == 400


def test_missing_snapshot_returns_404(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    assert client.get("/classroom/snapshot").status_code == 404


def test_profile_file_upload_rejects_oversize(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.setattr(classroom_routes, "MAX_PROFILE_FILE_BYTES", 4)
    client, context = make_client()
    profile = create_profile("Alice04", context.character_config.model_dump())
    context.classroom_username = profile.username

    response = client.post(
        "/classroom/profile/files/upload",
        files={"file": ("large.txt", b"12345", "text/plain")},
    )

    assert response.status_code == 400


def test_snapshot_round_trip_for_profile_and_status(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, context = make_client()
    profile = create_profile("Alice05", context.character_config.model_dump())
    context.classroom_username = profile.username
    content = image_bytes("WEBP")

    uploaded = client.post(
        "/classroom/snapshot",
        files={"file": ("snapshot.webp", content, "image/webp")},
    )
    downloaded = client.get("/classroom/snapshot")
    status = client.get("/classroom/status")

    assert uploaded.status_code == 200
    assert uploaded.json()["snapshot"]["username"] == profile.username
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "image/webp"
    assert downloaded.content == content
    assert status.json()["snapshot_updated_at"] is not None


def test_snapshot_round_trip_without_profile_uses_device_storage(
    tmp_path,
    monkeypatch,
):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()
    content = image_bytes("PNG")

    uploaded = client.post(
        "/classroom/snapshot",
        files={"file": ("snapshot.png", content, "image/png")},
    )
    downloaded = client.get("/classroom/snapshot")

    assert uploaded.status_code == 200
    assert uploaded.json()["snapshot"]["username"] is None
    assert (tmp_path / "classroom_data" / "snapshot.png").read_bytes() == content
    assert downloaded.status_code == 200
    assert downloaded.content == content


def test_export_profile_by_username(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    client, _ = make_client()

    client.post("/classroom/profile/create", json={"username": "Dave06"})

    resp = client.get("/classroom/profile/Dave06/export")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert "Dave06.zip" in resp.headers["content-disposition"]
