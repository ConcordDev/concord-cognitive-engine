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
      max_memory_restart: '34G',                                  // matches 32G heap + ~2G headroom
      node_args: '--max-old-space-size=32768 --expose-gc',         // 32GB heap — matches CLAUDE.md Blackwell default (server/package.json start script + docker-compose use the same)
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
        // RunPod RTX PRO 4500 Blackwell — 32GB GDDR7, 62GB RAM, 28 vCPU.
        // Single Ollama instance hosts all 5 brain slots (vs the docker-compose
        // split which puts each brain on its own container at 11434-11438).
        NODE_ENV: 'production',
        PORT: 5050,
        TRUST_PROXY: '1',
        // libuv thread pool — Node's default is 4, which bottlenecks SQLite
        // (better-sqlite3 is sync but WAL checkpoints + disk I/O share the pool)
        // and file-system operations. 16 threads on 28 vCPU is conservative;
        // raise to 32 under sustained file-write pressure on the artifact store.
        UV_THREADPOOL_SIZE: '16',
        // All five brain slots point at one on-pod Ollama; the model per slot
        // is what differentiates them. (env_runpod overrides PM2's `env`
        // block which has the docker-compose hostnames.)
        BRAIN_CONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_SUBCONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_UTILITY_URL: 'http://localhost:11434',
        BRAIN_REPAIR_URL: 'http://localhost:11434',
        BRAIN_VISION_URL: 'http://localhost:11434',
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
        BRAIN_VISION_MODEL: 'llava:13b-v1.6-vicuna-q4_K_M',
        // Phase A-F — concurrency / threading tuning. See .env.runpod for
        // descriptions. Defaults here are safe for the standard RTX PRO 4500
        // pod; override per-pod in .env if you need different values.
        CONCORD_HEARTBEAT_MODULE_TIMEOUT_MS: '30000',
        CONCORD_HEARTBEAT_TIMING_HISTORY: '60',
        CONCORD_HEARTBEAT_POOL_SIZE: '4',
        CONCORD_HEARTBEAT_WORKER_TIMEOUT_MS: '25000',
        // World sharding ON — per-world worker thread spawns on travel
        // (routes/worlds.js#POST /travel) so the parent governor offloads all
        // scope:'world' sim off the main event loop. The activation was
        // previously dead-wired (an inline travel route in server.js shadowed
        // by the worlds router); now wired on the live router path. Watch the
        // ops-telemetry lens "World shards" widget + ConcordWorldShard* alerts;
        // set 'false' to fall back to fully in-process heartbeats.
        CONCORD_SHARD_WORLDS: 'true',
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
      // Ollama process manager entry — skip if Ollama is already running as a system service
      name: 'ollama',
      script: 'ollama',
      args: 'serve',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '8G',
      autorestart: true,
      env: {
        OLLAMA_HOST: '0.0.0.0:11434',
        // RTX PRO 4500 Blackwell (32GB GDDR7, 28 vCPU). The 5-brain model set
        // (concord-conscious + qwen2.5:7b + qwen2.5:3b + qwen2.5:0.5b + llava:13b)
        // is much lighter than the old 32b+14b setup — total loaded weight stays
        // well under 32GB even with 2 models hot, so we keep MAX_LOADED_MODELS=2
        // for low-latency rotation between conscious and subconscious.
        // Phase D — bumped 8 → 16 for the single-Ollama RunPod deploy.
        // 16 concurrent inference streams across all loaded models. Higher
        // risks KV-cache thrash with 2 loaded models at q8_0.
        OLLAMA_NUM_PARALLEL: '16',
        OLLAMA_MAX_LOADED_MODELS: '2',   // keep conscious+subconscious in VRAM
        OLLAMA_NUM_THREAD: '14',         // half of 28 vCPU for Ollama CPU work
        // Blackwell tensor-core / VRAM optimizations — matches docker-compose.yml.
        // Previously these were docker-only, so the PM2 path on a real RunPod
        // pod was running Ollama without flash-attn or q8 KV cache. That meant:
        //  - no 5th-gen tensor-core acceleration (slower inference)
        //  - 2× VRAM usage for KV cache (evicted hot models faster than expected)
        // Aligning with docker-compose closes the gap.
        OLLAMA_FLASH_ATTENTION: '1',
        OLLAMA_KV_CACHE_TYPE: 'q8_0',
        OLLAMA_KEEP_ALIVE: '24h',
      },
      error_file: 'logs/ollama-error.log',
      out_file: 'logs/ollama-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
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
