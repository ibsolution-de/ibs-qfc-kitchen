# syntax=docker/dockerfile:1

# ---- Build-Stage: Cargo Release Build ----
FROM rust:1-slim-trixie AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Dependency layer: compile deps once, cached independently of source changes
COPY api/Cargo.toml api/Cargo.lock api/
RUN mkdir -p api/src \
    && echo "fn main() {}" > api/src/main.rs \
    && cargo build --manifest-path api/Cargo.toml --release \
    && rm -rf api/src

# Source layer: real sources + proto/ consumed by build.rs
COPY proto/ proto/
COPY api/ api/
RUN cargo build --manifest-path api/Cargo.toml --release

# ---- Runtime-Stage: debian-slim (unprivileged) ----
FROM debian:trixie-slim AS runtime
LABEL maintainer="Nazar Kulyk <nazar.kulyk@ibsolution.de>" \
    org.opencontainers.image.authors="nazar.kulyk@ibsolution.de" \
    org.opencontainers.image.url="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.source="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.vendor="ibsolution" \
    org.opencontainers.image.title="ibs-qfc-kitchen/api"

RUN apt-get update \
    && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 qfc-api \
    && useradd --uid 1000 --gid qfc-api --no-create-home --shell /usr/sbin/nologin qfc-api \
    && mkdir -p /data \
    && chown qfc-api:qfc-api /data

COPY --from=build /app/api/target/release/qfc-api /usr/local/bin/qfc-api

USER qfc-api
ENV QFC_DB_PATH=/data/qfc.db
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:8080/healthz" >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/usr/local/bin/qfc-api"]
