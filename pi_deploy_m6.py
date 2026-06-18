"""M6 部署：上传更新后的 auth.py + 前端 dist 到树莓派。"""
import os
import paramiko

HOST = "192.168.100.133"
USER = "yb"
PASSWORD = "1"

LOCAL_SRC = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\src\open_llm_vtuber"
REMOTE_SRC = "/home/yb/Open-LLM-VTuber/src/open_llm_vtuber"
LOCAL_FRONTEND_DIST = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\frontend-source\dist\web"
REMOTE_FRONTEND_DIST = "/home/yb/Open-LLM-VTuber/frontend-source/dist/web"


def upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        sftp.mkdir(remote_dir)
    for name in os.listdir(local_dir):
        local_path = os.path.join(local_dir, name)
        remote_path = f"{remote_dir}/{name}"
        if os.path.isdir(local_path):
            upload_dir(sftp, local_path, remote_path)
        else:
            sftp.put(local_path, remote_path)
    print(f"  dir: {local_dir} -> {remote_dir}")


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    sftp = c.open_sftp()

    print("=== 上传更新后的 auth.py ===")
    sftp.put(rf"{LOCAL_SRC}\classroom\auth.py", f"{REMOTE_SRC}/classroom/auth.py")
    print("  auth.py uploaded")

    print("=== 上传前端 dist/web ===")
    _, stdout, _ = c.exec_command(
        f"rm -rf {REMOTE_FRONTEND_DIST} && mkdir -p {REMOTE_FRONTEND_DIST}",
        timeout=30,
    )
    stdout.channel.recv_exit_status()
    upload_dir(sftp, LOCAL_FRONTEND_DIST, REMOTE_FRONTEND_DIST)

    sftp.close()
    # 清理 pycache
    _, stdout, _ = c.exec_command(
        "rm -rf ~/Open-LLM-VTuber/src/open_llm_vtuber/classroom/__pycache__",
        timeout=30,
    )
    stdout.channel.recv_exit_status()
    c.close()
    print("M6 DEPLOY DONE")


if __name__ == "__main__":
    main()
