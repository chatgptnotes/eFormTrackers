# JotFlow IIS deployment

This ZIP contains the production frontend (`dist`), backend (`backend`), and
PostgreSQL schema/migrations. It intentionally does **not** contain `.env`,
database data, uploads, logs, or `node_modules`.

On the Windows IIS PC:

1. Extract the ZIP to `C:\inetpub\jotflow`.
2. Copy the existing production `backend\.env` to `C:\inetpub\jotflow\backend\.env`.
3. In an Administrator PowerShell window, run:

   ```powershell
   Set-Location C:\inetpub\jotflow\backend
   npm ci --omit=dev
   node db\migrate.js
   node server.js
   ```

4. In IIS, set the JotFlow site's physical path to `C:\inetpub\jotflow\dist`.
   URL Rewrite and ARR must already be installed; `dist\web.config` proxies
   `/api`, `/socket.io`, and `/uploads` to the local backend on port 3001.

Keep the backend PowerShell window running, or register `backend\server.js` as
a Windows service before using this as a permanent production deployment.
