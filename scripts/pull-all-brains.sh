#!/bin/bash
# DEPRECATED — do not use. Kept only so old runbooks fail loudly instead of
# silently doing the wrong thing.
#
# Why retired (audit 2026-07-27):
#   - It pulled llava:7b — the exact CC-BY-NC-lineage vision model this
#     project deliberately swapped to qwen2.5vl:7b for LICENSING reasons
#     (see docs/LICENSING.md + ecosystem.config.cjs BRAIN_VISION_MODEL).
#     Running it reintroduced commercial licensing exposure.
#   - It pulled qwen2.5:1.5b for repair (the deploy uses 0.5b) and the raw
#     14B base instead of building concord-conscious:latest.
#   - It had no port map, so everything landed on the conscious instance.
#
# The real model provisioning path is scripts/runpod-cognition.sh, which
# builds/pulls each role's model into its own instance and is invoked by
# ./startup.sh automatically.
echo "DEPRECATED: pull-all-brains.sh pulled wrong (and license-encumbered) models." >&2
echo "Models are provisioned by scripts/runpod-cognition.sh — run ./startup.sh instead." >&2
exit 1
