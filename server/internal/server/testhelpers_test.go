package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/osmrouter/server/internal/config"
	"github.com/osmrouter/server/internal/domains"
	"github.com/osmrouter/server/internal/models"
	"github.com/osmrouter/server/internal/platform/db"
	"gorm.io/gorm"
)

// fakeResolver implements domains.Resolver and returns whatever the test sets.
type fakeResolver struct {
	cname map[string]string
	txt   map[string][]string
	err   error
}

func newFakeResolver() *fakeResolver {
	return &fakeResolver{cname: map[string]string{}, txt: map[string][]string{}}
}
func (f *fakeResolver) LookupCNAME(_ context.Context, name string) (string, error) {
	if f.err != nil {
		return "", f.err
	}
	if v, ok := f.cname[name]; ok {
		return v, nil
	}
	return "", nil
}
func (f *fakeResolver) LookupTXT(_ context.Context, name string) ([]string, error) {
	if f.err != nil {
		return nil, f.err
	}
	if v, ok := f.txt[name]; ok {
		return v, nil
	}
	return nil, nil
}

type testApp struct {
	t       *testing.T
	app     *App
	db      *gorm.DB
	cfg     *config.Config
	resolver *fakeResolver
}

func newTestApp(t *testing.T) *testApp {
	t.Helper()
	gdb, err := db.OpenInMemory()
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(gdb); err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{
		Env:                   config.EnvTest,
		HTTPAddr:              ":0",
		DatabaseURL:           "sqlite://:memory:",
		JWTSecret:             []byte("test-jwt-secret-test-jwt-secret-test"),
		OTPMasterSecret:       []byte("otp-secret-otp-secret-otp-secret-otpsec"),
		CSRFSecret:            []byte("csrf-secret"),
		AESMasterKey:          make([]byte, 32),
		CookieDomain:          "",
		CookieSecure:          false,
		CORSOrigins:           []string{"http://localhost:3000"},
		ProxyCNAME:            "proxy.osmrouter.test",
		AccessTokenTTL:        15 * time.Minute,
		RefreshTokenTTL:       30 * 24 * time.Hour,
		OTPTTL:                10 * time.Minute,
		ImpersonateTTL:        10 * time.Minute,
		RateLimitAuthPerMin:   1000, // generous in tests
		RateLimitNormalPerMin: 1000,
		DevExposeOTP:          true,
	}
	resolver := newFakeResolver()
	app, err := New(Deps{
		Config:   cfg,
		DB:       gdb,
		Logger:   slog.New(slog.NewJSONHandler(io.Discard, nil)),
		Resolver: resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	return &testApp{t: t, app: app, db: gdb, cfg: cfg, resolver: resolver}
}

// do executes a request against the app, optionally chaining cookies from a prior response.
func (ta *testApp) do(method, path string, body any, opts ...func(*http.Request)) *http.Response {
	ta.t.Helper()
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://localhost:3000")
	for _, opt := range opts {
		opt(req)
	}
	rec := httptest.NewRecorder()
	ta.app.Handler().ServeHTTP(rec, req)
	return rec.Result()
}

// session is a helper that captures cookies across requests.
type session struct {
	app     *testApp
	cookies []*http.Cookie
	csrf    string
}

func (ta *testApp) newSession() *session { return &session{app: ta} }

func (s *session) do(method, path string, body any) *http.Response {
	res := s.app.do(method, path, body, func(req *http.Request) {
		for _, c := range s.cookies {
			req.AddCookie(c)
		}
		if s.csrf != "" {
			req.Header.Set("X-CSRF-Token", s.csrf)
		}
	})
	if cookies := res.Cookies(); len(cookies) > 0 {
		s.cookies = mergeCookies(s.cookies, cookies)
	}
	return res
}

func mergeCookies(existing, fresh []*http.Cookie) []*http.Cookie {
	byName := map[string]*http.Cookie{}
	for _, c := range existing {
		byName[c.Name] = c
	}
	for _, c := range fresh {
		if c.MaxAge < 0 {
			delete(byName, c.Name)
			continue
		}
		byName[c.Name] = c
	}
	out := make([]*http.Cookie, 0, len(byName))
	for _, c := range byName {
		out = append(out, c)
	}
	return out
}

// helpers ---

func decode(t *testing.T, res *http.Response, v any) {
	t.Helper()
	defer res.Body.Close()
	if err := json.NewDecoder(res.Body).Decode(v); err != nil {
		t.Fatalf("decode: %v", err)
	}
}

func registerAndVerify(t *testing.T, ta *testApp, email, password string) *session {
	t.Helper()
	sess := ta.newSession()

	res := sess.do(http.MethodPost, "/api/v1/auth/register", map[string]string{
		"email":    email,
		"password": password,
		"name":     "Tester",
	})
	if res.StatusCode != http.StatusCreated {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("register status=%d body=%s", res.StatusCode, string(body))
	}
	var rr struct {
		DevOTP string `json:"dev_otp"`
	}
	decode(t, res, &rr)
	if rr.DevOTP == "" {
		t.Fatal("register must return dev_otp in test mode")
	}

	res = sess.do(http.MethodPost, "/api/v1/auth/verify-otp", map[string]string{
		"email": email,
		"code":  rr.DevOTP,
	})
	if res.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(res.Body)
		t.Fatalf("verify status=%d body=%s", res.StatusCode, string(body))
	}

	// Get CSRF token for subsequent writes
	res = sess.do(http.MethodGet, "/api/v1/csrf", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("csrf status=%d", res.StatusCode)
	}
	var cr struct {
		CSRFToken string `json:"csrf_token"`
	}
	decode(t, res, &cr)
	sess.csrf = cr.CSRFToken
	return sess
}

// promoteToAdmin bumps the most-recently-created user with this email to admin role.
// Used to test admin routes without a separate admin signup flow.
func promoteToAdmin(t *testing.T, gdb *gorm.DB, email string) {
	t.Helper()
	if err := gdb.Model(&models.User{}).Where("email = ?", email).Update("role", models.RoleAdmin).Error; err != nil {
		t.Fatal(err)
	}
}

// expectStatus asserts response code, dumping body on mismatch.
func expectStatus(t *testing.T, res *http.Response, want int) []byte {
	t.Helper()
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if res.StatusCode != want {
		t.Fatalf("status=%d want=%d body=%s", res.StatusCode, want, string(body))
	}
	return body
}

var _ = domains.SystemResolver{} // keep import alive even if not used in some test files
