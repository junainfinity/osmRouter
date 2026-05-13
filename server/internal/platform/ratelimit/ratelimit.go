package ratelimit

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/platform/httpx"
)

// Bucket is a leaky/token-bucket limiter.
type Bucket struct {
	tokens   float64
	capacity float64
	refill   float64 // tokens per second
	last     time.Time
}

func newBucket(capacity, perSecond float64) *Bucket {
	return &Bucket{tokens: capacity, capacity: capacity, refill: perSecond, last: time.Now()}
}

func (b *Bucket) Take() (allowed bool, retryAfter time.Duration) {
	now := time.Now()
	elapsed := now.Sub(b.last).Seconds()
	b.tokens = min(b.capacity, b.tokens+elapsed*b.refill)
	b.last = now
	if b.tokens >= 1 {
		b.tokens -= 1
		return true, 0
	}
	// time until we accumulate 1 token
	need := 1 - b.tokens
	return false, time.Duration(need/b.refill*float64(time.Second)) + time.Second
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

// Limiter keeps per-key buckets.
type Limiter struct {
	mu      sync.Mutex
	buckets map[string]*Bucket
	cap     float64
	perSec  float64
}

// New creates a Limiter that allows `perMinute` requests per key with a burst capacity equal to it.
func New(perMinute int) *Limiter {
	return &Limiter{
		buckets: make(map[string]*Bucket),
		cap:     float64(perMinute),
		perSec:  float64(perMinute) / 60.0,
	}
}

func (l *Limiter) Allow(key string) (allowed bool, retryAfter time.Duration) {
	l.mu.Lock()
	b, ok := l.buckets[key]
	if !ok {
		b = newBucket(l.cap, l.perSec)
		l.buckets[key] = b
	}
	l.mu.Unlock()
	return b.Take()
}

// Middleware returns an echo middleware. KeyFunc determines the bucket key —
// typically client IP for unauth routes, user-id for authed routes.
func Middleware(l *Limiter, keyFn func(c echo.Context) string) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			key := keyFn(c)
			if key == "" {
				return next(c)
			}
			ok, retry := l.Allow(key)
			if !ok {
				c.Response().Header().Set("Retry-After", fmt.Sprintf("%d", int(retry.Seconds())))
				return httpx.WriteError(c, httpx.ErrTooMany)
			}
			return next(c)
		}
	}
}

// ClientIP returns the best-effort remote IP. Honors X-Forwarded-For when configured.
func ClientIP(c echo.Context) string {
	if fwd := c.Request().Header.Get("X-Forwarded-For"); fwd != "" {
		// Take leftmost (original client)
		if idx := strings.Index(fwd, ","); idx > 0 {
			return strings.TrimSpace(fwd[:idx])
		}
		return strings.TrimSpace(fwd)
	}
	return c.RealIP()
}

// UserKey returns the per-user bucket key, or empty string if not authenticated.
func UserKey(c echo.Context) string {
	if uid, ok := c.Get("user_id").(string); ok && uid != "" {
		return "u:" + uid
	}
	return ""
}

// IPKey returns a per-IP bucket key.
func IPKey(c echo.Context) string {
	ip := ClientIP(c)
	if ip == "" {
		return ""
	}
	return "ip:" + ip
}

// EnsureMethodNotSafe gates the limiter to only state-changing methods (optional helper).
func EnsureMethodNotSafe(c echo.Context) bool {
	switch c.Request().Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}
