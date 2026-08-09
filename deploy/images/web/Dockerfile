# syntax=docker/dockerfile:1

# ---- Build-Stage: Vite React Build ----
# Multi-Arch manifest-list digest, aktualisiert via Dependabot.
FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS build
WORKDIR /app
RUN corepack enable
# Dependency layer: only the pnpm manifest/lock files, so `pnpm install` stays
# cached unless dependencies actually change (sources come after).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- Runtime-Stage: nginx (unprivileged) liefert statische Files ----
# Multi-Arch manifest-list digest, aktualisiert via Dependabot.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:a6c3ec0c0d249d68b0682df854d4a9e222b90fb607dc3fcf2f1d2fcbc85d347e AS runtime
LABEL maintainer="Nazar Kulyk <nazar.kulyk@ibsolution.de>" \
    org.opencontainers.image.authors="nazar.kulyk@ibsolution.de" \
    org.opencontainers.image.url="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.source="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.vendor="ibsolution" \
    org.opencontainers.image.title="ibs-qfc-kitchen/web"
COPY deploy/images/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:8080/healthz" >/dev/null 2>&1 || exit 1
# CMD/ENTRYPOINT vom nginx-Base übernommen (nginx -g 'daemon off;')
