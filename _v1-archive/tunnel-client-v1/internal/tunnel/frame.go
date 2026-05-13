// Package tunnel defines the osmRouter tunnel wire protocol — CLIENT MIRROR.
//
// CANONICAL: this is a literal mirror of `proxy-node/internal/tunnel/frame.go`.
// Any change to the protocol MUST update three files together:
//   1. proxy-node/internal/tunnel/frame.go (server side)
//   2. tunnel-client/internal/tunnel/frame.go (this file)
//   3. Planning/08 - Data Plane - Architecture.md
package tunnel

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
)

const ProtocolVersion = "1"

type FrameType string

const (
	FrameHello    FrameType = "hello"
	FrameHelloAck FrameType = "hello_ack"
	FrameRequest  FrameType = "request"
	FrameResponse FrameType = "response"
	FrameError    FrameType = "error"
	FramePing     FrameType = "ping"
	FramePong     FrameType = "pong"
	FrameClose    FrameType = "close"
)

type Frame struct {
	Type     FrameType `json:"type"`
	StreamID string    `json:"stream_id,omitempty"`
	DeviceID string    `json:"device_id,omitempty"`
	APIKey   string    `json:"api_key,omitempty"`
	Version  string    `json:"version,omitempty"`
	NodeID   string    `json:"node_id,omitempty"`
	Method   string              `json:"method,omitempty"`
	URL      string              `json:"url,omitempty"`
	Headers  map[string][]string `json:"headers,omitempty"`
	Status   int                 `json:"status,omitempty"`
	BodyB64  string              `json:"body_b64,omitempty"`
	Code     string              `json:"code,omitempty"`
	Message  string              `json:"message,omitempty"`
}

func (f *Frame) Marshal() ([]byte, error) { return json.Marshal(f) }

func Unmarshal(b []byte) (*Frame, error) {
	var f Frame
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("frame: decode: %w", err)
	}
	return &f, nil
}

func EncodeBody(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(raw)
}

func DecodeBody(s string) ([]byte, error) {
	if s == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(s)
}

const MaxBodyBytes = 4 * 1024 * 1024
