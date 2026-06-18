"""上传 config_templates/conf.classroom.yaml + deploy/setup_pi.sh 到树莓派。"""
import paramiko

HOST = "192.168.100.133"
USER = "yb"
PASSWORD = "1"

LOCAL_TEMPLATE = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\config_templates\conf.classroom.yaml"
REMOTE_TEMPLATE = "/home/yb/Open-LLM-VTuber/config_templates/conf.classroom.yaml"
LOCAL_SETUP = r"E:\Debian_canvas\vtuber-classcontrol\jacob-VTuber-classroom-control-master\deploy\setup_pi.sh"
REMOTE_SETUP = "/home/yb/Open-LLM-VTuber/deploy/setup_pi.sh"

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
sftp = c.open_sftp()

# 上传模板
sftp.put(LOCAL_TEMPLATE, REMOTE_TEMPLATE)
print(f"模板已上传: {REMOTE_TEMPLATE}")

# 建 deploy 目录（如不存在）
try:
    sftp.stat("/home/yb/Open-LLM-VTuber/deploy")
except FileNotFoundError:
    sftp.mkdir("/home/yb/Open-LLM-VTuber/deploy")
    print("已创建 deploy/ 目录")

# 上传 setup 脚本
sftp.put(LOCAL_SETUP, REMOTE_SETUP)
print(f"脚本已上传: {REMOTE_SETUP}")
sftp.close()

# chmod + 验证
_, so, _ = c.exec_command(
    "chmod +x ~/Open-LLM-VTuber/deploy/setup_pi.sh && "
    "ls -la ~/Open-LLM-VTuber/config_templates/conf.classroom.yaml "
    "~/Open-LLM-VTuber/deploy/setup_pi.sh",
    timeout=15,
)
print(so.read().decode())
c.close()
print("DONE")
