package admin

import (
	"strconv"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/platform/httpx"
)

type Handlers struct {
	svc *Service
}

func NewHandlers(svc *Service) *Handlers { return &Handlers{svc: svc} }

func (h *Handlers) Network(c echo.Context) error {
	st, err := h.svc.Network(c.Request().Context())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, st)
}

func (h *Handlers) Users(c echo.Context) error {
	q := c.QueryParam("q")
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	rows, err := h.svc.Users(c.Request().Context(), q, limit)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"users": rows})
}

func (h *Handlers) Dossier(c echo.Context) error {
	d, err := h.svc.Dossier(c.Request().Context(), c.Param("id"))
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, d)
}

func (h *Handlers) Impersonate(c echo.Context) error {
	adminID := auth.CurrentUserID(c)
	tok, err := h.svc.Impersonate(c.Request().Context(), adminID, c.Param("id"), c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]string{"impersonation_token": tok})
}

func (h *Handlers) Audit(c echo.Context) error {
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	rows, err := h.svc.Audit(c.Request().Context(), limit)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"entries": rows})
}

func (h *Handlers) Plans(c echo.Context) error {
	plans, err := h.svc.Plans(c.Request().Context())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"plans": plans})
}

func (h *Handlers) UpdatePlan(c echo.Context) error {
	id64, _ := strconv.ParseUint(c.Param("id"), 10, 64)
	if id64 == 0 {
		return httpx.WriteError(c, httpx.ErrNotFound)
	}
	var req PlanUpdate
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, err)
	}
	actorID := auth.CurrentUserID(c)
	plan, err := h.svc.UpdatePlan(c.Request().Context(), uint(id64), req, actorID, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, plan)
}

