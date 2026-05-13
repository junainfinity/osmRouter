package auth

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

const (
	CookieAccess  = "osm_access"
	CookieRefresh = "osm_refresh"
)

type CookieConfig struct {
	Secure bool
	Domain string
}

func setSessionCookie(c echo.Context, name, value string, ttl time.Duration, cfg CookieConfig) {
	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Domain:   cfg.Domain,
		HttpOnly: true,
		Secure:   cfg.Secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(ttl.Seconds()),
	})
}

func clearSessionCookie(c echo.Context, name string, cfg CookieConfig) {
	c.SetCookie(&http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		Domain:   cfg.Domain,
		HttpOnly: true,
		Secure:   cfg.Secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}
