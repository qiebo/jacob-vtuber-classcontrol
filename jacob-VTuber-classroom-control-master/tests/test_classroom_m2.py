"""M2 auth.py / workspace.py / sync_manager.py 单元测试。"""
import io
import zipfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from open_llm_vtuber.classroom import routes as classroom_routes
from open_llm_vtuber.classroom.auth import (
    _check_username_with_teacher,
    init_auth_routes,
)
from open_llm_vtuber.classroom.workspace import init_workspace_routes
from open_llm_vtuber.classroom.storage import (
    SavePointStore,
    UserRegistry,
    create_profile,
    profile_dir_for_username,
    rename_user,
)
from open_llm_vtuber.classroom.sync_manager import SyncManager


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
        for k, v in self.payload.items():
            setattr(self, k, v)

    def model_dump(self, **kwargs):
        return dict(self.payload)


class DummyContext:
    def __init__(self):
        self.character_config = DummyCharacterConfig()
        self.classroom_username = None

    async def apply_character_config(self, character_config):
        self.character_config = character_config


def make_app(context=None):
    app = FastAPI()
    context = context or DummyContext()
    app.include_router(init_auth_routes(context))
    app.include_router(init_workspace_routes(context))
    return TestClient(app), context


def sample_config():
    return {
        "conf_name": "default",
        "conf_uid": "default_uid",
        "character_name": "Jacob",
        "human_name": "Student",
        "persona_prompt": "hello",
        "avatar_mode": "live2d",
        "avatar_pack_id": "",
        "live2d_model_name": "shizuku",
    }


@pytest.fixture
def patch_character_config(monkeypatch):
    """让 routes.apply_profile_to_open_contexts 内的 CharacterConfig.model_validate
    返回 DummyCharacterConfig，避免真实 pydantic 校验失败。"""
    monkeypatch.setattr(
        classroom_routes.CharacterConfig,
        "model_validate",
        staticmethod(lambda payload: DummyCharacterConfig(payload)),
    )


@pytest.fixture
def offline_env(tmp_path, monkeypatch):
    """离线模式：无 token、无教师机。"""
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JACOB_CLASSROOM_TOKEN", raising=False)
    monkeypatch.setenv("JACOB_TEACHER_URL", "")


# ---------------------------------------------------------------------------
# auth.py
# ---------------------------------------------------------------------------


def test_check_username_with_teacher_offline_falls_back_to_local(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JACOB_TEACHER_URL", "")
    import asyncio

    available, checked_by = asyncio.run(_check_username_with_teacher("GroupA01"))
    assert available is True
    assert checked_by == "local"


def test_auth_check_username_local_dedup(offline_env):
    client, _ = make_app()
    UserRegistry().register("GroupA01")

    resp = client.post("/auth/check-username", json={"username": "GroupA01"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is False
    assert body["checked_by"] == "local"
    assert body["conflict"] == "username_exists_local"


def test_auth_check_username_available_offline(offline_env):
    client, _ = make_app()
    resp = client.post("/auth/check-username", json={"username": "FreeUser01"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["checked_by"] == "local"
    assert body.get("offline") is True


def test_auth_create_online_then_login_logout_me(offline_env, patch_character_config):
    client, context = make_app()

    # 创建用户（离线降级 → pending_sync=True）
    resp = client.post("/auth/create", json={"username": "GroupA02", "class_name": "三班"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["username"] == "GroupA02"
    assert body["pending_sync"] is True
    assert body["session_token"]
    assert body["profile"]["username"] == "GroupA02"
    assert UserRegistry().exists("GroupA02") is True
    assert UserRegistry().get("GroupA02")["pending_sync"] is True

    # me 接口
    resp = client.get("/auth/me")
    assert resp.json()["username"] == "GroupA02"
    assert resp.json()["pending_sync"] is True

    # 重复创建被拒
    resp = client.post("/auth/create", json={"username": "GroupA02"})
    assert resp.status_code == 409

    # logout（不保存）
    resp = client.post("/auth/logout", json={"save_before_exit": False})
    assert resp.status_code == 200
    assert client.get("/auth/me").json()["username"] is None

    # login 载入
    resp = client.post("/auth/login", json={"username": "GroupA02"})
    assert resp.status_code == 200
    assert resp.json()["username"] == "GroupA02"
    assert resp.json()["session_token"]

    # login 不存在的用户
    resp = client.post("/auth/login", json={"username": "Nobody99"})
    assert resp.status_code == 404
    assert resp.json()["suggest_create"] is True


def test_auth_create_rejects_invalid_username(offline_env):
    client, _ = make_app()
    for bad in ["has space", "中文名", "a" * 33, "has-dash"]:
        resp = client.post("/auth/create", json={"username": bad})
        assert resp.status_code == 422, f"{bad!r} should be rejected"


def test_auth_logout_with_save(offline_env, patch_character_config):
    client, context = make_app()
    client.post("/auth/create", json={"username": "GroupA03"})
    resp = client.post("/auth/logout", json={"save_before_exit": True})
    assert resp.status_code == 200
    assert client.get("/auth/me").json()["username"] is None


# ---------------------------------------------------------------------------
# workspace.py
# ---------------------------------------------------------------------------


def _login(client, username):
    client.post("/auth/create", json={"username": username})


def test_workspace_pack_returns_zip(offline_env, patch_character_config):
    client, _ = make_app()
    _login(client, "GroupW01")

    resp = client.post("/workspace/pack")
    assert resp.status_code == 200, resp.text
    assert "application/zip" in resp.headers["content-type"]
    assert "GroupW01.zip" in resp.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert "profile.yaml" in zf.namelist()


def test_workspace_save_points_crud(offline_env, patch_character_config):
    client, _ = make_app()
    _login(client, "GroupW02")

    assert client.get("/workspace/saves").json()["saves"] == []

    resp = client.post("/workspace/saves", json={"label": "第二课"})
    assert resp.status_code == 200, resp.text
    save_id = resp.json()["save"]["save_id"]
    assert resp.json()["save"]["label"] == "第二课"

    saves = client.get("/workspace/saves").json()["saves"]
    assert len(saves) == 1
    assert saves[0]["save_id"] == save_id

    resp = client.post(f"/workspace/saves/{save_id}/load")
    assert resp.status_code == 200, resp.text
    assert resp.json()["username"] == "GroupW02"

    resp = client.delete(f"/workspace/saves/{save_id}")
    assert resp.status_code == 200
    assert client.get("/workspace/saves").json()["saves"] == []


def test_workspace_restore_from_zip(offline_env, patch_character_config):
    client, _ = make_app()
    _login(client, "GroupW03")

    pack_resp = client.post("/workspace/pack")
    assert pack_resp.status_code == 200

    restore_resp = client.post(
        "/workspace/restore",
        files={"file": ("GroupW03.zip", pack_resp.content, "application/zip")},
    )
    assert restore_resp.status_code == 200, restore_resp.text
    assert restore_resp.json()["username"] == "GroupW03"


def test_workspace_requires_current_profile(offline_env):
    client, _ = make_app()
    resp = client.post("/workspace/pack")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# sync_manager.py
# ---------------------------------------------------------------------------


def _mock_async_client(monkeypatch, handler):
    """把 sync_manager 模块里的 httpx.AsyncClient 替换为带 MockTransport 的版本。"""
    import open_llm_vtuber.classroom.sync_manager as sm_mod
    import httpx

    real_async_client = httpx.AsyncClient

    def factory(*args, **kwargs):
        kwargs.pop("transport", None)
        return real_async_client(
            transport=httpx.MockTransport(handler), timeout=kwargs.get("timeout", 3)
        )

    monkeypatch.setattr(sm_mod.httpx, "AsyncClient", factory)


def test_sync_manager_conflict_triggers_rename(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JACOB_TEACHER_URL", "http://teacher.test:8765")
    monkeypatch.setenv("JACOB_CLASSROOM_TOKEN", "tok")
    monkeypatch.setenv("JACOB_DEVICE_ID", "pi-01")

    create_profile("ConflictUser", sample_config(), pending_sync=True)
    UserRegistry().register("ConflictUser", pending_sync=True)

    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "synced": False,
                "reason": "conflict",
                "new_name_suggested": "ConflictUserPi01",
            },
            request=request,
        )

    _mock_async_client(monkeypatch, handler)

    import asyncio
    import open_llm_vtuber.classroom.sync_manager as sm_mod

    asyncio.run(sm_mod.sync_manager._probe_and_sync_once())

    assert UserRegistry().exists("ConflictUser") is False
    assert UserRegistry().exists("ConflictUserPi01") is True
    assert profile_dir_for_username("ConflictUserPi01").is_dir()
    assert profile_dir_for_username("ConflictUser").is_dir() is False


def test_sync_manager_synced_clears_pending(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JACOB_TEACHER_URL", "http://teacher.test:8765")
    monkeypatch.setenv("JACOB_CLASSROOM_TOKEN", "tok")
    monkeypatch.setenv("JACOB_DEVICE_ID", "pi-01")

    create_profile("SyncUser", sample_config(), pending_sync=True)
    UserRegistry().register("SyncUser", pending_sync=True)

    import httpx

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"synced": True}, request=request)

    _mock_async_client(monkeypatch, handler)

    import asyncio
    import open_llm_vtuber.classroom.sync_manager as sm_mod

    asyncio.run(sm_mod.sync_manager._probe_and_sync_once())

    assert UserRegistry().get("SyncUser")["pending_sync"] is False
    assert UserRegistry().list_pending() == []


def test_sync_manager_skips_when_no_pending(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JACOB_TEACHER_URL", "http://teacher.test:8765")
    monkeypatch.setenv("JACOB_CLASSROOM_TOKEN", "tok")

    called = {"n": 0}

    import httpx

    def handler(request):
        called["n"] += 1
        return httpx.Response(200, json={"synced": True}, request=request)

    _mock_async_client(monkeypatch, handler)

    import asyncio
    import open_llm_vtuber.classroom.sync_manager as sm_mod

    asyncio.run(sm_mod.sync_manager._probe_and_sync_once())
    assert called["n"] == 0  # 无 pending 用户，不应请求教师机
