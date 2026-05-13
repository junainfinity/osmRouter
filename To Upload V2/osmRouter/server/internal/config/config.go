package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Env string

const (
	EnvDev  Env = "dev"
	EnvTest Env = "test"
	EnvProd Env = "prod"
)

type Config struct {
	Env             Env
	HTTPAddr        string
	DatabaseURL     string // "sqlite://path" or "postgres://..."
	RedisURL        string
	JWTSecret       []byte
	OTPMasterSecret []byte
	CSRFSecret      []byte
	AESMasterKey    []byte // 32 bytes
	CookieDomain    string
	CookieSecure    bool
	CORSOrigins     []string
	ProxyCNAME      string // CNAME target users point their domain to

	AccessTokenTTL  time.Duration
	RefreshTokenTTL time.Duration
	OTPTTL          time.Duration
	ImpersonateTTL  time.Duration

	RateLimitAuthPerMin   int
	RateLimitNormalPerMin int

	// ProxyNodeSecret is the shared Bearer token proxy nodes use to call
	// /api/v1/proxy/* endpoints. v1 uses one secret across all nodes;
	// per-node credentials are planned for v1.1.
	ProxyNodeSecret string

	DevExposeOTP bool // for E2E tests; never true in prod

	// SMTP — outbound email (signup OTP). Empty Host = no-op mailer.
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
}

func Load() (*Config, error) {
	env := Env(getenv("OSM_ENV", "dev"))
	c := &Config{
		Env:                   env,
		HTTPAddr:              getenv("OSM_HTTP_ADDR", ":8080"),
		DatabaseURL:           getenv("OSM_DATABASE_URL", "sqlite://osm-dev.db"),
		RedisURL:              getenv("OSM_REDIS_URL", ""),
		CookieDomain:          getenv("OSM_COOKIE_DOMAIN", ""),
		CookieSecure:          getenvBool("OSM_COOKIE_SECURE", env == EnvProd),
		CORSOrigins:           splitCSV(getenv("OSM_CORS_ORIGINS", "http://localhost:3000")),
		ProxyCNAME:            getenv("OSM_PROXY_CNAME", "proxy.osmrouter.local"),
		AccessTokenTTL:        getenvDuration("OSM_ACCESS_TTL", 15*time.Minute),
		RefreshTokenTTL:       getenvDuration("OSM_REFRESH_TTL", 30*24*time.Hour),
		OTPTTL:                getenvDuration("OSM_OTP_TTL", 10*time.Minute),
		ImpersonateTTL:        getenvDuration("OSM_IMPERSONATE_TTL", 10*time.Minute),
		RateLimitAuthPerMin:   getenvInt("OSM_RL_AUTH", 5),
		RateLimitNormalPerMin: getenvInt("OSM_RL_NORMAL", 100),
		ProxyNodeSecret:       getenv("OSM_PROXY_NODE_SECRET", "dev-proxy-node-secret-please-replace"),
		DevExposeOTP:          env != EnvProd && getenvBool("OSM_DEV_EXPOSE_OTP", env == EnvDev),
		SMTPHost:              getenv("SMTP_HOST", ""),
		SMTPPort:              getenvInt("SMTP_PORT", 587),
		SMTPUsername:          getenv("SMTP_USERNAME", ""),
		SMTPPassword:          getenv("SMTP_PASSWORD", ""),
		SMTPFrom:              getenv("SMTP_FROM", ""),
	}

	// Secrets — generate dev-safe defaults if in dev/test, but REFUSE prod without them.
	jwt := os.Getenv("OSM_JWT_SECRET")
	otp := os.Getenv("OSM_OTP_MASTER_SECRET")
	csrf := os.Getenv("OSM_CSRF_SECRET")
	aes := os.Getenv("OSM_AES_MASTER_KEY")

	if env == EnvProd {
		if jwt == "" || otp == "" || csrf == "" || aes == "" {
			return nil, errors.New("production: OSM_JWT_SECRET, OSM_OTP_MASTER_SECRET, OSM_CSRF_SECRET, OSM_AES_MASTER_KEY all required")
		}
	}
	c.JWTSecret = ensureSecret(jwt, "dev-jwt-secret-please-replace-in-prod-0123456789abcdef")
	c.OTPMasterSecret = ensureSecret(otp, "dev-otp-secret-please-replace-in-prod-0123456789abcdef")
	c.CSRFSecret = ensureSecret(csrf, "dev-csrf-secret-please-replace-in-prod-0123456789abcdef")
	c.AESMasterKey = ensureSecret(aes, "dev-aes-master-key-32-bytes-fixed-padding-here!")
	if len(c.AESMasterKey) < 32 {
		c.AESMasterKey = padTo(c.AESMasterKey, 32)
	}

	if c.Env != EnvProd && c.Env != EnvDev && c.Env != EnvTest {
		return nil, fmt.Errorf("unknown OSM_ENV %q", c.Env)
	}
	return c, nil
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func getenvInt(k string, def int) int {
	if v := os.Getenv(k); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func getenvBool(k string, def bool) bool {
	v := strings.ToLower(os.Getenv(k))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func getenvDuration(k string, def time.Duration) time.Duration {
	if v := os.Getenv(k); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func ensureSecret(s, devFallback string) []byte {
	if s != "" {
		return []byte(s)
	}
	return []byte(devFallback)
}

func padTo(b []byte, n int) []byte {
	if len(b) >= n {
		return b[:n]
	}
	out := make([]byte, n)
	copy(out, b)
	return out
}

// IsTest reports whether the running env is the test environment. Used as a guard
// against destructive operations leaking into prod.
func (c *Config) IsTest() bool { return c.Env == EnvTest }
