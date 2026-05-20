# IIS Architecture & Traffic Handling — Technical Guide

## Overview

FlowAccel uses IIS as a reverse proxy in front of Node.js/Express, with PostgreSQL as the database. This document explains how IIS handles traffic and processing at a technical level.

---

## 1. Kernel-Mode Request Processing (http.sys)

IIS's biggest advantage — requests never even reach user-mode for static files.

```
Network packet arrives
    │
    ▼
┌─────────────────────────────────┐
│  http.sys (Windows kernel)      │  ← Runs in KERNEL mode
│  ├─ TCP connection management   │
│  ├─ SSL/TLS handshake           │
│  ├─ Request parsing             │
│  ├─ Response caching (hot URLs) │
│  └─ Request queuing             │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│  IIS Worker Process (w3wp.exe)  │  ← Runs in USER mode
│  ├─ URL Rewrite rules           │
│  ├─ ARR reverse proxy           │
│  ├─ Static file serving         │
│  └─ Pass-through to Node.js    │
└─────────────────────────────────┘
```

Most web servers (nginx, Apache) process everything in user-mode. IIS offloads SSL, caching, and queuing to the **kernel** — fewer context switches, less overhead.

---

## 2. Request Queue — Traffic Shock Absorber

When hundreds of users hit the app simultaneously:

```
Incoming requests:  ████████████████ (burst of 500)
                         │
                         ▼
              ┌─────────────────────┐
              │  http.sys Queue     │  ← Holds up to 5000 requests (default)
              │  (kernel memory)    │     No request dropped
              └────────┬────────────┘
                       │
            Feeds worker process at
            a pace it can handle
                       │
                       ▼
              ┌─────────────────────┐
              │  w3wp.exe processes │
              │  20 concurrent      │  ← maxConcurrentRequestsPerCPU
              │  threads per CPU    │
              └─────────────────────┘
```

Without this queue, Node.js alone would choke on the burst. IIS **absorbs** the spike.

---

## 3. Request Routing in Production

```
Browser request hits IIS
         │
         ├── /assets/main.js     → IIS serves directly from disk (kernel-cached)
         ├── /assets/style.css   → IIS serves directly from disk (kernel-cached)
         ├── /index.html         → IIS serves directly from disk
         │
         ├── /api/submissions    → ARR proxies to Node.js:3001
         ├── /api/auth/login     → ARR proxies to Node.js:3001
         ├── /socket.io/         → ARR proxies WebSocket to Node.js:3001
         ├── /uploads/avatar.jpg → ARR proxies to Node.js:3001
         │
         └── /dashboard (SPA)   → URL Rewrite → index.html (IIS serves)
```

~70% of requests (static assets, SPA routes) **never touch Node.js**. IIS handles them at near-kernel speed. Only API calls reach the backend.

---

## 4. App Pool — Process Isolation & Recovery

```
┌─ Application Pool: "FlowAccel" ──────────────────┐
│                                                    │
│  Identity: ApplicationPoolIdentity                 │
│  CLR: No Managed Code (just proxying)             │
│  Max Workers: 1 per pool (can increase)           │
│                                                    │
│  Auto-recovery:                                    │
│  ├─ Crash → Restart w3wp.exe automatically        │
│  ├─ Memory leak → Recycle at threshold            │
│  ├─ Hang → Kill after timeout, start new          │
│  └─ Scheduled → Recycle every 29 hours (default)  │
│                                                    │
│  Rapid-Fail Protection:                            │
│  └─ 5 crashes in 5 min → stop pool, alert admin  │
└────────────────────────────────────────────────────┘
```

Even if the IIS worker crashes, **http.sys keeps listening** and queues requests until the new worker spins up. Zero dropped connections.

---

## 5. SSL/TLS at Kernel Level

```
Normal web server:
  Network → User-mode process → OpenSSL decrypt → Process request
  (2 context switches per request)

IIS with http.sys:
  Network → Kernel SChannel decrypt → Queue decrypted request
  (0 context switches for SSL)
```

The TLS handshake, session resumption, and decryption all happen before app code runs.

---

## 6. Output Caching

IIS can cache responses in **kernel memory**:

```
First request:   /api/submissions → Node.js → 200 JSON → cached
Next 99 requests: /api/submissions → http.sys returns cached response
                  (Node.js never called)
```

For read-heavy endpoints (submission lists that don't change every second), this is a free speed boost.

---

## 7. Full Stack Under Load

```
1000 concurrent users
         │
    http.sys (kernel)
    ├─ SSL: ~10,000 handshakes/sec on modern CPU
    ├─ Queue: absorbs bursts up to 5000 deep
    ├─ Static cache: serves dist/ at ~50,000 req/sec
         │
    IIS w3wp.exe
    ├─ URL Rewrite: pattern match, negligible cost
    ├─ ARR Proxy: forwards ~300 API calls to Node
         │
    Node.js (PM2 fork mode)
    ├─ Express: handles ~300 concurrent API requests
    ├─ Socket.IO: manages WebSocket connections
    ├─ Event loop: async I/O, non-blocking
         │
    PostgreSQL
    └─ Connection pool: 20 connections (pg pool)
       handles ~1000 queries/sec easily
```

---

## 8. ARR Proxy Setup

The ARR (Application Request Routing) module must be enabled for IIS to reverse proxy to Node.js:

```powershell
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
```

Without this, IIS URL Rewrite rules that proxy to the backend will fail silently.

---

## 9. Architecture Diagram

```
User Browser
    │
    ├─ HTTPS (port 443) ──→ IIS (Windows Server)
    │                         │
    │                    ┌────┴──────────────────────┐
    │                    │  web.config Rewrite Rules  │
    │                    │  (ARR reverse proxy)       │
    │                    └────┬──────────────────────┘
    │                         │
    │  Static files        ┌──┴──────────────────────────────┐
    │  from dist/          │                                  │
    │  ─────────────────→ IIS Static Content (HTML, CSS, JS) │
    │                      └──────────────────────────────────┘
    │
    │  API/WebSocket ────→ HTTP (localhost:3001)
    │  (via ARR proxy)     │
    │                      ├─ Express Server (server.js)
    │                      │  ├─ Routes (/api/auth, /api/submissions, etc.)
    │                      │  ├─ Socket.IO (real-time updates)
    │                      │  └─ Static files (/uploads)
    │                      │
    │                      └─ PostgreSQL (localhost:5432)
    │
    └─ Process Manager: PM2
       (fork mode, single instance, 512M memory limit)
```

---

## 10. Why This Architecture Works

| Layer | Responsibility | Handles |
|-------|---------------|---------|
| **http.sys** | SSL, queuing, kernel caching | Thousands of req/sec |
| **IIS w3wp.exe** | URL Rewrite, ARR proxy, static files | Offloads ~70% of requests from Node |
| **Node.js/Express** | API logic, WebSocket, auth | Async I/O, non-blocking |
| **PM2** | Process management, auto-restart | Crash recovery, logging |
| **PostgreSQL** | Data persistence | Connection pooling, ACID transactions |

The bottleneck will be **PostgreSQL connection pool** or **Node.js event loop** long before IIS breaks a sweat. IIS does the heavy lifting (SSL, static files, queuing) so Node.js only handles what it's good at — async API logic and WebSockets.
