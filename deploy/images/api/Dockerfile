# syntax=docker/dockerfile:1

# ---- Build-Stage: Cargo Release Build ----
# Multi-Arch manifest-list digest (linux/amd64 + linux/arm64), aktualisiert via Dependabot.
FROM rust:1-slim-trixie@sha256:8e8cf8f7fd54a2d23d5a743b3a03f56e26b6c774276c33fa0595111704ebb15c AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# Dependency layer: compile deps once, cached independently of source changes.
# build.rs is copied as well: without it Cargo skips the build script entirely,
# so build-dependencies like connectrpc-build would recompile on every source
# change. proto/ comes BEFORE the stub build because build.rs references
# ../proto — protos change rarely, so this barely hurts cache locality.
COPY api/Cargo.toml api/Cargo.lock api/
COPY api/build.rs api/build.rs
COPY proto/ proto/
RUN mkdir -p api/src \
    && echo "fn main() {}" > api/src/main.rs \
    && cargo build --manifest-path api/Cargo.toml --release \
    && rm -rf api/src

# Source layer: real sources (proto/ already in place from the dep layer)
COPY api/ api/
RUN cargo build --manifest-path api/Cargo.toml --release

# ---- Runtime-Stage: debian-slim (unprivileged) ----
# Multi-Arch manifest-list digest (linux/amd64 + linux/arm64), aktualisiert via Dependabot.
FROM debian:trixie-slim@sha256:3a39a0592364683e6bab97937b72cad5a8fa6dcbbee90edb3bb48c7f8e94f258 AS runtime
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
