"""M1 教师端冒烟：用教师端 StudentClient 真实连树莓派验证 collect_profile。

模拟 app.py 的 collect 逻辑：get_status → 读 current_username → collect_profile。
验证：URL 用 username 拼接成功、ZIP 落地、文件名含 username。
"""
import asyncio
import sys
from pathlib import Path

TEACHER_CONSOLE = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\teacher-console"
sys.path.insert(0, TEACHER_CONSOLE)

from teacher_console.student_client import StudentClient
from teacher_console.storage import Device

PI_URL = "http://192.168.100.133:12393"
TOKEN = "classroom-test-2026"
DEVICE_ID = "pi-01"
OUT_DIR = Path(r"E:\Debian_canvas\vtuber-classcontrol\m1_collect_out")


async def main():
    failures = []

    def check(cond, msg):
        status = "OK " if cond else "FAIL"
        print(f"  [{status}] {msg}")
        if not cond:
            failures.append(msg)

    device = Device(
        id=DEVICE_ID, name="树莓派5-测试机", base_url=PI_URL,
        group="", enabled=True, token=TOKEN,
        last_seen=None, status_cache=None, latency_ms=None, last_error=None,
    )
    client = StudentClient(connect_timeout=5, read_timeout=30)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    try:
        print("=== 1. get_status 读 current_username ===")
        status = await client.get_status(device)
        uname = status.get("current_username")
        print(f"  current_username = {uname!r}")
        check(uname is not None, f"current_username 非空 (实际 {uname!r})")
        check("current_profile_id" not in status, "status 不含 current_profile_id")

        print("=== 2. collect_profile 按 username 收取 ===")
        path = await client.collect_profile(device, str(uname), OUT_DIR)
        print(f"  落地文件: {path}")
        check(path.exists(), "ZIP 文件已落地")
        check(path.name.endswith(".zip"), f"文件名以 .zip 结尾 (实际 {path.name})")
        check(str(uname) in path.name, f"文件名含 username (实际 {path.name})")
        check(path.stat().st_size > 0, "ZIP 文件非空")

        # 校验 ZIP 内容
        import zipfile, json
        with zipfile.ZipFile(path) as zf:
            mf = json.loads(zf.read("manifest.json"))
            check(mf.get("username") == uname, f"ZIP manifest.username == {uname}")
            check("profile_id" not in mf, "ZIP manifest 不含 profile_id")

        print(f"\n>>> 教师端收取成功，作品保存到: {path}")
    finally:
        await client.close()

    print()
    if failures:
        print(f"!!! 教师端冒烟有 {len(failures)} 项失败:")
        for f in failures:
            print(f"   - {f}")
        raise SystemExit(1)
    print(">>> 教师端冒烟测试全部通过 <<<")


if __name__ == "__main__":
    asyncio.run(main())
