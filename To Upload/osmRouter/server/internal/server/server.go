package server

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/osmrouter/server/internal/admin"
	"github.com/osmrouter/server/internal/audit"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/config"
	"github.com/osmrouter/server/internal/devices"
	"github.com/osmrouter/server/internal/domains"
	"github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/csrf"
	"github.com/osmrouter/server/internal/platform/httpx"
	"github.com/osmrouter/server/internal/platform/ratelimit"
	"github.com/osmrouter/server/internal/platform/redis"
	"github.com/osmrouter/server/internal/platform/ws"
	"github.com/osmrouter/server/internal/proxyingest"
	"github.com/osmrouter/server/internal/subdomains"
	"gorm.io/gorm"
)

// Deps is what New takes; allows easy override in tests.
type Deps struct {
	Config   *config.Config
	DB       *gorm.DB
	Redis    *redis.Client
	Logger   *slog.Logger
	Resolver domains.Resolver // optional override; defaults to system DNS
}

// App is the wired server.
type App struct {
	cfg        *config.Config
	e          *echo.Echo
	hub        *ws.Hub
	verifier   *domains.Verifier
	devicesSvc *devices.Service
	logger     *slog.Logger
	bgCancel   context.CancelFunc
}

func New(d Deps) (*App, error) {
	if d.Resolver == nil {
		d.Resolver = domains.SystemResolver{}
	}
	// Seed plans
	if err := seedPlans(d.DB); err != nil {
		d.Logger.Warn("plan seed failed", "err", err)
	}

	jwtIssuer := crypto.NewJWTIssuer(d.Config.JWTSecret, "osmrouter", "osmrouter-web")
	auditw := audit.New(d.DB, d.Logger)
	hub := ws.NewHub(d.Logger)

	authSvc := auth.NewService(d.DB, jwtIssuer, auditw,
		d.Config.AccessTokenTTL, d.Config.RefreshTokenTTL, d.Config.OTPTTL,
		d.Config.DevExposeOTP,
	)
	authH := auth.NewHandlers(authSvc, jwtIssuer, auth.CookieConfig{
		Secure: d.Config.CookieSecure,
		Domain: d.Config.CookieDomain,
	})

	domainSvc := domains.NewService(d.DB, auditw, d.Config.ProxyCNAME, d.Config.OTPMasterSecret)
	verifier := domains.NewVerifier(domainSvc, d.Resolver, hub, d.Logger)
	domainH := domains.NewHandlers(domainSvc, verifier)

	deviceSvc := devices.NewService(d.DB, auditw)
	deviceH := devices.NewHandlers(deviceSvc)

	subSvc := subdomains.NewService(d.DB, d.Redis, hub, auditw)
	subH := subdomains.NewHandlers(subSvc)

	adminSvc := admin.NewService(d.DB, jwtIssuer, auditw, d.Config.ImpersonateTTL)
	adminH := admin.NewHandlers(adminSvc)

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if !c.Response().Committed {
			_ = httpx.WriteError(c, err)
		}
	}

	// Global middleware (order matters)
	e.Use(middleware.Recover())
	e.Use(RequestID())
	e.Use(SecurityHeaders(d.Config.CookieSecure))
	e.Use(CORS(d.Config.CORSOrigins))
	e.Use(AccessLog(d.Logger))

	// Rate limiters
	rlAuth := ratelimit.New(d.Config.RateLimitAuthPerMin)
	rlNormal := ratelimit.New(d.Config.RateLimitNormalPerMin)

	// /healthz — minimal, no rate limit
	e.GET("/healthz", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]any{
			"status": "ok",
			"env":    string(d.Config.Env),
		})
	})

	// /api/v1/health — richer status
	e.GET("/api/v1/health", func(c echo.Context) error {
		dbOk := true
		if sqlDB, err := d.DB.DB(); err != nil {
			dbOk = false
		} else if err := sqlDB.PingContext(c.Request().Context()); err != nil {
			dbOk = false
		}
		redisOk := false
		if d.Redis != nil && d.Redis.Available() {
			redisOk = d.Redis.Ping(c.Request().Context()) == nil
		}
		mode := "ok"
		if !dbOk {
			mode = "readonly"
		}
		return c.JSON(http.StatusOK, map[string]any{
			"db":    dbOk,
			"redis": redisOk,
			"mode":  mode,
		})
	})

	// API v1
	api := e.Group("/api/v1")

	// Auth (unauthenticated) — under tight per-IP rate limit
	authGroup := api.Group("/auth")
	authGroup.Use(ratelimit.Middleware(rlAuth, ratelimit.IPKey))
	authGroup.POST("/register", authH.Register)
	authGroup.POST("/verify-otp", authH.VerifyOTP)
	authGroup.POST("/login", authH.Login)
	authGroup.POST("/refresh", authH.Refresh)

	// Dev-only OTP echo (e2e helper)
	if d.Config.DevExposeOTP {
		api.GET("/dev/last-otp/:email", func(c echo.Context) error {
			email := strings.ToLower(c.Param("email"))
			var otp struct {
				ID string
			}
			// Note: this is purely dev convenience; never enable in prod.
			err := d.DB.Raw("SELECT id FROM email_otps WHERE email=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1", email).
				Scan(&otp).Error
			if err != nil {
				return c.JSON(404, map[string]string{"error": "no pending otp"})
			}
			return c.JSON(200, map[string]string{"id": otp.ID, "note": "code is not stored plaintext; check server logs"})
		})
	}

	// Everything below requires an authenticated session.
	authed := api.Group("")
	authed.Use(auth.RequireAuth(jwtIssuer))
	authed.Use(ratelimit.Middleware(rlNormal, ratelimit.UserKey))

	// CSRF middleware applied to authed group; skips GETs and bearer requests.
	authed.Use(csrf.Middleware(csrf.Config{
		Secure:       d.Config.CookieSecure,
		CookieDomain: d.Config.CookieDomain,
		SkipPrefixes: []string{"/api/v1/csrf"},
	}))

	// CSRF issue endpoint (writes a cookie; safe to call)
	authed.GET("/csrf", authH.CSRFIssue)

	authed.GET("/auth/me", authH.Me)
	authed.POST("/auth/logout", authH.Logout)

	// Domains
	authed.GET("/domains", domainH.List)
	authed.POST("/domains", domainH.Create)
	authed.GET("/domains/:id", domainH.Get)
	authed.DELETE("/domains/:id", domainH.Delete)
	authed.POST("/domains/:id/verify", domainH.Verify)
	authed.GET("/domains/:id/subdomains", subH.List)
	authed.POST("/domains/:id/subdomains", subH.Create)

	// Subdomains (singular ops)
	authed.DELETE("/subdomains/:id", subH.Delete)
	authed.POST("/subdomains/:id/bind", subH.Bind)
	authed.POST("/subdomains/:id/unbind", subH.Unbind)

	// Devices
	authed.GET("/devices", deviceH.List)
	authed.POST("/devices", deviceH.Create)
	authed.DELETE("/devices/:id", deviceH.Revoke)

	// Heartbeat (Bearer auth, mounted on api root so CSRF is skipped and our own handler validates)
	api.POST("/devices/heartbeat", deviceH.Heartbeat)

	// Dashboard summary
	authed.GET("/dashboard", buildDashboard(d.DB))

	// Admin
	adminGroup := authed.Group("/admin")
	adminGroup.Use(auth.RequireRole(string("admin")))
	adminGroup.GET("/network", adminH.Network)
	adminGroup.GET("/users", adminH.Users)
	adminGroup.GET("/users/:id", adminH.Dossier)
	adminGroup.POST("/users/:id/impersonate", adminH.Impersonate)
	adminGroup.GET("/audit", adminH.Audit)

	// ---- Proxy-node ingest (Bearer shared secret, no cookies/CSRF) ----
	proxyH := proxyingest.New(d.DB, hub, auditw)
	proxyGroup := api.Group("/proxy")
	proxyGroup.Use(proxyingest.RequireProxyAuth(d.Config.ProxyNodeSecret))
	proxyGroup.POST("/devices/verify", proxyH.VerifyDevice)
	proxyGroup.POST("/tunnels/start", proxyH.TunnelStart)
	proxyGroup.POST("/tunnels/:id/end", proxyH.TunnelEnd)
	proxyGroup.POST("/nodes/heartbeat", proxyH.Heartbeat)

	// WebSocket (cookie auth on upgrade)
	authed.GET("/ws", func(c echo.Context) error {
		uid := auth.CurrentUserID(c)
		if uid == "" {
			return httpx.WriteError(c, httpx.ErrUnauthorized)
		}
		return hub.Upgrade(c.Response(), c.Request(), uid)
	})

	app := &App{
		cfg:        d.Config,
		e:          e,
		hub:        hub,
		verifier:   verifier,
		devicesSvc: deviceSvc,
		logger:     d.Logger,
	}
	return app, nil
}

func (a *App) Handler() http.Handler { return a.e }

// StartBackgroundWorkers runs the verifier + offline-device sweeper.
func (a *App) StartBackgroundWorkers(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	a.bgCancel = cancel
	go a.verifier.Run(ctx)
	go func() {
		t := time.NewTicker(60 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				_ = a.devicesSvc.SweepOffline(ctx)
			}
		}
	}()
}

func (a *App) Close() {
	if a.bgCancel != nil {
		a.bgCancel()
	}
}

func seedPlans(db *gorm.DB) error {
	type seed struct {
		Slug                                string
		PriceCents, MaxDomains, MaxDevices, BandwidthGB int
	}
	plans := []seed{
		{"free", 0, 1, 1, 10},
		{"pro", 1200, 9999, 10, 500},
	}
	for _, p := range plans {
		var existingID uint
		row := db.Raw("SELECT id FROM plans WHERE slug = ?", p.Slug).Row()
		if err := row.Scan(&existingID); err == nil && existingID > 0 {
			continue
		}
		if err := db.Exec(
			"INSERT INTO plans (slug, price_cents, max_domains, max_devices, bandwidth_gb, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			p.Slug, p.PriceCents, p.MaxDomains, p.MaxDevices, p.BandwidthGB, time.Now(), time.Now(),
		).Error; err != nil {
			return err
		}
	}
	return nil
}
