# Copyright (c) 2026 Jugaad s.r.l.
#
# KeelOps in a container: the server serves the built web app on port 3001.
# Built from the community tree (github.com/dariofinardi/KeelOps-FOSS) it is
# the community image; docker-compose.yml puts Caddy in front for HTTPS.
FROM node:22-bookworm-slim

# Prisma's engines need OpenSSL; the CA bundle is for outgoing TLS (SMTP, Ollama).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# pnpm comes from corepack, kept in a shared folder so that the `node` user
# finds it at run time without downloading anything (prepara-db.ts calls it).
ENV COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .

# Dependencies, the two Prisma clients (SQLite and MariaDB, the latter from the
# generated schema) and the web build. The server runs its TypeScript through
# tsx, so the development dependencies stay in the image.
RUN corepack install \
 && pnpm install --frozen-lockfile \
 && pnpm --filter @kancrm/server exec prisma generate \
 && (cd apps/server && pnpm exec tsx scripts/mariadb/genera-schema.ts) \
 && DATABASE_URL_MARIADB="mysql://x:y@127.0.0.1:3306/z" \
    pnpm --filter @kancrm/server exec prisma generate --schema=prisma/mariadb/schema.prisma \
 && pnpm build \
 && rm -rf /root/.local/share/pnpm /root/.cache \
 && chmod -R a+rX /opt/corepack \
 && chmod +x docker/entrypoint.sh \
 && mkdir -p /app/data /etc/keelops \
 && chown -R node:node /app/data /etc/keelops

ENV NODE_ENV=production \
    PORT=3001 \
    HTTPS_REDIRECT_PORT=0
# data/: database (SQLite), attachments, backups. /etc/keelops: the password pepper
# and the message key, generated at the first start — outside /app (the server
# refuses a pepper inside the application) and outside data/, which
# ends up in the backups.
VOLUME ["/app/data", "/etc/keelops"]
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
