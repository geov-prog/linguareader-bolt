#!/usr/bin/env sh
# Restarts the dev server after hibernate/revive. Idempotent and non-blocking.

set -e

PORT=8080
HEALTH_URL="http://127.0.0.1:${PORT}/"

# Already healthy? Nothing to do.
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "dev server already up on :${PORT}"
    exit 0
  fi
fi

cd "$(dirname "$0")"

# Start the dev server in the background (npm run dev -> vite via with-app-env.mjs).
nohup npm run dev > /tmp/dev-server.log 2>&1 &
echo "dev server starting on :${PORT} (pid $!)"

# Best-effort wait for the port to come up (max ~60s).
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "dev server up after ${i} probes"
    exit 0
  fi
  sleep 2
done

echo "dev server did not become healthy in time; see /tmp/dev-server.log"
exit 0
