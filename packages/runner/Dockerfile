FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy all workspace package manifests (npm ci needs the full workspace graph)
COPY packages/parser/package.json packages/parser/
COPY packages/core/package.json packages/core/
COPY packages/review/package.json packages/review/
COPY packages/runner/package.json packages/runner/
COPY packages/app/package.json packages/app/
COPY packages/cli/package.json packages/cli/
COPY packages/site/package.json packages/site/

# Install all workspace dependencies
RUN npm ci

# Copy source code
COPY packages/parser/ packages/parser/
COPY packages/core/ packages/core/
COPY packages/review/ packages/review/
COPY packages/runner/ packages/runner/

# Build packages in dependency order
RUN npm run build -w packages/parser && \
    npm run build -w packages/core && \
    npm run build -w packages/review && \
    npm run build -w packages/runner

# ─── Prune dev dependencies ──────────────────────────────────────────────────

FROM builder AS pruner

RUN npm prune --omit=dev

# ─── Production image ────────────────────────────────────────────────────────

FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

RUN groupadd -r lien && useradd -r -g lien -m lien

WORKDIR /app

# Copy pre-built node_modules (with native addons already compiled)
COPY --from=pruner /app/node_modules/ node_modules/
COPY --from=pruner /app/packages/parser/node_modules/ packages/parser/node_modules/
COPY --from=pruner /app/packages/core/node_modules/ packages/core/node_modules/

# Copy built dist and package manifests
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/parser/package.json packages/parser/
COPY --from=builder /app/packages/parser/dist/ packages/parser/dist/
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/review/package.json packages/review/
COPY --from=builder /app/packages/review/dist/ packages/review/dist/
COPY --from=builder /app/packages/runner/package.json packages/runner/
COPY --from=builder /app/packages/runner/dist/ packages/runner/dist/

ENV GIT_TERMINAL_PROMPT=0
ENV OPENROUTER_MODEL=minimax/minimax-m2.5

USER lien

CMD ["node", "packages/runner/dist/index.js"]
