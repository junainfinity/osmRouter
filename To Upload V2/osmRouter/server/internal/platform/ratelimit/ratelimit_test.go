package ratelimit

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
)

func TestBucket_AllowsBurstThenRejects(t *testing.T) {
	l := New(10) // 10 per minute = ~0.166/sec, burst 10
	for i := 0; i < 10; i++ {
		ok, _ := l.Allow("k")
		if !ok {
			t.Fatalf("request %d should pass within burst", i)
		}
	}
	ok, retry := l.Allow("k")
	if ok {
		t.Fatal("11th request should be rejected")
	}
	if retry <= 0 {
		t.Fatalf("retry-after should be positive, got %v", retry)
	}
}

func TestBucket_RefillsOverTime(t *testing.T) {
	l := New(60) // 60/min = 1/sec, burst 60
	// drain
	for i := 0; i < 60; i++ {
		l.Allow("k")
	}
	if ok, _ := l.Allow("k"); ok {
		t.Fatal("bucket should be empty")
	}
	time.Sleep(1100 * time.Millisecond)
	if ok, _ := l.Allow("k"); !ok {
		t.Fatal("after 1.1s refill, should allow again")
	}
}

func TestBucket_PerKeyIsolation(t *testing.T) {
	l := New(2)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal()
	}
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal()
	}
	if ok, _ := l.Allow("a"); ok {
		t.Fatal("a should be exhausted")
	}
	if ok, _ := l.Allow("b"); !ok {
		t.Fatal("b should still have full bucket")
	}
}

func TestMiddleware_ReturnsRetryAfter(t *testing.T) {
	e := echo.New()
	l := New(1)
	e.Use(Middleware(l, func(c echo.Context) string { return "k" }))
	e.GET("/", func(c echo.Context) error { return c.String(200, "ok") })

	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != 200 {
		t.Fatalf("first should pass, got %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	e.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second should 429, got %d", rec.Code)
	}
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("Retry-After header missing")
	}
}
