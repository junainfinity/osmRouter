#!/usr/bin/env bash
#
# End-to-end test of the osmRouter Data Plane with the tunnel-client running
# inside a Docker container — simulating a remote user's laptop.
#
#  +----------------------+         +---------------------------+
#  |   Host (your Mac)    |         |  Docker container         |
#  |                      |         |  ("remote laptop")        |
#  |  - dev-redis :6390   |         |                           |
#  |  - Control Plane     |         |   - python local app      |
#  |    :8080             |         |       (in-container)      |
#  |  - Proxy node        |         |   - osmrouter-client      |
#  |    :8000 public      |◀──WS────│       dials proxy via     |
#  |    :8001 tunnel      │         │       host.docker.internal│
#  |  - curl (visitor)    │         │                           │
#  +──────────────────────+         +───────────────────────────+
#
# Pass criteria: the response body served via the proxy contains the JSON
# `"served_by": "in-container local app"` and the container's hostname —
# proving traffic really crossed the host/container boundary.
set -euo pipefail

PROJ_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
HOST_PIDS=()
CONTAINER_NAME="osm-remote-laptop-$$"
IMAGE_TAG="osmrouter-test-laptop:smoke"

cleanup() {
  echo
  echo "--- cleaning up ---"
  if [ ${#HOST_PIDS[@]} -gt 0 ]; then
    for pid in "${HOST_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  fi
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  wait 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

if ! docker version >/dev/null 2>&1; then
  echo "Docker daemon not responding. Start Docker Desktop and re-run." >&2
  exit 1
fi

PROXY_SECRET="docker-smoke-$$"

cd "$PROJ_DIR/server"
echo "--- building host binaries ---"
go build -o "$TMP/dev-redis" ./cmd/dev-redis
go build -o "$TMP/api"       ./cmd/api
cd "$PROJ_DIR/proxy-node"
go build -o "$TMP/proxy"     ./cmd/proxy

echo "--- building container image (tunnel-client + python app) ---"
cd "$PROJ_DIR/tunnel-client"
docker build -t "$IMAGE_TAG" -f Dockerfile . > "$TMP/build.log" 2>&1 || {
  echo "docker build failed:"; cat "$TMP/build.log"; exit 1;
}
echo "  image: $IMAGE_TAG"

cd "$PROJ_DIR"

echo "--- starting dev-redis on :6390 ---"
"$TMP/dev-redis" -addr=:6390 > "$TMP/redis.log" 2>&1 &
HOST_PIDS+=($!)
sleep 0.5

echo "--- starting Control Plane on :8080 ---"
OSM_ENV=dev \
OSM_HTTP_ADDR=:8080 \
OSM_DATABASE_URL="sqlite://$TMP/api.db" \
OSM_REDIS_URL="redis://localhost:6390" \
OSM_DEV_EXPOSE_OTP=true \
OSM_PROXY_NODE_SECRET="$PROXY_SECRET" \
  "$TMP/api" > "$TMP/api.log" 2>&1 &
HOST_PIDS+=($!)
sleep 2

echo "--- starting proxy node (public :8000, tunnel :8001) ---"
OSM_PUBLIC_ADDR=:8000 \
OSM_TUNNEL_ADDR=:8001 \
OSM_REDIS_URL="redis://localhost:6390" \
OSM_CONTROL_PLANE_URL=http://localhost:8080 \
OSM_PROXY_NODE_SECRET="$PROXY_SECRET" \
OSM_NODE_ID=docker-smoke \
  "$TMP/proxy" > "$TMP/proxy.log" 2>&1 &
HOST_PIDS+=($!)
sleep 1

echo "--- creating user + device + verified domain + subdomain ---"
REG=$(curl -sf -X POST http://localhost:8080/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"docker@example.test","password":"hunter22","name":"Docker"}')
OTP=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin)['dev_otp'])")
COOKIES="$TMP/cookies.txt"
curl -sf -c "$COOKIES" -X POST http://localhost:8080/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"docker@example.test\",\"code\":\"$OTP\"}" > /dev/null
CSRF=$(curl -sf -b "$COOKIES" -c "$COOKIES" http://localhost:8080/api/v1/csrf \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['csrf_token'])")

sqlite3 "$TMP/api.db" "UPDATE users SET plan_id=(SELECT id FROM plans WHERE slug='pro') WHERE email='docker@example.test';"

DEVRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/devices \
  -d '{"name":"Docker Laptop","os_type":"linux"}')
DEV_ID=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['device']['id'])")
API_KEY=$(echo "$DEVRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['api_key'])")
echo "  device_id=$DEV_ID"

DOMRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST http://localhost:8080/api/v1/domains -d '{"fqdn":"dockertest.example"}')
DOM_ID=$(echo "$DOMRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
sqlite3 "$TMP/api.db" "UPDATE domains SET dns_status='verified' WHERE id='$DOM_ID';"

SUBRESP=$(curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/domains/$DOM_ID/subdomains" \
  -d '{"prefix":"api","target_port":3030}')
SUB_ID=$(echo "$SUBRESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -sf -X POST http://localhost:8080/api/v1/devices/heartbeat \
  -H "Authorization: Bearer $API_KEY" > /dev/null

curl -sf -b "$COOKIES" -H "X-CSRF-Token: $CSRF" -H "Content-Type: application/json" \
  -X POST "http://localhost:8080/api/v1/subdomains/$SUB_ID/bind" \
  -d "{\"device_id\":\"$DEV_ID\"}" > /dev/null
echo "  subdomain api.dockertest.example bound to device"

echo "--- starting container ($CONTAINER_NAME) ---"
docker run -d --name "$CONTAINER_NAME" \
  -e API_KEY="$API_KEY" \
  -e DEVICE_ID="$DEV_ID" \
  -e PROXY_URL=ws://host.docker.internal:8001/ws/tunnel \
  -e LOCAL_URL=http://127.0.0.1:3030 \
  "$IMAGE_TAG" > "$TMP/container.id"

CID=$(cat "$TMP/container.id" | head -c 12)
echo "  container started: $CID"
sleep 4
echo "  container logs (first lines):"
docker logs "$CONTAINER_NAME" 2>&1 | sed 's/^/    /' | head -10

echo
echo "--- visitor curl through proxy (Host: api.dockertest.example) ---"
RESPONSE=$(curl -s -H 'Host: api.dockertest.example' http://localhost:8000/hello?from=host)
echo "$RESPONSE"
echo

if echo "$RESPONSE" | grep -q '"served_by": "in-container local app"'; then
  CONTAINER_HOSTNAME=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['hostname'])")
  EXPECTED_HOSTNAME=$(docker exec "$CONTAINER_NAME" hostname)
  echo "  ✓ response came from container's app"
  echo "  ✓ container hostname:    $CONTAINER_HOSTNAME"
  echo "  ✓ docker reports hostname: $EXPECTED_HOSTNAME"
  if [ "$CONTAINER_HOSTNAME" = "$EXPECTED_HOSTNAME" ]; then
    echo
    echo "✓✓ DEMO PASSED — traffic routed across host/container boundary correctly"
  else
    echo "  ✗ hostname mismatch: got=$CONTAINER_HOSTNAME expected=$EXPECTED_HOSTNAME"
    exit 1
  fi
else
  echo "✗ DEMO FAILED — response does not contain expected marker"
  exit 1
fi

echo
echo "--- testing POST through tunnel ---"
POSTRESP=$(curl -s -X POST -d 'visitor-payload' -H 'Host: api.dockertest.example' \
  -H 'Content-Type: text/plain' http://localhost:8000/post-here)
echo "$POSTRESP" | python3 -m json.tool 2>/dev/null | head -20 || echo "$POSTRESP"
echo
echo "--- killing container to test holding state ---"
docker stop "$CONTAINER_NAME" > /dev/null 2>&1
sleep 3
echo "GET after container stop (expecting 503 Reconnecting):"
HOLD_CODE=$(curl -s -o "$TMP/hold.html" -w "%{http_code}" -H 'Host: api.dockertest.example' http://localhost:8000/)
echo "  HTTP $HOLD_CODE"
grep -q "Reconnecting" "$TMP/hold.html" && echo "  ✓ Holding state page served"

echo
echo "✓ smoke complete"
