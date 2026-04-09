# =============================================================================
# Dockerfile — Tier 1 (Nginx, Presentation Layer)
#
# Stage 1 (builder): Install dependencies and build the React app with Webpack.
# Stage 2 (nginx):   Copy ONLY the build output into a clean Nginx image.
#                    No Node.js, no source code, no node_modules in production.
# =============================================================================

# --- Stage 1: Build React app ---
FROM node:18-alpine AS builder

WORKDIR /app/client

# Copy package files first so Docker can cache the npm install layer.
# The install layer only re-runs when package.json changes, not on every code change.
COPY client/package*.json ./
RUN npm install --include=dev

# Copy source and build
COPY client/ ./
RUN npm run build
# Output: /app/client/public/ (bundle.js, index.html, CSS, images)


# --- Stage 2: Nginx serving the build output ---
FROM nginx:alpine

# Replace the default Nginx config with our reverse-proxy config
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the React build output from Stage 1 into Nginx's web root
COPY --from=builder /app/client/public /usr/share/nginx/html

EXPOSE 80

# Nginx starts automatically — no CMD needed (inherited from nginx:alpine)
