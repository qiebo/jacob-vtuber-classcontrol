"""M4 教师端班级管理 + 用户管理 + 扫描单元测试（PRD T-3/T-4）。"""
import httpx
import pytest
from fastapi.testclient import TestClient

from teacher_console.app import create_app
from teacher_console.class_store import ClassStore
from teacher_console.student_client import StudentClient
from teacher_console.user_store import UserStore


@pytest.fixture
def app_client(tmp_path):
    # 用 mock transport 的 StudentClient，避免真实 httpx 连接池在 TestClient 退出时卡住
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"online": False}, request=request)

    student_client = StudentClient(transport=httpx.MockTransport(handler))
    app = create_app(tmp_path, student_client, enable_auth=False, enable_scan=False)
    with TestClient(app) as client:
        yield client, app


# --- ClassStore ---


def test_class_store_crud(tmp_path):
    cs = ClassStore(tmp_path)
    assert cs.list_classes() == []

    cls = cs.create("三班")
    assert cls["name"] == "三班"
    assert cls["class_id"].startswith("cls_")
    assert cs.list_classes() == [cls]

    # 重名拒绝
    with pytest.raises(ValueError):
        cs.create("三班")

    # rename
    renamed = cs.rename(cls["class_id"], "四班")
    assert renamed["name"] == "四班"

    # delete
    assert cs.delete(cls["class_id"]) is True
    assert cs.list_classes() == []
    assert cs.delete("cls_nonexistent") is False


def test_class_name_validation(tmp_path):
    cs = ClassStore(tmp_path)
    with pytest.raises(ValueError):
        cs.create("")
    with pytest.raises(ValueError):
        cs.create("x" * 33)


# --- UserStore ---


def test_user_store_register_and_check(tmp_path):
    us = UserStore(tmp_path)
    assert us.check_available("GroupA01") is True
    entry, created = us.register("GroupA01", device_hint="pi-01")
    assert created is True
    assert entry["username"] == "GroupA01"
    assert entry["device_hint"] == "pi-01"

    # 重复注册不报错，created=False
    entry2, created2 = us.register("GroupA01", device_hint="pi-01")
    assert created2 is False
    assert us.check_available("GroupA01") is False


def test_user_store_check_rejects_invalid(tmp_path):
    us = UserStore(tmp_path)
    with pytest.raises(ValueError):
        us.check_available("has space")
    with pytest.raises(ValueError):
        us.check_available("中文")
    with pytest.raises(ValueError):
        us.check_available("a" * 33)


def test_user_store_sync_no_conflict(tmp_path):
    us = UserStore(tmp_path)
    result = us.sync_from_device("SyncUser01", "pi-02")
    assert result == {"synced": True}
    assert us.exists("SyncUser01") is True
    assert us.get("SyncUser01")["device_hint"] == "pi-02"


def test_user_store_sync_conflict_different_device(tmp_path):
    us = UserStore(tmp_path)
    us.register("ConflictU", device_hint="pi-01")
    result = us.sync_from_device("ConflictU", "pi-02")
    assert result["synced"] is False
    assert result["reason"] == "conflict"
    assert result["new_name_suggested"]
    # 建议名应合法
    assert result["new_name_suggested"].replace("ConflictU", "")


def test_user_store_sync_same_device_ok(tmp_path):
    us = UserStore(tmp_path)
    us.register("SameDev", device_hint="pi-01")
    result = us.sync_from_device("SameDev", "pi-01")
    assert result == {"synced": True}


def test_user_store_update_class(tmp_path):
    us = UserStore(tmp_path)
    cs = ClassStore(tmp_path)
    us.register("Student01")
    cls = cs.create("一班")
    updated = us.update_class("Student01", cls["class_id"])
    assert updated["class_id"] == cls["class_id"]
    # 移出班级
    updated = us.update_class("Student01", None)
    assert updated["class_id"] is None


def test_user_store_persists(tmp_path):
    us = UserStore(tmp_path)
    us.register("Persist01", device_hint="pi-09")
    us2 = UserStore(tmp_path)
    assert us2.exists("Persist01") is True
    assert us2.get("Persist01")["device_hint"] == "pi-09"


# --- API 集成 ---


def test_api_classes_crud(app_client):
    client, _ = app_client
    assert client.get("/api/classes").json() == {"classes": []}

    r = client.post("/api/classes", json={"name": "三班"})
    assert r.status_code == 200
    cls = r.json()["class"]
    assert cls["name"] == "三班"
    class_id = cls["class_id"]

    assert len(client.get("/api/classes").json()["classes"]) == 1

    r = client.patch(f"/api/classes/{class_id}", json={"name": "四班"})
    assert r.status_code == 200
    assert r.json()["class"]["name"] == "四班"

    r = client.delete(f"/api/classes/{class_id}")
    assert r.status_code == 200
    assert client.get("/api/classes").json()["classes"] == []


def test_api_classes_delete_unassigns_users(app_client):
    """删除班级时学生回未分班。"""
    client, app = app_client
    user_store = app.state.user_store
    cls = client.post("/api/classes", json={"name": "一班"}).json()["class"]
    user_store.register("StuA")
    user_store.update_class("StuA", cls["class_id"])
    assert user_store.get("StuA")["class_id"] == cls["class_id"]

    client.delete(f"/api/classes/{cls['class_id']}")
    assert user_store.get("StuA")["class_id"] is None


def test_api_users_list_with_class_name(app_client):
    client, app = app_client
    user_store = app.state.user_store
    class_store = app.state.class_store
    cls = class_store.create("一班")
    user_store.register("ListUser01")
    user_store.update_class("ListUser01", cls["class_id"])

    users = client.get("/api/users").json()["users"]
    u = next(x for x in users if x["username"] == "ListUser01")
    assert u["class_id"] == cls["class_id"]
    assert u["class_name"] == "一班"


def test_api_users_patch_class(app_client):
    client, app = app_client
    user_store = app.state.user_store
    class_store = app.state.class_store
    user_store.register("PatchUser01")
    cls = class_store.create("二班")

    r = client.patch("/api/users/PatchUser01", json={"class_id": cls["class_id"]})
    assert r.status_code == 200
    assert r.json()["user"]["class_id"] == cls["class_id"]

    # 归到不存在的班级
    r = client.patch("/api/users/PatchUser01", json={"class_id": "cls_nope"})
    assert r.status_code == 404


def test_api_users_check(app_client):
    client, _ = app_client
    r = client.post("/api/users/check", json={"username": "CheckUser01"})
    assert r.status_code == 200
    assert r.json()["available"] is True

    # 非法格式
    r = client.post("/api/users/check", json={"username": "bad name"})
    assert r.status_code == 400


def test_api_users_sync(app_client):
    client, _ = app_client
    r = client.post(
        "/api/users/sync",
        json={"username": "SyncApi01", "device_id": "pi-05"},
    )
    assert r.status_code == 200
    assert r.json()["synced"] is True


def test_api_scan_now_and_status(app_client):
    client, _ = app_client
    # 无设备时扫描应正常返回
    r = client.post("/api/scan/now")
    assert r.status_code == 200
    assert r.json()["total"] == 0
    assert r.json()["online"] == 0

    r = client.get("/api/scan/status")
    assert r.status_code == 200
    assert "last_scan_at" in r.json()
