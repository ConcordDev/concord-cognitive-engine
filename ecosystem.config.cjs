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
        // World sharding OFF by default — enable only after the operator
        // has telemetry confirming the per-world isolation is clean for
        // their workload (ops-telemetry lens shows shard status + restart
        // counts under "World shards" widget).
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
      // Crash-loop detection: stop restarting after 15 rapid failures
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,
      kill_timeout: 10000,
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
  ],
};
