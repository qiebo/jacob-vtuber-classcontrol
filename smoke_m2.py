"""M2 端到端冒烟：auth + workspace 完整链路（树莓派实跑）。"""
import io
import zipfile

import httpx

BASE = "http://192.168.100.133:12393"
TOKEN = "classroom-test-2026"
HEADERS = {"X-Classroom-Token": TOKEN}


def main():
    failures = []

    def check(cond, msg):
        s = "OK " if cond else "FAIL"
        print(f"  [{s}] {msg}")
        if not cond:
            failures.append(msg)

    with httpx.Client(timeout=30, headers=HEADERS, base_url=BASE) as c:
        print("=== 1. 初始 /auth/me 未登录 ===")
        r = c.get("/auth/me")
        check(r.status_code == 200, f"me 返回 200 (实际 {r.status_code})")
        check(r.json().get("username") is None, "初始未登录 username=null")

        print("=== 2. check-username 可用（离线）===")
        r = c.post("/auth/check-username", json={"username": "M2Tester01"})
        check(r.status_code == 200, f"check-username 200 (实际 {r.status_code})")
        check(r.json().get("available") is True, "M2Tester01 可用")
        check(r.json().get("offline") is True, "离线模式标记")

        print("=== 3. create 用户（离线 pending_sync=True）===")
        r = c.post("/auth/create", json={"username": "M2Tester01", "class_name": "M2班"})
        check(r.status_code == 200, f"create 200 (实际 {r.status_code} {r.text[:100]})")
        body = r.json()
        check(body.get("username") == "M2Tester01", "create 返回 username")
        check(body.get("pending_sync") is True, "离线创建 pending_sync=True")
        check(body.get("session_token"), "返回 session_token")

        print("=== 4. /auth/me 已登录 ===")
        r = c.get("/auth/me")
        check(r.json().get("username") == "M2Tester01", "me 显示已登录")
        check(r.json().get("pending_sync") is True, "me pending_sync=True")

        print("=== 5. workspace pack ===")
        r = c.post("/workspace/pack")
        check(r.status_code == 200, f"pack 200 (实际 {r.status_code})")
        check("M2Tester01.zip" in r.headers.get("content-disposition", ""), "pack 文件名含 username")
        pack_bytes = r.content

        print("=== 6. workspace 存档点 CRUD ===")
        r = c.post("/workspace/saves", json={"label": "M2存档"})
        check(r.status_code == 200, f"create save 200 (实际 {r.status_code})")
        save_id = r.json()["save"]["save_id"]
        check(r.json()["save"]["label"] == "M2存档", "存档 label 正确")

        r = c.get("/workspace/saves")
        check(len(r.json()["saves"]) == 1, "存档列表 1 条")

        r = c.post(f"/workspace/saves/{save_id}/load")
        check(r.status_code == 200, f"load save 200 (实际 {r.status_code})")
        check(r.json().get("username") == "M2Tester01", "load save 返回 username")

        r = c.delete(f"/workspace/saves/{save_id}")
        check(r.status_code == 200, "delete save 200")
        check(c.get("/workspace/saves").json()["saves"] == [], "存档删除后为空")

        print("=== 7. workspace restore（从 pack ZIP 恢复）===")
        r = c.post("/workspace/restore", files={"file": ("M2Tester01.zip", pack_bytes, "application/zip")})
        check(r.status_code == 200, f"restore 200 (实际 {r.status_code} {r.text[:100]})")
        check(r.json().get("username") == "M2Tester01", "restore 返回 username")

        print("=== 8. logout（不保存）后未登录 ===")
        r = c.post("/auth/logout", json={"save_before_exit": False})
        check(r.status_code == 200, "logout 200")
        check(c.get("/auth/me").json().get("username") is None, "logout 后未登录")

        print("=== 9. login 载入已存在用户 ===")
        r = c.post("/auth/login", json={"username": "M2Tester01"})
        check(r.status_code == 200, f"login 200 (实际 {r.status_code})")
        check(r.json().get("username") == "M2Tester01", "login 返回 username")

        print("=== 10. login 不存在用户提示创建 ===")
        r = c.post("/auth/login", json={"username": "NobodyX"})
        check(r.status_code == 404, f"login 不存在 404 (实际 {r.status_code})")
        check(r.json().get("suggest_create") is True, "提示创建")

        print("=== 11. 非法 username 被拒 ===")
        r = c.post("/auth/create", json={"username": "bad name"})
        check(r.status_code == 422, f"非法 username 422 (实际 {r.status_code})")

    print()
    if failures:
        print(f"!!! M2 冒烟有 {len(failures)} 项失败:")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print(">>> M2 端到端冒烟全部通过 <<<")


if __name__ == "__main__":
    main()
