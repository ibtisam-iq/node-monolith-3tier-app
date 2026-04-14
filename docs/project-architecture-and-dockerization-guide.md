# Project Architecture & Dockerization Guide

> **Why this document exists:** While migrating this project from two-tier to
> three-tier architecture, a deep investigation of every key file was carried
> out. This document captures every finding, every curiosity, and every
> lesson learned — so that the next time a similar project arrives, you can
> read the code, understand its architecture, and Dockerize it correctly
> without guessing.

---

## 1. The Big Mental Model: Local ≠ Docker

The single most important lesson from this project:

> **Running a project locally and running it via Docker are two completely
> different things. They share the same source code but have entirely
> different runtime environments.**

| Aspect | Local (bare metal) | Docker / Docker Compose |
|---|---|---|
| Node.js | Installed on your Mac | Bundled inside the image |
| MySQL | Installed on your Mac | Runs as a separate container |
| Frontend | Built by Webpack, served by Nginx or Python | Built inside a multi-stage image, served by Nginx container |
| Networking | `localhost` everywhere | Container names resolve as hostnames |
| Config files | Read from your filesystem | Copied into the image at build time |

**Why it matters:** When the project ran fine via Docker Compose but not
locally, it was because Docker was using Nginx to serve the frontend and
proxy API calls — exactly as designed. Locally, none of that infrastructure
existed yet.

---

## 2. Two-Tier vs Three-Tier — How to Tell From the Code

As a DevOps engineer, you will frequently receive a project and need to decide
how to Dockerize it. The answer always comes from reading the code.

### Two-Tier (what this project looked like before migration)

```
Browser → Express (serves BOTH static files AND API) → MySQL
```

**Code signal — `server.js` or `app.js` contains:**
```js
app.use(express.static(path.join(__dirname, '../client/public')));
```
This one line means Express is acting as both the web server (Tier 1) and the
application server (Tier 2). Both tiers are collapsed into a single process.

**Docker consequence:** You only need **one** Dockerfile for the entire
frontend + backend. The frontend is built and its output folder is copied into
the backend image. One container runs everything on one port (e.g., 3000 or
5000).

---

### Three-Tier (what this project is now)

```
Browser → Nginx (Tier 1: static files + reverse proxy)
               → Express API (Tier 2: business logic)
                    → MySQL (Tier 3: data)
```

**Code signal — `app.js` contains NO `express.static()` call.** The comment
in this project's `app.js` makes it explicit:

```js
// ── No static file serving ────────────────────────────────────────────────────
// Express is Tier 2 (Application Layer) only.
// Static file delivery is Tier 1 — handled exclusively by Nginx.
// If you add express.static() here, you are collapsing Tier 1 into Tier 2.
```

**Docker consequence:** You need **two separate Dockerfiles** (or two stages in
Docker Compose) — one for the frontend (multi-stage: build with Node, serve
with Nginx) and one for the backend (Node.js only). Plus a third service for
MySQL.

---

## 3. Key Files and What They Tell You

### 3.1 `server/server.js` — The Entry Point

```js
require('dotenv').config({ path: __dirname + '/../../.env' });
const app  = require('./app');
require('./config/db');
const port = process.env.PORT || 5000;
app.listen(port, () => { ... });
```

**What it tells you:**

- This file is a **bootstrap only** — it loads env, wires up the app, and
  starts listening.
- It has **no routes** and **no SQL** — that is an architectural rule enforced
  by comments.
- The port is `5000` — this is what your backend Docker container must `EXPOSE`
  and what Nginx must `proxy_pass` to.
- The `.env` path goes two levels up (`/../../.env`) — in Docker, you must make
  sure this path resolves correctly, or pass env vars via `docker-compose.yml`.

---

### 3.2 `server/app.js` — Express Configuration

```js
app.use(cors());
app.use(express.json());
app.get('/api/test', ...);
app.use('/api/users', userRoutes);
// NO express.static() → this is confirmed three-tier
```

**What it tells you:**

- All routes are prefixed with `/api/` — this is the exact prefix Nginx must
  match in its `location /api/` block.
- CORS is enabled — during local development the frontend and backend run on
  different ports, so CORS is required. In Docker, Nginx reverse-proxies both
  on port 80, so they share the same origin and CORS becomes irrelevant (but
  harmless).
- **No static file serving** confirms the three-tier separation.

---

### 3.3 `client/package.json` — The Build Commands

```json
"scripts": {
  "start": "webpack --mode development",
  "build": "webpack --mode production"
}
```

**What it tells you:**

- `npm start` is **not** a dev server. It runs Webpack once and produces a
  build. It does **not** start `webpack-dev-server`. This is why you cannot
  open `localhost:3000` after running it locally.
- `npm run build` produces the production-optimised bundle.
- **In the Dockerfile**, you must use `npm run build` (production), not
  `npm start` (development mode build).
- The presence of `react`, `react-dom`, `@babel/preset-react`, and `.babelrc`
  **confirms this is a React project** even though it has no `create-react-app`
  scaffolding. Key identifiers:
  - `.babelrc` with `@babel/preset-react`
  - `react` and `react-dom` in dependencies
  - `webpack.config.js` with `babel-loader`

---

### 3.4 `client/webpack.config.js` — The Build Pipeline

```js
output: {
  filename: 'bundle.js',
  path: path.resolve(__dirname, 'public'),  // ← output folder
  clean: true,
}
plugins: [
  new HtmlWebpackPlugin({ template: './src/index.html', filename: 'index.html' }),
  new MiniCssExtractPlugin({ filename: 'style.css' }),
]
```

**What it tells you:**

- The build output goes to `client/public/` — **not** `dist/`, **not** `build/`.
- Three files are produced: `bundle.js`, `index.html`, `style.css`.
- `clean: true` means the `public/` folder is **deleted and recreated** on
  every build. This is why `public/` does not exist in the repository — it is
  a generated artifact, not source code.
- **In the Dockerfile (multi-stage):** Stage 1 runs `npm run build`. Stage 2
  (Nginx:alpine) copies from `client/public/` — not from `dist/`.
- **For Nginx** (`nginx.conf` / `default.conf`): the `root` directive must
  point to wherever this `public/` folder lands inside the container.

> **Lesson learned:** In the two-tier era, Webpack only produced `bundle.js`
> because `HtmlWebpackPlugin` and `MiniCssExtractPlugin` were not yet added.
> After adding those plugins, `npm run build` started producing `index.html`
> and `style.css` as well — which is what Nginx needs to serve the app.

---

### 3.5 `client/src/api/users.js` — The Critical Routing Clue

```js
// const API_URL = 'http://localhost:5000/api/users'; // Adjust if necessary
const API_URL = '/api/users'; // Removed 'http://localhost:5000'
```

**This one change is what made three-tier work in Docker.** Here is why:

| Value | Works when… | Breaks when… |
|---|---|---|
| `http://localhost:5000/api/users` | Backend and frontend on same machine, different ports (local dev) | Inside Docker — `localhost` inside the browser means the user's machine, not the backend container |
| `/api/users` (relative URL) | Nginx proxies `/api/` to the backend container | Never — relative URLs always go to the current host, which is Nginx on port 80 |

**The flow with relative URL:**
```
Browser fetches /api/users
  → hits Nginx on port 80
  → Nginx matches location /api/
  → proxy_pass to http://localhost:5000/api/
  → Express handles it
  → response flows back
```

**What this tells you for future projects:** When you see a hardcoded
`localhost:PORT` in the frontend API file, that project is designed for
local-only access. To Dockerize it properly, the URL must either be made
relative or replaced with the Nginx proxy path.

---

### 3.6 `nginx/default.conf` — The Traffic Router

```nginx
server {
    listen 80;

    location / {
        root ~/node-monolith-app/client/dist;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:5000/api/;
    }
}
```

**What it tells you:**

- Nginx listens on port **80** — this is the only port the outside world
  needs to access.
- `location /` serves static files (the React build output).
- `location /api/` proxies to Express on port 5000.
- `try_files $uri $uri/ /index.html` enables **client-side routing** — if a
  URL like `/users/42` doesn't match a file, Nginx falls back to `index.html`
  and lets React Router handle it.
- **Note:** The `root` path in this file uses a local filesystem path
  (`~/node-monolith-app/client/dist`). In the Docker image, this path will
  be different — typically `/usr/share/nginx/html`. The Dockerfile's COPY
  command in Stage 2 must match wherever Nginx expects static files.

---

## 4. The Multi-Stage Dockerfile Explained

### Why multi-stage for the frontend?

The frontend needs Node.js only to **build** (compile JSX, bundle JS, extract
CSS). Once built, Node.js is no longer needed. Nginx:alpine is ~20MB vs
Node:alpine's ~180MB. Multi-stage build discards the builder and ships only
what Nginx needs.

### Stage 1 — Build

```dockerfile
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build          # produces client/public/
```

### Stage 2 — Serve

```dockerfile
FROM nginx:alpine
COPY --from=builder /app/public /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

**Key point:** The `COPY --from=builder` path must match `webpack.config.js`
output path (`public/`). If you change the output path in webpack, you must
update the Dockerfile too.

---

### Backend Dockerfile — Why it stays simple

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["node", "server/server.js"]
```

The backend has no build step — Node.js runs the source directly. The port
comes from `server.js` (`process.env.PORT || 5000`).

---

## 5. How to Read Any New Project — Decision Checklist

When you receive a new Node.js project and need to Dockerize it:

**Step 1 — Check `server.js` or `app.js`:**
- Does it have `express.static()`? → **Two-tier.** One Dockerfile covers
  frontend + backend.
- No `express.static()`? → **Three-tier.** Separate Dockerfiles needed.

**Step 2 — Check `client/package.json` scripts:**
- What does `start` do? (`webpack`, `react-scripts start`, `vite`, `next dev`)
- What does `build` do? → This is the command your Dockerfile will call.
- Is there a `webpack-dev-server` or `vite` in devDependencies? → Then
  `start` runs a live dev server. Do **not** use `start` in Docker — always
  use `build`.

**Step 3 — Check `webpack.config.js` (or `vite.config.js`, etc.):**
- What is `output.path`? → This is the folder your Nginx `COPY` must point to.
- What plugins are used? → `HtmlWebpackPlugin` means `index.html` is generated.
  `MiniCssExtractPlugin` means CSS is extracted. Nginx needs all of these.

**Step 4 — Check the frontend API file (`src/api/*.js`):**
- Is the URL relative (`/api/users`) or absolute (`http://localhost:5000/api/users`)?
- Relative → Already Nginx-compatible. No change needed.
- Absolute → Must change to relative, or configure Nginx `proxy_pass` to match.

**Step 5 — Check `server.js` for the port:**
- `process.env.PORT || 5000` → Dockerfile must `EXPOSE 5000`, and Docker
  Compose must map it. Nginx `proxy_pass` must use the same port.

**Step 6 — Check if there is an Nginx config:**
- Exists → Use it as the base for your Docker Nginx config (adjust paths for
  the container filesystem).
- Doesn't exist → Write one. Frontend gets `location /`, API gets
  `location /api/` with `proxy_pass`.

---

## 6. Why Nginx in Three-Tier — The Purpose

Adding Nginx is not cosmetic. Before three-tier, Express was serving both
static files and the API from port 5000. Traffic routing looked like:

```
Browser → Express:5000 (handles everything)
```

This works, but it means Express — an application server — is also doing the
job of a web server. Web servers are optimised for static file delivery; Node
is not.

After three-tier with Nginx:

```
Browser → Nginx:80
              ├── GET /           → serves React build (static, fast)
              └── GET /api/*      → proxy_pass → Express:5000
```

Now Express only handles API logic. Nginx handles static delivery at its
native performance. **If Nginx were added to the two-tier project without
removing `express.static()`, Nginx would have existed but the traffic would
still route directly through Express for everything — Nginx would be
meaningless.**

---

## 7. The `public/` Folder — When and Why It Appears

`client/public/` does not exist in the repository. It is created by running:

```bash
npm run build       # or npm start (development mode)
```

Webpack reads `webpack.config.js`, processes `src/index.js` (the entry
point), and outputs to `output.path` which is `path.resolve(__dirname, 'public')`.

- `bundle.js` → compiled + bundled JavaScript
- `index.html` → generated from `src/index.html` template by HtmlWebpackPlugin
- `style.css` → extracted from all CSS imports by MiniCssExtractPlugin

Before `HtmlWebpackPlugin` was added, Webpack only produced `bundle.js`.
Nginx could not serve the app because there was no `index.html` to root from.
After adding the plugin, `npm run build` started producing the complete set of
files Nginx needs.

> **Rule:** Never commit `public/` (or `dist/`) to Git. It is a build
> artifact. In Docker, it is produced during the image build (Stage 1) and
> copied to the Nginx image (Stage 2).

---

## 8. Summary: Tier Responsibilities

| Tier | Technology | Responsibility | Port |
|---|---|---|---|
| Tier 1 — Presentation | Nginx | Serves static React build, reverse-proxies `/api/` | 80 |
| Tier 2 — Application | Express (Node.js) | REST API, business logic, DB queries | 5000 |
| Tier 3 — Data | MySQL | Persistent storage | 3306 |

Each tier is independent. Each has its own Dockerfile (or service in
`docker-compose.yml`). Each can be scaled, replaced, or updated without
touching the others.
