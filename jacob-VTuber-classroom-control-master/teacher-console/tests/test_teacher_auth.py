"""M3 教师端登录鉴权单元测试（PRD T-2）。"""
import pytest
from fastapi.testclient import TestClient

from teacher_console.app import create_app
from teacher_console.auth import AuthStore


def test_default_credentials_login(tmp_path):
    app = create_app(tmp_path, enable_auth=True, enable_scan=False)
    with TestClient(app) as client:
        # 未登录访问受保护接口 → 401
        assert client.get("/api/devices").status_code == 401

        # 默认账号登录
        r = client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "123456"},
        )
        assert r.status_code == 200
        token = r.json()["token"]
        assert token

        # 带 token 访问
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/devices", headers=headers).status_code == 200
        assert client.get("/api/auth/me", headers=headers).status_code == 200
        assert client.get("/api/auth/me", headers=headers).json()["username"] == "ybszr"

        # 错误密码
        r = client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "wrong"},
        )
        assert r.status_code == 401

        # 错误用户名
        r = client.post(
            "/api/auth/login",
            json={"username": "nobody", "password": "123456"},
        )
        assert r.status_code == 401


def test_public_paths_not_blocked(tmp_path):
    app = create_app(tmp_path, enable_auth=True, enable_scan=False)
    with TestClient(app) as client:
        # 首页、static、login 不应被鉴权拦截
        assert client.get("/").status_code == 200
        assert client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "123456"},
        ).status_code == 200


def test_logout_invalidates_token(tmp_path):
    app = create_app(tmp_path, enable_auth=True, enable_scan=False)
    with TestClient(app) as client:
        token = client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "123456"},
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/devices", headers=headers).status_code == 200

        client.post("/api/auth/logout", headers=headers)

        # logout 后 token 失效
        assert client.get("/api/devices", headers=headers).status_code == 401


def test_change_password(tmp_path):
    app = create_app(tmp_path, enable_auth=True, enable_scan=False)
    with TestClient(app) as client:
        token = client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "123456"},
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 改密
        r = client.post(
            "/api/auth/password",
            headers=headers,
            json={"old_password": "123456", "new_password": "newpass789"},
        )
        assert r.status_code == 200

        # 旧 token 失效（改密清所有 token）
        assert client.get("/api/devices", headers=headers).status_code == 401

        # 旧密码登录失败
        assert client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "123456"},
        ).status_code == 401

        # 新密码登录成功
        assert client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "newpass789"},
        ).status_code == 200

        # 原密码错误时改密失败
        token2 = client.post(
            "/api/auth/login",
            json={"username": "ybszr", "password": "newpass789"},
        ).json()["token"]
        r = client.post(
            "/api/auth/password",
            headers={"Authorization": f"Bearer {token2}"},
            json={"old_password": "wrongold", "new_password": "x"},
        )
        assert r.status_code == 400


def test_auth_store_persists_password(tmp_path):
    """密码修改持久化到 config.json，新实例仍用新密码。"""
    store1 = AuthStore(tmp_path)
    assert store1.change_password("123456", "persisted1") is True

    store2 = AuthStore(tmp_path)
    assert store2.verify("ybszr", "persisted1") is True
    assert store2.verify("ybszr", "123456") is False
