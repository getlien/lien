# Lien Review GitHub Action image.
# Multi-stage: build the workspace, prune dev deps, ship a slim runtime that
# keeps git (the action self-clones the PR head/base by SHA).
FROM --platform=linux/amd64 node:22-slim AS builder

RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json ./

# Copy all workspace package manifests (npm ci needs the full workspace graph)
COPY packages/parser-native/package.json packages/parser-native/
COPY packages/parser/package.json packages/parser/
COPY packages/core/package.json packages/core/
COPY packages/review/package.json packages/review/
COPY packages/action/package.json packages/action/
COPY packages/cli/package.json packages/cli/
COPY packages/site/package.json packages/site/

# Install all workspace dependencies
RUN npm ci

# Copy source code
#
# parser-native is napi-rs (Rust): the crate itself is NOT built in this
# image (no Rust toolchain here). ADR-013 Phase 4-B deleted the legacy
# node-tree-sitter backend entirely, so @liendev/parser now hard-requires a
# loadable native binding at runtime -- it can no longer fall back. The
# workflow that docker-builds this image runs `npm run build:native -w
# @liendev/parser-native` on the RUNNER first (see .github/workflows/ci.yml's
# "Build native parser" step), which drops a linux-x64-gnu
# parser-native.node at the fixed path below; we COPY that prebuilt binary
# in alongside the package's JS surface (types + loader), same as we do for
# index.js/index.d.ts/scripts/ -- see docs/architecture/native-parser.md.
# Everything else under parser-native/ (Cargo.toml, target/, vendor/) stays
# out via .dockerignore.
COPY packages/parser-native/index.js packages/parser-native/index.d.ts packages/parser-native/
COPY packages/parser-native/scripts/ packages/parser-native/scripts/
COPY packages/parser-native/parser-native.node packages/parser-native/
COPY packages/parser/ packages/parser/
COPY packages/core/ packages/core/
COPY packages/review/ packages/review/
COPY packages/action/ packages/action/

# Fail loudly and immediately if the runner didn't produce the binary above
# (e.g. someone docker-builds this image directly, skipping the "Build
# native parser" step) -- much cheaper than discovering it via a
# NativeBindingLoadError several minutes into `npm run build`/test below.
RUN test -f packages/parser-native/parser-native.node || \
    (echo "Missing packages/parser-native/parser-native.node -- run 'npm run build:native -w @liendev/parser-native' before docker build" >&2 && exit 1)

# Build packages in dependency order
RUN npm run build -w packages/parser && \
    npm run build -w packages/core && \
    npm run build -w packages/review && \
    npm run build -w packages/action

# ─── Prune dev dependencies ──────────────────────────────────────────────────

FROM builder AS pruner

RUN npm prune --omit=dev

# ─── Production image ────────────────────────────────────────────────────────

FROM --platform=linux/amd64 node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy pre-built node_modules (with native addons already compiled)
#
# @liendev/parser has no packages/parser/node_modules/ to copy: ADR-013
# Phase 4-B deleted node-tree-sitter and its 11 grammar packages, which were
# parser's only non-hoisted deps -- the rest (@liendev/parser-native, glob,
# ignore, p-limit) resolve cleanly into the root node_modules/ above. core
# still gets its own line because better-sqlite3's native build can nest
# there depending on the lockfile's resolution.
COPY --from=pruner /app/node_modules/ node_modules/
COPY --from=pruner /app/packages/core/node_modules/ packages/core/node_modules/

# Copy built dist and package manifests
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/parser-native/package.json packages/parser-native/
COPY --from=builder /app/packages/parser-native/index.js packages/parser-native/
COPY --from=builder /app/packages/parser-native/index.d.ts packages/parser-native/
COPY --from=builder /app/packages/parser-native/scripts/ packages/parser-native/scripts/
COPY --from=builder /app/packages/parser-native/parser-native.node packages/parser-native/
COPY --from=builder /app/packages/parser/package.json packages/parser/
COPY --from=builder /app/packages/parser/dist/ packages/parser/dist/
COPY --from=builder /app/packages/core/package.json packages/core/
COPY --from=builder /app/packages/core/dist/ packages/core/dist/
COPY --from=builder /app/packages/review/package.json packages/review/
COPY --from=builder /app/packages/review/dist/ packages/review/dist/
COPY --from=builder /app/packages/action/package.json packages/action/
COPY --from=builder /app/packages/action/dist/ packages/action/dist/

ENV GIT_TERMINAL_PROMPT=0

# Runtime gate: actually load the native binding and parse one real snippet
# through it, in the exact final-stage layout that ships (index.js's local-
# dev fallback resolves ./parser-native.node next to itself -- see
# packages/parser-native/index.js's "Resolution order" comment). A present-
# but-wrong-platform, corrupted, or otherwise unloadable binary fails the
# docker build here instead of surfacing as a NativeBindingLoadError the
# first time the shipped Action tries to review a PR.
RUN node -e "import('./packages/parser-native/index.js').then(({ parseTree }) => { \
    const wire = parseTree('javascript', 'const x = 1;'); \
    if (!wire || !JSON.parse(wire).type) throw new Error('parseTree returned an empty/invalid result'); \
    console.log('native parser binding OK'); \
  }).catch((err) => { console.error(err); process.exit(1); })"

ENTRYPOINT ["node", "packages/action/dist/index.js"]
