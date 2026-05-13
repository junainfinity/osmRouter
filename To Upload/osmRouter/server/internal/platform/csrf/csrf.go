package csrf

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
)

const (
	HeaderName = "X-CSRF-Token"
	CookieName = "osm_csrf"
	tokenBytes = 32
)

// Middleware enforces double-submit-token CSRF on state-changing methods.
// Skips:
//   - GET, HEAD, OPTIONS
//   - Requests with Authorization: Bearer header (machine clients)
//   - Configured allowlist paths (e.g. /api/v1/csrf itself, /api/v1/health)
type Config struct {
	Secure       bool
	CookieDomain string
	SkipPrefixes []string
}

func Middleware(cfg Config) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if isSafeMethod(req.Method) {
				return next(c)
			}
			if strings.HasPrefix(req.Header.Get("Authorization"), "Bearer ") {
				return next(c)
			}
			for _, p := range cfg.SkipPrefixes {
				if strings.HasPrefix(req.URL.Path, p) {
					return next(c)
				}
			}
			cookie, err := req.Cookie(CookieName)
			if err != nil || cookie.Value == "" {
				return httpx.WriteError(c, httpx.ErrCSRF)
			}
			header := req.Header.Get(HeaderName)
			if header == "" {
				return httpx.WriteError(c, httpx.ErrCSRF)
			}
			if subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(header)) != 1 {
				return httpx.WriteError(c, httpx.ErrCSRF)
			}
			return next(c)
		}
	}
}

// Issue mints a new CSRF token, sets the cookie, and returns the value for the response body.
func Issue(c echo.Context, secure bool, domain string) (string, error) {
	tok, err := crypto.RandomURLToken(tokenBytes)
	if err != nil {
		return "", err
	}
	c.SetCookie(&http.Cookie{
		Name:     CookieName,
		Value:    tok,
		Path:     "/",
		Domain:   domain,
		HttpOnly: false, // intentional — JS must read to attach as header
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   60 * 60 * 12,
	})
	return tok, nil
}

func isSafeMethod(m string) bool {
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	return false
}
