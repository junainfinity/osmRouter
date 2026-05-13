// Package ingest is the proxy node's HTTP client back to the Control Plane.
//
// All ingest calls are authenticated with a shared Bearer token configured
// via OSM_PROXY_NODE_SECRET. v1 uses a single secret across all nodes; per-
// node credentials are planned for v1.1 (see Planning/11 risk DR7).
package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client wraps HTTP calls to the Control Plane's /api/v1/proxy/* endpoints.
type Client struct {
	baseURL string
	secret  string
	nodeID  string
	http    *http.Client
}

// New returns a configured Client.
func New(baseURL, secret, nodeID string) *Client {
	return &Client{
		baseURL: baseURL,
		secret:  secret,
		nodeID:  nodeID,
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// VerifyDeviceResult is what the Control Plane returns when we present a
// device api_key for validation at tunnel-connect time.
type VerifyDeviceResult struct {
	Valid    bool   `json:"valid"`
	DeviceID string `json:"device_id"`
	UserID   string `json:"user_id"`
	Name     string `json:"name"`
}

// VerifyDevice validates a tunnel client's api_key. The Control Plane is the
// source of truth — proxy nodes hold no device records of their own.
func (c *Client) VerifyDevice(ctx context.Context, apiKey string) (*VerifyDeviceResult, error) {
	body, _ := json.Marshal(map[string]string{"api_key": apiKey})
	res, err := c.do(ctx, http.MethodPost, "/api/v1/proxy/devices/verify", body)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("verify device: %s", res.Status)
	}
	var out VerifyDeviceResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

// TunnelStarted reports a newly opened tunnel to the Control Plane. The
// returned TunnelID is the canonical ID we use in subsequent updates.
func (c *Client) TunnelStarted(ctx context.Context, deviceID, fqdn string) (tunnelID string, err error) {
	body, _ := json.Marshal(map[string]string{"device_id": deviceID, "host": fqdn, "node_id": c.nodeID})
	res, err := c.do(ctx, http.MethodPost, "/api/v1/proxy/tunnels/start", body)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusCreated && res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("tunnel start: %s", res.Status)
	}
	var out struct {
		TunnelID string `json:"tunnel_id"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return "", err
	}
	return out.TunnelID, nil
}

// TunnelEnded reports a closed tunnel with the final byte counter.
func (c *Client) TunnelEnded(ctx context.Context, tunnelID string, bytesTransferred int64) error {
	body, _ := json.Marshal(map[string]any{"bytes_transferred": bytesTransferred})
	res, err := c.do(ctx, http.MethodPost, "/api/v1/proxy/tunnels/"+tunnelID+"/end", body)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent && res.StatusCode != http.StatusOK {
		return fmt.Errorf("tunnel end: %s", res.Status)
	}
	return nil
}

// Heartbeat reports proxy-node liveness. Best-effort; errors are logged but
// shouldn't crash the node.
func (c *Client) Heartbeat(ctx context.Context, tunnels int) error {
	body, _ := json.Marshal(map[string]any{"node_id": c.nodeID, "tunnels": tunnels})
	res, err := c.do(ctx, http.MethodPost, "/api/v1/proxy/nodes/heartbeat", body)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 400 {
		b, _ := io.ReadAll(res.Body)
		return fmt.Errorf("heartbeat: %s: %s", res.Status, string(b))
	}
	return nil
}

func (c *Client) do(ctx context.Context, method, path string, body []byte) (*http.Response, error) {
	if c.baseURL == "" {
		return nil, errors.New("ingest: control plane url not configured")
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.secret)
	req.Header.Set("X-Proxy-Node-ID", c.nodeID)
	return c.http.Do(req)
}
