#!/bin/sh
# Copyright (c) 2026 Jugaad s.r.l.
#
# First start and every start of the KeelOps container: secrets, database
# tables, the base structure, the first administrator, then the server.
set -eu
cd /app

# The password pepper and the key of confidential messages: generated once in
# /etc/keelops (the keelops-config volume), unless given from outside. Losing them locks everybody out
# (pepper) or makes confidential messages unreadable (key): back up that volume.
if [ -z "${PASSWORD_PEPPER_FILE:-}" ]; then
  PASSWORD_PEPPER_FILE=/etc/keelops/pepper.json
  if [ ! -f "$PASSWORD_PEPPER_FILE" ]; then
    node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ passwordPepper: require("crypto").randomBytes(32).toString("hex") }), { mode: 0o600 })' "$PASSWORD_PEPPER_FILE"
    echo "KeelOps: password pepper created in /etc/keelops/pepper.json"
  fi
  export PASSWORD_PEPPER_FILE
fi
if [ -z "${SECRET_KEY_CRYPTO:-}" ]; then
  if [ ! -f /etc/keelops/secret-key ]; then
    node -e 'require("fs").writeFileSync(process.argv[1], require("crypto").randomBytes(32).toString("hex"), { mode: 0o600 })' /etc/keelops/secret-key
    echo "KeelOps: key for confidential messages created in /etc/keelops/secret-key"
  fi
  SECRET_KEY_CRYPTO=$(cat /etc/keelops/secret-key)
  export SECRET_KEY_CRYPTO
fi

cd /app/apps/server
# Tables: created or brought up to date at every start.
if [ "${DB_ENGINE:-sqlite}" = "mariadb" ]; then
  pnpm exec tsx scripts/mariadb/prepara-db.ts
else
  pnpm exec prisma migrate deploy
fi

# Statuses, deal stages, activity types and groups: once, never again (after
# that they belong to the company, and a second run would bring back the ones
# it deleted).
if [ ! -f /app/data/.struttura ]; then
  SEED_MINIMAL=1 pnpm exec tsx prisma/seed.ts
  date -u +%Y-%m-%dT%H:%M:%SZ > /app/data/.struttura
fi

# The first administrator, with a temporary password printed once in the log:
# it must be changed at the first sign-in.
if [ -n "${KEELOPS_ADMIN_EMAIL:-}" ] && [ ! -f /app/data/.admin ]; then
  pnpm exec tsx scripts/utenti.ts crea-admin "$KEELOPS_ADMIN_EMAIL" --nome "${KEELOPS_ADMIN_NAME:-Administrator}" \
    && date -u +%Y-%m-%dT%H:%M:%SZ > /app/data/.admin
fi

exec node --import tsx src/index.ts
