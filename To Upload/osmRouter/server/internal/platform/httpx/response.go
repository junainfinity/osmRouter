package httpx

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

type errEnvelope struct {
	Error errBody `json:"error"`
}
type errBody struct {
	Code      Code   `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
}

// WriteError maps any error to a sanitized JSON response. No stack traces, no internals.
func WriteError(c echo.Context, err error) error {
	e := From(err)
	if e.HTTPStatus == 0 {
		e.HTTPStatus = http.StatusInternalServerError
	}
	reqID, _ := c.Get("request_id").(string)
	return c.JSON(e.HTTPStatus, errEnvelope{Error: errBody{
		Code:      e.Code,
		Message:   e.Message,
		RequestID: reqID,
	}})
}

// WriteOK is sugar for JSON 200.
func WriteOK(c echo.Context, body any) error {
	return c.JSON(http.StatusOK, body)
}

// WriteCreated is sugar for JSON 201.
func WriteCreated(c echo.Context, body any) error {
	return c.JSON(http.StatusCreated, body)
}

// WriteNoContent is sugar for 204.
func WriteNoContent(c echo.Context) error {
	return c.NoContent(http.StatusNoContent)
}
