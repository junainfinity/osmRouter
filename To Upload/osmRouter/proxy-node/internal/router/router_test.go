package router

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/osmrouter/proxy-node/internal/hub"
	"github.com/osmrouter/proxy-node/internal/tunnel"
)

type fakeMappings struct {
	m map[string]string
}

func (f *fakeMappings) LookupDevice(_ context.Context, host string) (string, error) {
	return f.m[host], nil
}

func discardLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

func TestRouter_NoMapping_Returns502(t *testing.T) {
	r := New(&fakeMappings{m: map[string]string{}}, hub.New(discardLogger()), discardLogger())
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "missing.test"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", rec.Code)
	}
}

func TestRouter_MappingButNoTunnel_ReturnsHolding503(t *testing.T) {
	r := New(&fakeMappings{m: map[string]string{"api.test": "dev-1"}}, hub.New(discardLogger()), discardLogger())
	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "api.test"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "Reconnecting") {
		t.Fatalf("expected holding page, got %q", rec.Body.String())
	}
}

func TestRouter_HappyPath_ForwardsAndReturnsResponse(t *testing.T) {
	h := hub.New(discardLogger())
	mappings := &fakeMappings{m: map[string]string{"api.test": "dev-1"}}

	// Spin up a real WebSocket pair so the Tunnel.WritePump has a live conn.
	// We need TWO ends of a WS: the proxy side (which we hold) and a client
	// side that will echo back a `response` frame.
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	clientReceivedRequest := make(chan struct{}, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("upgrade: %v", err)
		}
		// Fake tunnel client: reads request, echoes response.
		go func() {
			defer conn.Close()
			for {
				_, msg, err := conn.ReadMessage()
				if err != nil {
					return
				}
				frame, err := tunnel.Unmarshal(msg)
				if err != nil {
					return
				}
				if frame.Type == tunnel.FrameRequest {
					clientReceivedRequest <- struct{}{}
					resp := &tunnel.Frame{
						Type:     tunnel.FrameResponse,
						StreamID: frame.StreamID,
						Status:   200,
						Headers:  map[string][]string{"Content-Type": {"text/plain"}},
						BodyB64:  tunnel.EncodeBody([]byte("hi")),
					}
					b, _ := resp.Marshal()
					_ = conn.WriteMessage(websocket.TextMessage, b)
				}
			}
		}()
	}))
	defer srv.Close()

	// Dial the WS as if we were the proxy holding the tunnel side.
	dialer := websocket.DefaultDialer
	conn, _, err := dialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	tn := hub.NewTunnel(conn, "dev-1", "u-1", "node-test", discardLogger())
	// Drive the read pump: deliver inbound frames to the hub's stream registry.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			f, err := tunnel.Unmarshal(msg)
			if err != nil {
				continue
			}
			h.DeliverStream(f)
		}
	}()
	go tn.WritePump(30*time.Second, 5*time.Second)
	h.Register(tn)

	r := New(mappings, h, discardLogger())

	req := httptest.NewRequest("GET", "/", nil)
	req.Host = "api.test"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "hi" {
		t.Fatalf("expected body 'hi', got %q", rec.Body.String())
	}
	select {
	case <-clientReceivedRequest:
	case <-time.After(time.Second):
		t.Fatal("fake client never saw the request frame")
	}

	tn.Close()
	wg.Wait()
}

func TestRouter_RequestBodyTooLarge_Returns413(t *testing.T) {
	h := hub.New(discardLogger())
	r := New(&fakeMappings{m: map[string]string{"big.test": "dev-1"}}, h, discardLogger())
	r.maxBodyBytes = 16 // tiny for test

	// Register a tunnel so we get past the holding-state check.
	upgrader := websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, _ := upgrader.Upgrade(w, r, nil)
		_ = conn
	}))
	defer srv.Close()
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	tn := hub.NewTunnel(conn, "dev-1", "u-1", "node", discardLogger())
	go tn.WritePump(30*time.Second, 5*time.Second)
	h.Register(tn)

	big := strings.Repeat("X", 256)
	req := httptest.NewRequest("POST", "/", strings.NewReader(big))
	req.Host = "big.test"
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413, got %d", rec.Code)
	}
	tn.Close()
}
