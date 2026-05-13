#!/usr/bin/env bash
#
# init-ca.sh — mint the operator's root CA + a leaf cert for the proxy.
#
# Run once per install. Re-run to ROTATE the leaf (within a 2-week dual
# trust window). Re-run with --rotate-root to mint a fresh root + leaf
# (requires re-shipping clients).
#
#   ./scripts/init-ca.sh [--out <dir>] [--rotate-root]
#
# Outputs into the chosen dir (default ./ca/):
#   root.key            — DON'T ship this. Locked-down on operator box.
#   root.pem            — Root CA. Ship into both proxy & sidecar binaries.
#   proxy-leaf.pem      — Mount into proxy container.
#   proxy-leaf.key      — Mount into proxy container.
#
# Subject Alternative Names on the leaf cover the tunnel endpoint
# hostnames the sidecar is allowed to dial. Edit SAN_LIST below.
set -euo pipefail

OUT_DIR="./ca"
ROTATE_ROOT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="$2"; shift 2;;
    --rotate-root) ROTATE_ROOT=true; shift;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

# Comma-separated SAN list for the proxy's leaf cert. Adjust for prod.
SAN_LIST="${SAN_LIST:-DNS:localhost,DNS:tunnel.osmrouter.test.localtest.me,IP:127.0.0.1}"
ROOT_DAYS=3650
LEAF_DAYS=90
KEY_CURVE=secp384r1

mkdir -p "$OUT_DIR"
cd "$OUT_DIR"

mint_root() {
  echo "→ generating new root CA ($ROOT_DAYS days)"
  openssl ecparam -genkey -name "$KEY_CURVE" -noout -out root.key
  chmod 600 root.key
  openssl req -x509 -new -nodes -key root.key -sha384 -days "$ROOT_DAYS" \
    -subj "/CN=osmRouter Operator Root CA/O=osmRouter" \
    -addext "basicConstraints=critical,CA:true,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out root.pem
}

mint_leaf() {
  echo "→ generating proxy leaf cert ($LEAF_DAYS days, SANs=$SAN_LIST)"
  openssl ecparam -genkey -name "$KEY_CURVE" -noout -out proxy-leaf.key
  chmod 600 proxy-leaf.key
  cat > /tmp/osm-leaf.cnf <<EOF
[req]
distinguished_name=req
[v3]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN_LIST
EOF
  openssl req -new -key proxy-leaf.key -subj "/CN=osmrouter-proxy" -out /tmp/osm-leaf.csr
  openssl x509 -req -in /tmp/osm-leaf.csr -CA root.pem -CAkey root.key \
    -CAcreateserial -days "$LEAF_DAYS" -sha384 -extensions v3 \
    -extfile /tmp/osm-leaf.cnf -out proxy-leaf.pem
  rm -f /tmp/osm-leaf.csr /tmp/osm-leaf.cnf
}

if [[ ! -f root.pem ]] || $ROTATE_ROOT; then
  mint_root
fi
mint_leaf

echo
echo "✓ done. Files in: $OUT_DIR"
ls -la
echo
echo "Next steps:"
echo "  - Mount proxy-leaf.{pem,key} + root.pem into the proxy container"
echo "  - Embed root.pem into the Mac sidecar binary (build-time //go:embed)"
echo "  - Rotate proxy-leaf every ~60 days; rotate root every several years"
