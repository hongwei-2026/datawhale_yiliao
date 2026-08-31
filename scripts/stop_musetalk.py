import os
import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect("connect.westb.seetacloud.com", 16655, "root", os.environ["CLOUD_SSH_PASSWORD"], timeout=60)

fix = r"""
cd /root/autodl-tmp/aisp-datawhale
if grep -q '^MUSETALK_ENABLED=' .env; then
  sed -i 's/^MUSETALK_ENABLED=.*/MUSETALK_ENABLED=false/' .env
else
  echo 'MUSETALK_ENABLED=false' >> .env
fi
grep MUSETALK .env
./stop.sh 2>/dev/null
./start.sh
sleep 2
curl -s http://127.0.0.1:6008/api/voice/status
"""
_, o, _ = ssh.exec_command(fix)
print(o.read().decode())
ssh.close()
