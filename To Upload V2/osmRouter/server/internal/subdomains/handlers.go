package subdomains

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/platform/httpx"
)

type Handlers struct {
	svc *Service
}

func NewHandlers(svc *Service) *Handlers { return &Handlers{svc: svc} }

type createReq struct {
	Prefix     string `json:"prefix"`
	TargetPort int    `json:"target_port"`
}

func (h *Handlers) Create(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	domainID := c.Param("id")
	var req createReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	sd, err := h.svc.Create(c.Request().Context(), uid, CreateInput{
		ParentDomainID: domainID,
		Prefix:         req.Prefix,
		TargetPort:     req.TargetPort,
	}, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteCreated(c, sd)
}

func (h *Handlers) List(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	domainID := c.Param("id")
	out, err := h.svc.List(c.Request().Context(), uid, domainID)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"subdomains": out})
}

func (h *Handlers) Delete(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	if err := h.svc.Delete(c.Request().Context(), uid, id, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteNoContent(c)
}

type bindReq struct {
	DeviceID string `json:"device_id"`
}

func (h *Handlers) Bind(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	var req bindReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	if err := h.svc.Bind(c.Request().Context(), uid, id, req.DeviceID, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]string{"status": "bound"})
}

func (h *Handlers) Unbind(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	if err := h.svc.Unbind(c.Request().Context(), uid, id, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]string{"status": "unbound"})
}
