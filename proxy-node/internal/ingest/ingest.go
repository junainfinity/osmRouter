// Package ingest calls the Control Plane to verify a sidecar's register
// frame. The Control Plane confirms (token → device, host → bound device)
// match, and approves or rejects the tunnel registration.
package ingest

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"
)

// Client wraps the Control Plane's /api/v1/proxy/* endpoints.
type Client struct {
	BaseURL string
	Secret  string
	NodeID  string
	HTTP    *http.Client
}

// New constructs an ingest client.
func New(baseURL, secret, nodeID string) *Client {
	return &Client{
		BaseURL: baseURL,
		Secret:  secret,
		NodeID:  nodeID,
		HTTP:    &http.Client{Timeout: 8 * time.Second},
	}
}

// VerifyResult is what the Control Plane returns when we ask
// "is this token+device authorized to serve this host?"
type VerifyResult struct {
	Valid    bool   `json:"valid"`
	DeviceID string `json:"device_id"`
	UserID   string `json:"user_id"`
	Reason   string `json:"reason,omitempty"`
}

// Verify presents the register-frame fields to the Control Plane.
// Returns Valid=true iff the device exists, isn't revoked, AND the host
// is currently bound to this device.
func (c *Client) Verify(ctx context.Context, token, deviceID, host string) (*VerifyResult, error) {
	body, _ := json.Marshal(map[string]string{
		"api_key":   token,
		"device_id": deviceID,
		"host":      host,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/v1/proxy/devices/verify", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	req.Header.Set("X-Proxy-Node-ID", c.NodeID)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, fmt.Errorf("verify: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("verify: status %s", res.Status)
	}
	var out VerifyResult
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("verify: decode: %w", err)
	}
	return &out, nil
}

// Heartbeat is fire-and-forget liveness from proxy to Control Plane.
func (c *Client) Heartbeat(ctx context.Context, tunnels int, hosts []string) error {
	if c.BaseURL == "" {
		return errors.New("ingest: control-plane url unset")
	}
	body, _ := json.Marshal(map[string]interface{}{
		"node_id":  c.NodeID,
		"tunnels":  tunnels,
		"hosts":    hosts,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/v1/proxy/nodes/heartbeat", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return nil
}

// TunnelStarted records an opening for audit purposes.
func (c *Client) TunnelStarted(ctx context.Context, deviceID, host string) (tunnelID string, err error) {
	body, _ := json.Marshal(map[string]string{
		"device_id": deviceID, "host": host, "node_id": c.NodeID,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/v1/proxy/tunnels/start", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	res, err := c.HTTP.Do(req)
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
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out.TunnelID, nil
}

// TunnelEnded records a closure.
func (c *Client) TunnelEnded(ctx context.Context, tunnelID string, bytesTransferred int64) error {
	if tunnelID == "" {
		return nil
	}
	body, _ := json.Marshal(map[string]int64{"bytes_transferred": bytesTransferred})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		c.BaseURL+"/api/v1/proxy/tunnels/"+tunnelID+"/end", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Secret)
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	return nil
}
