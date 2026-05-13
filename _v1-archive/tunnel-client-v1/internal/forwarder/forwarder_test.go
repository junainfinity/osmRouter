package forwarder

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/osmrouter/tunnel-client/internal/tunnel"
)

func TestForwarder_HappyPath_GET(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Greeting", "hi")
		_, _ = w.Write([]byte("local-response"))
	}))
	defer srv.Close()

	f := New(srv.URL)
	resp := f.Forward(context.Background(), &tunnel.Frame{
		Type:     tunnel.FrameRequest,
		StreamID: "s1",
		Method:   "GET",
		URL:      "/",
	})
	if resp.Type != tunnel.FrameResponse {
		t.Fatalf("expected response frame, got %+v", resp)
	}
	if resp.Status != 200 {
		t.Fatalf("expected 200, got %d", resp.Status)
	}
	if v := resp.Headers["X-Greeting"]; len(v) == 0 || v[0] != "hi" {
		t.Fatalf("expected X-Greeting header preserved, got %+v", resp.Headers)
	}
	body, _ := tunnel.DecodeBody(resp.BodyB64)
	if string(body) != "local-response" {
		t.Fatalf("body mismatch: %q", body)
	}
}

func TestForwarder_LocalAppDown_ReturnsErrorFrame(t *testing.T) {
	// Point at an unbound port.
	f := New("http://127.0.0.1:1")
	resp := f.Forward(context.Background(), &tunnel.Frame{
		Type: tunnel.FrameRequest, StreamID: "s1", Method: "GET", URL: "/",
	})
	if resp.Type != tunnel.FrameError {
		t.Fatalf("expected error frame, got %+v", resp)
	}
	if resp.Code != "UPSTREAM_DOWN" {
		t.Fatalf("expected UPSTREAM_DOWN, got %q", resp.Code)
	}
}

func TestForwarder_POSTBody_RoundTrip(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		w.WriteHeader(202)
		_, _ = w.Write([]byte("got:" + string(b)))
	}))
	defer srv.Close()

	f := New(srv.URL)
	resp := f.Forward(context.Background(), &tunnel.Frame{
		Type:     tunnel.FrameRequest,
		StreamID: "s1",
		Method:   "POST",
		URL:      "/x",
		Headers:  map[string][]string{"Content-Type": {"text/plain"}},
		BodyB64:  tunnel.EncodeBody([]byte("hello")),
	})
	if resp.Status != 202 {
		t.Fatalf("expected 202, got %d", resp.Status)
	}
	body, _ := tunnel.DecodeBody(resp.BodyB64)
	if string(body) != "got:hello" {
		t.Fatalf("body mismatch: %q", body)
	}
}

func TestForwarder_ResponseTooLarge_ReturnsErrorFrame(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(strings.Repeat("x", 200)))
	}))
	defer srv.Close()

	f := New(srv.URL)
	f.maxBody = 16
	resp := f.Forward(context.Background(), &tunnel.Frame{
		Type: tunnel.FrameRequest, StreamID: "s1", Method: "GET", URL: "/",
	})
	if resp.Type != tunnel.FrameError || resp.Code != "RESPONSE_TOO_LARGE" {
		t.Fatalf("expected RESPONSE_TOO_LARGE, got %+v", resp)
	}
}
