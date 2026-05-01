// PM2 Ecosystem Configuration for Concord Cognitive Engine
// Usage: pm2 start ecosystem.config.cjs
// Docs:  https://pm2.keymetrics.io/docs/usage/application-declaration/
//
// Deployment targets:
//   RunPod / bare-metal: pm2 start ecosystem.config.cjs --env runpod
//   Docker:              Use docker-compose.yml instead
//   Local dev:           pm2 start ecosystem.config.cjs --env development

module.exports = {
  apps: [
    {
      name: 'concord-backend',
      script: 'server/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '4G',
      node_args: '--max-old-space-size=3584 --expose-gc',
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
        // RunPod: Ollama runs locally, ports exposed via RunPod proxy
        NODE_ENV: 'production',
        PORT: 5050,
        TRUST_PROXY: '1',
        // All brains hit localhost Ollama — one instance, multiple model roles
        BRAIN_CONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_SUBCONSCIOUS_URL: 'http://localhost:11434',
        BRAIN_UTILITY_URL: 'http://localhost:11434',
        BRAIN_REPAIR_URL: 'http://localhost:11434',
        BRAIN_MULTIMODAL_URL: 'http://localhost:11434',
        OLLAMA_HOST: 'http://localhost:11434',
        // Models — adjust to what you've pulled in Ollama
        BRAIN_CONSCIOUS_MODEL: 'qwen2.5:14b',
        BRAIN_SUBCONSCIOUS_MODEL: 'qwen2.5:7b',
        BRAIN_UTILITY_MODEL: 'qwen2.5:7b',
        BRAIN_REPAIR_MODEL: 'qwen2.5:7b',
        // ALLOWED_ORIGINS and COOKIE_DOMAIN loaded from .env file
        // (RunPod pod URL changes per pod — set these in .env, not here)
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
        // On RunPod with an RTX, increase parallelism:
        OLLAMA_NUM_PARALLEL: '4',
        OLLAMA_MAX_LOADED_MODELS: '2',
      },
      error_file: 'logs/ollama-error.log',
      out_file: 'logs/ollama-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
