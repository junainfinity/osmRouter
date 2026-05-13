// Package config loads the proxy node's runtime configuration from
// environment variables. All settings have sane dev defaults so the binary
// can be started with no setup beyond having Redis available.
package config

import (
	"errors"
	"os"
	"strconv"
)

// Config is the proxy node's runtime configuration.
type Config struct {
	// NodeID identifies this node in heartbeats and audit metadata.
	// Defaults to the OS hostname.
	NodeID string

	// PublicAddr is the visitor-facing HTTP listen address.
	PublicAddr string

	// TunnelAddr is the WebSocket listen address for desktop clients.
	// Separating the two ports lets operators front them with different
	// firewall rules (public is internet-facing; tunnel can be VPC-only
	// or behind mTLS in a future hardening pass).
	TunnelAddr string

	// RedisURL — required; used to look up live:<fqdn> mappings.
	RedisURL string

	// ControlPlaneURL — base URL of the Control Plane API.
	ControlPlaneURL string

	// SharedSecret — Bearer token used for proxy → Control Plane auth.
	// MUST be set in production. Empty allowed in dev (no ingest calls made).
	SharedSecret string

	// MaxBodyBytes overrides the per-request body cap from tunnel package.
	MaxBodyBytes int64
}

// Load reads env vars and returns a Config. Returns an error if a required
// var is missing.
func Load() (*Config, error) {
	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "proxy-unknown"
	}
	c := &Config{
		NodeID:          env("OSM_NODE_ID", hostname),
		PublicAddr:      env("OSM_PUBLIC_ADDR", ":8000"),
		TunnelAddr:      env("OSM_TUNNEL_ADDR", ":8001"),
		RedisURL:        env("OSM_REDIS_URL", "redis://localhost:6379"),
		ControlPlaneURL: env("OSM_CONTROL_PLANE_URL", "http://localhost:8080"),
		SharedSecret:    os.Getenv("OSM_PROXY_NODE_SECRET"),
		MaxBodyBytes:    envInt64("OSM_MAX_BODY_BYTES", 4*1024*1024),
	}
	if c.RedisURL == "" {
		return nil, errors.New("OSM_REDIS_URL is required")
	}
	return c, nil
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt64(k string, def int64) int64 {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}
