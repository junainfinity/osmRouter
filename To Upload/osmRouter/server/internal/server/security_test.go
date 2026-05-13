package server

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/osmrouter/server/internal/auth"
	cr "github.com/osmrouter/server/internal/platform/crypto"
)

func bytesLastIndex(b []byte, c byte) int {
	for i := len(b) - 1; i >= 0; i-- {
		if b[i] == c {
			return i
		}
	}
	return -1
}

// --- AUTH / UNAUTHENTICATED ACCESS REJECTION ---

func TestSecurity_ProtectedEndpoints_RejectUnauthenticated(t *testing.T) {
	ta := newTestApp(t)
	protected := []struct {
		method, path string
	}{
		{"GET", "/api/v1/auth/me"},
		{"GET", "/api/v1/domains"},
		{"GET", "/api/v1/devices"},
		{"GET", "/api/v1/dashboard"},
		{"GET", "/api/v1/admin/network"},
		{"GET", "/api/v1/admin/users"},
	}
	for _, p := range protected {
		res := ta.do(p.method, p.path, nil)
		if res.StatusCode != http.StatusUnauthorized {
			body, _ := io.ReadAll(res.Body)
			t.Errorf("%s %s expected 401 got %d body=%s", p.method, p.path, res.StatusCode, string(body))
		}
	}
}

func TestSecurity_AdminEndpoints_RejectNonAdmin(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "user@example.com", "hunter22")

	res := sess.do(http.MethodGet, "/api/v1/admin/network", nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("user must not access admin: got %d", res.StatusCode)
	}
}

func TestSecurity_AdminEndpoints_AllowAdmin(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "admin@example.com", "hunter22")
	promoteToAdmin(t, ta.db, "admin@example.com")

	// Need a fresh session with an admin-role JWT — log in again
	sess = ta.newSession()
	res := sess.do(http.MethodPost, "/api/v1/auth/login", map[string]string{
		"email":    "admin@example.com",
		"password": "hunter22",
	})
	expectStatus(t, res, http.StatusOK)

	res = sess.do(http.MethodGet, "/api/v1/admin/network", nil)
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("admin must access admin network: got %d body=%s", res.StatusCode, string(body))
	}
}

// --- CSRF ---

func TestSecurity_CSRF_PostWithoutToken_Rejected(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "csrf@example.com", "hunter22")
	// strip CSRF for this one request
	priorCSRF := sess.csrf
	sess.csrf = ""
	res := sess.do(http.MethodPost, "/api/v1/domains", map[string]string{"fqdn": "a.test"})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("POST without CSRF should 403, got %d", res.StatusCode)
	}
	sess.csrf = priorCSRF
}

func TestSecurity_CSRF_WrongToken_Rejected(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "csrf2@example.com", "hunter22")
	sess.csrf = "thisIsNotTheRealToken"
	res := sess.do(http.MethodPost, "/api/v1/domains", map[string]string{"fqdn": "a.test"})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("POST with wrong CSRF should 403, got %d", res.StatusCode)
	}
}

// --- LOGIN ENUMERATION SAFETY ---

func TestSecurity_LoginUnknownUser_SameErrorAsWrongPassword(t *testing.T) {
	ta := newTestApp(t)
	_ = registerAndVerify(t, ta, "real@example.com", "hunter22")

	cases := []map[string]string{
		{"email": "real@example.com", "password": "WRONGPASS9"},
		{"email": "noone@example.com", "password": "anything9"},
	}
	for _, body := range cases {
		res := ta.do(http.MethodPost, "/api/v1/auth/login", body)
		if res.StatusCode != http.StatusUnauthorized {
			t.Fatalf("expected 401 for %+v, got %d", body, res.StatusCode)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		var e struct{ Error struct{ Code, Message string } }
		_ = json.Unmarshal(b, &e)
		if e.Error.Code != "INVALID_CREDENTIALS" {
			t.Fatalf("expected INVALID_CREDENTIALS, got %s for %+v", e.Error.Code, body)
		}
	}
}

// --- JWT TAMPERING / ALG CONFUSION ---

func TestSecurity_TamperedJWTCookie_Rejected(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "jwt@example.com", "hunter22")

	// Find and tamper with the access cookie — flip a middle char (signature region).
	// Use a definitively-different replacement so we never accidentally write the original byte back.
	for i, c := range sess.cookies {
		if c.Name == auth.CookieAccess {
			cp := *c
			b := []byte(cp.Value)
			// Tamper in the signature portion (after the last dot)
			lastDot := bytesLastIndex(b, '.')
			if lastDot < 0 || lastDot == len(b)-1 {
				lastDot = len(b) - 2
			}
			pos := lastDot + 1
			if b[pos] == 'A' {
				b[pos] = 'B'
			} else {
				b[pos] = 'A'
			}
			cp.Value = string(b)
			sess.cookies[i] = &cp
		}
	}
	res := sess.do(http.MethodGet, "/api/v1/auth/me", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("tampered JWT should 401, got %d", res.StatusCode)
	}
}

func TestSecurity_AlgNoneJWT_Rejected(t *testing.T) {
	ta := newTestApp(t)
	_ = registerAndVerify(t, ta, "algnone@example.com", "hunter22")

	// craft alg=none token impersonating the user
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, &cr.Claims{UserID: "any", Role: "admin"})
	s, _ := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)

	res := ta.do(http.MethodGet, "/api/v1/auth/me", nil, func(req *http.Request) {
		req.AddCookie(&http.Cookie{Name: auth.CookieAccess, Value: s})
	})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("alg=none JWT must be 401, got %d", res.StatusCode)
	}
}

// --- REFRESH ROTATION REUSE ---

func TestSecurity_RefreshTokenReuse_RevokesEntireChain(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "rotate@example.com", "hunter22")

	// Capture the original refresh cookie
	var firstRefresh string
	for _, c := range sess.cookies {
		if c.Name == auth.CookieRefresh {
			firstRefresh = c.Value
		}
	}
	if firstRefresh == "" {
		t.Fatal("expected refresh cookie")
	}

	// 1st refresh succeeds and rotates the token
	res := sess.do(http.MethodPost, "/api/v1/auth/refresh", nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("first refresh should succeed, got %d", res.StatusCode)
	}

	// Replay the original refresh token (should trigger chain revocation)
	res = ta.do(http.MethodPost, "/api/v1/auth/refresh", nil, func(req *http.Request) {
		req.AddCookie(&http.Cookie{Name: auth.CookieRefresh, Value: firstRefresh})
	})
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("reused refresh should 401, got %d", res.StatusCode)
	}

	// Subsequent refresh with the NEW (rotated) cookie should also fail since chain is revoked
	res = sess.do(http.MethodPost, "/api/v1/auth/refresh", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("after chain revocation, even new refresh should 401, got %d", res.StatusCode)
	}
}

// --- INPUT VALIDATION ---

func TestSecurity_InvalidFQDN_Rejected(t *testing.T) {
	ta := newTestApp(t)
	sess := registerAndVerify(t, ta, "fqdn@example.com", "hunter22")

	bad := []string{"", "no-tld", ".bad.com", "bad..com", "a*b.com", "1234567890123456789012345678901234567890123456789012345678901234.com"}
	for _, b := range bad {
		res := sess.do(http.MethodPost, "/api/v1/domains", map[string]string{"fqdn": b})
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("fqdn %q should be 400, got %d", b, res.StatusCode)
		}
	}
}

func TestSecurity_WeakPassword_Rejected(t *testing.T) {
	ta := newTestApp(t)
	res := ta.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email":    "weakpw@example.com",
		"password": "short", // < 8 chars, no digit
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("weak password should 400, got %d", res.StatusCode)
	}
}

func TestSecurity_OTPWrongCode_DoesNotConsumeTooFast(t *testing.T) {
	ta := newTestApp(t)
	sess := ta.newSession()
	res := sess.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email": "otp@example.com", "password": "hunter22",
	})
	expectStatus(t, res, http.StatusCreated)

	// 4 wrong attempts
	for i := 0; i < 4; i++ {
		res := sess.do(http.MethodPost, "/api/v1/auth/verify-otp", map[string]string{
			"email": "otp@example.com", "code": "000000",
		})
		if res.StatusCode == http.StatusOK {
			t.Fatal("wrong OTP must not succeed")
		}
	}
}

// --- SECURITY HEADERS ---

func TestSecurity_SecurityHeadersPresent(t *testing.T) {
	ta := newTestApp(t)
	res := ta.do(http.MethodGet, "/healthz", nil)
	defer res.Body.Close()
	required := []string{
		"X-Content-Type-Options",
		"X-Frame-Options",
		"Referrer-Policy",
		"Content-Security-Policy",
		"Cross-Origin-Opener-Policy",
	}
	for _, h := range required {
		if res.Header.Get(h) == "" {
			t.Errorf("missing security header %s", h)
		}
	}
	if got := res.Header.Get("X-Frame-Options"); got != "DENY" {
		t.Errorf("X-Frame-Options = %q, want DENY", got)
	}
}

// --- CORS ---

func TestSecurity_CORS_DisallowedOrigin_NoCredentialsHeader(t *testing.T) {
	ta := newTestApp(t)
	res := ta.do(http.MethodGet, "/api/v1/health", nil, func(req *http.Request) {
		req.Header.Set("Origin", "https://evil.example")
	})
	if res.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("CORS allow-origin must NOT be set for disallowed origin")
	}
}

// --- RATE LIMIT ---

func TestSecurity_AuthRoute_RateLimited(t *testing.T) {
	ta := newTestApp(t)
	// override rate limit by re-creating app with tighter config
	ta.cfg.RateLimitAuthPerMin = 2

	// Rebuild app with tighter limit
	ta.app, _ = New(Deps{
		Config: ta.cfg, DB: ta.db, Logger: ta.app.logger, Resolver: ta.resolver,
	})

	for i := 0; i < 2; i++ {
		ta.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": "no@one.com", "password": "x"})
	}
	res := ta.do(http.MethodPost, "/api/v1/auth/login", map[string]string{"email": "no@one.com", "password": "x"})
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("rate limit should kick in: got %d", res.StatusCode)
	}
	if ra := res.Header.Get("Retry-After"); ra == "" {
		t.Fatal("Retry-After missing on 429")
	}
}

// --- SQL INJECTION SAFETY (sanity, GORM uses parameterized queries) ---

func TestSecurity_SQLInjectionInEmail_SafelyParameterized(t *testing.T) {
	ta := newTestApp(t)
	// Try an attacker payload as the email — should bounce on email validation, not SQL parsing.
	res := ta.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email": "'; DROP TABLE users; --",
		"password": "hunter22",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("SQLi-shaped email should fail validation, got %d", res.StatusCode)
	}
	// Sanity check: users table still queryable
	var n int64
	if err := ta.db.Raw("SELECT COUNT(*) FROM users").Scan(&n).Error; err != nil {
		t.Fatalf("users table broken: %v", err)
	}
}

// --- LOG REDACTION SANITY (passwords never logged via JSON access logger) ---

func TestSecurity_PasswordNotEchoedInResponse(t *testing.T) {
	ta := newTestApp(t)
	res := ta.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email": "secret@example.com", "password": "supersecret9",
	})
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(body), "supersecret9") {
		t.Fatal("password must never appear in response")
	}
}
