# Simulated "remote laptop" container for testing the osmRouter Data Plane.
#
# Inside the container:
#   - A tiny Python HTTP server listens on :3030 (the "local app")
#   - The tunnel-client connects out to the proxy node running on the host
#     and forwards traffic back to that local app.
#
# Build:    docker build -t osmrouter-test-laptop -f tunnel-client/Dockerfile tunnel-client/
# Run:      docker run --rm -e API_KEY=... -e DEVICE_ID=... -e PROXY_URL=...
#                       osmrouter-test-laptop
#
# `host.docker.internal` resolves to the host's IP from inside the container,
# letting the tunnel-client reach the proxy node running on the host.

# --- Stage 1: build the tunnel-client binary for the container's arch -------
# GOTOOLCHAIN=auto so Go fetches the right toolchain on demand based on go.mod.
FROM golang:1.24-alpine AS builder
ENV GOTOOLCHAIN=auto
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/osmrouter-client ./cmd/osmrouter-client

# --- Stage 2: runtime container with python + the binary --------------------
FROM alpine:3.20
RUN apk add --no-cache python3 ca-certificates && \
    addgroup -S osm && adduser -S osm -G osm

WORKDIR /app
COPY --from=builder /out/osmrouter-client /app/osmrouter-client
COPY docker/local-app.py    /app/local-app.py
COPY docker/entrypoint.sh   /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh /app/osmrouter-client

USER osm

# LOCAL_PORT is the port the in-container "local app" listens on.
ENV LOCAL_PORT=3030 \
    PROXY_URL=ws://host.docker.internal:8001/ws/tunnel \
    LOCAL_URL=http://127.0.0.1:3030

ENTRYPOINT ["/app/entrypoint.sh"]
