# atmobb release image: the built SvelteKit app plus the appview configuration
# (lexicons, Lua, setup scripts) that this exact build expects. One image serves
# the forum (`node build`, the default) and runs the Happyview setup job
# (`sh appview/container-setup.sh`). See infra/release/compose.yml.
#
# Keep HAPPYVIEW_VERSION aligned with the image tag in every Compose file;
# `infra/release/check-pins.sh` fails CI when they drift.
ARG HAPPYVIEW_VERSION=2.14.0

# --- build ------------------------------------------------------------------
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# --- production dependencies ------------------------------------------------
# A fresh install so devDependencies never reach the runtime image. Native
# optional packages (@resvg/resvg-js) resolve for the target platform here.
FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim
ARG HAPPYVIEW_VERSION

# curl/jq/psql/openssl are for the setup, bootstrap, and backfill scripts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl jq openssl postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 atmobb \
  && useradd --system --uid 10001 --gid atmobb --home-dir /data --no-create-home --shell /usr/sbin/nologin atmobb \
  && install -d -o atmobb -g atmobb -m 700 /data

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
# package.json carries "type": "module", which the adapter-node output needs.
COPY package.json ./
COPY appview ./appview
COPY lexicons ./lexicons
COPY infra/rebuild-stats.sql ./infra/rebuild-stats.sql

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001 \
  BODY_SIZE_LIMIT=3M \
  DATA_DIR=/data \
  HAPPYVIEW_EXPECTED_VERSION=$HAPPYVIEW_VERSION

USER atmobb
VOLUME /data
EXPOSE 3001
CMD ["node", "build"]
