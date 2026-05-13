// Package proxyingest exposes the Control Plane endpoints that proxy nodes
// call to: validate a device api_key, record tunnel lifecycle (start, end,
// bytes), and report node liveness. All endpoints are protected by a shared
// Bearer secret loaded from OSM_PROXY_NODE_SECRET.
//
// v1 uses a single shared secret across all proxy nodes (documented as
// risk DR7 in Planning/11). v1.1 will switch to per-node credentials.
package proxyingest

import (
	"crypto/subtle"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/platform/httpx"
)

// RequireProxyAuth checks the Bearer header against the configured shared
// secret. Constant-time compare to avoid leaking secret length via timing.
func RequireProxyAuth(secret string) echo.MiddlewareFunc {
	expected := []byte(secret)
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if len(expected) == 0 {
				// Defensive: refuse all calls if not configured rather than allow-all.
				return httpx.WriteError(c, httpx.ErrUnauthorized)
			}
			header := c.Request().Header.Get("Authorization")
			tok := strings.TrimPrefix(header, "Bearer ")
			if tok == header || tok == "" {
				return httpx.WriteError(c, httpx.ErrUnauthorized)
			}
			if subtle.ConstantTimeCompare([]byte(tok), expected) != 1 {
				return httpx.WriteError(c, httpx.ErrUnauthorized)
			}
			return next(c)
		}
	}
}
