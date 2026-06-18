"""M1 部署：把改造后的源码 SFTP 上传到树莓派。"""
import paramiko

HOST = "192.168.100.133"
USER = "yb"
PASSWORD = "1"

LOCAL_ROOT = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\src\open_llm_vtuber"
REMOTE_ROOT = "/home/yb/Open-LLM-VTuber/src/open_llm_vtuber"

UPLOADS = [
    (rf"{LOCAL_ROOT}\classroom\models.py", f"{REMOTE_ROOT}/classroom/models.py"),
    (rf"{LOCAL_ROOT}\classroom\storage.py", f"{REMOTE_ROOT}/classroom/storage.py"),
    (rf"{LOCAL_ROOT}\classroom\routes.py", f"{REMOTE_ROOT}/classroom/routes.py"),
    (rf"{LOCAL_ROOT}\service_context.py", f"{REMOTE_ROOT}/service_context.py"),
    (rf"{LOCAL_ROOT}\websocket_handler.py", f"{REMOTE_ROOT}/websocket_handler.py"),
]


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    sftp = c.open_sftp()
    for local, remote in UPLOADS:
        sftp.put(local, remote)
        print(f"uploaded {local} -> {remote}")
    sftp.close()

    # 清理 __pycache__ 避免旧 .pyc 干扰
    for cmd in [
        "rm -rf ~/Open-LLM-VTuber/src/open_llm_vtuber/classroom/__pycache__",
        "rm -rf ~/Open-LLM-VTuber/src/open_llm_vtuber/__pycache__",
    ]:
        _, stdout, stderr = c.exec_command(cmd, timeout=30)
        print(stdout.read().decode("utf-8", "replace"), end="")
        e = stderr.read().decode("utf-8", "replace")
        if e:
            print("ERR:", e, end="")
    c.close()
    print("DEPLOY DONE")


if __name__ == "__main__":
    main()
