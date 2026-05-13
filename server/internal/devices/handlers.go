package devices

import (
	"context"
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/platform/httpx"
)

type Handlers struct {
	svc *Service
}

func NewHandlers(svc *Service) *Handlers { return &Handlers{svc: svc} }

type createReq struct {
	Name         string `json:"name"`
	OSType       string `json:"os_type"`
	HardwareUUID string `json:"hardware_uuid"`
}

type createResp struct {
	Device any    `json:"device"`
	APIKey string `json:"api_key"` // shown once
}

func (h *Handlers) Create(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	var req createReq
	if err := c.Bind(&req); err != nil {
		return httpx.WriteError(c, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest, "invalid body"))
	}
	d, key, err := h.svc.Create(c.Request().Context(), uid, req.Name, req.OSType, req.HardwareUUID, c.RealIP(), c.Request().UserAgent())
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteCreated(c, createResp{Device: d, APIKey: key})
}

func (h *Handlers) List(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	out, err := h.svc.List(c.Request().Context(), uid)
	if err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]any{"devices": out})
}

func (h *Handlers) Revoke(c echo.Context) error {
	uid := auth.CurrentUserID(c)
	id := c.Param("id")
	if err := h.svc.Revoke(c.Request().Context(), uid, id, c.RealIP(), c.Request().UserAgent()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteNoContent(c)
}

// Heartbeat uses Bearer api-key auth (NOT cookies). Mounted on a separate route group.
func (h *Handlers) Heartbeat(c echo.Context) error {
	tok := strings.TrimPrefix(c.Request().Header.Get("Authorization"), "Bearer ")
	if tok == "" {
		return httpx.WriteError(c, httpx.ErrUnauthorized)
	}
	d, err := h.svc.FindByAPIKey(c.Request().Context(), tok)
	if err != nil {
		return httpx.WriteError(c, httpx.ErrUnauthorized)
	}
	if err := h.svc.Heartbeat(context.WithoutCancel(c.Request().Context()), d.ID, c.RealIP()); err != nil {
		return httpx.WriteError(c, err)
	}
	return httpx.WriteOK(c, map[string]string{"status": "ok", "device_id": d.ID})
}
