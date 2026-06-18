"""M1 冒烟测试辅助：SSH/SCP 到树莓派 (192.168.100.133) 的工具函数。

用法：python pi_ssh.py "<command>"
"""
import sys
import paramiko

HOST = "192.168.100.133"
USER = "yb"
PASSWORD = "1"


def connect():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
    return c


def run(c, cmd, timeout=60):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "echo ok"
    c = connect()
    rc, out, err = run(c, cmd)
    print(f"[rc={rc}]")
    if out:
        print(out, end="")
    if err:
        print("--- stderr ---", end="")
        print(err, end="")
    c.close()
