#!/usr/bin/env bash
#
# End-to-end smoke test for the osmRouter Data Plane.
#
# Boots: dev-redis, Control Plane API, fake local app, proxy node,
# tunnel client. Creates a user + device + verified domain + subdomain,
# binds the subdomain to the device, then curls through the proxy and
# expects the fake local app's response back.
#
# Usage:  ./scripts/smoke_data_plane.sh
#
# All servers run in the background; the script kills them on exit.
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
PIDS=()

cleanup() {
  echo
  echo "--- cleaning up ---"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

PROXY_SECRET="smoke-secret-$$"

cd "$PROJ_DIR/server"
echo "--- building binaries ---"
go build -o "$TMP/dev-redis" ./cmd/dev-redis
go build -o "$TMP/api"       ./cmd/api
cd "$PROJ_DIR/proxy-node"
go build -o "$TMP/proxy"     ./cmd/proxy
cd "$PROJ_DIR/tunnel-client"
go build -o "$TMP/tnclient"  ./cmd/osmrouter-client

echo "--- starting dev-redis on :6390 ---"
"$TMP/dev-redis" -addr=:6390 > "$TMP/redis.log" 2>&1 &
PIDS+=($!)
sleep 0.5

echo "--- starting Control Plane API on :8080 ---"
OSM_ENV=dev \
OSM_HTTP_ADDR=:8080 \
OSM_DATABASE_URL="sqlite://$TMP/api.db" \
OSM_REDIS_URL="redis://localhost:6390" \
OSM_DEV_EXPOSE_OTP=true \
OSM_PROXY_NODE_SECRET="$PROXY_SECRET" \
OSM_CORS_ORIGINS=http://localhost:3000 \
  "$TMP/api" > "$TMP/api.log" 2>&1 &
PIDS+=($!)
sleep 2

echo "--- starting fake local app on :3030 ---"
python3 -c "
import http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type','text/plain')
        self.end_headers()
        self.wfile.write(f'hello from local app, path={self.path}'.encode())
    def log_message(self, *a): pass
with socketserver.TCPServer(('127.0.0.1', 3030), H) as s:
    s.serve_forever()
" > "$TMP/app.log" 2>&1 &
PIDS+=($!)
sleep 1

echo "--- starting proxy node (public :8000, tunnel :8001) ---"
OSM_PUBLIC_ADDR=:8000 \
OSM_TUNNEL_ADDR=:8001 \
OSM_REDIS_URL="redis://localhost:6390" \
OSM_CONTROL_PLANE_URL=http://localhost:8080 \
OSM_PROXY_NODE_SECRET="$PROXY_SECRET" \
OSM_NODE_ID=smoke-node \
  "$TMP/proxy" > "$TMP/proxy.log" 2>&1 &
PIDS+=($!)
sleep 1

echo "--- register user + verify OTP ---"
REG=$(curl -sf -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"smoke@example.test","password":"hunter22","name":"Smoke"}')
echo "  $REG"
OTP=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['dev_otp'])")
COOKIES="$TMP/cookies.txt"
curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"smoke@example.test\",\"code\":\"$OTP\"}" > /dev/null
CSRF=$(curl -sf -b "$COOKIES" -c "$COOKIES" http://localhost:8080/api/v1/csrf | python3 -c "import sys,json; print(json.load(sys.stdin)['csrf_token'])")
echo "  cookies + csrf acquired"

echo "--- upgrade user to pro plan (via direct DB) ---"
sqlite3 "$TMP/api.db" "UPDATE users SET plan_id=(SELECT id FROM plans WHERE slug='pro') WHERE email='smoke@example.test';"

echo "--- create device ---"
DEVRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/devices \
  -d '{"name":"Smoke MacBook","os_type":"macos"}')
DEV_ID=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['device']['id'])")
API_KEY=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")
echo "  device_id=$DEV_ID api_key=${API_KEY:0:8}..."

echo "--- create domain + mark verified ---"
DOMRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/domains \
  -d '{"fqdn":"smoke.test"}')
DOM_ID=$(echo "$DOMRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
sqlite3 "$TMP/api.db" "UPDATE domains SET dns_status='verified' WHERE id='$DOM_ID';"
echo "  domain_id=$DOM_ID (set to verified)"

echo "--- create subdomain api.smoke.test → port 3000 ---"
SUBRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/domains/$DOM_ID/subdomains" \
  -d '{"prefix":"api","target_port":3030}')
SUB_ID=$(echo "$SUBRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "  subdomain_id=$SUB_ID"

echo "--- mark device online (heartbeat) ---"
curl -sf -X POST http://localhost:8080/api/v1/devices/heartbeat \
  -H "Authorization: Bearer $API_KEY" > /dev/null

echo "--- bind subdomain to device ---"
curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/subdomains/$SUB_ID/bind" \
  -d "{\"device_id\":\"$DEV_ID\"}" > /dev/null
echo "  bound. Redis should now have live:api.smoke.test → $DEV_ID"

echo "--- start tunnel client ---"
"$TMP/tnclient" \
  --proxy-url ws://localhost:8001/ws/tunnel \
  --api-key   "$API_KEY" \
  --device-id "$DEV_ID" \
  --local     http://localhost:3030 > "$TMP/client.log" 2>&1 &
PIDS+=($!)
sleep 2

echo "--- before tunnel: visitor hits proxy → should now work ---"
echo
echo "GET / via proxy (Host: api.smoke.test):"
curl -sv -H 'Host: api.smoke.test' http://localhost:8000/ 2>&1 | tail -15
echo
echo "GET /foo/bar via proxy:"
curl -s -H 'Host: api.smoke.test' http://localhost:8000/foo/bar
echo
echo

echo "--- killing tunnel client to test holding state ---"
LASTPID=${PIDS[${#PIDS[@]}-1]}
kill "$LASTPID" 2>/dev/null || true
sleep 3
echo "GET via proxy after client gone (expecting 503 Reconnecting):"
HTTP_CODE=$(curl -s -o /tmp/holding_body -w "%{http_code}" -H 'Host: api.smoke.test' http://localhost:8000/)
echo "HTTP $HTTP_CODE"
grep -q "Reconnecting" /tmp/holding_body && echo "✓ Holding state page served" || echo "✗ Holding state page NOT served"
rm -f /tmp/holding_body
echo
echo "✓ smoke test complete"
echo
echo "--- log tails ---"
echo "[api]:";   tail -3 "$TMP/api.log"   2>/dev/null
echo "[proxy]:";tail -3 "$TMP/proxy.log" 2>/dev/null
echo "[client]:";tail -5 "$TMP/client.log" 2>/dev/null
