#!/bin/sh
# Container entrypoint — runs the local app in the background and then the
# tunnel-client in the foreground. SIGTERM propagates to both so the
# container shuts down cleanly.
set -e

: "${API_KEY:?API_KEY env var is required}"
: "${DEVICE_ID:?DEVICE_ID env var is required}"

# Start the local app in the background.
python3 /app/local-app.py &
APP_PID=$!

# Forward SIGTERM/SIGINT to both children.
trap 'kill -TERM "$APP_PID" 2>/dev/null; kill -TERM "$CLIENT_PID" 2>/dev/null' INT TERM

# Run the tunnel-client in the foreground.
/app/osmrouter-client \
  --proxy-url "$PROXY_URL" \
  --api-key   "$API_KEY"   \
  --device-id "$DEVICE_ID" \
  --local     "$LOCAL_URL" &
CLIENT_PID=$!

# Wait on whichever exits first.
wait -n
exit $?
