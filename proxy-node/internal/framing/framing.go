// Package framing handles the single-line JSON register frame the sidecar
// sends immediately after the TLS handshake completes — and the proxy's
// single-line JSON ack/reject response.
//
// Why a custom framing layer at all? After the TLS handshake but before
// HTTP/2 starts, we need exactly ONE round-trip of metadata so the proxy
// can identify which device + host this connection serves and decide
// whether to accept it. We can't use HTTP/2 frames yet — the proxy would
// need to be the H2 server, but right after TLS handshake the proxy will
// switch into the H2 *client* role for the rest of the connection. So we
// borrow one application-level exchange before that flip.
//
// CRITICAL: this code must read bytes one at a time until `\n`. Using a
// bufio.Reader would over-read into the HTTP/2 preface and corrupt the
// connection (see Planning/16 §DR-D5). Tested by TestHandshake_ByteByByte.
package framing

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"time"
)

// MaxFrameBytes caps the size of a single register/response frame. 4 KB
// is plenty for the JSON shapes we use and bounds our memory exposure if
// a misbehaving client sends a multi-MB line without a newline.
const MaxFrameBytes = 4 * 1024

// ProtocolVersion is the wire version. Bumped on any breaking change.
const ProtocolVersion = 1

// RegisterFrame is the sidecar → proxy first message.
type RegisterFrame struct {
	Version  int    `json:"v"`
	DeviceID string `json:"device_id"`
	Token    string `json:"token"`
	Host     string `json:"host"`
	Client   string `json:"client,omitempty"`
}

// RegisterResponse is the proxy → sidecar reply.
type RegisterResponse struct {
	OK          bool   `json:"ok"`
	NodeID      string `json:"node_id,omitempty"`
	KeepaliveMS int    `json:"keepalive_ms,omitempty"`
	Code        string `json:"code,omitempty"`
	Message     string `json:"message,omitempty"`
}

// Errors with stable codes — surfaced into the proxy's logs and the
// sidecar's stderr.
var (
	ErrFrameOverSize = errors.New("framing: register frame exceeds 4096 bytes")
	ErrFrameTimeout  = errors.New("framing: register frame read timed out")
	ErrInvalidJSON   = errors.New("framing: register frame is not valid JSON")
	ErrMissingFields = errors.New("framing: register frame missing required field")
)

// ReadRegisterFrame consumes bytes from conn one byte at a time until
// '\n' or MaxFrameBytes is reached. The trailing '\n' is consumed but not
// returned. The deadline guards against a slow-loris-style attack where a
// connection sits open without sending the frame.
//
// IMPORTANT: caller must NOT have wrapped conn in a buffered reader.
// After this returns, conn's read pointer is exactly at the byte
// following '\n', so the HTTP/2 preface that follows is intact.
func ReadRegisterFrame(conn net.Conn, deadline time.Duration) (*RegisterFrame, error) {
	if deadline > 0 {
		_ = conn.SetReadDeadline(time.Now().Add(deadline))
		defer func() { _ = conn.SetReadDeadline(time.Time{}) }()
	}
	buf := make([]byte, 0, 512)
	one := make([]byte, 1)
	for {
		n, err := conn.Read(one)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil, fmt.Errorf("framing: EOF after %d bytes: %w", len(buf), err)
			}
			return nil, fmt.Errorf("framing: read: %w", err)
		}
		if n == 0 {
			continue
		}
		if one[0] == '\n' {
			break
		}
		buf = append(buf, one[0])
		if len(buf) > MaxFrameBytes {
			return nil, ErrFrameOverSize
		}
	}
	var f RegisterFrame
	if err := json.Unmarshal(buf, &f); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidJSON, err)
	}
	if f.Version == 0 {
		f.Version = 1
	}
	if f.DeviceID == "" || f.Token == "" || f.Host == "" {
		return nil, ErrMissingFields
	}
	return &f, nil
}

// WriteRegisterResponse marshals the response and writes it as one line.
// Writing is buffered into a single Write call so we don't accidentally
// emit a partial line.
func WriteRegisterResponse(conn net.Conn, r *RegisterResponse) error {
	b, err := json.Marshal(r)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	_, err = conn.Write(b)
	return err
}
