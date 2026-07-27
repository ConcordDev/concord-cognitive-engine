// PM2 Ecosystem Configuration for Concord Cognitive Engine
// Usage: pm2 start ecosystem.config.cjs
// Docs:  https://pm2.keymetrics.io/docs/usage/application-declaration/
//
// Deployment targets:
//   RunPod / bare-metal: pm2 start ecosystem.config.cjs --env runpod
//   Docker:              Use docker-compose.yml instead
//   Local dev:           pm2 start ecosystem.config.cjs --env development

// Ensure logs directory exists before pm2 tries to write to it
const fs = require('fs');
const path = require('path');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

module.exports = {
  apps: [
    {
      name: 'concord-backend',
      script: 'server/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      // Stability audit (2026-07-20) — RETUNED from 32GB/34G. The old values
      // matched a stale RTX PRO 4500 Blackwell assumption (CLAUDE.md's own
      // "GPU/CPU pinning audit" corrected this project's real deploy target
      // to a single A40 on a 9 vCPU / 50GB TOTAL SYSTEM RAM box — .env.runpod,
      // scripts/pin-processes.sh, and scripts/runpod-cognition.sh all agree
      // on this figure independently, so it's the bare-metal reality, not a
      // docker-compose.yml assumption). A 32GB heap ceiling (with pm2 not
      // even intervening until 34GB) left almost nothing for everything else
      // that has to share the SAME 50GB: Ollama's 5 separate bare-metal
      // processes (OLLAMA_NUM_PARALLEL=1 each — see .env.runpod's "Phase F"
      // section — real system RAM for loading ~26GB of resident model
      // weights, not just VRAM), this app's own worker_threads (now
      // individually capped — see workers/heartbeat-pool.js,
      // workers/macro-pool.js, lib/world-shard-manager.js — but their caps
      // still draw from this SAME process's RSS budget), the frontend pm2
      // app (capped 1G below), SQLite's cache_size (1GB default), and OS
      // overhead. Budget: 50GB total − ~20GB Ollama (conservative; covers a
      // transient full-reload spike, not just steady-state) − 1GB frontend
      // − 1GB SQLite cache − 2GB OS/kernel ≈ 26GB left for this ENTIRE
      // backend process (main thread + heartbeat/macro/shard workers
      // combined). 8GB main-thread heap + worker ceilings (4×512MB
      // heartbeat + 2×1024MB macro ≈ 4GB, shard workers stay at 0 while
      // CONCORD_SHARD_WORLDS=false) leaves real margin under that 26GB, and
      // max_memory_restart=20G gives pm2 room to intervene well before this
      // process could pressure Ollama or the frontend for RAM. This is a
      // calculated estimate, not live telemetry from the real pod — verify
      // with `free -h` / `ps aux --sort=-rss` under real traffic and adjust
      // if Ollama's actual steady-state footprint differs materially.
      // 2026-07-25: LOWERED 20G -> 6G, because at 20G this net could never
      // fire for the failure mode we actually have.
      //
      // pm2 triggers max_memory_restart on RSS. V8 fatally aborts when the
      // MAIN-THREAD OLD SPACE hits its own ceiling — 8192MB, set in node_args
      // below — which is a per-isolate limit independent of process RSS. At
      // that moment RSS is roughly 9-11GB (heap + external + array buffers +
      // code space + the worker ceilings this file budgets: 4x512MB heartbeat
      // + 2x1024MB macro). All of that is BELOW 20G, so the process always
      // died of a V8 abort before pm2 ever saw a reason to intervene. The
      // "graceful pre-emptive restart" was decorative.
      //
      // Why 6G specifically, from measurement rather than taste
      // (docs/HEAP_GROWTH_MEASUREMENT.md — 46min real run, 87 samples):
      //   - idle RSS settles at ~1.15GB and peaked at 1.45GB
      //   - a confirmed leak raises the heap floor ~300MB/hr at ZERO load,
      //     and the crash that started this hit 6,029MB heap in ~75min under
      //     light load
      //   - 6G RSS lands well above anything observed in normal operation and
      //     well below the ~9-11GB V8-abort point
      // So it fires during a leak run and not during healthy operation.
      //
      // A graceful restart here is materially better than the abort it
      // replaces: pm2 sends SIGINT, so gracefulShutdown() (server.js) flushes
      // STATE, drains in-flight requests over its 5s window, and lets WAL
      // checkpoint. A V8 abort skips all of that and drops up to 2 minutes of
      // in-memory STATE (the periodic save interval).
      //
      // This does NOT trip the max_restarts: 10 crash-loop guard below — that
      // only counts restarts where the process failed to stay up for
      // min_uptime (30s). A memory restart hours apart resets the counter.
      //
      // If this fires OFTEN, that is signal, not noise: it means the leak is
      // running faster than the measured idle rate and the underlying
      // retention path still needs fixing. It buys uptime; it is not a fix.
      max_memory_restart: '6G',
      node_args: '--max-old-space-size=8192 --expose-gc',
      env: {
        // Default (Docker / docker-compose)
        NODE_ENV: 'production',
        PORT: 5050,
        ALLOWED_ORIGINS: 'https://concord-os.org',
        COOKIE_DOMAIN: 'concord-os.org',
        TRUST_PROXY: '1',
        // Docker Ollama hostnames (set by docker-compose network)
        BRAIN_CONSCIOUS_URL: 'http://ollama-conscious:11434',
        BRAIN_SUBCONSCIOUS_URL: 'http://ollama-subconscious:11434',
        BRAIN_UTILITY_URL: 'http://ollama-utility:11434',
        BRAIN_REPAIR_URL: 'http://ollama-repair:11434',
        OLLAMA_HOST: 'http://ollama:11434',
      },
      env_runpod: {
        // Stability audit (2026-07-20) — corrected stale hardware claim.
        // This used to say "RunPod RTX PRO 4500 Blackwell — 32GB GDDR7, 62GB
        // RAM, 28 vCPU", copied from an earlier, now-superseded assumption.
        // The REAL bare-metal target (confirmed independently across
        // .env.runpod, scripts/pin-processes.sh, and
        // scripts/runpod-cognition.sh — not docker-compose.yml, which
        // describes a DIFFERENT topology this deploy path doesn't use) is a
        // single NVIDIA A40 (48GB GDDR6, 696GB/s bandwidth, 300W — per
        // NVIDIA's own datasheet) on a 9 vCPU / 50GB system RAM box. This
        // deploy runs 5 SEPARATE Ollama processes (one per brain slot,
        // OLLAMA_NUM_PARALLEL=1 each — see .env.runpod's "Phase F" /
        // scripts/runpod-cognition.sh), not docker-compose's 7-instance
        // horizontal-duplication scheme — the two topologies have
        // meaningfully different resource footprints; don't cite one for
        // the other.
        NODE_ENV: 'production',
        PORT: 5050,
        TRUST_PROXY: '1',
        // libuv thread pool — Node's default is 4, which bottlenecks SQLite
        // (better-sqlite3 is sync but WAL checkpoints + disk I/O share the pool)
        // and file-system operations. 16 threads on 28 vCPU is conservative;
        // raise to 32 under sustained file-write pressure on the artifact store.
        UV_THREADPOOL_SIZE: '16',
        // Stability audit (2026-07-20) — the memory-pressure watchdog
        // (lib/memory-pressure.js) and /health's soft-pressure flag
        // (routes/system.js) both read MAX_OLD_SPACE_SIZE from the
        // environment to compute their heap-pressure percentage — this is
        // SEPARATE from the --max-old-space-size CLI flag in node_args
        // above and was never actually set anywhere, so both silently fell
        // back to their own stale 32768 default regardless of the real
        // configured ceiling. Must stay numerically in sync with node_args'
        // --max-old-space-size below or the watchdog computes pressure
        // against the wrong baseline (i.e. never fires even when genuinely
        // near the real ceiling).
        MAX_OLD_SPACE_SIZE: '8192',
        // Stability audit (2026-07-20) — FIXED a real, severe bug: this
        // block previously pointed ALL FIVE brain slots at the SAME port
        // (11434), but scripts/runpod-cognition.sh runs 5 SEPARATE Ollama
        // processes on 5 DISTINCT fixed ports (its own `declare -A PORT=(
        // [conscious]=11434 [subconscious]=11435 [utility]=11436
        // [repair]=11437 [vision]=11438 )`) — matching CLAUDE.md's
        // documented brain-port table. With the old single-port config, if
        // `pm2 start ecosystem.config.cjs --env runpod` is the deploy path
        // (which startup.sh documents as the standard flow), 4 of the 5
        // brains would have silently hit the WRONG Ollama process (or
        // connection-refused if nothing else listens on 11434) — not a
        // crash, but a severe, silent functional break: subconscious/
        // utility/repair/vision calls either failing outright or getting
        // answered by the wrong model. Corrected to match the real fixed
        // ports below.
        BRAIN_CONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_SUBCONSCIOUS_URL: 'http://localhost:11435',
        BRAIN_UTILITY_URL: 'http://localhost:11436',
        BRAIN_REPAIR_URL: 'http://localhost:11437',
        BRAIN_VISION_URL: 'http://localhost:11438',
        OLLAMA_HOST: 'http://localhost:11434',
        // 5-brain model defaults — match server/lib/brain-config.js and
        // .env.runpod. Previously this file held a legacy single-Ollama
        // big-model config (qwen2.5:32b + 14b + 7b + 7b) that was 28GB
        // loaded on a 32GB VRAM card with NO headroom for KV cache spikes
        // under concurrent inference. The 5-brain set is concord-conscious
        // (custom on qwen2.5 base) + qwen2.5:7b + qwen2.5:3b + qwen2.5:0.5b
        // + llava:13b-v1.6-vicuna-q4_K_M; total much lighter and lets
        // OLLAMA_MAX_LOADED_MODELS=2 actually rotate without OOMing.
        BRAIN_CONSCIOUS_MODEL: 'concord-conscious:latest',
        BRAIN_SUBCONSCIOUS_MODEL: 'qwen2.5:7b-instruct-q4_K_M',
        BRAIN_UTILITY_MODEL: 'qwen2.5:3b',
        BRAIN_REPAIR_MODEL: 'qwen2.5:0.5b',
        // Stability audit (2026-07-20) — FIXED a real licensing-exposure
        // bug: this was still 'llava:13b-v1.6-vicuna-q4_K_M', but
        // .env.runpod (and CLAUDE.md's "five-brain architecture" section)
        // documents an intentional swap away from that exact model —
        // Vicuna→LLaMA + GPT-4-instruction-data lineage means CC-BY-NC,
        // commercial exposure — to qwen2.5vl:7b (cleanly Apache-2.0).
        // Since pm2's env silently wins over .env.runpod for any key set in
        // both (see the ENV_CONFLICT detector added in server.js's dotenv
        // loader this same audit), this stale value would have silently
        // reintroduced the exact licensing risk the swap was meant to close.
        BRAIN_VISION_MODEL: 'qwen2.5vl:7b',
        // Stability audit (2026-07-20) — real bare-metal Ollama topology is
        // 5 SEPARATE processes, each OLLAMA_NUM_PARALLEL=1 (see
        // .env.runpod's "Phase F" / scripts/runpod-cognition.sh) — the true
        // ceiling on simultaneously-useful LLM concurrency is 5 (one
        // in-flight request per brain-process), not the stale 32 default
        // this queue inherited from an earlier RTX-4500/docker-era
        // assumption (lib/llm-queue.js's own default). Past 5 truly
        // concurrent dispatches, extra requests just pile into Ollama's own
        // per-process FIFO instead of Concord's priority queue — which
        // means CRITICAL-priority live chat stops actually cutting the
        // line once more than ~5 requests are genuinely in flight. This
        // keeps the priority ordering meaningful all the way to the GPU.
        LLM_CONCURRENCY: '5',
        // Phase A-F — concurrency / threading tuning. See .env.runpod for
        // descriptions. Defaults here are safe for the standard RTX PRO 4500
        // pod; override per-pod in .env if you need different values.
        CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS: '30000',
        CONCORD_HEARTBEAT_TIMING_HISTORY: '60',
        CONCORD_HEARTBEAT_POOL_SIZE: '4',
        CONCORD_HEARTBEAT_WORKER_TIMEOUT_MS: '25000',
        // World sharding — REVERTED to 'false' (2026-07-20 stability audit).
        // This was briefly set 'true' earlier the same day (the sharding
        // activation itself — routes/worlds.js#POST /travel wiring — is real
        // and correct), but pm2's env here silently WON over .env.runpod's
        // CONCORD_SHARD_WORLDS=false: pm2 injects its `env_runpod` block into
        // process.env before node starts, and dotenv.config() (server.js's
        // "---- dotenv (safe) ----" block) does NOT override an already-set
        // process.env var by default — so this field was the one actually in
        // effect, not .env.runpod's, despite .env.runpod's own extensive
        // comment there documenting a REAL PRIOR INCIDENT: sharding was tried
        // on this exact 9-vCPU/50GB-RAM box before and caused site-wide CPU/
        // event-loop sluggishness, because CONCORD_WORLD_CORE_COUNT=2 (also
        // only set in .env.runpod, never overridden here) leaves just 2 fixed
        // cores for the ENTIRE backend main loop + heartbeat pool + every
        // active world shard combined — well below the ~4+ vCPU/active-world
        // baseline the sharding design assumes. Reverting to 'false' here
        // makes this file's value match .env.runpod's evidenced-safe default
        // again, closing the silent-override gap. Only flip back to 'true'
        // after ALSO raising CONCORD_WORLD_CORE_COUNT to a real number in
        // THIS file (not just .env.runpod, which this field's presence here
        // will keep silently overriding) — see .env.runpod's "Phase F"
        // section for the exact tradeoff against Ollama's dispatch cores.
        CONCORD_SHARD_WORLDS: 'false',
        CONCORD_SHARD_BACKOFF_MS: '2000',
        CONCORD_SHARD_MAX_RESTARTS_PER_MIN: '5',
        // ALLOWED_ORIGINS and COOKIE_DOMAIN loaded from .env file
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5050,
        BRAIN_CONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_SUBCONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_UTILITY_URL: 'http://localhost:11434',
        BRAIN_REPAIR_URL: 'http://localhost:11434',
        OLLAMA_HOST: 'http://localhost:11434',
      },
      // Crash-loop detection — stop restarting after 10 rapid failures.
      // Under heavy WebSocket load a fast crash-loop can exhaust FDs + DB
      // connections before the process exits cleanly; the 5s base + 200ms
      // backoff gives the OS time to reclaim sockets and DB WAL locks.
      max_restarts: 10,
      min_uptime: '30s',              // must be stable 30s before reset; catches fast boot-crash
      restart_delay: 5000,            // 5s base grace — lets WAL checkpoint + port release
      exp_backoff_restart_delay: 200, // steeper ramp: 5.2s, 5.4s, 5.6s …
      kill_timeout: 15000,            // 15s graceful shutdown (flush DB + drain WS)
      wait_ready: true,
      listen_timeout: 60000,
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'concord-frontend',
      script: 'node',
      args: '.next/standalone/server.js',
      cwd: `${__dirname}/concord-frontend`,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
        // Rewrites proxy /api/* and /socket.io/* to this URL at runtime (no rebuild needed)
        BACKEND_URL: 'http://127.0.0.1:5050',
      },
      error_file: '../logs/frontend-error.log',
      out_file: '../logs/frontend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      // ── Native Godot client (bare-metal one-command boot) ────────────────
      // Godot is a CLIENT that connects to Concord's /godot-ws gateway over
      // WebSocket (docs/GODOT_INTEGRATION.md), NOT a server-side sidecar
      // Concord's own operation depends on — so this app is supervised the
      // same way as backend/frontend, but is allowed to correctly do nothing.
      // scripts/launch-godot-client.sh decides at runtime whether to launch
      // (CONCORD_LAUNCH_GODOT=auto/1/0, display detection, Godot-binary
      // resolution honoring an existing install) and idles via `sleep
      // infinity` rather than exiting when it decides not to — so pm2 sees
      // a stable "up" process instead of treating a correct no-op (e.g. a
      // headless A40 compute box with no monitor) as a crash-loop.
      name: 'concord-godot-client',
      script: 'bash',
      args: 'scripts/launch-godot-client.sh',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      max_memory_restart: '1G',
      kill_timeout: 5000,
      error_file: 'logs/godot-client-error.log',
      out_file: 'logs/godot-client-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    // Stability audit (2026-07-20) — REMOVED the legacy single-instance
    // "ollama" app that used to live here (name: 'ollama', script: 'ollama',
    // args: 'serve', OLLAMA_HOST: '0.0.0.0:11434', a stale RTX-4500/28-vCPU
    // assumption). It was a genuine, live collision risk: `pm2 start
    // ecosystem.config.cjs --env runpod` starts every app in this array with
    // no scoping, so this legacy single-port entry and
    // scripts/runpod-cognition.sh's real 5-separate-process/per-role setup
    // (the one every other doc in this repo — .env.runpod, pin-processes.sh,
    // CLAUDE.md's brain table — actually describes) would both try to bind
    // port 11434. Worse: startup.sh never called runpod-cognition.sh at all,
    // so a plain `./startup.sh` run was ONLY ever getting this legacy single-
    // model-rotation app, with the other 4 brain ports (11435-11438) never
    // listening — silently stranding subconscious/utility/repair/vision.
    // Fixed at the root: startup.sh now calls runpod-cognition.sh itself
    // (see its own comment), so there is exactly ONE real path, and this
    // app's removal closes the port-11434 collision for good.
    {
      // ── Cloudflare Tunnel (Vector 6 — eliminate tunnel SPOF) ─────────────
      // PM2 supervises cloudflared so it auto-restarts on crash or hang.
      // cloudflared already has built-in exponential-backoff reconnect for
      // transient network drops; PM2 handles hard process death.
      //
      // Cloudflare natively supports multiple connectors on the same tunnel:
      // running startup.sh on a second machine adds a second edge connector
      // automatically — this is the zero-config HA story (no extra config).
      //
      // ACTIVATION: Set CLOUDFLARE_TUNNEL_TOKEN in .env. Without it PM2 will
      // start this app but cloudflared exits immediately (non-fatal).
      name: 'concord-tunnel',
      script: 'cloudflared',
      args: `tunnel --no-autoupdate run --token ${process.env.CLOUDFLARE_TUNNEL_TOKEN || 'CLOUDFLARE_TUNNEL_TOKEN_NOT_SET'}`,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      // Only auto-start when the token is present — prevents a crash-loop
      // from flooding logs when the user hasn't configured the tunnel yet.
      autorestart: Boolean(process.env.CLOUDFLARE_TUNNEL_TOKEN),
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
      exp_backoff_restart_delay: 200,
      max_memory_restart: '256M',     // cloudflared is lightweight (~50MB RSS)
      kill_timeout: 5000,
      error_file: 'logs/cloudflared-error.log',
      out_file: 'logs/cloudflared-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
