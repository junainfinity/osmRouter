package hostcheck

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExact_AllowMatch(t *testing.T) {
	v := NewExact("dev.arjuns-app.com")
	assert.True(t, v.Allow("dev.arjuns-app.com"))
	assert.True(t, v.Allow("DEV.ARJUNS-APP.com"))         // case-insensitive
	assert.True(t, v.Allow("dev.arjuns-app.com:8443"))    // strip port
	assert.False(t, v.Allow("attacker.com"))
	assert.False(t, v.Allow("evil.dev.arjuns-app.com"))   // not a prefix match
	assert.False(t, v.Allow("dev.arjuns-app.com.evil"))   // not a suffix match
	assert.False(t, v.Allow(""))
}

func TestMiddleware_DropsMismatch(t *testing.T) {
	v := NewExact("ok.example.com")
	var dropped string
	mw := Middleware(v, func(h string) { dropped = h })
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(204)
	})
	handler := mw(next)

	// Bad host → 421
	req := httptest.NewRequest("GET", "http://ok.example.com/", nil)
	req.Host = "attacker.com"
	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)
	require.Equal(t, http.StatusMisdirectedRequest, rr.Code)
	assert.Equal(t, "attacker.com", dropped)

	// Good host → 204
	req2 := httptest.NewRequest("GET", "http://ok.example.com/", nil)
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)
	assert.Equal(t, http.StatusNoContent, rr2.Code)
}
