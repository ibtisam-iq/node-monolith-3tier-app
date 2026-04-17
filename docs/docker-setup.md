# How to Dockerize a Node.js 3-Tier Application

This document explains **every decision** behind `Dockerfile.client`,
`Dockerfile.server`, and `compose.yml` in this project — not just what each
line does, but **why it was written that way**, what the alternatives were,
why they were rejected, and what breaks if you get it wrong.

This is a **reusable framework** for Dockerizing any three-tier Node.js
application where a frontend (React/Webpack) is served by Nginx and a backend
(Express) handles API logic separately from static delivery.

---

## Step 0 — Why Three Docker Files Instead of One?

This is the first decision — and the most important one. Before writing any
Dockerfile, you must answer: **how many containers does this application need?**

The answer comes from reading the architecture (see `understand-architecture.md`),
specifically two signals:

| Signal | File to read | Finding for this project |
|---|---|---|
| Does Express serve static files? | `server/app.js` | **No** — no `express.static()` |
| Who serves the frontend? | `nginx/docker.conf` | **Nginx** — separate process |

**The conclusion:** Three-tier = three independent services = three containers
= **two Dockerfiles + one compose.yml**.

| File | Purpose | What it produces |
|---|---|---|
| `Dockerfile.client` | Build React app with Node, serve with Nginx | `node-monolith-3tier-app-client` image |
| `Dockerfile.server` | Install server deps, run Express | `node-monolith-3tier-app-server` image |
| `compose.yml` | Wire all three services together | Running stack: nginx + server + mysql |

> **Contrast with two-tier:** In the two-tier project, one Dockerfile handled
> both the React build AND the Express runtime in a single image. That worked
> because `express.static()` meant Express served the frontend too. Here,
> Nginx and Express are completely separate processes — they must live in
> separate containers, built from separate Dockerfiles.

---

## The `Dockerfile.client` — Every Decision Explained

### Why Two Stages?

The frontend needs Node.js **only to compile** (Webpack + Babel). Once
`bundle.js`, `index.html`, and `style.css` are produced, Node.js is
completely useless for serving them. Nginx was purpose-built for static
file delivery.

| Stage | Base image | Job | What it produces |
|---|---|---|---|
| 1 — `client-build` | `node:22-alpine` | `npm install` + `npm run build` (Webpack) | `client/public/` (bundle.js, index.html, style.css) |
| 2 — `runtime` | `nginx:alpine` | Copy build output + Nginx config | Final ~25MB serving image |

**Image size comparison:**

| Approach | Final image size | Contains |
|---|---|---|
| Single stage (node:22-alpine) | ~180MB | Node.js, npm, Webpack, all devDeps, source code |
| Multi-stage (nginx:alpine) | ~25MB | Nginx binary + compiled static files only |

The final image has **zero Node.js, zero Webpack, zero npm**. Only Nginx and
three static files.

---

### Stage 1 — Client Build

```dockerfile
FROM node:22-alpine AS client-build
```

**`node:22-alpine`** — Node 22 is the current LTS (supported until April 2027).
Node 18 reached End of Life in April 2025. Alpine minimises the builder image
size, which reduces CI pull times even though this stage does not affect the
final image size.

---

```dockerfile
WORKDIR /app/client
```

Sets the working directory for this stage. All `COPY` and `RUN` instructions
that follow are relative to `/app/client`. The path mirrors the repo structure
(`client/` at the root), making COPY paths intuitive.

---

```dockerfile
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build
```

**Layer caching — why `package.json` is copied before source:**

```
Layer 1: FROM node:22-alpine           ← cached forever
Layer 2: WORKDIR                       ← cached forever
Layer 3: COPY client/package.json .    ← invalidated only if package.json changes
Layer 4: RUN npm install               ← re-runs only when package.json changes (~1-2 min)
Layer 5: COPY client/ ./               ← invalidated on ANY client source change
Layer 6: RUN npm run build             ← re-runs on ANY client source change (~10-15s)
```

**Result:** When you change React component code (the common case), only
Layers 5 and 6 re-run. All `node_modules` are served from cache. Build time
drops from 2+ minutes to ~15 seconds.

> **What if you did `COPY client/ ./` before `npm install`?** Every single
> React code change would re-run `npm install` — re-downloading all Webpack
> and Babel packages from the internet on every build. Catastrophic for CI.

**`RUN npm run build`** — Executes `webpack --mode production` (defined in
`client/package.json`). Webpack reads `webpack.config.js`, processes
`src/index.js` through Babel and CSS loaders, and writes output to
`client/public/`. The three output files are:
- `bundle.js` — compiled + minified JavaScript
- `index.html` — generated from `src/index.html` by `HtmlWebpackPlugin`
- `style.css` — extracted from CSS imports by `MiniCssExtractPlugin`

---

### Stage 2 — Nginx Runtime

```dockerfile
FROM nginx:alpine AS runtime
```

Fresh start. No Node.js. `nginx:alpine` is ~20MB. The entire Node.js build
toolchain from Stage 1 is discarded — it does not exist in this image.

---

```dockerfile
LABEL org.opencontainers.image.title="NodeApp-Client" \
      org.opencontainers.image.description="React Frontend served by Nginx — Tier 1 of 3-Tier User Management App" \
      org.opencontainers.image.authors="Muhammad Ibtisam Iqbal <github.com/ibtisam-iq>" \
      org.opencontainers.image.source="https://github.com/ibtisam-iq/node-monolith-3tier-app" \
      org.opencontainers.image.licenses="MIT"
```

OCI standard metadata. Visible in `docker inspect`, Docker Hub, GitHub
Container Registry, and security scanners like Trivy. No runtime impact.

---

```dockerfile
COPY --from=client-build /app/client/public /usr/share/nginx/html
```

**Copies the compiled React build from Stage 1 into Nginx's default static
content directory.**

- Source: `/app/client/public` (Stage 1 output) — must match `output.path`
  in `webpack.config.js` (`path.resolve(__dirname, 'public')`)
- Destination: `/usr/share/nginx/html` — Nginx's default `root` directory.
  When Nginx receives `GET /`, it serves files from here.

> **If `output.path` in `webpack.config.js` ever changes** (e.g., to `dist/`),
> this COPY path must be updated to match. The Dockerfile and webpack config
> are coupled on this path.

---

```dockerfile
COPY nginx/docker.conf /etc/nginx/conf.d/default.conf
```

**Why `docker.conf` and not `default.conf` from the repo?**

The repo contains two Nginx config files:

| File | Purpose | `proxy_pass` target |
|---|---|---|
| `nginx/default.conf` | Local bare-metal use | `http://localhost:5000` |
| `nginx/docker.conf` | Docker Compose use | `http://server:5000` |

Inside a Docker container, `localhost` refers to the **Nginx container itself**
— not the Express container. The correct hostname in Docker Compose is the
**service name** — `server`. Docker's internal DNS resolves `server` to the
Express container's IP on `app-network`.

Using `default.conf` in Docker would cause all proxied API calls to fail with
`Connection refused` — Nginx would try to connect to port 5000 on itself.

This file replaces Nginx's default `/etc/nginx/conf.d/default.conf`,
overriding the built-in "Welcome to Nginx" page with our application config.

---

```dockerfile
EXPOSE 80
```

Documents that this container listens on port 80. This is the only port the
outside world ever touches — all traffic (static files + API) flows through
Nginx. In `compose.yml`, only this service has a `ports:` mapping.

---

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:80/ || exit 1
```

**Why `start_period: 20s` (shorter than the server's 40s)?**

Nginx starts in under 1 second — there is no database connection, no npm
startup, no framework initialization. The 20s grace period is generous but
reflects that `depends_on: condition: service_healthy` on the `server`
service already guarantees Express is ready before Nginx starts. Nginx only
needs time to load its own config.

**Why `CMD` (shell form) and not exec form `["CMD", ...]` here?**

The healthcheck URL is `http://localhost:80/` — no shell variable expansion
needed. Either form works. Shell form is slightly more readable and consistent
with how we write it in `compose.yml`.

**Why `wget` and not `curl`?** `nginx:alpine` does not include `curl`.
`wget` is available by default.

| Parameter | Value | Reason |
|---|---|---|
| `--interval=30s` | Check every 30 seconds | Standard monitoring cadence |
| `--timeout=10s` | Fail if no response in 10s | Generous for a local HTTP ping |
| `--start-period=20s` | Grace period after start | Nginx starts almost instantly |
| `--retries=3` | 3 failures = unhealthy | One bad check should not kill the container |

---

```dockerfile
# Default CMD inherited from nginx:alpine: ["nginx", "-g", "daemon off;"]
```

No `CMD` or `ENTRYPOINT` override needed. The `nginx:alpine` base image
already defines the correct entrypoint. Overriding it would be redundant.

> **Contrast with `Dockerfile.server`:** The server image uses an explicit
> `ENTRYPOINT ["node", "server/server.js"]` because there is no base image
> default to rely on. The nginx base image already knows how to start Nginx.

---

## The `Dockerfile.server` — Every Decision Explained

### Why Two Stages?

The backend has **no frontend build step** — Node.js runs the source directly.
But a two-stage approach is still used, for a different reason: to install
**production-only dependencies** in isolation before assembling the final image.

| Stage | Base image | Job | What it produces |
|---|---|---|---|
| 1 — `server-deps` | `node:22-alpine` | `npm install --omit=dev` | `server/node_modules/` (production only) |
| 2 — `runtime` | `node:22-alpine` | Assemble final image | Lean production image |

**Why not just `npm install --omit=dev` in the runtime stage?**

Installing in a separate stage keeps the dependency cache independent from
the source code layer. If you add a devDependency to `server/package.json`,
it does not affect the runtime stage's `node_modules` cache layer. The
separation also makes the Dockerfile's intent explicit — deps are a build
artifact, not part of the runtime assembly.

---

### Stage 1 — Server Dependencies

```dockerfile
FROM node:22-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev
```

Same layer caching pattern as `Dockerfile.client` Stage 1: copy
`package.json` first, install, then (in Stage 2) copy source. This way,
`npm install` only re-runs when `server/package.json` changes.

**`--omit=dev`** — Equivalent to the old `--production` flag. Skips all
`devDependencies`. The server runtime only needs: `express`, `mysql2`,
`cors`, `dotenv`, `body-parser`. It does not need test frameworks, linters,
or type checkers.

**`WORKDIR /app/server`** — Scoped to the server subdirectory inside this
stage. The `node_modules` lands at `/app/server/node_modules`, which is then
copied into the runtime stage at the same path.

---

### Stage 2 — Runtime

```dockerfile
FROM node:22-alpine AS runtime
```

Fresh Alpine start. No devDependencies. No build tools from Stage 1.

---

```dockerfile
LABEL org.opencontainers.image.title="NodeApp-Server" \
      ...
```

Same OCI metadata pattern as `Dockerfile.client`. The `title` and
`description` fields identify this as Tier 2 specifically.

---

```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
```

**Why create a non-root user?**

By default, Docker containers run as `root` (UID 0). This is a critical
security vulnerability:

1. **Trivy flags it** as HIGH or CRITICAL in security scans
2. **Kubernetes rejects it** under `PodSecurityAdmission` (restricted policy)
   — production clusters enforce `runAsNonRoot: true`
3. **Container escape risk** — if an attacker breaks out, they land as root on the host

`-S` = system account — no home directory, no login shell, no password.

> **Alpine vs Debian syntax:** Alpine uses `addgroup` / `adduser`. Debian/Ubuntu
> images use `groupadd` / `useradd`. This matters when switching base images.

---

```dockerfile
WORKDIR /app
```

Working directory for the runtime container. All subsequent paths are
relative to `/app`.

---

```dockerfile
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/ ./server/
```

**The assembly step — pulling from Stage 1:**

```
From server-deps stage:  /app/server/node_modules  →  /app/server/node_modules
From host (build context): server/                 →  /app/server/
```

**Order matters for caching:**
- `node_modules` is copied first — large, rarely changes
- Server source code is copied second — changes frequently, but only
  invalidates layers below it (of which there are none after this point)

**Why copy `node_modules` from `server-deps` instead of running `npm install` again?**

Running `npm install` in the runtime stage would re-download all packages
from the internet every time the image is rebuilt. Copying from Stage 1 uses
already-installed packages — no network, no npm registry, deterministic and fast.

---

```dockerfile
RUN chown -R appuser:appgroup /app
USER appuser
```

**The order here is mandatory:**

```
Step 1: chown — runs as root, sets ownership of /app tree to appuser
Step 2: USER  — switches to appuser; from here everything runs as appuser
```

If `USER appuser` came **before** `chown`, the `chown` command would run
as `appuser` who has no permission to change file ownership. It would fail
with `Permission denied`.

**`chown -R`** — Recursive because the directory tree spans `server/` source
files and `server/node_modules/`. Every file under `/app` must be readable
by `appuser`.

---

```dockerfile
ARG PORT=5000
ENV PORT=${PORT}
EXPOSE ${PORT}
```

**Why `ARG` + `ENV` + `EXPOSE ${PORT}` instead of `EXPOSE 5000`?**

- `ARG PORT=5000` — build-time argument with default 5000. Override with
  `docker build --build-arg PORT=8080`.
- `ENV PORT=${PORT}` — promotes the ARG into a runtime environment variable.
  The running container always has `PORT` set.
- `EXPOSE ${PORT}` — documents the actual port dynamically. If `PORT` ever
  changes, `EXPOSE` stays in sync automatically.

Port `5000` comes from `process.env.PORT || 5000` in `server/server.js`.

---

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-5000}/api/test || exit 1
```

**Why `/api/test` and not `/`?**

Unlike the two-tier project where `GET /` returned `index.html` (a valid 200),
this Express server has **no static file serving**. `GET /` would return 404.
`/api/test` is the explicit lightweight health route defined in `server/app.js`:
```js
app.get('/api/test', (req, res) => res.json({ status: 'UP' }));
```
This returns HTTP 200 only when Express is fully initialized — semantically
correct for a health endpoint.

**Why `CMD` (shell form) here?**

`${PORT:-5000}` requires shell variable expansion. The `HEALTHCHECK` instruction's
`CMD` keyword in shell form is executed via `/bin/sh -c`, enabling `${}` expansion.
The exec form `["CMD", "wget", ..., "${PORT:-5000}"]` would pass the literal
string `${PORT:-5000}` to wget — variable NOT expanded, healthcheck always fails.

**`start_period: 40s`** — Node.js starts in seconds, but MySQL connection
initialization via `mysql.createConnection()` in `server/config/db.js` adds
time. 40s covers the worst-case cold start including MySQL becoming healthy
and the connection pool being established.

---

```dockerfile
ENTRYPOINT ["node", "server/server.js"]
```

**`ENTRYPOINT` vs `CMD`:**

| | `ENTRYPOINT` | `CMD` |
|---|---|---|
| Override requires | `--entrypoint` flag (explicit) | Any argument to `docker run` (accidental) |
| PID 1 in exec form | Yes — Node.js is PID 1 | Yes — Node.js is PID 1 |
| Best for | Single-purpose containers | Containers with switchable commands |

This container has one job: run the Express server. `ENTRYPOINT` enforces that.

**Exec form vs shell form:**

Shell form (`node server/server.js`) runs as `/bin/sh -c "node ..."` — the
shell becomes PID 1, Node.js is PID 2. When Docker sends `SIGTERM` on
`docker stop`, it goes to PID 1 (the shell). Alpine's `sh` does not forward
signals to child processes. Node.js never receives `SIGTERM`, Docker waits
the full 10s timeout, then sends `SIGKILL` — no graceful shutdown.

Exec form runs `node` directly as PID 1. `SIGTERM` goes straight to Node.js.

**`server/server.js` path** — `WORKDIR` is `/app`. Entry point is at
`/app/server/server.js`. The relative path `server/server.js` is correct.

---

## The `compose.yml` — Every Decision Explained

### `name: nodeapp`

```yaml
name: nodeapp
```

Explicit Compose project name. Without this, Docker Compose uses the
**directory name** as the project prefix — which varies by machine
(`node-monolith-3tier-app`, `app`, `project`, etc.). With `name: nodeapp`,
all containers, networks, and volumes are always prefixed `nodeapp-` on
any machine.

---

### The `mysql` service

```yaml
mysql:
  image: mysql:8.4
```

**`mysql:8.4` vs `mysql:8`:**

`mysql:8` is a floating tag — it resolves to whatever 8.x is latest at pull
time. In April 2026, MySQL 8.0 reached End of Life. `mysql:8` could resolve
to EOL 8.0 on some machines. `mysql:8.4` pins to the current LTS — explicit,
reproducible, and future-safe.

---

```yaml
  env_file: .env
  environment:
    MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
    MYSQL_DATABASE: ${MYSQL_DATABASE}
    MYSQL_USER: ${MYSQL_USER}
    MYSQL_PASSWORD: ${MYSQL_PASSWORD}
```

**Understanding `env_file` vs `environment`:**

`env_file: .env` loads **every** `KEY=VALUE` from `.env` and injects all of
them into the container automatically. The four variables under `environment:`
are already injected by `env_file` — they are listed here **for documentation
only**, to make explicit which four variables `mysql:8.4` requires for
database initialization.

In a minimal production compose file you would remove the `environment:` block
and keep only `env_file: .env`.

**What MySQL does with these variables on first start:**

| Variable | MySQL action |
|---|---|
| `MYSQL_ROOT_PASSWORD` | Sets the root password |
| `MYSQL_DATABASE` | Creates this database automatically |
| `MYSQL_USER` | Creates this application user |
| `MYSQL_PASSWORD` | Sets the password for `MYSQL_USER` |

> **Important:** These variables are only read on **first startup** when
> `/var/lib/mysql` is empty. Changing them after the volume is initialized
> has no effect until you run `docker compose down -v`.

---

```yaml
  volumes:
    - mysql-data:/var/lib/mysql
    - ./database/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
```

**`mysql-data:/var/lib/mysql`** — MySQL stores all data in `/var/lib/mysql`.
Without a volume, all data is destroyed on `docker compose down`. Named
volumes persist. Only `docker compose down -v` destroys them.

**`./database/init.sql:/docker-entrypoint-initdb.d/init.sql:ro`** — MySQL
automatically executes `.sql` files in `/docker-entrypoint-initdb.d/` on
first startup. This creates the `users` table automatically — no manual
`mysql` commands required. `:ro` prevents the container from modifying
the source schema file.

---

```yaml
  healthcheck:
    test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${MYSQL_ROOT_PASSWORD}"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
```

**`-h localhost` — and the critical mistake it avoids:**

A common mistake is `-h mysql` (using the Compose service name). This is
wrong. `mysql` resolves to the MySQL container's IP **from other containers
on the network**. But this healthcheck runs **inside the MySQL container
itself** — where `mysql` is not a valid hostname. The correct hostname is
`localhost`.

```
❌ -h mysql      → "Unknown MySQL server host 'mysql'" — healthcheck always fails
✅ -h localhost  → correct — connects to the local MySQL server inside the container
```

If the healthcheck always fails, `depends_on: condition: service_healthy`
on the `server` service means the Express container **never starts**.

---

### The `server` service

```yaml
server:
  build:
    context: .
    dockerfile: Dockerfile.server
  image: node-monolith-3tier-app-server
```

**`image: node-monolith-3tier-app-server`** — Explicit image name. Without
this, the image is named `nodeapp-server` (project + service). Explicit name
enables `docker push node-monolith-3tier-app-server` directly without
re-tagging.

---

```yaml
  env_file: .env
  environment:
    DB_HOST: mysql
```

**This is the single most important override in the entire compose file.**

`env_file: .env` loads all variables — including `DB_HOST=localhost`.
`localhost` is correct for bare-metal (MySQL on the same machine). But inside
the `server` container, `localhost` is the `server` container itself — nothing
is listening on port 3306 there. The connection fails immediately.

The correct hostname is the **Compose service name** — `mysql`. Docker's
internal DNS resolves it to the MySQL container's IP on `app-network`.

```
Outside Docker:   server → localhost:3306   (MySQL on same machine)
Inside Compose:   server → mysql:3306       (MySQL container by service name)
```

The `environment:` override replaces the `localhost` from `.env` with `mysql`
— only for the Compose environment. The `.env` file stays unchanged so
bare-metal development still works.

**The rule:**
- `env_file` loads everything from `.env` automatically
- `environment:` is only needed when a `.env` value is **wrong for Docker**
  and needs to be overridden
- Never re-list `env_file` variables under `environment:` just because they
  came from `env_file` — that is redundant noise

---

```yaml
  expose:
    - "${PORT:-5000}"
```

**`expose:` vs `ports:` — a critical three-tier distinction:**

| Directive | What it does | When to use |
|---|---|---|
| `ports: "5000:5000"` | Maps host port → container port. Accessible from the host machine. | Use for the single public entry point only (Nginx on port 80) |
| `expose: "5000"` | Makes the port accessible within the Docker network only. Host cannot reach it. | Use for internal services (Express, MySQL) |

In three-tier architecture, **only Nginx (Tier 1) is exposed to the host**.
Express (Tier 2) and MySQL (Tier 3) are internal. If you added
`ports: "5000:5000"` on the `server` service, the API would be directly
accessible from the host — bypassing Nginx entirely and breaking the security
model.

> **Contrast with two-tier:** In the two-tier `compose.yml`, the `app` service
> used `ports: "${PORT:-5000}:${PORT:-5000}"` because Express was the public
> entry point. Here, Nginx is the entry point — Express must not be exposed.

---

```yaml
  depends_on:
    mysql:
      condition: service_healthy
```

`depends_on: mysql` (no condition) only waits for the MySQL **container to
start** — not for MySQL to be ready. MySQL initializes for 15-30 seconds
after the container starts. Without `condition: service_healthy`, Express
fires `mysql.createConnection()` before MySQL accepts connections, fails,
and calls `process.exit(1)` — crashing the container.

`condition: service_healthy` waits for `mysqladmin ping` to succeed — that
only happens when MySQL is fully initialized and accepting connections.

---

### The `nginx` service

```yaml
nginx:
  build:
    context: .
    dockerfile: Dockerfile.client
  image: node-monolith-3tier-app-client
```

Uses `Dockerfile.client` to build the React app and produce the Nginx image.
The `image:` name enables direct registry push.

---

```yaml
  ports:
    - "80:80"
```

**Port 80 is the ONLY port exposed to the host.** This is the single entry
point for all traffic:
- `GET /` → Nginx serves static files from `/usr/share/nginx/html`
- `GET /api/*` → Nginx proxies to `server:5000`

MySQL (3306) and Express (5000) are never mapped to host ports — internal only.

---

```yaml
  depends_on:
    server:
      condition: service_healthy
```

Nginx is the final layer — it proxies to Express. If Express is not ready
when Nginx starts, early API calls proxied by Nginx would fail. Waiting for
`service_healthy` ensures the Express healthcheck (`/api/test` returning 200)
has passed before Nginx begins accepting traffic.

The full startup order enforced by `depends_on` chains:

```
mysql starts → healthcheck passes
  → server starts → healthcheck passes (Express + DB connection ready)
    → nginx starts → healthcheck passes (static files + proxy ready)
      → Stack is fully healthy
```

---

```yaml
networks:
  app-network:
    driver: bridge

volumes:
  mysql-data:
```

**`app-network`** — An explicit named bridge network. Without this, Compose
creates a default network automatically, but the explicit declaration makes
the intent clear and allows fine-grained configuration if needed.

**`volumes: mysql-data:`** — Top-level declaration required. Without it, the
`mysql-data:` reference in the `mysql` service fails with a validation error.

---

## How the Three Files Work Together — End to End

```
docker compose up --build
        │
        ├── Reads compose.yml
        │
        ├── Builds Dockerfile.client → image: node-monolith-3tier-app-client
        │       Stage 1 (node:22-alpine AS client-build):
        │         COPY client/package.json → npm install (cached)
        │         COPY client/ → npm run build (Webpack)
        │         Output: client/public/ (bundle.js, index.html, style.css)
        │
        │       Stage 2 (nginx:alpine AS runtime):
        │         COPY --from=client-build → /usr/share/nginx/html
        │         COPY nginx/docker.conf → /etc/nginx/conf.d/default.conf
        │         EXPOSE 80
        │
        ├── Builds Dockerfile.server → image: node-monolith-3tier-app-server
        │       Stage 1 (node:22-alpine AS server-deps):
        │         COPY server/package.json → npm install --omit=dev
        │         Output: server/node_modules/ (production only)
        │
        │       Stage 2 (node:22-alpine AS runtime):
        │         Non-root user created (appuser:appgroup)
        │         server/node_modules/ copied from Stage 1
        │         server/ source code copied from host
        │         ARG PORT=5000 → ENV PORT=5000 → EXPOSE 5000
        │
        ├── Starts mysql (mysql:8.4)
        │       Reads MYSQL_* from .env → creates DB + user on first start
        │       Executes database/init.sql → creates users table
        │       Healthcheck: mysqladmin ping -h localhost
        │       Status: starting → healthy (~20-30s)
        │
        ├── Waits for mysql healthcheck (condition: service_healthy)
        │
        ├── Starts server (node-monolith-3tier-app-server)
        │       Reads ALL variables from .env
        │       DB_HOST overridden to "mysql"
        │       Node.js connects to MySQL → Express starts on port 5000
        │       Healthcheck: wget http://localhost:5000/api/test → 200
        │       Status: starting → healthy (~5-10s after MySQL ready)
        │
        ├── Waits for server healthcheck (condition: service_healthy)
        │
        └── Starts nginx (node-monolith-3tier-app-client)
                Nginx serves /usr/share/nginx/html on port 80
                /api/* proxied to http://server:5000
                Healthcheck: wget http://localhost:80/ → 200
                Accessible at http://localhost:80
```

---

## Decision Log

| Area | Decision Made | Alternative Considered | Why This Was Chosen |
|---|---|---|---|
| **Two Dockerfiles** | `Dockerfile.client` + `Dockerfile.server` | Single Dockerfile (two-tier style) | Express has no `express.static()` — Nginx and Node.js are separate services requiring separate images |
| **`nginx:alpine` for client** | Multi-stage: Node build → Nginx serve | Node:alpine serving static files | `nginx:alpine` is ~20MB vs ~180MB; Nginx is purpose-built for static delivery |
| **`docker.conf` vs `default.conf`** | Copy `nginx/docker.conf` into image | Copy `nginx/default.conf` | `default.conf` uses `localhost:5000` — broken in Docker; `docker.conf` uses `http://server:5000` (service name) |
| **`expose:` on server (not `ports:`)** | `expose: "5000"` — internal only | `ports: "5000:5000"` — host-exposed | Three-tier security model: only Nginx is public; Express must not be directly reachable from host |
| **`/api/test` healthcheck on server** | Use `/api/test` route | Use `GET /` | Express has no static files — `GET /` returns 404; `/api/test` is the explicit health route |
| **`node:22-alpine` for server** | `node:22-alpine` | `node:18-alpine` (EOL Apr 2025) | Node 22 is current LTS (supported until April 2027) |
| **`--omit=dev` in server-deps** | Production deps only | `npm install` (all deps) | devDependencies not needed at runtime; smaller, more secure image |
| **`chown -R` before `USER`** | `chown` as root, then switch user | `USER` first, then `chown` | `appuser` has no permission to change file ownership; `chown` must run as root |
| **`ENTRYPOINT` exec form** | `["node", "server/server.js"]` | `CMD node server/server.js` (shell form) | Shell form makes `/bin/sh` PID 1; signals not forwarded to Node.js; no graceful shutdown |
| **`ARG PORT` + `ENV PORT` + `EXPOSE ${PORT}`** | Dynamic port via ARG/ENV | `EXPOSE 5000` hardcoded | Hardcoded EXPOSE mismatches if PORT changes; ARG/ENV pattern stays in sync |
| **`CMD-SHELL` in server compose healthcheck** | `CMD-SHELL` for variable expansion | `CMD` exec form | Exec form does not expand `${PORT:-5000}`; `CMD-SHELL` invokes `/bin/sh -c` |
| **`DB_HOST: mysql` override** | Override only `DB_HOST` in `environment:` | Hardcode `DB_HOST=mysql` in `.env` | `.env` must stay `localhost` for bare-metal dev; override only in Compose |
| **`mysql:8.4` image** | Pin to `mysql:8.4` (LTS) | `mysql:8` (floating tag) | `mysql:8` could resolve to EOL 8.0; `8.4` is explicit and reproducible |
| **`-h localhost` in MySQL healthcheck** | `localhost` | `-h mysql` (service name) | Service name only resolves from other containers; `mysql` is invalid inside its own container |
| **`condition: service_healthy`** | Wait for full MySQL health before server | `depends_on: mysql` (no condition) | Plain `depends_on` only waits for container start, not MySQL readiness; app crashes on premature connection |
| **nginx `depends_on: server: service_healthy`** | Wait for Express healthcheck | Start nginx immediately | Early API proxy calls fail if Express is not ready |
| **Port 80 only exposed** | `ports: "80:80"` on nginx only | Expose Express (5000) and MySQL (3306) too | Three-tier security: one public entry point; internal services never reachable from host |
| **Named volume `mysql-data`** | Named volume | Anonymous volume or no volume | Named volumes persist beyond `docker compose down`; only `down -v` destroys them |
| **`name: nodeapp`** | Explicit project name | No name (uses directory name) | Consistent container/network/volume naming across all machines |

---

## Common Mistakes Reference

| Mistake | What Breaks | Correct Approach |
|---|---|---|
| One Dockerfile for three-tier | Express serves static files — Nginx is meaningless | Separate Dockerfiles: `Dockerfile.client` (Nginx) + `Dockerfile.server` (Node) |
| `nginx/default.conf` (localhost) in Docker | All `/api/` proxied calls fail — Nginx tries `localhost:5000` (itself) | Use `nginx/docker.conf` with `proxy_pass http://server:5000` |
| `ports: "5000:5000"` on server service | API bypasses Nginx — security model broken | Use `expose: "5000"` — internal network only |
| `GET /` healthcheck on Express | Returns 404 (no static files) — healthcheck always fails | Use `GET /api/test` — the explicit health route |
| `COPY client/ ./` before `npm install` in Dockerfile.client Stage 1 | npm re-installs all Webpack/Babel packages on every source change | Copy `package.json` first, `npm install`, then `COPY client/ ./` |
| Copying full `client/` to nginx stage | React source, Webpack config, node_modules in production image | Copy only `client/public/` (compiled output) |
| `["CMD", "wget", "...", "${PORT:-5000}"]` exec form in healthcheck | Shell variable NOT expanded — healthcheck always fails | Use `CMD-SHELL` form for variable expansion |
| `-h mysql` in MySQL healthcheck | "Unknown MySQL server host 'mysql'" — healthcheck never passes | Use `-h localhost` (valid inside the MySQL container) |
| `depends_on: mysql` without `condition` | Express starts before MySQL is ready — `createConnection()` fails | Use `condition: service_healthy` |
| `DB_HOST=mysql` hardcoded in `.env` | Breaks bare-metal development (nothing at `mysql:3306` locally) | Keep `DB_HOST=localhost` in `.env`; override `DB_HOST: mysql` in `compose.yml` |
| Exposing MySQL port to host | Database directly accessible from outside Docker | Remove `ports:` from `mysql` service entirely |
| Using EOL `node:18` | Security vulnerabilities, no upstream patches | Use `node:22-alpine` (LTS until April 2027) |
| `USER appuser` before `chown` | `Permission denied` — non-root cannot change ownership | Always `chown -R` as root before `USER appuser` |
| Re-listing `env_file` variables under `environment:` | Redundant — works but misleads about what is being overridden | Only list variables that **override** their `env_file` values |

The existing `project-architecture-and-dockerization-guide.md` can then be deleted since its content is now split across these two cleaner files. Want me to also handle deleting that old file once you push these?
