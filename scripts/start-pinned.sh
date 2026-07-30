#!/bin/bash
# DEPRECATED — do not use. This script assumed a 4-core box and a single
# Ollama instance on 11434 — neither matches the real 5-instance topology
# (scripts/runpod-cognition.sh) or the cgroup-aware pinning
# (scripts/pin-processes.sh, called by startup.sh).
echo "DEPRECATED: use ./startup.sh — it launches the 5 brains (runpod-cognition.sh) and applies CPU pinning (pin-processes.sh)." >&2
exit 1
