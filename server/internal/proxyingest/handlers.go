package proxyingest

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/audit"
	"github.com/osmrouter/server/internal/models"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
	"github.com/osmrouter/server/internal/platform/ws"
	"gorm.io/gorm"
)

// Handlers exposes the ingest HTTP endpoints. Mounted under /api/v1/proxy.
type Handlers struct {
	db     *gorm.DB
	hub    *ws.Hub
	auditw *audit.Writer
}

// New constructs Handlers.
func New(db *gorm.DB, hub *ws.Hub, auditw *audit.Writer) *Handlers {
	return &Handlers{db: db, hub: hub, auditw: auditw}
}

// VerifyDevice validates a sidecar's register-frame against:
//   1. the devices table — api_key must be valid and device not revoked
//   2. (v0.2+) the subdomains table — `host` (if provided) must be bound
//      to *this* device. Prevents a stolen API key from being used to
//      claim someone else's domain.
//
// Backward-compatible: callers that omit `host` (old proxy-node v1) get
// only the device check, same as before.
func (h *Handlers) VerifyDevice(c echo.Context) error {
	var req struct {
		APIKey   string `json:"api_key"`
		DeviceID string `json:"device_id"`
		Host     string `json:"host"`
	}
	if err := c.Bind(&req); err != nil || req.APIKey == "" {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "api_key required"))
	}
	var d models.Device
	err := h.db.WithContext(c.Request().Context()).
		Where("api_key_hash = ? AND revoked_at IS NULL", cr.SHA256Hex(req.APIKey)).
		First(&d).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return c.JSON(http.StatusOK, map[string]any{"valid": false, "reason": "unknown api_key"})
		}
		return httpx.WriteError(c, err)
	}
	// If client asserts a device_id, it must match the one we resolved.
	if req.DeviceID != "" && req.DeviceID != d.ID {
		return c.JSON(http.StatusOK, map[string]any{"valid": false, "reason": "device_id mismatch"})
	}

	// v0.2 host binding check.
	if req.Host != "" {
		ok, err := h.hostBoundToDevice(c.Request().Context(), req.Host, d.ID)
		if err != nil {
			return httpx.WriteError(c, err)
		}
		if !ok {
			return c.JSON(http.StatusOK, map[string]any{
				"valid":  false,
				"reason": "host not bound to this device",
			})
		}
	}

	return c.JSON(http.StatusOK, map[string]any{
		"valid":     true,
		"device_id": d.ID,
		"user_id":   d.UserID,
		"name":      d.Name,
	})
}

// hostBoundToDevice checks whether the given full hostname is currently
// bound to the given device.
//
// We try EVERY plausible split: strip labels from the LEFT one at a
// time and check whether the remainder matches a Domain row + the left
// part matches the Subdomain prefix. Robust to any number of left
// labels (subdomain hierarchies) without needing a public-suffix list.
//
// Example: host="app.todo.localtest.me" tries:
//   prefix=""             fqdn="app.todo.localtest.me"
//   prefix="app"          fqdn="todo.localtest.me"           ← matches
//   prefix="app.todo"     fqdn="localtest.me"
func (h *Handlers) hostBoundToDevice(ctx context.Context, host, deviceID string) (bool, error) {
	labels := strings.Split(host, ".")
	for i := 0; i <= len(labels); i++ {
		prefix := strings.Join(labels[:i], ".")
		fqdn := strings.Join(labels[i:], ".")
		if fqdn == "" {
			continue
		}
		// Subdomain match
		var n int64
		err := h.db.WithContext(ctx).Raw(`
            SELECT COUNT(*) FROM subdomains s
            JOIN domains d ON d.id = s.parent_domain_id
            WHERE d.fqdn = ? AND s.prefix = ? AND s.bound_device_id = ?`,
			fqdn, prefix, deviceID).Row().Scan(&n)
		if err == nil && n > 0 {
			return true, nil
		}
	}
	return false, nil
}

// TunnelStart records the opening of a new tunnel. The proxy passes
// device_id + host (the FQDN the visitor hit) + node_id (which proxy).
// We resolve the subdomain row by host and create a tunnels row.
func (h *Handlers) TunnelStart(c echo.Context) error {
	var req struct {
		DeviceID string `json:"device_id"`
		Host     string `json:"host"`
		NodeID   string `json:"node_id"`
	}
	if err := c.Bind(&req); err != nil || req.DeviceID == "" || req.Host == "" {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "device_id and host required"))
	}
	// Resolve subdomain id by host (split prefix.fqdn or apex match).
	prefix, fqdn := splitHost(req.Host)
	var subID string
	q := h.db.WithContext(c.Request().Context()).
		Raw(`SELECT s.id FROM subdomains s
		     JOIN domains d ON d.id = s.parent_domain_id
		     WHERE d.fqdn = ? AND s.prefix = ?`, fqdn, prefix).Row()
	_ = q.Scan(&subID)
	if subID == "" {
		// No matching subdomain row — apex domain only?
		_ = h.db.WithContext(c.Request().Context()).
			Raw(`SELECT id FROM domains WHERE fqdn = ?`, fqdn).Row().Scan(&subID)
	}
	t := models.Tunnel{
		ID:          uuid.NewString(),
		SubdomainID: subID,
		DeviceID:    req.DeviceID,
		ProxyNodeID: req.NodeID,
		StartedAt:   time.Now(),
	}
	if err := h.db.WithContext(c.Request().Context()).Create(&t).Error; err != nil {
		return httpx.WriteError(c, err)
	}

	// Resolve user_id to publish WS event
	var userID string
	_ = h.db.WithContext(c.Request().Context()).Raw(`SELECT user_id FROM devices WHERE id = ?`, req.DeviceID).Row().Scan(&userID)
	if userID != "" {
		h.hub.PublishTo(userID, ws.Event{
			Type: "tunnel.opened",
			Data: map[string]any{"tunnel_id": t.ID, "host": req.Host, "device_id": req.DeviceID, "node_id": req.NodeID},
		})
	}
	return c.JSON(http.StatusCreated, map[string]string{"tunnel_id": t.ID})
}

// TunnelEnd records tunnel closure with a final byte counter.
func (h *Handlers) TunnelEnd(c echo.Context) error {
	id := c.Param("id")
	var req struct {
		BytesTransferred int64 `json:"bytes_transferred"`
	}
	_ = json.NewDecoder(c.Request().Body).Decode(&req)

	now := time.Now()
	res := h.db.WithContext(c.Request().Context()).Model(&models.Tunnel{}).
		Where("id = ? AND ended_at IS NULL", id).
		Updates(map[string]any{
			"ended_at":          &now,
			"bytes_transferred": req.BytesTransferred,
		})
	if res.Error != nil {
		return httpx.WriteError(c, res.Error)
	}
	if res.RowsAffected == 0 {
		return c.NoContent(http.StatusNoContent) // idempotent
	}

	// Publish to user.
	var t models.Tunnel
	if err := h.db.WithContext(c.Request().Context()).Where("id = ?", id).First(&t).Error; err == nil {
		var userID string
		_ = h.db.WithContext(c.Request().Context()).Raw(`SELECT user_id FROM devices WHERE id = ?`, t.DeviceID).Row().Scan(&userID)
		if userID != "" {
			h.hub.PublishTo(userID, ws.Event{
				Type: "tunnel.closed",
				Data: map[string]any{"tunnel_id": t.ID, "bytes_transferred": req.BytesTransferred},
			})
		}
	}
	return c.NoContent(http.StatusNoContent)
}

// Heartbeat receives a proxy-node liveness ping. Best-effort recorded as an
// audit log entry; no separate proxy_nodes table in v1.
func (h *Handlers) Heartbeat(c echo.Context) error {
	var req struct {
		NodeID  string `json:"node_id"`
		Tunnels int    `json:"tunnels"`
	}
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	// Light-touch: keep it observable but not heavy. Just respond OK; surface
	// in logs via the AccessLog middleware on the server side.
	return c.JSON(http.StatusOK, map[string]any{
		"node_id":          req.NodeID,
		"reported_tunnels": req.Tunnels,
		"server_time":      time.Now().Unix(),
	})
}

// splitHost separates an FQDN like `api.acme.test` into (prefix, fqdn) per
// our schema. For apex `acme.test`, prefix is "".
//
// This is heuristic: we treat the most specific 2-label suffix as the domain
// (which works for `acme.test`, `acme.com`, `mycoolstartup.io`) and anything
// to the left as the prefix. For real eTLDs like `co.uk`, we'd consult a
// public-suffix-list — out of scope for v1.
func splitHost(host string) (prefix, fqdn string) {
	for i := 0; i < len(host); i++ {
		if host[i] == ':' {
			host = host[:i]
			break
		}
	}
	// Find the rightmost two labels.
	dotCount := 0
	splitAt := -1
	for i := len(host) - 1; i >= 0; i-- {
		if host[i] == '.' {
			dotCount++
			if dotCount == 2 {
				splitAt = i
				break
			}
		}
	}
	if splitAt < 0 {
		return "", host
	}
	return host[:splitAt], host[splitAt+1:]
}
