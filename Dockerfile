# Both bye0 images. docker-compose.yaml picks one with `target`:
#   server  the party server, on port 3001
#   web     the built web app behind Caddy, on port 80; it also forwards /ws to the party server

FROM oven/bun:1.4-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

FROM deps AS web-build
COPY packages packages
COPY apps/web apps/web
RUN bun --filter @bye0/web build

FROM caddy:2-alpine AS web
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/apps/web/build /srv

FROM deps AS server
COPY packages packages
COPY apps/server apps/server
ENV PORT=3001
EXPOSE 3001
USER bun
HEALTHCHECK --interval=30s --timeout=3s \
  CMD bun -e "const r = await fetch('http://localhost:' + process.env.PORT + '/healthz'); process.exit(r.ok ? 0 : 1)"
CMD ["bun", "apps/server/src/index.ts"]
