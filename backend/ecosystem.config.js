// PM2 ecosystem config for Windows IIS deployment
// Install: npm install -g pm2 pm2-windows-startup
// Start:   pm2 start ecosystem.config.js
// Save:    pm2 save
// Startup: pm2-startup install
//
// IMPORTANT: this file deliberately does NOT set NODE_ENV or PORT.
// server.js loads backend/.env (via config/env), and pm2's `env` block would
// OVERRIDE those values in process.env - which previously forced the backend to
// dev mode on port 3000 even though .env said production/3001. Leaving env out
// makes backend/.env the single source of truth for PORT and NODE_ENV.

module.exports = {
  apps: [
    {
      name: 'jotflow-backend',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,           // Fork mode - Socket.IO rooms require single instance
      exec_mode: 'fork',
      // No env block on purpose - PORT and NODE_ENV come from backend/.env.
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
