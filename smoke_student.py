"""M1 端到端冒烟测试：学生端 API 全链路。

对树莓派 192.168.100.133:12393 的 /classroom/* 接口发请求，
验证 username 主键链路：创建→状态→保存→导出ZIP→ZIP内容校验。
"""
import io
import json
import zipfile

import httpx

BASE = "http://192.168.100.133:12393"
TOKEN = "classroom-test-2026"
HEADERS = {"X-Classroom-Token": TOKEN}
USERNAME = "GroupA01"
CLASS_NAME = "三班"


def main():
    failures = []

    def check(cond, msg):
        status = "OK " if cond else "FAIL"
        print(f"  [{status}] {msg}")
        if not cond:
            failures.append(msg)

    with httpx.Client(timeout=30, headers=HEADERS, base_url=BASE) as client:
        print("=== 1. 创建用户 GroupA01 ===")
        r = client.post("/classroom/profile/create",
                        json={"username": USERNAME, "class_name": CLASS_NAME})
        print(f"  status={r.status_code}")
        check(r.status_code == 200, f"create 返回 200 (实际 {r.status_code})")
        profile = r.json().get("profile", {})
        check(profile.get("username") == USERNAME, f"profile.username == {USERNAME}")
        check(profile.get("class_name") == CLASS_NAME, f"profile.class_name == {CLASS_NAME}")
        check(profile.get("schema_version") == 2, "schema_version == 2")
        check("profile_id" not in profile, "profile 不再含 profile_id 字段")
        check(profile.get("character_config", {}).get("conf_uid") == USERNAME,
              "conf_uid 绑定为 username")

        print("=== 2. 状态接口返回 current_username ===")
        r = client.get("/classroom/status")
        st = r.json()
        check(st.get("current_username") == USERNAME,
              f"status.current_username == {USERNAME} (实际 {st.get('current_username')!r})")
        check("current_profile_id" not in st, "status 不再含 current_profile_id")

        print("=== 3. 保存档案 ===")
        r = client.post("/classroom/profile/save",
                        json={"workspace_state": {"lesson": "L1"}})
        print(f"  status={r.status_code}")
        check(r.status_code == 200, f"save 返回 200 (实际 {r.status_code})")
        check(r.json().get("profile", {}).get("username") == USERNAME,
              "save 返回 profile.username")

        print("=== 4. 按 username 导出 ZIP ===")
        r = client.get(f"/classroom/profile/{USERNAME}/export")
        print(f"  status={r.status_code} content-type={r.headers.get('content-type')}")
        check(r.status_code == 200, f"export 返回 200 (实际 {r.status_code})")
        check("application/zip" in r.headers.get("content-type", ""),
              "export content-type 含 zip")
        cd = r.headers.get("content-disposition", "")
        check(f"{USERNAME}.zip" in cd, f"export 文件名含 {USERNAME}.zip (实际 {cd!r})")

        print("=== 5. 校验 ZIP 内容 ===")
        buf = io.BytesIO(r.content)
        with zipfile.ZipFile(buf) as zf:
            names = set(zf.namelist())
            print(f"  zip 内文件: {sorted(names)}")
            check("profile.yaml" in names, "zip 含 profile.yaml")
            check("manifest.json" in names, "zip 含 manifest.json")
            py = yaml_load(zf.read("profile.yaml"))
            check(py.get("username") == USERNAME, f"profile.yaml.username == {USERNAME}")
            check(py.get("class_name") == CLASS_NAME, f"profile.yaml.class_name == {CLASS_NAME}")
            check(py.get("schema_version") == 2, "profile.yaml.schema_version == 2")
            check("profile_id" not in py, "profile.yaml 不含 profile_id")
            check("class_slug" not in py, "profile.yaml 不含 class_slug")
            check("student_slug" not in py, "profile.yaml 不含 student_slug")
            check(py.get("pending_sync") is False, "profile.yaml.pending_sync == False")
            mf = json.loads(zf.read("manifest.json"))
            check(mf.get("username") == USERNAME, f"manifest.username == {USERNAME}")
            check("profile_id" not in mf, "manifest 不含 profile_id")

        print("=== 6. 按 username 加载档案 ===")
        r = client.post("/classroom/profile/load", json={"username": USERNAME})
        print(f"  status={r.status_code}")
        check(r.status_code == 200, f"load 返回 200 (实际 {r.status_code})")
        check(r.json().get("profile", {}).get("username") == USERNAME,
              "load 返回 profile.username")

        print("=== 7. 非法 username 被拒 ===")
        r = client.post("/classroom/profile/create", json={"username": "bad name"})
        check(r.status_code == 422, f"非法 username 返回 422 (实际 {r.status_code})")

    print()
    if failures:
        print(f"!!! 冒烟测试有 {len(failures)} 项失败:")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print(">>> 学生端冒烟测试全部通过 <<<")


def yaml_load(data):
    import yaml
    return yaml.safe_load(data)


if __name__ == "__main__":
    main()
