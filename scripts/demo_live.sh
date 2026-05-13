#!/usr/bin/env bash
#
# Live end-to-end demo:
#   - docker compose brings up redis + server + proxy + dashboard
#   - host runs the to-do app on :3100
#   - host runs the osmrouter-client connected to the dockerized proxy
#   - script bootstraps: signup → device → domain → bind → ready
#
# After this finishes:
#   • Dashboard:   http://localhost:3030       (sign in as demo@osmrouter.test / hunter22demo)
#   • To-Do app:   http://localhost:3100       (direct on Mac)
#   • Public URL:  http://app.todo.localtest.me:8000   (via the tunnel)
#
# Stop everything:  ./scripts/demo_stop.sh
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$PROJ_DIR/deploy/docker-compose.yml"
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
STATE_DIR="$PROJ_DIR/.demo-state"
mkdir -p "$STATE_DIR"

EMAIL="demo@osmrouter.test"
PASSWORD="hunter22demo"
FQDN="todo.localtest.me"
PREFIX="app"
LOCAL_PORT=3100

color() { printf '\033[1;36m%s\033[0m\n' "$1"; }

cleanup_on_err() {
  echo
  echo "Demo bootstrap failed. Inspect logs with:"
  echo "  docker compose -f \"$COMPOSE_FILE\" logs --tail=80"
  exit 1
}
trap cleanup_on_err ERR

color "→ Step 1/7: docker compose up (build + start)"
compose up -d --build

color "→ Step 2/7: wait for backend health"
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/healthz >/dev/null 2>&1; then
    echo "  Control Plane ready"
    break
  fi
  sleep 1
  [ "$i" = "60" ] && { echo "Control Plane never came up"; exit 1; }
done
for i in $(seq 1 90); do
  if curl -sf http://localhost:3030/ >/dev/null 2>&1; then
    echo "  Dashboard ready"
    break
  fi
  sleep 1
done

color "→ Step 3/7: launch the to-do app on :$LOCAL_PORT (background)"
if lsof -iTCP:$LOCAL_PORT -sTCP:LISTEN -P >/dev/null 2>&1; then
  echo "  port $LOCAL_PORT already in use — assuming the to-do app is already running"
else
  nohup python3 "$PROJ_DIR/mac-app/todo-app/server.py" > "$STATE_DIR/todo-app.log" 2>&1 &
  echo $! > "$STATE_DIR/todo-app.pid"
  sleep 1
fi
echo "  curl http://localhost:$LOCAL_PORT/health:"
curl -sf "http://localhost:$LOCAL_PORT/health" || true
echo

color "→ Step 4/7: register demo user + verify OTP"
REG_RESPONSE_RAW=$(curl -s -w "\n%{http_code}" -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"name\":\"Demo\"}")
REG_BODY=$(echo "$REG_RESPONSE_RAW" | sed '$d')
REG_CODE=$(echo "$REG_RESPONSE_RAW" | tail -n1)

if [ "$REG_CODE" = "409" ]; then
  echo "  user already exists — logging in instead"
  COOKIES="$STATE_DIR/cookies.txt"; rm -f "$COOKIES"
  curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /dev/null
else
  if [ "$REG_CODE" != "201" ]; then
    echo "  registration failed (HTTP $REG_CODE): $REG_BODY"
    exit 1
  fi
  OTP=$(echo "$REG_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('dev_otp',''))")
  echo "  dev_otp=$OTP"
  COOKIES="$STATE_DIR/cookies.txt"; rm -f "$COOKIES"
  curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/verify-otp \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"code\":\"$OTP\"}" > /dev/null
fi

CSRF=$(curl -sf -b "$COOKIES" -c "$COOKIES" http://localhost:8080/api/v1/csrf \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['csrf_token'])")
echo "  csrf_token=${CSRF:0:12}…"

color "→ Step 5/7: upgrade plan + create domain + subdomain"
docker exec osm-server sh -c "echo \"UPDATE users SET plan_id=(SELECT id FROM plans WHERE slug='pro') WHERE email='$EMAIL';\" | sqlite3 /data/osm.db 2>/dev/null || true"
# Promote first signup to admin so we can showcase the admin panel too.
docker exec osm-server sh -c "echo \"UPDATE users SET role='admin' WHERE email='$EMAIL';\" | sqlite3 /data/osm.db 2>/dev/null || true"

# Idempotent: skip create if FQDN already exists
EXISTING_DOM=$(curl -sf -b "$COOKIES" http://localhost:8080/api/v1/domains \
  | python3 -c "import sys,json; d=[x['id'] for x in json.load(sys.stdin)['domains'] if x['fqdn']=='$FQDN']; print(d[0] if d else '')")
if [ -z "$EXISTING_DOM" ]; then
  DOM_ID=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
    -X POST http://localhost:8080/api/v1/domains \
    -d "{\"fqdn\":\"$FQDN\",\"registrar\":\"Cloudflare\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  DOM_ID="$EXISTING_DOM"
  echo "  reusing existing domain $DOM_ID"
fi
docker exec osm-server sh -c "echo \"UPDATE domains SET dns_status='verified', verified_at=datetime('now') WHERE id='$DOM_ID';\" | sqlite3 /data/osm.db"
echo "  domain $FQDN verified"

EXISTING_SUB=$(curl -sf -b "$COOKIES" "http://localhost:8080/api/v1/domains/$DOM_ID/subdomains" \
  | python3 -c "import sys,json; d=[x['id'] for x in json.load(sys.stdin)['subdomains'] if x['prefix']=='$PREFIX']; print(d[0] if d else '')")
if [ -z "$EXISTING_SUB" ]; then
  SUB_ID=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
    -X POST "http://localhost:8080/api/v1/domains/$DOM_ID/subdomains" \
    -d "{\"prefix\":\"$PREFIX\",\"target_port\":$LOCAL_PORT}" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  SUB_ID="$EXISTING_SUB"
  echo "  reusing existing subdomain $SUB_ID"
fi
echo "  subdomain $PREFIX.$FQDN created"

color "→ Step 6/7: create device + bind subdomain"
DEVRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/devices \
  -d '{"name":"Demo MacBook","os_type":"macos"}')
DEV_ID=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['device']['id'])")
API_KEY=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")
echo "  device_id=$DEV_ID"

# Mark device online via heartbeat so the bind passes the "online" check.
curl -sf -X POST http://localhost:8080/api/v1/devices/heartbeat \
  -H "Authorization: Bearer $API_KEY" > /dev/null

curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/subdomains/$SUB_ID/bind" \
  -d "{\"device_id\":\"$DEV_ID\"}" > /dev/null
echo "  bound $PREFIX.$FQDN → $DEV_ID"

color "→ Step 7/7: launch osmrouter-client on this Mac (background)"
# Build the binary if not already built.
if [ ! -x "$STATE_DIR/osmrouter-client" ]; then
  (cd "$PROJ_DIR/tunnel-client" && go build -o "$STATE_DIR/osmrouter-client" ./cmd/osmrouter-client)
fi

# Kill any prior client
[ -f "$STATE_DIR/tunnel-client.pid" ] && kill "$(cat "$STATE_DIR/tunnel-client.pid")" 2>/dev/null || true

nohup "$STATE_DIR/osmrouter-client" \
  --proxy-url ws://localhost:8001/ws/tunnel \
  --api-key   "$API_KEY"   \
  --device-id "$DEV_ID"    \
  --local     "http://localhost:$LOCAL_PORT" \
  > "$STATE_DIR/tunnel-client.log" 2>&1 &
echo $! > "$STATE_DIR/tunnel-client.pid"
sleep 2

color "✓ Demo is live"
cat <<EOF

Open these in your browser:
  • Dashboard (sign in as $EMAIL / $PASSWORD):
      http://localhost:3030/login
  • To-Do app (direct on Mac):
      http://localhost:$LOCAL_PORT
  • To-Do app via the public proxy + tunnel:
      http://$PREFIX.$FQDN:8000

Smoke test from a terminal:
  curl -s http://$PREFIX.$FQDN:8000/health | python3 -m json.tool

To tear it all down:
  ./scripts/demo_stop.sh

State (PIDs + cookies + binary):  $STATE_DIR
EOF
