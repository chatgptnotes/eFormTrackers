// PM2 ecosystem config for Windows IIS deployment
// Install: npm install -g pm2 pm2-windows-startup
// Start:   pm2 start ecosystem.config.js
// Save:    pm2 save
// Startup: pm2-startup install

module.exports = {
  apps: [
    {
      name: 'jotflow-backend',
      script: 'server.js',
      cwd: __dirname,
      instances: 1,           // Fork mode — Socket.IO rooms require single instance
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      merge_logs: true,
    },
  ],
};
