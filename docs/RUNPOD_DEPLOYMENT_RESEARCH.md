# RunPod Deployment Research — findings & fixes (2026-06)

A 5-angle deep-research pass (Ollama docs/GitHub issues, RunPod docs, Cloudflare
Tunnel docs, NVIDIA MIG/MPS, AI-NPC market) against the Concord deploy stack:
one RunPod pod, one 32GB Blackwell RTX, 5 Ollama brains (custom 14B conscious +
qwen2.5 7b/3b/0.5b + qwen2.5vl:7b), Cloudflare tunnel to concord-os.org.

Each claim below is sourced. **🔴 = contradicted a stack assumption and was fixed
in code. 🟡 = caveat worth knowing. ✅ = confirmed correct.**

---

## 1. RunPod + multi-Ollama + CPU pinning + storage

- 🔴 **`nproc` reports the HOST core count, not the pod's cgroup slice** (procfs isn't
  cgroup-virtualized — [moby#43205](https://github.com/moby/moby/issues/43205)). On RunPod a pod is a sliver of a big host, so
  `nproc` can read 128 while you have ~16 cores. Pinning math built on `nproc` lands
  **outside** the cpuset and every `taskset` fails with `Invalid argument`.
  **FIXED:** `runpod-cognition.sh` + `pin-processes.sh` now read the real allowed set
  from `/proc/self/status` `Cpus_allowed_list` and pin only within it.
- 🟡 **`taskset -c` works in a container only for cores inside the cgroup cpuset** —
  pinning outside it fails. (Now guaranteed by the fix above.) `taskset` (util-linux)
  isn't always in a minimal image — verify it's installed.
- 🟡 **Shared `OLLAMA_MODELS` blob dir across processes can desync the manifest list** —
  Ollama caches the model list in-memory at serve start; a model pulled against
  instance A *after* B–E booted is invisible to B–E until restart ([ollama#2536](https://github.com/ollama/ollama/issues/2536)).
  **Mitigated:** `runpod-setup.sh --with-models` pulls all against one temp serve
  *before* the five start; the cognition path pulls each model against its own serving
  instance, so no cross-instance dependency.
- 🟡 **Put `OLLAMA_MODELS` on the `/workspace` network volume** — container disk is wiped
  on pod terminate; the volume persists ([RunPod storage docs](https://docs.runpod.io/storage/network-volumes)). **FIXED:** launcher now
  defaults to `/workspace/.ollama/models` when `/workspace` exists. Caveat: network
  volumes lock the pod to one datacenter (can hurt GPU availability) + slower first-load
  than local NVMe; pricing ~$0.07/GB/mo.
- 🟡 **pm2 in a container: use `pm2-runtime` (not `pm2 start`) if it's the entrypoint** —
  plain `pm2 start` daemonizes, PID 1 exits, the container dies. pm2 won't auto-resurrect
  on pod restart; declare everything in `ecosystem.config.cjs` + `pm2-runtime`. (For an
  interactive `runpod-up.sh` boot, daemon-mode `pm2 start` is fine.)
- ✅ **Binding `127.0.0.1` is correct behind the on-pod tunnel** — keeps the 5 brains +
  backend off any public RunPod port; the tunnel reaches them over loopback. RunPod's
  generic "bind 0.0.0.0" advice only applies to *its* proxy, which we bypass.

## 2. Five Ollama models on one 32GB GPU

- 🔴 **`OLLAMA_GPU_OVERHEAD` is NOT reliably enforced** (open bug [ollama#12223](https://github.com/ollama/ollama/issues/12223)) and
  can't fence VRAM for a non-Ollama consumer. The "enforced Concordia slice" framing was
  **overclaimed**. **FIXED:** relabeled everywhere as *fit margin, not a hard fence*.
  Saving grace: Concordia has no server-side CUDA (3D render is client-side Three.js), so
  the slice was always really KV headroom, not a separate consumer.
- 🔴 **No cross-process LRU across 5 separate `ollama serve` processes** — Ollama's
  graceful eviction is *within* a serve process; across five, an over-commit is a hard
  **CUDA OOM**, not a graceful unload. The ~1.6GB margin is thin for that. **FIXED:**
  pinned `OLLAMA_NUM_PARALLEL=1` (KV scales with it), per-instance
  `OLLAMA_MAX_LOADED_MODELS=1`, and the `BRAIN_VISION_KEEP_ALIVE` lever sheds ~6.9GB
  on demand as the real pressure valve.
- 🟡 **Flash attention is experimental on vision/multimodal** (can degrade qwen2.5vl),
  and **q8_0 KV cache *requires* flash attention** (silently falls back to f16 without it
  — [smcleod KV-quant writeup](https://smcleod.net/2024/12/bringing-k/v-context-quantisation-to-ollama/)). **FIXED:** `BRAIN_VISION_FLASH_ATTENTION=0` default
  for the vision instance, which then explicitly uses f16 KV.
- 🟡 **`OLLAMA_MAX_LOADED_MODELS` default is 3 per GPU** — irrelevant to us (5 separate
  processes, 1 model each) but would bite a single-serve setup. **Separate processes are
  the right call** for per-model config isolation (KV type, keep-alive, context are
  process-global).
- ✅ **MIG/MPS: "share the GPU, no partition" is correct.** The RTX PRO 4500 Blackwell
  *Workstation* Edition doesn't support MIG (only the Server Edition does); MIG would
  hard-split into 2, not 5; MPS doesn't save VRAM. CUDA already time-shares across
  processes.
- 🟡 **Fit is real but tight:** ~26GB weights+KV + 4GB margin = ~30/32GB. Holds at
  NUM_PARALLEL=1 + short context + q8_0 KV; long contexts or parallelism push it over.
  Confirm with `nvidia-smi` / `GET <brain>/api/ps` after loading all five live.

## 3. Egress / pulling models if `registry.ollama.ai` is blocked

- ✅ **The custom `concord-conscious` build is 100% LOCAL** once its `qwen2.5:14b` base
  exists — `ollama create FROM <local base>` needs no network ([ollama import docs](https://docs.ollama.com/import)). So
  only *getting the bases in* needs egress.
- **Ranked working paths when the registry is blocked:**
  1. **Transplant the whole `~/.ollama/models` dir** (blobs+manifests) from a machine
     that already pulled them — content-addressed, fully air-gap-capable. Put it on
     `/workspace`.
  2. **`ollama run hf.co/Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M`** — pulls from Hugging
     Face, not the Ollama registry ([HF-Ollama docs](https://huggingface.co/docs/hub/ollama)). Official Qwen + bartowski GGUFs exist
     for 0.5b/3b/7b/14b.
  3. **Manual GGUF import** — copy a `.gguf` in, `FROM /path.gguf` + `ollama create`.
- 🟡 **Minimal Ollama-registry allowlist = `registry.ollama.ai` + `*.r2.cloudflarestorage.com`**
  (blobs redirect to R2 — [ollama#2390](https://github.com/ollama/ollama/issues/2390)); allowing only the registry domain stalls on
  blob fetch. Honors `HTTPS_PROXY`.
- 🟡 **Qwen2.5-VL as a runnable Ollama GGUF is less consistently available** — verify the
  specific VL repo runs under your Ollama version (matches the CLAUDE.md vision-stack
  uncertainty).
- 🟡 **No env var globally redirects the default registry** ([ollama#9409](https://github.com/ollama/ollama/issues/9409)) — must retag
  with an explicit registry prefix or use `hf.co/`.

## 4. Cloudflare Tunnel (concord-os.org)

- ✅ **Same-origin path-ingress shape is correct** — anchored Go-regex `path:`, first-match
  wins, mandatory final `http_status:404` catch-all ([ingress pkg](https://pkg.go.dev/github.com/cloudflare/cloudflared/ingress)).
- ✅ **WebSockets safe through the tunnel** — but Cloudflare drops a socket after **~100s
  idle** ([connection-limits](https://developers.cloudflare.com/fundamentals/reference/connection-limits/)). Checked the code: Socket.IO `pingInterval: 25000` keeps it
  alive. No change needed.
- ✅ **LLM streaming 524 risk doesn't apply** — chat streams tokens over **WebSocket**
  (`socket.emit("chat:token")`), not an HTTP SSE response, so the 100s time-to-first-byte
  timeout ([error-524](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-524/)) never triggers. `originRequest.keepAliveTimeout: 90s` already set.
- 🟡 **100MB upload cap on the Free plan** (HTTP 413) — large artifact/media uploads
  through the tunnel hard-fail at 100MB. Route those to object storage or chunk them.

## 5. Product / IP thesis — honest landing

- **The salience-gating concept is NOT novel — it's what the field converges on.**
  "Affordable Generative Agents" ([arXiv:2402.02053](https://arxiv.org/abs/2402.02053)) claims **~100×** cost reduction via
  exactly this (deterministic policy reuse + LLM only on salient moments); plus
  Slow/Fast-Mind hierarchies and tier-routers. NVIDIA ACE's 2025 strategy is 4B–8B
  **on-device** models in shipping games (PUBG Ally, inZOI, Mecha BREAK). Inworld
  **pivoted away** from NPCs to general agent infra.
- **The cost-per-interaction IS the cited blocker** — Inworld's legacy pricing was
  ~$0.002/interaction; Stanford's Smallville cost ~$1k for 25 agents over 3 days.
- **Defensible IP isn't the gate (table-stakes) — it's:** (a) the specific cheap-per-tick
  **affect/salience trigger function**, (b) the domain-specific deterministic substrate
  it falls back to, (c) a **reproducible benchmark at 1,000+ persistent agents**, which
  nobody has published. That gap is real and is where to plant the flag.
- **Positioning fix:** lead with the benchmark + the affect-trigger design, not the
  "thousand NPCs for the cost of ten" slogan — frame the slogan as *convergent-with-the-
  field*, not novel. (The plan's Track D already hedges this correctly.)

---

### Two things to verify on the live pod (version-sensitive)
1. The current R2 blob host for the egress allowlist (claim can drift across versions).
2. Qwen2.5-VL GGUF runnability under your exact Ollama version.

### Method caveat
Several primary doc sites (Cloudflare, RunPod, pm2) 403'd the automated fetcher; those
claims were corroborated via GitHub source/issues + cross-checked search snippets. The
Ollama FAQ, `envconfig/config.go`, and the moby/ollama GitHub issues were fetched directly.
