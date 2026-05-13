package auth

import (
	"errors"

	"github.com/labstack/echo/v4"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
)

// CtxKeyUserID is what middleware injects into context for handlers to read.
const (
	CtxKeyUserID = "user_id"
	CtxKeyRole   = "role"
	CtxKeyImpersonatedBy = "impersonated_by"
)

// RequireAuth verifies the access cookie and injects user_id/role into context.
func RequireAuth(jwtIssuer *cr.JWTIssuer) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			cookie, err := c.Request().Cookie(CookieAccess)
			if err != nil || cookie.Value == "" {
				return httpx.WriteError(c, httpx.ErrUnauthorized)
			}
			claims, err := jwtIssuer.Parse(cookie.Value)
			if err != nil {
				if errors.Is(err, cr.ErrTokenExpired) {
					return httpx.WriteError(c, httpx.New(401, httpx.CodeTokenExpired, "access token expired"))
				}
				return httpx.WriteError(c, httpx.New(401, httpx.CodeTokenInvalid, "access token invalid"))
			}
			c.Set(CtxKeyUserID, claims.UserID)
			c.Set(CtxKeyRole, claims.Role)
			if claims.ImpersonatedBy != "" {
				c.Set(CtxKeyImpersonatedBy, claims.ImpersonatedBy)
			}
			return next(c)
		}
	}
}

// RequireRole enforces that the request actor has one of the allowed roles.
// Must run AFTER RequireAuth.
func RequireRole(roles ...string) echo.MiddlewareFunc {
	allowed := make(map[string]struct{}, len(roles))
	for _, r := range roles {
		allowed[r] = struct{}{}
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			r, _ := c.Get(CtxKeyRole).(string)
			if _, ok := allowed[r]; !ok {
				return httpx.WriteError(c, httpx.ErrForbidden)
			}
			return next(c)
		}
	}
}

// CurrentUserID is a typed getter for handlers.
func CurrentUserID(c echo.Context) string {
	uid, _ := c.Get(CtxKeyUserID).(string)
	return uid
}

func CurrentRole(c echo.Context) string {
	r, _ := c.Get(CtxKeyRole).(string)
	return r
}
