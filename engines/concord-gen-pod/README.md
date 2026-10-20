# concord-gen-pod

Concord's organic-asset generation service for a rented GPU pod (built and
tested on a RunPod A40, 46 GB). It turns a concept prompt into an image
(FLUX.1-schnell) and an image into a textured GLB (TRELLIS.2-4B). Concord
calls it through `server/lib/asset-gen/organic/providers.js` (`local-gpu`
provider) over an SSH tunnel; everything after the raw GLB — WebP/alpha
normalization, budget LOD0, LOD bands, registry, Unity drop — is Concord's own
pipeline (`server/lib/asset-gen/organic/generate-organic.js`).

Why a pod and not Hugging Face ZeroGPU: TRELLIS.2 reserves 120 GPU-seconds per
call, so the free tier covers ~2 meshes/day. The pod has no daily cap; you pay
per second while it runs (A40 ≈ $0.44/h on RunPod, 2026-09).

## Layout on the pod

| Path | What | Survives pod restart? |
|---|---|---|
| `/root/gen/venv` | Python venv (system torch 2.8 / CUDA 12.8) | no — rerun `pod_install.sh` |
| `/root/gen/TRELLIS.2`, `/root/gen/ext/*` | TRELLIS.2 + compiled CUDA extensions (sm_86) | no |
| `/workspace/models/<org>/<repo>` | model weights as plain files | **yes** |

`/workspace` on RunPod is `geesefs` (S3-backed FUSE): it rejects `chmod`, so
git clones and venvs fail there, and it has no symlinks, so weights are stored
as plain files rather than a Hugging Face cache.

## Models and licenses

| Model | Role | License | Gate |
|---|---|---|---|
| `microsoft/TRELLIS.2-4B` | image → 3D | MIT | none |
| `microsoft/TRELLIS-image-large` (`ckpts/ss_dec_conv3d_16l8_fp16` only) | sparse-structure decoder | MIT | none |
| `ZhengPeng7/BiRefNet` | background removal | MIT | none |
| `facebook/dinov3-vitl16-pretrain-lvd1689m` | image encoder | Meta DINOv3 license | **manual approval** |
| `black-forest-labs/FLUX.1-schnell` | text → concept image | Apache-2.0 | click-through |

**Not used on purpose:** `briaai/RMBG-2.0`, the background remover TRELLIS.2's
stock `pipeline.json` names, is licensed for non-commercial use. The server
writes `pipeline.concord.json` with the MIT BiRefNet instead, so the stock
config (and RMBG-2.0) is never loaded. The public TRELLIS.2 Hugging Face demo
runs the stock config.

## Setup

```bash
# on the pod
bash /workspace/pod_install.sh          > /root/install.log 2>&1   # ~5 min
bash /workspace/pod_weights.sh          > /root/weights.log 2>&1   # ungated MIT weights
HF_TOKEN=… bash /workspace/pod_weights_gated.sh                     # DINOv3 + FLUX, needs approved access
bash /workspace/start_gen_server.sh                                 # 127.0.0.1:7870

# on the Mac
engines/concord-gen-pod/tunnel.sh <host> <port>                    # -> localhost:7870
```

The token is passed only as an environment variable for the download command;
it is not written to the pod.

## API

Port 7870, localhost only: RunPod's nginx owns 0.0.0.0:7861 and exposes it through its public proxy.

`GET /health` · `POST /concept {prompt, seed?, width?, height?}` → `png_b64` ·
`POST /mesh {image_b64, seed?, pipeline_type?, decimation_target?, texture_size?}` → `glb_b64`.
Failures are `{ok:false, reason}` (`weights_missing`, `generation_error`, …);
Concord falls back to Hugging Face only for `weights_missing` / unreachable.

## Gotcha: never `scp` a running script

`scp` overwrites the destination in place (no atomic rename). If a script is
still mid-execution on the pod when you `scp` a new version over it, bash's
in-progress read of that file descriptor gets corrupted and it dies with a
garbled syntax error pointing at an innocent line — this happened once
(2026-09-24) to `pod_weights_gated.sh` mid-FLUX-download; the already-written
files were unaffected, but the script process was killed. Check
`pgrep -f <script>.sh` on the pod before overwriting; if it's running, let it
finish (or kill it deliberately) first, or upload to a new filename.

## Live pod runtime (synced from the RunPod pod, 2026-10-19)

The pod runs these files out of `/workspace` (persistent geesefs) and `/pre_start.sh`:

| repo file | pod path | role |
|---|---|---|
| `pre_start.sh` | `/pre_start.sh` | RunPod `/start.sh` runs it on every container start; launches `pod-autostart.sh` |
| `pod-autostart.sh` | `/workspace/pod-autostart.sh` | idempotent start of ollama brain (:11434), ollama bg (:11436), local weight sync, gen-server (:7870) |
| `start-ollama-a40brain.sh` | `/workspace/start-ollama-a40brain.sh` | chat brain; `LLAMA_ARG_CACHE_RAM=2048` caps llama-server's host prompt cache (default 8 GiB per runner caused cgroup OOMs) |
| `start-ollama-bg.sh` | `/workspace/start-ollama-bg.sh` | background agents; pinned to CPUs 0-2 with `nice 15`, cache RAM 512 MiB |
| `sync-local-weights.sh` | `/workspace/gen/sync-local-weights.sh` | copies FLUX + TRELLIS-image-large to `/root/gen/models-local` (container disk) so reloads take ~1 min, not 5-16 min from geesefs |
| `gen-server-loop.sh` | `/workspace/gen/gen-server-loop.sh` | restart loop; `MALLOC_ARENA_MAX=2`, thread caps (`CONCORD_GEN_THREADS=6`) |
| `start_gen_server.sh`, `concord_gen_server.py` | `/workspace/...` | gen server |

gen-server behavior added on the pod:
- FLUX and TRELLIS share the A40 by parking on CPU between requests (`CONCORD_GEN_PARK`), `malloc_trim` after each request.
- RSS watchdog (`CONCORD_GEN_RSS_RESTART_MB`=24000, `CONCORD_GEN_RSS_IDLE_S`=60) exits for a clean respawn when idle.
- Startup preload (`CONCORD_GEN_PRELOAD`=`trellis1,flux`, ~55 s) loads both models into CPU RAM after any respawn, so the first mesh does not pay the ~36 s cold load. TRELLIS goes first: built after FLUX nf4 its CPU module init took ~250 s instead of ~28 s.
- Thread cap (`CONCORD_GEN_THREADS`=6): the container has a 7.65-CPU CFS quota but sees 96 cores; default torch/OpenMP thread counts were throttled in ~42% of CFS periods.
- While `/mesh` runs, the bg Ollama (`OLLAMA_HOST=127.0.0.1:11436`, incl. runners) is re-pinned to `CONCORD_GEN_BG_YIELD_CPUS` (default `0`) and restored to `CONCORD_GEN_BG_CPUS` (`0-2`) afterwards.
- `/abort` also stops TRELLIS v1 mid-mesh (abort-aware tqdm in the v1 sampler/postprocessing/render loops).
- Per-mesh phase timing (`phases`: to_gpu/sample/to_glb/export, to_glb sub-steps, cgroup throttling, major faults) in the `/mesh` response and log.

Memory: the real limit is the container cgroup `memory.max` (~47.7 GiB, no swap) for all processes combined, not a gen-server RSS figure.
