#!/bin/bash
# Start concord_gen_server.py on 127.0.0.1:7861 (background, log in /root).
source /root/gen/venv/bin/activate
export HF_HOME=/root/gen/hf-cache HF_HUB_OFFLINE=1   # every weight is local; never reach the Hub at serve time
pkill -f concord_gen_server.py 2>/dev/null; sleep 1
nohup python /workspace/concord_gen_server.py > /root/gen_server.log 2>&1 &
sleep 3; curl -s 127.0.0.1:7870/health; echo; tail -3 /root/gen_server.log
