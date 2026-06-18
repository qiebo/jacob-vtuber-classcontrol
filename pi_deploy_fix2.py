"""部署修复2：autostart（wayvnc延迟启动）+ 前端 dist（登录加载人物形象）。"""
import os
import paramiko

HOST = "192.168.100.133"
USER = "yb"
PASSWORD = "1"

LOCAL_AUTOSTART = r"E:\Debian_canvas\vtuber-classcontrol\pi_labwc_autostart.sh"
REMOTE_AUTOSTART = "/home/yb/.config/labwc/autostart"
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


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    sftp = c.open_sftp()

    print("=== 1. 上传修复后的 autostart（wayvnc 延迟启动）===")
    sftp.put(LOCAL_AUTOSTART, REMOTE_AUTOSTART)
    print("  autostart uploaded")

    print("=== 2. 上传前端 dist（登录加载人物形象）===")
    _, stdout, _ = c.exec_command(
        f"rm -rf {REMOTE_FRONTEND_DIST} && mkdir -p {REMOTE_FRONTEND_DIST}",
        timeout=30,
    )
    stdout.channel.recv_exit_status()
    upload_dir(sftp, LOCAL_FRONTEND_DIST, REMOTE_FRONTEND_DIST)
    print("  dist/web uploaded")

    sftp.close()

    # chmod autostart + 清 pycache
    _, stdout, _ = c.exec_command(
        "chmod +x ~/.config/labwc/autostart && "
        "rm -rf ~/Open-LLM-VTuber/src/open_llm_vtuber/classroom/__pycache__ && "
        "echo DONE",
        timeout=15,
    )
    print(stdout.read().decode())
    c.close()
    print("DEPLOY DONE")


if __name__ == "__main__":
    main()
