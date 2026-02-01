FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy package manifests for all workspace packages
COPY packages/core/package.json packages/core/
COPY packages/review/package.json packages/review/
COPY packages/app/package.json packages/app/

# Install all dependencies
RUN npm ci --workspace=packages/core --workspace=packages/review --workspace=packages/app

# Copy source code
COPY packages/core/ packages/core/
COPY packages/review/ packages/review/
COPY packages/app/ packages/app/

# Build packages in dependency order
RUN npm run build -w packages/core && \
    npm run build -w packages/review && \
    npm run build -w packages/app

# ─── Production image ────────────────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/review/package.json packages/review/
COPY --from=builder /app/packages/review/dist/ packages/review/dist/
COPY --from=builder /app/packages/app/package.json packages/app/
COPY --from=builder /app/packages/app/dist/ packages/app/dist/

RUN npm ci --workspace=packages/core --workspace=packages/review --workspace=packages/app --omit=dev

EXPOSE 3000

CMD ["node", "packages/app/dist/index.js"]
