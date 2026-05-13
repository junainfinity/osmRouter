package domains

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/platform/httpx"
)

type Handlers struct {
	svc      *Service
	verifier *Verifier
}

func NewHandlers(svc *Service, verifier *Verifier) *Handlers {
	return &Handlers{svc: svc, verifier: verifier}
}

type createReq struct {
	FQDN      string `json:"fqdn"`
	Registrar string `json:"registrar"`
}

func (h *Handlers) Create(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	var req createReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	d, err := h.svc.Create(c.Request().Context(), uid, req.FQDN, req.Registrar, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	// Trigger verification in background.
	if h.verifier != nil {
		h.verifier.Enqueue(d.ID)
	}
	return httpx.WriteCreated(c, d)
}

func (h *Handlers) List(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	out, err := h.svc.List(c.Request().Context(), uid)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"domains": out})
}

func (h *Handlers) Get(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	d, err := h.svc.Get(c.Request().Context(), uid, id)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, d)
}

func (h *Handlers) Delete(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	if err := h.svc.Delete(c.Request().Context(), uid, id, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteNoContent(c)
}

func (h *Handlers) Verify(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	// Ownership check (avoid IDOR)
	if _, err := h.svc.Get(c.Request().Context(), uid, id); err != nil {
		return httpx.WriteError(c, err)
	}
	if h.verifier != nil {
		h.verifier.Enqueue(id)
	}
	return httpx.WriteOK(c, map[string]string{"status": "queued"})
}
