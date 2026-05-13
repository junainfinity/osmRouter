package server

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestProxyIngest_RequiresBearer(t *testing.T) {
	ta := newTestApp(t)

	res := ta.do(http.MethodPost, "/api/v1/proxy/devices/verify", map[string]string{"api_key": "x"})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 without Bearer, got %d", res.StatusCode)
	}
}

func TestProxyIngest_WrongBearer_Rejected(t *testing.T) {
	ta := newTestApp(t)
	// Test config doesn't set ProxyNodeSecret; let's set it
	ta.cfg.ProxyNodeSecret = "right-secret"
	// Rebuild
	ta.app, _ = New(Deps{Config: ta.cfg, DB: ta.db, Logger: ta.app.logger, Resolver: ta.resolver})

	res := ta.do(http.MethodPost, "/api/v1/proxy/devices/verify", map[string]string{"api_key": "x"},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer wrong") })
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong Bearer, got %d", res.StatusCode)
	}
}

func TestProxyIngest_VerifyDevice_HappyPath(t *testing.T) {
	ta := newTestApp(t)
	ta.cfg.ProxyNodeSecret = "secret-xyz"
	ta.app, _ = New(Deps{Config: ta.cfg, DB: ta.db, Logger: ta.app.logger, Resolver: ta.resolver})

	// Set up a user + device via the normal API
	sess := registerAndVerify(t, ta, "proxytest@example.com", "hunter22")
	upgradeToPro(t, ta, "proxytest@example.com")
	res := sess.do(http.MethodPost, "/api/v1/devices", map[string]string{
		"name": "M4 Max", "os_type": "macos",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("device create status %d", res.StatusCode)
	}
	var dev struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
		APIKey string `json:"api_key"`
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	_ = json.Unmarshal(body, &dev)
	if dev.APIKey == "" {
		t.Fatalf("expected api_key in body: %s", body)
	}

	// Now call /proxy/devices/verify as the proxy node would
	res = ta.do(http.MethodPost, "/api/v1/proxy/devices/verify", map[string]string{"api_key": dev.APIKey},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer secret-xyz") })
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("verify status %d body=%s", res.StatusCode, body)
	}
	var vr struct {
		Valid    bool   `json:"valid"`
		DeviceID string `json:"device_id"`
		UserID   string `json:"user_id"`
	}
	_ = json.NewDecoder(res.Body).Decode(&vr)
	if !vr.Valid {
		t.Fatalf("expected valid=true, got %+v", vr)
	}
	if vr.DeviceID != dev.Device.ID {
		t.Fatalf("device_id mismatch")
	}
}

func TestProxyIngest_VerifyDevice_UnknownKey(t *testing.T) {
	ta := newTestApp(t)
	ta.cfg.ProxyNodeSecret = "secret"
	ta.app, _ = New(Deps{Config: ta.cfg, DB: ta.db, Logger: ta.app.logger, Resolver: ta.resolver})

	res := ta.do(http.MethodPost, "/api/v1/proxy/devices/verify", map[string]string{"api_key": "nope"},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer secret") })
	if res.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 with valid=false, got %d", res.StatusCode)
	}
	var vr struct {
		Valid bool `json:"valid"`
	}
	_ = json.NewDecoder(res.Body).Decode(&vr)
	if vr.Valid {
		t.Fatal("expected valid=false for unknown api_key")
	}
}

func TestProxyIngest_TunnelLifecycle(t *testing.T) {
	ta := newTestApp(t)
	ta.cfg.ProxyNodeSecret = "s"
	ta.app, _ = New(Deps{Config: ta.cfg, DB: ta.db, Logger: ta.app.logger, Resolver: ta.resolver})

	// User + device + verified domain + subdomain
	sess := registerAndVerify(t, ta, "tn@example.com", "hunter22")
	upgradeToPro(t, ta, "tn@example.com")
	res := sess.do(http.MethodPost, "/api/v1/devices", map[string]string{"name": "M4", "os_type": "macos"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("device create status %d", res.StatusCode)
	}
	var dev struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
		APIKey string `json:"api_key"`
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	_ = json.Unmarshal(body, &dev)

	res = sess.do(http.MethodPost, "/api/v1/domains", map[string]string{"fqdn": "tn.test"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("domain create status %d", res.StatusCode)
	}
	var dom struct {
		ID string `json:"id"`
	}
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	_ = json.Unmarshal(body, &dom)
	if dom.ID == "" {
		t.Fatalf("expected domain id, got body=%s", body)
	}
	_ = ta.db.Exec("UPDATE domains SET dns_status='verified' WHERE id=?", dom.ID).Error

	res = sess.do(http.MethodPost, "/api/v1/domains/"+dom.ID+"/subdomains", map[string]any{"prefix": "api", "target_port": 3000})
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("subdomain create status %d body=%s", res.StatusCode, body)
	}

	// Start a tunnel via proxy ingest
	res = ta.do(http.MethodPost, "/api/v1/proxy/tunnels/start",
		map[string]string{"device_id": dev.Device.ID, "host": "api.tn.test", "node_id": "node-test"},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer s") })
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("tunnel start status %d body=%s", res.StatusCode, body)
	}
	var startResp struct {
		TunnelID string `json:"tunnel_id"`
	}
	_ = json.NewDecoder(res.Body).Decode(&startResp)
	if startResp.TunnelID == "" {
		t.Fatal("expected tunnel_id")
	}

	// End the tunnel
	res = ta.do(http.MethodPost, "/api/v1/proxy/tunnels/"+startResp.TunnelID+"/end",
		map[string]any{"bytes_transferred": 1024},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer s") })
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("tunnel end status %d", res.StatusCode)
	}

	// Heartbeat
	res = ta.do(http.MethodPost, "/api/v1/proxy/nodes/heartbeat",
		map[string]any{"node_id": "node-test", "tunnels": 0},
		func(req *http.Request) { req.Header.Set("Authorization", "Bearer s") })
	if res.StatusCode != http.StatusOK {
		t.Fatalf("heartbeat status %d", res.StatusCode)
	}
}
