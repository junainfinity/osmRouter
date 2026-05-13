#!/usr/bin/env bash
# Tear down the live demo started by demo_live.sh.
set -e
PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE_DIR="$PROJ_DIR/.demo-state"

echo "stopping tunnel-client + to-do app..."
for f in tunnel-client.pid todo-app.pid; do
  if [ -f "$STATE_DIR/$f" ]; then
    kill "$(cat "$STATE_DIR/$f")" 2>/dev/null || true
    rm -f "$STATE_DIR/$f"
  fi
done

echo "stopping docker compose..."
docker compose -f "$PROJ_DIR/deploy/docker-compose.yml" down -v

echo "✓ stopped"
