// Package hostcheck validates the Host header of incoming requests.
// Implements S7.4 (Host header validation) and S3.2 (anti-DNS-rebinding).
package hostcheck

import (
	"net/http"
	"strings"
)

// Validator decides whether an inbound request is allowed based on its
// Host header. The interface lets us inject a fake in tests.
type Validator interface {
	Allow(host string) bool
}

type exact struct {
	domain string
}

// NewExact returns a Validator that allows only the exact domain (case
// insensitive, port stripped).
func NewExact(domain string) Validator {
	return &exact{domain: strings.ToLower(domain)}
}

func (e *exact) Allow(host string) bool {
	h := strings.ToLower(host)
	// Strip ":port" if present.
	if i := strings.LastIndex(h, ":"); i > 0 && strings.Index(h, "[") < 0 {
		h = h[:i]
	}
	return h == e.domain
}

// Middleware wraps an http.Handler and drops requests whose Host header
// does not match the validator.
func Middleware(v Validator, dropped func(host string)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !v.Allow(r.Host) {
				if dropped != nil {
					dropped(r.Host)
				}
				http.Error(w, "host header mismatch", http.StatusMisdirectedRequest)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
