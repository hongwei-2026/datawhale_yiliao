import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(
    "connect.westd.seetacloud.com",
    port=32798,
    username="root",
    password=os.environ["CLOUD_SSH_PASSWORD"],
    timeout=30,
)
cmds = [
    "env | sort",
    "hostname",
    "cat /etc/hosts",
    "ls /init",
    "curl -s -m 5 -I http://127.0.0.1:6006/ 2>&1 | head -5",
    "curl -s -m 5 -I http://127.0.0.1:6008/ 2>&1 | head -5",
]
for c in cmds:
    print("===", c, "===")
    _, stdout, _ = ssh.exec_command(c)
    print(stdout.read().decode("utf-8", errors="replace")[:8000])
ssh.close()
