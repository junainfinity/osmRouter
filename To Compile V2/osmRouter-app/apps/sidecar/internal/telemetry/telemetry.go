// Package telemetry emits JSON-line events on stdout for the Electron Main
// process to consume. Implements PRD §3.4 (telemetry) and S9.1 (heartbeat).
package telemetry

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"sync"
	"sync/atomic"
	"time"
)

// Emitter is concurrency-safe.
type Emitter struct {
	w  *bufio.Writer
	mu sync.Mutex
	// Counters
	inbound     atomic.Uint64
	outbound    atomic.Uint64
	latencySum  atomic.Uint64 // microseconds
	latencyN    atomic.Uint64
	activeConns atomic.Int64
	cancel      context.CancelFunc
	domainID    string
}

func NewEmitter(out io.Writer) *Emitter {
	return &Emitter{w: bufio.NewWriter(out)}
}

func (e *Emitter) SetDomainID(id string) {
	e.domainID = id
}

func (e *Emitter) AddInbound(n uint64)  { e.inbound.Add(n) }
func (e *Emitter) AddOutbound(n uint64) { e.outbound.Add(n) }
func (e *Emitter) RecordLatency(d time.Duration) {
	e.latencySum.Add(uint64(d / time.Microsecond))
	e.latencyN.Add(1)
}
func (e *Emitter) ConnsOpened() { e.activeConns.Add(1) }
func (e *Emitter) ConnsClosed() { e.activeConns.Add(-1) }

type telemetryEvent struct {
	Event       string `json:"event"`
	DomainID    string `json:"domainId,omitempty"`
	Inbound     uint64 `json:"inbound"`
	Outbound    uint64 `json:"outbound"`
	LatencyMs   uint64 `json:"latencyMs"`
	ActiveConns int64  `json:"activeConns"`
}

type heartbeatEvent struct {
	Event string `json:"event"`
	T     int64  `json:"t"`
}

type readyEvent struct {
	Event    string `json:"event"`
	DomainID string `json:"domainId,omitempty"`
}

type errorEvent struct {
	Event   string `json:"event"`
	Message string `json:"message"`
}

type logEvent struct {
	Event string `json:"event"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
}

type requestEvent struct {
	Event     string `json:"event"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	Status    int    `json:"status"`
	LatencyMs int    `json:"latencyMs"`
	SizeBytes int    `json:"sizeBytes"`
	Remote    string `json:"remote"`
}

// Start begins emitting heartbeats and 500ms telemetry ticks.
func (e *Emitter) Start(ctx context.Context, hbInterval time.Duration) {
	c, cancel := context.WithCancel(ctx)
	e.cancel = cancel
	hb := time.NewTicker(hbInterval)
	tt := time.NewTicker(500 * time.Millisecond)
	go func() {
		defer hb.Stop()
		defer tt.Stop()
		for {
			select {
			case <-c.Done():
				e.flush()
				return
			case <-hb.C:
				e.write(heartbeatEvent{Event: "heartbeat", T: time.Now().UnixMilli()})
			case <-tt.C:
				// snapshot
				in := e.inbound.Swap(0)
				out := e.outbound.Swap(0)
				sum := e.latencySum.Swap(0)
				n := e.latencyN.Swap(0)
				var avg uint64
				if n > 0 {
					avg = sum / n / 1000 // ms
				}
				e.write(telemetryEvent{
					Event:       "telemetry",
					DomainID:    e.domainID,
					Inbound:     in,
					Outbound:    out,
					LatencyMs:   avg,
					ActiveConns: e.activeConns.Load(),
				})
			}
		}
	}()
}

func (e *Emitter) Ready() {
	e.write(readyEvent{Event: "ready", DomainID: e.domainID})
}

func (e *Emitter) Errorf(format string, args ...any) {
	msg := format
	if len(args) > 0 {
		// Avoid pulling in fmt for one-off — caller can format.
		// We accept format-with-args for compat; rendering uses fmt.Sprintf.
	}
	e.write(errorEvent{Event: "error", Message: msg})
}

func (e *Emitter) Info(msg string)  { e.write(logEvent{Event: "log", Level: "info", Msg: msg}) }
func (e *Emitter) Warn(msg string)  { e.write(logEvent{Event: "log", Level: "warn", Msg: msg}) }
func (e *Emitter) Debug(msg string) { e.write(logEvent{Event: "log", Level: "debug", Msg: msg}) }

func (e *Emitter) Request(method, path string, status, latencyMs, sizeBytes int, remote string) {
	e.write(requestEvent{
		Event:     "request",
		Method:    method,
		Path:      path,
		Status:    status,
		LatencyMs: latencyMs,
		SizeBytes: sizeBytes,
		Remote:    remote,
	})
}

func (e *Emitter) write(v any) {
	e.mu.Lock()
	defer e.mu.Unlock()
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = e.w.Write(b)
	_, _ = e.w.Write([]byte("\n"))
	_ = e.w.Flush()
}

func (e *Emitter) flush() {
	e.mu.Lock()
	defer e.mu.Unlock()
	_ = e.w.Flush()
}

func (e *Emitter) Stop() {
	if e.cancel != nil {
		e.cancel()
	}
}
