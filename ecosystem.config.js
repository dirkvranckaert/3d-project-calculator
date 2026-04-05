/**
 * PM2 Ecosystem Configuration
 * App name: project-calculator
 * Port: 3003 (dev), 3458 (production via Nginx)
 */
module.exports = {
  apps: [
    {
      name: 'project-calculator',
      script: 'server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3459,
      },
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      kill_timeout: 10000,
      listen_timeout: 5000,
    },
  ],
};
