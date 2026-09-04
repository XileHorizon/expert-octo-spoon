module.exports = {
  apps: [
    {
      name: "ship-print-esell",
      script: "node_modules/next/dist/bin/next",
      args: "start",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",

      // Restart on crash, with backoff so a bad deploy cannot spin the CPU.
      autorestart: true,
      max_restarts: 10,
      min_uptime: "30s",
      restart_delay: 2000,
      exp_backoff_restart_delay: 200,

      // Recycle if the process leaks memory rather than letting the box swap.
      max_memory_restart: "512M",

      env: { NODE_ENV: "production", PORT: process.env.PORT || 3000 },

      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
