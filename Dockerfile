# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv

# ==========================================
# Stage 1: Build Frontend & Server bundle
# ==========================================
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Install all dependencies (including devDependencies for Vite/esbuild)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source files
COPY . .

# Public Firebase client config baked into client-side Vite bundle at build time
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_STORAGE_BUCKET=""
ARG VITE_FIREBASE_MESSAGING_SENDER_ID=""
ARG VITE_FIREBASE_APP_ID=""
ARG VITE_FIREBASE_FIRESTORE_DATABASE_ID="(default)"

ENV VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_FIREBASE_FIRESTORE_DATABASE_ID=$VITE_FIREBASE_FIRESTORE_DATABASE_ID

RUN npm run build && \
    npx esbuild server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist-server/server.mjs

# ==========================================
# Stage 2: Production Runtime + Code Toolchains
# ==========================================
FROM node:24-bookworm-slim AS runner

# Install Python, C++ (g++), and Java (JDK) toolchains for in-app code execution
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python-is-python3 \
    g++ \
    default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Install production dependencies only
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R node:node /app/node_modules

# Copy built frontend and bundled server
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/dist-server ./dist-server

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist-server/server.mjs"]
