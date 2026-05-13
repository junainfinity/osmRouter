// Package tunnel defines the osmRouter tunnel wire protocol.
//
// CANONICAL: the authoritative specification for this protocol lives in
// `Planning/08 - Data Plane - Architecture.md`. This file MUST be kept in
// sync with its mirror in `tunnel-client/internal/tunnel/frame.go`. Any
// protocol change must update all three locations together.
//
// Wire format: WebSocket text frames carrying a single JSON object per frame.
// A single WebSocket connection multiplexes many concurrent visitor requests
// via a per-stream UUID (`stream_id`). The protocol is connection-stateful
// (the first frame must be `hello`) and otherwise mostly stateless per-frame.
package tunnel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// ProtocolVersion is bumped whenever a backward-incompatible change is made
// to any frame's shape or semantics. The client's `hello` carries the version
// it speaks; the server may refuse a mismatched version with an `error` frame.
const ProtocolVersion = "1"

// FrameType enumerates the legal `type` field of a frame.
type FrameType string

const (
	// FrameHello is the first frame sent by the client after WS upgrade.
	// Carries DeviceID + APIKey + Version. The server validates via the
	// Control Plane and, on success, replies with FrameHelloAck.
	FrameHello FrameType = "hello"

	// FrameHelloAck is the server's confirmation of a successful hello.
	// Carries the proxy node's identifier (NodeID).
	FrameHelloAck FrameType = "hello_ack"

	// FrameRequest is sent by the server when a public visitor request needs
	// to be forwarded into the client's local app. Carries StreamID + a full
	// HTTP request snapshot (method, URL, headers, base64-encoded body).
	FrameRequest FrameType = "request"

	// FrameResponse is sent by the client back over the tunnel after the
	// local app has handled the request. Carries StreamID + status + headers
	// + base64-encoded body.
	FrameResponse FrameType = "response"

	// FrameError signals an unrecoverable error for a stream (when StreamID
	// is non-empty) or for the entire connection (when StreamID is empty).
	FrameError FrameType = "error"

	// FramePing / FramePong are application-level keep-alives in addition to
	// the WebSocket-level ping/pong handshake. Some intermediaries drop the
	// WS pings; this layer is defense in depth.
	FramePing FrameType = "ping"
	FramePong FrameType = "pong"

	// FrameClose terminates a specific stream early (server-initiated).
	// Rare in v1; reserved for future use.
	FrameClose FrameType = "close"
)

// Frame is the canonical envelope for any wire message between proxy and
// tunnel client. Only the fields relevant to the Type are populated.
//
// Why a single struct rather than per-type structs? JSON unmarshal needs a
// concrete target, and a single struct keeps the codec one-shot. The cost
// is a slightly wider zero value; the trade is intentional.
type Frame struct {
	Type     FrameType `json:"type"`
	StreamID string    `json:"stream_id,omitempty"`

	// hello (client → server)
	DeviceID string `json:"device_id,omitempty"`
	APIKey   string `json:"api_key,omitempty"`
	Version  string `json:"version,omitempty"`

	// hello_ack (server → client)
	NodeID string `json:"node_id,omitempty"`

	// request (server → client)
	Method  string              `json:"method,omitempty"`
	URL     string              `json:"url,omitempty"`
	Headers map[string][]string `json:"headers,omitempty"`

	// response (client → server)
	Status int `json:"status,omitempty"`

	// Body shared by request and response — base64 to keep JSON-safe.
	BodyB64 string `json:"body_b64,omitempty"`

	// error
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

// Validate performs minimum structural validation. Used at frame ingress to
// reject obviously malformed input early.
func (f *Frame) Validate() error {
	if f.Type == "" {
		return fmt.Errorf("frame: type is required")
	}
	switch f.Type {
	case FrameHello:
		if f.DeviceID == "" || f.APIKey == "" {
			return fmt.Errorf("hello: device_id and api_key required")
		}
	case FrameRequest:
		if f.StreamID == "" || f.Method == "" || f.URL == "" {
			return fmt.Errorf("request: stream_id, method, url required")
		}
	case FrameResponse:
		if f.StreamID == "" || f.Status == 0 {
			return fmt.Errorf("response: stream_id, status required")
		}
	}
	return nil
}

// Marshal returns the wire bytes for the frame.
func (f *Frame) Marshal() ([]byte, error) {
	return json.Marshal(f)
}

// Unmarshal parses wire bytes into a frame.
func Unmarshal(b []byte) (*Frame, error) {
	var f Frame
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("frame: decode: %w", err)
	}
	return &f, nil
}

// EncodeBody base64-encodes raw bytes for placement in a frame's BodyB64.
// We use std (with padding) base64 because frames are not URL-borne.
func EncodeBody(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(raw)
}

// DecodeBody reverses EncodeBody.
func DecodeBody(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(s)
}

// MaxBodyBytes is the default request/response body cap enforced by both
// proxy and client. Configurable via env in callers. Documented limit in
// `Planning/10 §C2`.
const MaxBodyBytes = 4 * 1024 * 1024 // 4 MB
