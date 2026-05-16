package auth

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/models"
	"github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/csrf"
	"github.com/osmrouter/server/internal/platform/httpx"
)

type Handlers struct {
	svc    *Service
	jwt    *crypto.JWTIssuer
	cookie CookieConfig
}

func NewHandlers(svc *Service, jwt *crypto.JWTIssuer, cookie CookieConfig) *Handlers {
	return &Handlers{svc: svc, jwt: jwt, cookie: cookie}
}

type registerReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type registerResp struct {
	UserID string `json:"user_id"`
	Email  string `json:"email"`
	DevOTP string `json:"dev_otp,omitempty"`
}

func (h *Handlers) Register(c echo.Context) error {
	var req registerReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	res, err := h.svc.Register(c.Request().Context(), req.Email, req.Password, req.Name, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteCreated(c, registerResp{UserID: res.UserID, Email: res.Email, DevOTP: res.DevOTP})
}

type verifyOTPReq struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

func (h *Handlers) VerifyOTP(c echo.Context) error {
	var req verifyOTPReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	tokens, user, err := h.svc.VerifyOTP(c.Request().Context(), req.Email, req.Code, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	h.setSession(c, tokens)
	return httpx.WriteOK(c, userView(user))
}

type loginReq struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *Handlers) Login(c echo.Context) error {
	var req loginReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	tokens, user, err := h.svc.Login(c.Request().Context(), req.Email, req.Password, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	h.setSession(c, tokens)
	return httpx.WriteOK(c, userView(user))
}

func (h *Handlers) Refresh(c echo.Context) error {
	cookie, err := c.Request().Cookie(CookieRefresh)
	if err != nil || cookie.Value == "" {
		return httpx.WriteError(c, httpx.ErrUnauthorized)
	}
	tokens, err := h.svc.Refresh(c.Request().Context(), cookie.Value, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		// Clear cookies on suspected reuse / invalid.
		clearSessionCookie(c, CookieAccess, h.cookie)
		clearSessionCookie(c, CookieRefresh, h.cookie)
		return httpx.WriteError(c, err)
	}
	h.setSession(c, tokens)
	return httpx.WriteNoContent(c)
}

func (h *Handlers) Logout(c echo.Context) error {
	uid := CurrentUserID(c)
	var refresh string
	if rt, err := c.Request().Cookie(CookieRefresh); err == nil {
		refresh = rt.Value
	}
	h.svc.Logout(c.Request().Context(), uid, refresh, c.RealIP(), c.Request().UserAgent())
	clearSessionCookie(c, CookieAccess, h.cookie)
	clearSessionCookie(c, CookieRefresh, h.cookie)
	return httpx.WriteNoContent(c)
}

func (h *Handlers) Me(c echo.Context) error {
	uid := CurrentUserID(c)
	u, err := h.svc.FindUserByID(c.Request().Context(), uid)
	if err != nil {
		return httpx.WriteError(c, httpx.ErrUnauthorized)
	}
	return httpx.WriteOK(c, userView(u))
}

type forgotPasswordReq struct {
	Email string `json:"email"`
}

type forgotPasswordResp struct {
	Sent   bool   `json:"sent"`
	Email  string `json:"email"`
	DevOTP string `json:"dev_otp,omitempty"`
}

// ForgotPassword issues a password-reset OTP if the email is registered.
// Per product spec the response is NOT silent-success — we return 404
// ErrEmailNotRegistered if the email has no account, so the dashboard can
// show "no account with this email" instead of a confusing silent OK.
func (h *Handlers) ForgotPassword(c echo.Context) error {
	var req forgotPasswordReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	res, err := h.svc.ForgotPassword(c.Request().Context(), req.Email, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, forgotPasswordResp{Sent: true, Email: res.Email, DevOTP: res.DevOTP})
}

type resetPasswordReq struct {
	Email       string `json:"email"`
	Code        string `json:"code"`
	NewPassword string `json:"new_password"`
}

// ResetPassword consumes the OTP + sets the new password + invalidates
// every existing session for the user.
func (h *Handlers) ResetPassword(c echo.Context) error {
	var req resetPasswordReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	if err := h.svc.ResetPassword(c.Request().Context(), req.Email, req.Code, req.NewPassword, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteNoContent(c)
}

// ExchangeDeviceKey takes a device API key in the request body and returns
// the user + device info if it's valid. Lets the Mac desktop client sign in
// by pasting an API key generated on the web dashboard — same pattern as
// fly.io / Linear CLIs. No cookie / session is involved on either side.
type exchangeDeviceKeyReq struct {
	APIKey string `json:"api_key"`
}
type exchangeDeviceKeyResp struct {
	UserID     string `json:"user_id"`
	Email      string `json:"email"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
}

func (h *Handlers) ExchangeDeviceKey(c echo.Context) error {
	var req exchangeDeviceKeyReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, err)
	}
	if req.APIKey == "" {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "api_key required"))
	}
	dev, user, err := h.svc.LookupByDeviceAPIKey(c.Request().Context(), req.APIKey)
	if err != nil {
		return httpx.WriteError(c, httpx.ErrUnauthorized)
	}
	return httpx.WriteOK(c, exchangeDeviceKeyResp{
		UserID:     user.ID,
		Email:      user.Email,
		Name:       user.Name,
		Role:       string(user.Role),
		DeviceID:   dev.ID,
		DeviceName: dev.Name,
	})
}

// CSRFIssue is wired alongside the auth handlers because it relies on a session being present.
func (h *Handlers) CSRFIssue(c echo.Context) error {
	tok, err := csrf.Issue(c, h.cookie.Secure, h.cookie.Domain)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]string{"csrf_token": tok})
}

// --- helpers ---

func (h *Handlers) setSession(c echo.Context, t *SessionTokens) {
	ttlAccess := time.Until(t.AccessExp)
	ttlRefresh := time.Until(t.RefreshExp)
	setSessionCookie(c, CookieAccess, t.AccessToken, ttlAccess, h.cookie)
	setSessionCookie(c, CookieRefresh, t.RefreshToken, ttlRefresh, h.cookie)
}

type userVM struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
	PlanID uint  `json:"plan_id"`
	EmailVerified bool `json:"email_verified"`
}

func userView(u *models.User) userVM {
	return userVM{
		ID:            u.ID,
		Email:         u.Email,
		Name:          u.Name,
		Role:          string(u.Role),
		PlanID:        u.PlanID,
		EmailVerified: u.EmailVerifiedAt != nil,
	}
}
