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
