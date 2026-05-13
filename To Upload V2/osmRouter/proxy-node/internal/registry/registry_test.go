package registry

import (
	"io"
	"log/slog"
	"sync"
	"testing"
)

func newReg() *Registry {
	return New(slog.New(slog.NewJSONHandler(io.Discard, nil)))
}

func TestSetGetDelete(t *testing.T) {
	r := newReg()
	tn := NewTunnel("a.test", "d1", "u1", "n1", nil)
	r.Set("a.test", tn)
	if g := r.Get("a.test"); g != tn {
		t.Fatalf("Get returned %v want %v", g, tn)
	}
	r.Delete("a.test", tn)
	if g := r.Get("a.test"); g != nil {
		t.Fatalf("Get after Delete returned %v", g)
	}
}

func TestSetReplaces_ClosingOld(t *testing.T) {
	r := newReg()
	old := NewTunnel("a.test", "d1", "u1", "n1", nil)
	r.Set("a.test", old)
	new1 := NewTunnel("a.test", "d2", "u2", "n2", nil)
	prev := r.Set("a.test", new1)
	if prev != old {
		t.Fatalf("expected the prior tunnel returned, got %v", prev)
	}
	// closeOnce → after Set the old conn was closed asynchronously.
	// We block on Closed() to assert the close happened.
	<-old.Closed()
}

func TestConcurrent_NoRace(t *testing.T) {
	r := newReg()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			host := "x.test"
			tn := NewTunnel(host, "d", "u", "n", nil)
			r.Set(host, tn)
			r.Get(host)
			r.Delete(host, tn)
		}(i)
	}
	wg.Wait()
}

func TestDelete_RespectsStaleness(t *testing.T) {
	r := newReg()
	a := NewTunnel("h", "d1", "u", "n", nil)
	r.Set("h", a)
	b := NewTunnel("h", "d2", "u", "n", nil)
	r.Set("h", b)
	// Delete with stale handle should be a no-op.
	r.Delete("h", a)
	if r.Get("h") != b {
		t.Fatal("stale Delete removed the wrong tunnel")
	}
	r.Delete("h", b)
	if r.Get("h") != nil {
		t.Fatal("Delete with current handle did not remove")
	}
}
