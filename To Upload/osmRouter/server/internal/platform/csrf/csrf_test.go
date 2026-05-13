package csrf

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func newEcho() *echo.Echo {
	e := echo.New()
	e.Use(Middleware(Config{Secure: false, SkipPrefixes: []string{"/api/v1/csrf", "/api/v1/health"}}))
	e.Any("/*", func(c echo.Context) error {
		return c.String(http.StatusOK, "ok")
	})
	return e
}

func TestCSRF_GetRequest_AlwaysAllowed(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/anything", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET should be allowed, got %d", rec.Code)
	}
}

func TestCSRF_PostMissingToken_Rejected(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/domains", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF should 403, got %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestCSRF_PostMatchingToken_Allowed(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/domains", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "abc123"})
	req.Header.Set(HeaderName, "abc123")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("matching CSRF should pass, got %d", rec.Code)
	}
}

func TestCSRF_PostMismatchedToken_Rejected(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/domains", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: CookieName, Value: "abc123"})
	req.Header.Set(HeaderName, "different")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("mismatched CSRF should 403, got %d", rec.Code)
	}
}

func TestCSRF_BearerHeader_Skipped(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices/x/heartbeat", strings.NewReader("{}"))
	req.Header.Set("Authorization", "Bearer device-api-key")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("Bearer auth should skip CSRF, got %d", rec.Code)
	}
}

func TestCSRF_SkipPrefix_Allowed(t *testing.T) {
	e := newEcho()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/csrf", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("skip prefix should be allowed, got %d", rec.Code)
	}
}
