#!/bin/bash
# Concord: start GPU services in the background on container start (see /workspace/pod-autostart.sh).
nohup bash /workspace/pod-autostart.sh >/dev/null 2>&1 &
exit 0
