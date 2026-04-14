# 07 — Local Deployment Guide

> **Context:** This document covers how to run the fully refactored 3-tier application
> on a local development machine — no Docker, no cloud. Pure bare-metal local setup.
> It is the practical companion to the architecture theory in `01-architecture-theory.md`.

---

## Table of Contents

1. [Architecture Recap](#1-architecture-recap)
2. [Prerequisites](#2-prerequisites)
3. [Project Structure Reference](#3-project-structure-reference)
4. [Tier 3 — Database Setup (MySQL)](#4-tier-3--database-setup-mysql)
5. [Tier 2 — Backend Setup (Express)](#5-tier-2--backend-setup-express)
6. [Tier 1 — Frontend Build (Webpack)](#6-tier-1--frontend-build-webpack)
7. [Tier 1 — Static File Server (Nginx)](#7-tier-1--static-file-server-nginx)
8. [Accessing the Application](#8-accessing-the-application)
9. [Why Express Does NOT Serve the Frontend](#9-why-express-does-not-serve-the-frontend)
10. [Common Mistakes & Fixes](#10-common-mistakes--fixes)
11. [Quick Reference — All Commands](#11-quick-reference--all-commands)

---

## 1. Architecture Recap

This application is a **3-tier architecture**. Each tier has a single, non-overlapping responsibility:

```
┌─────────────────────────────────────────────────┐
│  TIER 1 — Presentation Layer                    │
│  Nginx  →  serves client/public/ (static files) │
│  Browser accesses:  http://localhost             │
└──────────────────────┬──────────────────────────┘
                       │ /api/* requests proxied
┌──────────────────────▼──────────────────────────┐
│  TIER 2 — Application Layer                     │
│  Node.js / Express  →  handles API logic        │
│  Listens on:  http://localhost:5000              │
└──────────────────────┬──────────────────────────┘
                       │ SQL queries
┌──────────────────────▼──────────────────────────┐
│  TIER 3 — Data Layer                            │
│  MySQL  →  stores and retrieves data            │
│  Listens on:  localhost:3306                     │
└─────────────────────────────────────────────────┘
```

**Key principle:** Nginx owns static file delivery. Express owns API logic only.
These two concerns must never be mixed into the same process.

---

## 2. Prerequisites

| Requirement | Version | Check Command |
|---|---|---|
| Node.js | ≥ 18.x | `node --version` |
| npm | ≥ 9.x | `npm --version` |
| MySQL | ≥ 8.0 | `mysql --version` |
| Nginx | any stable | `nginx -v` |

### Install MySQL (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install mysql-server -y
sudo systemctl start mysql
sudo systemctl enable mysql
```

### Install Nginx (Ubuntu/Debian)

```bash
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

---

## 3. Project Structure Reference

```
node-monolith-app/
├── .env.example          ← copy this to .env and fill in your values
├── client/
│   ├── src/              ← React source files (index.js, components, CSS)
│   ├── public/           ← Webpack OUTPUT folder (auto-generated, do not edit)
│   │   ├── index.html
│   │   ├── bundle.js
│   │   └── style.css
│   ├── webpack.config.js ← builds src/ → public/
│   └── package.json
├── server/
│   ├── server.js         ← entry point: loads env, starts Express
│   ├── app.js            ← Express config: middleware + API routes (NO static serving)
│   ├── config/
│   │   └── db.js         ← MySQL pool initialisation
│   └── routes/
│       └── userRoutes.js ← GET/POST/PUT/DELETE /api/users
├── database/
│   └── *.sql             ← schema and seed files
├── nginx/
│   └── nginx.conf        ← reference Nginx config for this project
└── docs/
    └── migration/        ← all architecture documentation
```

---

## 4. Tier 3 — Database Setup (MySQL)

### Step 1 — Create the database and user

```bash
sudo mysql -u root
```

```sql
CREATE DATABASE IF NOT EXISTS node_app_db;
CREATE USER IF NOT EXISTS 'node_user'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON node_app_db.* TO 'node_user'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### Step 2 — Run schema / seed SQL

```bash
mysql -u node_user -p node_app_db < database/schema.sql
# If a seed file exists:
mysql -u node_user -p node_app_db < database/seed.sql
```

### Step 3 — Verify

```bash
mysql -u node_user -p -e "SHOW TABLES IN node_app_db;"
```

---

## 5. Tier 2 — Backend Setup (Express)

### Step 1 — Create your `.env` file

```bash
cp .env.example .env
nano .env
```

Fill in the values:

```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=node_user
DB_PASSWORD=yourpassword
DB_NAME=node_app_db
```

> **Note:** `server.js` loads the `.env` from two levels up (`__dirname + '/../../.env'`).
> Always place `.env` in the **project root**, not inside `server/`.

### Step 2 — Install backend dependencies

```bash
# From project root
npm install
```

### Step 3 — Start Express

```bash
node server/server.js
```

**Expected output:**

```
Server running at http://localhost:5000
Database pool connected successfully.
```

### Step 4 — Verify the API

```bash
curl http://localhost:5000/api/test
# Expected: {"message":"API is working!"}

curl http://localhost:5000/api/users
# Expected: JSON array of users (or empty array if DB is empty)
```

---

## 6. Tier 1 — Frontend Build (Webpack)

### Understanding `npm start` in the client

The `client/package.json` defines:

```json
"start": "webpack --mode development"
```

This command **compiles** the source files — it is **not** a live dev server.
Running it produces static files in `client/public/`:

```
client/public/
├── index.html   ← generated from src/index.html template
├── bundle.js    ← all JS compiled and bundled
└── style.css    ← extracted CSS
```

### Step 1 — Install frontend dependencies

```bash
cd client
npm install
```

### Step 2 — Build the frontend

```bash
npm start
# Or equivalently:
# npx webpack --mode development
```

**Expected output:**

```
asset bundle.js ...
asset index.html ...
asset style.css ...
webpack compiled successfully
```

### Step 3 — Verify the output

```bash
ls client/public/
# Should show: index.html  bundle.js  style.css
```

> **Important:** The `client/public/` folder is auto-generated and cleaned before every
> build (`clean: true` in `webpack.config.js`). Never manually edit files inside it.

### Optional — Production build

```bash
npx webpack --mode production
```

This minifies and optimises the output. Use for staging/production deployments.

---

## 7. Tier 1 — Static File Server (Nginx)

Nginx's job is to serve the built files from `client/public/` and proxy all `/api/*`
requests upstream to the Express server on port 5000.

### Step 1 — Create the Nginx site config

```bash
sudo nano /etc/nginx/sites-available/node-monolith-app
```

Paste the following (replace the `root` path with your actual project path):

```nginx
server {
    listen 80;
    server_name localhost;

    # Serve the compiled frontend from Webpack output
    root /home/<your-username>/node-monolith-app/client/public;
    index index.html;

    # SPA fallback: send all non-file requests to index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy all /api/* requests to the Express backend
    location /api/ {
        proxy_pass         http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   Connection        '';
    }
}
```

> A reference config is also available at `nginx/nginx.conf` in this repository.

### Step 2 — Enable the site

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/node-monolith-app \
           /etc/nginx/sites-enabled/node-monolith-app

# Disable the default placeholder site (optional but recommended)
sudo rm -f /etc/nginx/sites-enabled/default
```

### Step 3 — Test and reload Nginx

```bash
sudo nginx -t
# Expected: syntax is ok / test is successful

sudo systemctl reload nginx
```

### Step 4 — Verify Nginx is running

```bash
sudo systemctl status nginx
curl -I http://localhost
# Expected: HTTP/1.1 200 OK
```

---

## 8. Accessing the Application

Once all three tiers are running:

| URL | What you get |
|---|---|
| `http://localhost` | Frontend (served by Nginx from `client/public/`) |
| `http://localhost/api/test` | Backend health check (proxied by Nginx → Express) |
| `http://localhost/api/users` | Users API endpoint |
| `http://localhost:5000/api/test` | Direct Express access (bypass Nginx) |

**Normal user flow:** Browser → `http://localhost` → Nginx → serves `index.html` + `bundle.js`.
When the JS app calls `/api/users`, Nginx proxies that request to Express on port 5000.
Express queries MySQL and returns JSON. The browser never talks to Express or MySQL directly.

---

## 9. Why Express Does NOT Serve the Frontend

This is the most common question when first reading `server/app.js`.

The file contains this comment:

```js
// It does NOT serve static files — Nginx owns that (see nginx/nginx.conf).
```

There is deliberately **no** `app.use(express.static(...))` in `app.js`.

### The architectural reason

| Concern | Owner | Why |
|---|---|---|
| Static file delivery (HTML, JS, CSS, images) | **Nginx** | Purpose-built for high-speed static serving; handles caching, compression, and connection management far more efficiently than Node.js |
| API business logic | **Express** | Node.js event loop is optimised for I/O-bound async work, not file serving |
| Data persistence | **MySQL** | Relational storage with ACID guarantees |

Mixing static file serving into Express would:
- Collapse Tier 1 into Tier 2 (violating the 3-tier boundary)
- Force every static file request through the Node.js event loop
- Make the backend harder to scale independently of the frontend

If you are prototyping and genuinely need a zero-config local setup without Nginx,
you *could* temporarily add:

```js
// TEMPORARY — not for production, violates 3-tier architecture
app.use(express.static(path.join(__dirname, '../client/public')));
```

But remove it before any deployment. The Nginx path is the correct architecture for
this project.

---

## 10. Common Mistakes & Fixes

### `npm start` in `client/` shows no output / exits immediately

This is expected. `npm start` runs `webpack --mode development`, which is a **one-shot
build command**, not a server. It compiles and exits. Check `client/public/` for output.

### Frontend loads but API calls return 502 Bad Gateway

Express is not running, or it crashed.

```bash
node server/server.js
# Check for errors in the output
```

### `Database pool connected successfully` does not appear

The `.env` file is missing or has wrong credentials.

```bash
cat .env                      # verify the file exists in project root
mysql -u node_user -p         # verify the MySQL user can connect
```

### Nginx returns 403 Forbidden

The `root` path in the Nginx config is wrong, or Nginx does not have read permission
on `client/public/`.

```bash
# Verify the path exists
ls /home/<your-username>/node-monolith-app/client/public/

# Check permissions (Nginx runs as www-data)
sudo chmod o+rx /home/<your-username>/
sudo chmod -R o+rx /home/<your-username>/node-monolith-app/client/public/
```

### Nginx returns 404 for all routes except `/`

The `try_files $uri $uri/ /index.html;` line is missing from the Nginx config.
This directive is required for Single Page Applications that use client-side routing.

### Port 80 already in use

```bash
sudo lsof -i :80
# Kill the conflicting process or change Nginx to listen on a different port (e.g. 8080)
```

---

## 11. Quick Reference — All Commands

```bash
# ── Tier 3: MySQL ─────────────────────────────────────────────────────────────
sudo systemctl start mysql
mysql -u node_user -p node_app_db < database/schema.sql

# ── Tier 2: Express ───────────────────────────────────────────────────────────
cp .env.example .env          # first time only
npm install                   # from project root
node server/server.js         # keep this terminal open

# ── Tier 1: Webpack (build frontend) ─────────────────────────────────────────
cd client
npm install                   # first time only
npm start                     # builds → client/public/
cd ..

# ── Tier 1: Nginx (serve frontend + proxy API) ───────────────────────────────
sudo nginx -t
sudo systemctl reload nginx

# ── Verify everything ─────────────────────────────────────────────────────────
curl http://localhost                    # frontend (200 OK)
curl http://localhost/api/test           # API via Nginx proxy
curl http://localhost:5000/api/test      # API direct to Express
```

---

*This document covers local bare-metal deployment only.*
*For Docker-based deployment, see the upcoming `08-docker-deployment.md`.*
*For production/cloud deployment, see `nginx/nginx.conf` and the project README.*
