#!/bin/bash
# DEPRECATED — do not use. This script warmed ALL FIVE models against a single
# OLLAMA_URL (default :11434 — the conscious instance), with model names that
# don't match this deploy (qwen2.5:14b-q4_K_M vs concord-conscious:latest,
# qwen2.5:7b vs 7b-instruct-q4_K_M, 1.5b vs 0.5b). With
# OLLAMA_MAX_LOADED_MODELS=1 on that instance, each "warm" simply evicted the
# previous model — the last state was five cold brains and one wrong model
# resident on the conscious port.
#
# Model residency is now handled by scripts/runpod-cognition.sh:
# per-instance OLLAMA_KEEP_ALIVE (default 30m, per-role overridable) keeps
# each brain's model hot on its own port; the first real request warms it.
echo "DEPRECATED: model warmup is handled by scripts/runpod-cognition.sh (per-instance keep-alive). Run ./startup.sh." >&2
exit 1
