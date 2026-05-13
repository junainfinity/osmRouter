package httpx

import (
	"errors"
	"fmt"
	"net/http"
)

type Code string

const (
	CodeValidation     Code = "VALIDATION_FAILED"
	CodeUnauthorized   Code = "UNAUTHORIZED"
	CodeForbidden      Code = "FORBIDDEN"
	CodeNotFound       Code = "NOT_FOUND"
	CodeConflict       Code = "CONFLICT"
	CodeTooMany        Code = "TOO_MANY_REQUESTS"
	CodeCSRF           Code = "CSRF_INVALID"
	CodeReadOnly       Code = "READONLY_MODE"
	CodeInternal       Code = "INTERNAL_ERROR"
	CodeBadRequest     Code = "BAD_REQUEST"
	CodeAccountLocked  Code = "ACCOUNT_LOCKED"
	CodeOTPInvalid     Code = "OTP_INVALID"
	CodeTokenExpired   Code = "TOKEN_EXPIRED"
	CodeTokenInvalid   Code = "TOKEN_INVALID"
)

type Error struct {
	HTTPStatus int    `json:"-"`
	Code       Code   `json:"code"`
	Message    string `json:"message"`
	cause      error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.cause != nil {
		return fmt.Sprintf("%s: %s (cause: %v)", e.Code, e.Message, e.cause)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *Error) Unwrap() error { return e.cause }

func (e *Error) With(cause error) *Error {
	cp := *e
	cp.cause = cause
	return &cp
}

func New(status int, code Code, message string) *Error {
	return &Error{HTTPStatus: status, Code: code, Message: message}
}

func From(err error) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return New(http.StatusInternalServerError, CodeInternal, "internal error").With(err)
}

// Common preset errors
var (
	ErrUnauthorized = New(http.StatusUnauthorized, CodeUnauthorized, "unauthorized")
	ErrForbidden    = New(http.StatusForbidden, CodeForbidden, "forbidden")
	ErrCSRF         = New(http.StatusForbidden, CodeCSRF, "csrf token missing or invalid")
	ErrNotFound     = New(http.StatusNotFound, CodeNotFound, "not found")
	ErrTooMany      = New(http.StatusTooManyRequests, CodeTooMany, "too many requests")
	ErrReadOnly     = New(http.StatusServiceUnavailable, CodeReadOnly, "service is in read-only mode")
)
