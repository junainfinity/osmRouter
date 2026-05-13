package hub

import (
	"io"
	"log/slog"
	"sync"
	"testing"

	"github.com/osmrouter/proxy-node/internal/tunnel"
)

func newHub() *Hub {
	return New(slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func TestHub_RegisterStream_DeliveryAndCleanup(t *testing.T) {
	h := newHub()
	ch, done := h.RegisterStream("s1")
	defer done()

	go h.DeliverStream(&tunnel.Frame{Type: tunnel.FrameResponse, StreamID: "s1", Status: 200})

	f := <-ch
	if f.StreamID != "s1" || f.Status != 200 {
		t.Fatalf("unexpected frame: %+v", f)
	}
}

func TestHub_DeliverStream_OrphanDoesNotPanic(t *testing.T) {
	h := newHub()
	h.DeliverStream(&tunnel.Frame{Type: tunnel.FrameResponse, StreamID: "missing", Status: 200})
	// no panic = pass
}

func TestHub_RegisterStream_CleanupRemovesEntry(t *testing.T) {
	h := newHub()
	_, done := h.RegisterStream("s1")
	done()
	// After cleanup, delivery should be a no-op (orphan path)
	h.DeliverStream(&tunnel.Frame{Type: tunnel.FrameResponse, StreamID: "s1", Status: 200})
}

func TestHub_ConcurrentRegisterStreams(t *testing.T) {
	h := newHub()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			ch, done := h.RegisterStream("s" + string(rune(i)))
			defer done()
			h.DeliverStream(&tunnel.Frame{Type: tunnel.FrameResponse, StreamID: "s" + string(rune(i)), Status: 200})
			<-ch
		}(i)
	}
	wg.Wait()
}
