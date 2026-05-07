// PM2 Ecosystem Configuration for Concord Cognitive Engine
// Usage: pm2 start ecosystem.config.cjs
// Docs:  https://pm2.keymetrics.io/docs/usage/application-declaration/

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
      // Heap limit below PM2's 4GB restart so memory watchdog can intervene before OOM
      node_args: '--max-old-space-size=3584 --expose-gc',
      env: {
        NODE_ENV: 'production',
        PORT: 5050,
      },
      // Crash-loop detection: stop restarting after 15 rapid failures
      max_restarts: 15,
      min_uptime: '10s',
      restart_delay: 4000,
      exp_backoff_restart_delay: 100,  // doubles each restart: 100ms → 200ms → 400ms...
      // Graceful shutdown: give in-flight requests time to finish
      kill_timeout: 10000,
      // Wait for the server to signal ready before marking it online
      wait_ready: true,
      listen_timeout: 30000,
      // Logging
      error_file: 'logs/backend-error.log',
      out_file: 'logs/backend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'concord-frontend',
      script: 'npm',
      args: 'start',
      cwd: `${__dirname}/concord-frontend`,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      // Logging
      error_file: '../logs/frontend-error.log',
      out_file: '../logs/frontend-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
