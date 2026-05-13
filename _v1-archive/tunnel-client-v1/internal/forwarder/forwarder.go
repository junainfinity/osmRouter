// Package forwarder converts incoming tunnel `request` frames into local
// HTTP calls against the user's app, and converts the local response back
// into a tunnel `response` frame.
package forwarder

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/osmrouter/tunnel-client/internal/tunnel"
)

// Forwarder issues HTTP requests to the local app on behalf of tunnel frames.
type Forwarder struct {
	target     string // e.g. "http://localhost:3000"
	httpClient *http.Client
	maxBody    int64
}

// New constructs a Forwarder. `target` is the base URL of the user's local app.
func New(target string) *Forwarder {
	return &Forwarder{
		target: target,
		httpClient: &http.Client{
			Timeout: 25 * time.Second, // less than proxy's 30s to always reply first
		},
		maxBody: tunnel.MaxBodyBytes,
	}
}

// Forward converts a `request` Frame into a local HTTP call and returns the
// `response` Frame to send back. On any error (connection refused, timeout,
// body too big), the returned Frame is type=error with a useful message —
// callers should still send it over the tunnel so the visitor gets a 502
// instead of hanging.
func (f *Forwarder) Forward(ctx context.Context, in *tunnel.Frame) *tunnel.Frame {
	body, err := tunnel.DecodeBody(in.BodyB64)
	if err != nil {
		return errResp(in.StreamID, "BAD_BODY", "failed to decode request body")
	}
	req, err := http.NewRequestWithContext(ctx, in.Method, f.target+in.URL, bytes.NewReader(body))
	if err != nil {
		return errResp(in.StreamID, "BAD_REQUEST", err.Error())
	}
	for k, vs := range in.Headers {
		// Skip headers that http.Client / net.http manages itself.
		switch k {
		case "Host", "Content-Length", "Connection":
			continue
		}
		req.Header[k] = vs
	}
	// Re-set Content-Length explicitly so the local app sees a sane value.
	if len(body) > 0 {
		req.Header.Set("Content-Length", strconv.Itoa(len(body)))
	}

	res, err := f.httpClient.Do(req)
	if err != nil {
		return errResp(in.StreamID, "UPSTREAM_DOWN", "local app unreachable: "+err.Error())
	}
	defer res.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(res.Body, f.maxBody+1))
	if err != nil {
		return errResp(in.StreamID, "READ_RESPONSE_FAILED", err.Error())
	}
	if int64(len(respBody)) > f.maxBody {
		return errResp(in.StreamID, "RESPONSE_TOO_LARGE", "local app response exceeded 4MB cap")
	}

	out := &tunnel.Frame{
		Type:     tunnel.FrameResponse,
		StreamID: in.StreamID,
		Status:   res.StatusCode,
		Headers:  map[string][]string{},
		BodyB64:  tunnel.EncodeBody(respBody),
	}
	for k, vs := range res.Header {
		out.Headers[k] = append([]string(nil), vs...)
	}
	return out
}

func errResp(streamID, code, msg string) *tunnel.Frame {
	return &tunnel.Frame{
		Type:     tunnel.FrameError,
		StreamID: streamID,
		Code:     code,
		Message:  msg,
	}
}
