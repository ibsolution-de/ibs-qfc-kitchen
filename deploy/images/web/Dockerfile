# syntax=docker/dockerfile:1

# ---- Build-Stage: Vite React Build ----
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

# ---- Runtime-Stage: nginx (unprivileged) liefert statische Files ----
FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
LABEL maintainer="Nazar Kulyk <nazar.kulyk@ibsolution.de>" \
    org.opencontainers.image.authors="nazar.kulyk@ibsolution.de" \
    org.opencontainers.image.url="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.source="https://github.com/ibsolution-de/ibs-qfc-kitchen" \
    org.opencontainers.image.vendor="ibsolution" \
    org.opencontainers.image.title="ibs-qfc-kitchen/web"
COPY deploy/images/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- "http://localhost:8080/healthz" >/dev/null 2>&1 || exit 1
# CMD/ENTRYPOINT vom nginx-Base übernommen (nginx -g 'daemon off;')
