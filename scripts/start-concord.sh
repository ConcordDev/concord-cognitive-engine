#!/bin/bash
# DEPRECATED — do not use. This script hardcoded a /workspace node path and
# called /workspace/start-ollama.sh, /workspace/start-frontend.sh, and
# /workspace/start-tunnel.sh — none of which exist in this repo — so it
# silently half-started at best. The canonical entry points are:
#   ./bootstrap.sh              (first-time provisioning on a fresh box)
#   ./startup.sh --cloudflare   (every boot; or --runpod without a tunnel)
echo "DEPRECATED: use ./startup.sh --runpod (or --cloudflare). See startup.sh header." >&2
exit 1
