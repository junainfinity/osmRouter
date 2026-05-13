#!/usr/bin/env bash
#
# Live end-to-end v2 demo for Option D:
#   - bring up Docker stack with the new proxy
#   - run to-do app on Mac
#   - run sidecar pointing the proxy at the to-do app
#   - (optional) pull Ollama in Docker, point a second sidecar at it
#   - take screenshots
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$PROJ_DIR/deploy/docker-compose.v2.yml"
SIDECAR_BIN="$PROJ_DIR/.demo-state/osm-agent"
STATE_DIR="$PROJ_DIR/.demo-state"
TODO_APP="$PROJ_DIR/mac-app/todo-app/server.py"

mkdir -p "$STATE_DIR"

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }
color() { printf '\033[1;36m%s\033[0m\n' "$1"; }

color "→ Step 1/9: ensure CA exists"
if [ ! -f "$PROJ_DIR/ca/root.pem" ]; then
  bash "$PROJ_DIR/scripts/init-ca.sh" --out "$PROJ_DIR/ca" >/dev/null
fi
echo "  CA ready at $PROJ_DIR/ca/"

color "→ Step 2/9: build sidecar from the Mac project"
MAC_SIDECAR="/Users/arjun/Projects/osmRouter Mac/osmRouter-app/apps/sidecar"
(cd "$MAC_SIDECAR" && go build -o "$SIDECAR_BIN" ./cmd/osm-agent)
echo "  built: $SIDECAR_BIN"

color "→ Step 3/9: docker compose up -d --build"
compose up -d --build 2>&1 | tail -5

color "→ Step 4/9: wait for control plane + proxy health"
for i in $(seq 1 60); do
  if curl -sf http://localhost:8080/healthz >/dev/null 2>&1; then
    echo "  Control Plane ready"
    break
  fi
  sleep 1
done

# wait for proxy TLS to be up
for i in $(seq 1 30); do
  if echo | openssl s_client -connect localhost:8443 -servername localhost 2>/dev/null | grep -q "BEGIN CERTIFICATE"; then
    echo "  Proxy TLS listener ready"
    break
  fi
  sleep 1
done

color "→ Step 5/9: launch to-do app on :3100"
if lsof -iTCP:3100 -sTCP:LISTEN -P >/dev/null 2>&1; then
  echo "  port 3100 in use; assuming to-do app running"
else
  nohup python3 "$TODO_APP" > "$STATE_DIR/todo-app.log" 2>&1 &
  echo $! > "$STATE_DIR/todo-app.pid"
  sleep 1
fi

color "→ Step 6/9: register demo user, mark domain verified, bind subdomain"
EMAIL="demo@osmrouter.test"
PASS="hunter22demo"
FQDN="todo.localtest.me"
PREFIX="app"
HOST="$PREFIX.$FQDN"

REG=$(curl -s -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"name\":\"Demo\"}" | python3 -c "import sys,json
d=json.load(sys.stdin)
print(d.get('dev_otp',''))")

COOKIES="$STATE_DIR/cookies.txt"
rm -f "$COOKIES"

if [ -n "$REG" ]; then
  curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/verify-otp \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"code\":\"$REG\"}" > /dev/null
else
  curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" > /dev/null
fi

CSRF=$(curl -sf -b "$COOKIES" -c "$COOKIES" http://localhost:8080/api/v1/csrf | python3 -c "import sys,json; print(json.load(sys.stdin)['csrf_token'])")

# promote to pro + admin
docker exec osm-server sh -c "echo \"UPDATE users SET plan_id=(SELECT id FROM plans WHERE slug='pro'), role='admin' WHERE email='$EMAIL';\" | sqlite3 /data/osm.db" 2>/dev/null || true

# (re-)create device
DEV=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/devices -d '{"name":"Demo MacBook","os_type":"macos"}')
DEV_ID=$(echo "$DEV" | python3 -c "import sys,json; print(json.load(sys.stdin)['device']['id'])")
API_KEY=$(echo "$DEV" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")

# domain (idempotent)
EXISTING=$(curl -sf -b "$COOKIES" http://localhost:8080/api/v1/domains \
  | python3 -c "import sys,json
ds=json.load(sys.stdin)['domains']
for d in ds:
    if d['fqdn']=='$FQDN':
        print(d['id'])
        break")
if [ -z "$EXISTING" ]; then
  DOM_RESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
    -X POST http://localhost:8080/api/v1/domains -d "{\"fqdn\":\"$FQDN\"}")
  DOM_ID=$(echo "$DOM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  DOM_ID="$EXISTING"
fi
docker exec osm-server sh -c "echo \"UPDATE domains SET dns_status='verified', verified_at=datetime('now') WHERE id='$DOM_ID';\" | sqlite3 /data/osm.db"

# subdomain (idempotent)
EX_SUB=$(curl -sf -b "$COOKIES" http://localhost:8080/api/v1/domains/$DOM_ID/subdomains \
  | python3 -c "import sys,json
ss=json.load(sys.stdin)['subdomains']
for s in ss:
    if s['prefix']=='$PREFIX':
        print(s['id'])
        break")
if [ -z "$EX_SUB" ]; then
  SUB=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
    -X POST "http://localhost:8080/api/v1/domains/$DOM_ID/subdomains" -d "{\"prefix\":\"$PREFIX\",\"target_port\":3100}")
  SUB_ID=$(echo "$SUB" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
else
  SUB_ID="$EX_SUB"
fi

# heartbeat + bind
curl -sf -X POST http://localhost:8080/api/v1/devices/heartbeat -H "Authorization: Bearer $API_KEY" >/dev/null
curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/subdomains/$SUB_ID/bind" -d "{\"device_id\":\"$DEV_ID\"}" >/dev/null

echo "  device=$DEV_ID  host=$HOST"

color "→ Step 7/9: launch sidecar against proxy"
[ -f "$STATE_DIR/sidecar.pid" ] && kill "$(cat "$STATE_DIR/sidecar.pid")" 2>/dev/null || true

OSM_TOKEN="$API_KEY" nohup "$SIDECAR_BIN" run \
  --domain "$HOST" \
  --local-port 3100 \
  --proxy-url "https://localhost:8443" \
  --root-ca   "$PROJ_DIR/ca/root.pem" \
  --device-id "$DEV_ID" \
  > "$STATE_DIR/sidecar.log" 2>&1 &
echo $! > "$STATE_DIR/sidecar.pid"
sleep 3
echo "  sidecar pid=$(cat $STATE_DIR/sidecar.pid)"
echo "  recent sidecar events:"
tail -6 "$STATE_DIR/sidecar.log" | sed 's/^/    /'

color "→ Step 8/9: visitor curl test (Host: $HOST)"
echo
curl -sv -H "Host: $HOST" http://localhost:8000/ 2>&1 | tail -20
echo

color "→ Step 9/9: health summary"
cat <<EOF

✓ Stack live (v2 / Option D):

  Dashboard:  http://localhost:3030/login   ($EMAIL / $PASS)
  Direct:     http://localhost:3100
  Via proxy:  http://$HOST:8000

  Sidecar log:   $STATE_DIR/sidecar.log
  Proxy logs:    docker logs osm-proxy-v2
  Server logs:   docker logs osm-server
  To-do log:     $STATE_DIR/todo-app.log

EOF
