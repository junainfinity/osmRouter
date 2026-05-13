package auth

import (
	"errors"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/models"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
	"gorm.io/gorm"
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

// RequireAuthOrDeviceKey accepts EITHER a session cookie (web dashboard)
// OR a device API key in `Authorization: Bearer <key>` (desktop client).
// Whichever wins, `user_id` and `role` are set on the context exactly as
// RequireAuth does. When a Bearer key is used, the device's UserID is the
// actor, and an additional `device_id` key is set so handlers that care
// about which device made the call can read it.
//
// Critically: when this middleware authenticates via Bearer, CSRF is
// bypassed (CSRF middleware skips Bearer-marked requests). That's safe —
// the device API key itself is the credential, no cookie-confused-deputy.
func RequireAuthOrDeviceKey(jwtIssuer *cr.JWTIssuer, db *gorm.DB) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			// 1) Bearer device-key path
			if h := c.Request().Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
				key := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
				if key != "" {
					var dev models.Device
					err := db.WithContext(c.Request().Context()).
						Where("api_key_hash = ? AND revoked_at IS NULL", cr.SHA256Hex(key)).
						First(&dev).Error
					if err == nil {
						var u models.User
						if uerr := db.WithContext(c.Request().Context()).First(&u, "id = ?", dev.UserID).Error; uerr == nil {
							c.Set(CtxKeyUserID, u.ID)
							c.Set(CtxKeyRole, string(u.Role))
							c.Set("device_id", dev.ID)
							c.Set("auth_method", "bearer-device")
							return next(c)
						}
					}
					// Bearer header present but unknown — refuse rather than
					// fall through to cookie (avoids confusion attacks).
					return httpx.WriteError(c, httpx.ErrUnauthorized)
				}
			}

			// 2) Cookie session path (same as RequireAuth)
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
			c.Set("auth_method", "cookie")
			if claims.ImpersonatedBy != "" {
				c.Set(CtxKeyImpersonatedBy, claims.ImpersonatedBy)
			}
			return next(c)
		}
	}
}

// CurrentDeviceID returns the device id when authentication was via Bearer
// device key. Empty string when the call was made via cookie session.
func CurrentDeviceID(c echo.Context) string {
	id, _ := c.Get("device_id").(string)
	return id
}

// AuthMethod returns "cookie" or "bearer-device" so handlers can distinguish.
func AuthMethod(c echo.Context) string {
	m, _ := c.Get("auth_method").(string)
	return m
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
