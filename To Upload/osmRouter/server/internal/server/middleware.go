package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// RequestID injects an `X-Request-ID` (generates one if absent) and stores it in echo context.
func RequestID() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			id := c.Request().Header.Get("X-Request-ID")
			if id == "" {
				id = uuid.NewString()
			}
			c.Response().Header().Set("X-Request-ID", id)
			c.Set("request_id", id)
			ctx := context.WithValue(c.Request().Context(), ctxKeyRequestID{}, id)
			c.SetRequest(c.Request().WithContext(ctx))
			return next(c)
		}
	}
}

type ctxKeyRequestID struct{}

// SecurityHeaders sets strict, sensible security headers on every response.
func SecurityHeaders(secure bool) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			h := c.Response().Header()
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("X-Frame-Options", "DENY")
			h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
			h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
			h.Set("Cross-Origin-Opener-Policy", "same-origin")
			h.Set("Cross-Origin-Resource-Policy", "same-site")
			// CSP is strictest on API responses (no scripts); frontend serves its own CSP.
			h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
			if secure {
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload")
			}
			h.Del("Server")
			h.Del("X-Powered-By")
			return next(c)
		}
	}
}

// AccessLog is a minimal JSON access logger that does NOT log bodies.
func AccessLog(logger *slog.Logger) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			start := time.Now()
			err := next(c)
			req := c.Request()
			res := c.Response()
			rid, _ := c.Get("request_id").(string)
			uid, _ := c.Get("user_id").(string)
			fields := []any{
				"request_id", rid,
				"method", req.Method,
				"path", req.URL.Path,
				"status", res.Status,
				"bytes", res.Size,
				"duration_ms", time.Since(start).Milliseconds(),
				"ip", c.RealIP(),
			}
			if uid != "" {
				fields = append(fields, "user_id", uid)
			}
			if err != nil {
				fields = append(fields, "err", err.Error())
			}
			if res.Status >= 500 {
				logger.Error("http", fields...)
			} else if res.Status >= 400 {
				logger.Warn("http", fields...)
			} else {
				logger.Info("http", fields...)
			}
			return err
		}
	}
}

// CORS returns an allowlist-based CORS middleware. Allow-credentials is true
// because we rely on cookies; this requires explicit origins (no wildcards).
func CORS(allowOrigins []string) echo.MiddlewareFunc {
	allow := map[string]struct{}{}
	for _, o := range allowOrigins {
		allow[o] = struct{}{}
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			origin := c.Request().Header.Get("Origin")
			if _, ok := allow[origin]; ok {
				h := c.Response().Header()
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Vary", "Origin")
				h.Set("Access-Control-Allow-Credentials", "true")
				h.Set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-ID, Authorization")
				h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
				h.Set("Access-Control-Max-Age", "600")
				if c.Request().Method == http.MethodOptions {
					return c.NoContent(http.StatusNoContent)
				}
			} else if c.Request().Method == http.MethodOptions {
				return c.NoContent(http.StatusNoContent)
			}
			return next(c)
		}
	}
}
