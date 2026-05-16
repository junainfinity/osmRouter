// Package mail handles outbound transactional email.
//
// Today the only email we send is the signup-verification OTP. The
// interface is intentionally narrow so we can swap providers (Postmark,
// SES, SendGrid, plain SMTP relay) without touching auth code.
//
// Failure policy: SendOTP returns an error, but Register() is expected
// to log + continue. A temporary SMTP outage must not block account
// creation — the user can resend the code from the verify page.
package mail

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strings"
	"time"
)

// Mailer is the small surface every email backend implements.
type Mailer interface {
	SendOTP(to, name, code string) error
	SendPasswordReset(to, name, code string) error
}

// NoopMailer logs the OTP/reset code but doesn't send anything. Used when
// SMTP isn't configured — keeps Register() and ForgotPassword() working in
// local-dev / pre-launch states.
type NoopMailer struct {
	Logger *slog.Logger
}

func (m *NoopMailer) SendOTP(to, name, code string) error {
	if m.Logger != nil {
		m.Logger.Warn("mail:smtp-not-configured", "to", to, "code", code,
			"hint", "set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD in .env to enable delivery")
	}
	return nil
}

func (m *NoopMailer) SendPasswordReset(to, name, code string) error {
	if m.Logger != nil {
		m.Logger.Warn("mail:smtp-not-configured", "kind", "password-reset", "to", to, "code", code,
			"hint", "set SMTP_HOST / SMTP_USERNAME / SMTP_PASSWORD in .env to enable delivery")
	}
	return nil
}

// SMTPConfig is everything we need to talk to a vanilla SMTP relay
// (Gmail, Postmark, SendGrid, SES — they all expose SMTP).
type SMTPConfig struct {
	Host     string // e.g. "smtp.gmail.com"
	Port     int    // 587 (STARTTLS) or 465 (implicit TLS)
	Username string
	Password string
	From     string // "osmRouter <noreply@osmrouter.com>"
}

// SMTPMailer delivers via STARTTLS on the configured relay.
type SMTPMailer struct {
	cfg    SMTPConfig
	logger *slog.Logger
}

func NewSMTPMailer(cfg SMTPConfig, logger *slog.Logger) *SMTPMailer {
	return &SMTPMailer{cfg: cfg, logger: logger}
}

func (m *SMTPMailer) SendOTP(to, name, code string) error {
	subject := "Your osmRouter verification code"
	body := otpBody(name, code)
	return m.sendRaw(to, subject, body)
}

func (m *SMTPMailer) SendPasswordReset(to, name, code string) error {
	subject := "Reset your osmRouter password"
	body := passwordResetBody(name, code)
	return m.sendRaw(to, subject, body)
}

// passwordResetBody mirrors otpBody but with copy that makes it clear
// what the code is for. The reset page on the dashboard accepts the
// same 6-digit code the user pastes here, so we don't even need a URL.
func passwordResetBody(name, code string) string {
	greeting := "Hi"
	if n := strings.TrimSpace(name); n != "" {
		greeting = "Hi " + n
	}
	return fmt.Sprintf(`%s,

Use this code to reset your osmRouter password:

  %s

It expires in 10 minutes. If you didn't request a password reset, you
can safely ignore this email — your account is unchanged.

— osmRouter
`, greeting, code)
}

// otpBody renders a tiny plaintext + html email. Plain-text is the trunk
// because some corporate filters strip HTML or render it weirdly. The
// minimal HTML version gives modern clients a slightly nicer layout.
func otpBody(name, code string) string {
	greeting := "Hi"
	if n := strings.TrimSpace(name); n != "" {
		greeting = "Hi " + n
	}
	return fmt.Sprintf(`%s,

Your osmRouter verification code is:

  %s

It expires in 10 minutes. If you didn't request this, you can safely
ignore this email — no one can access your account without this code.

— osmRouter
`, greeting, code)
}

func (m *SMTPMailer) sendRaw(to, subject, body string) error {
	if m.cfg.Host == "" {
		return errors.New("smtp: host not configured")
	}
	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)
	from := m.cfg.From
	if from == "" {
		from = m.cfg.Username
	}

	msg := []byte(strings.Join([]string{
		"From: " + from,
		"To: " + to,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/plain; charset=UTF-8",
		"",
		body,
	}, "\r\n"))

	auth := smtp.PlainAuth("", m.cfg.Username, m.cfg.Password, m.cfg.Host)

	// Dial + STARTTLS by hand so we can set a tight timeout. The net/smtp
	// helper SendMail blocks forever if the relay is unreachable.
	conn, err := net.DialTimeout("tcp", addr, 10*time.Second)
	if err != nil {
		return fmt.Errorf("smtp: dial: %w", err)
	}
	defer func() { _ = conn.Close() }()
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))

	client, err := smtp.NewClient(conn, m.cfg.Host)
	if err != nil {
		return fmt.Errorf("smtp: new client: %w", err)
	}
	defer func() { _ = client.Close() }()

	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(&tls.Config{ServerName: m.cfg.Host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("smtp: starttls: %w", err)
		}
	}
	if err := client.Auth(auth); err != nil {
		return fmt.Errorf("smtp: auth: %w", err)
	}
	if err := client.Mail(stripDisplayName(from)); err != nil {
		return fmt.Errorf("smtp: mail-from: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp: rcpt-to: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp: data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp: write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp: close-data: %w", err)
	}
	_ = client.Quit()

	if m.logger != nil {
		m.logger.Info("mail:sent", "to", to, "subject", subject)
	}
	return nil
}

// stripDisplayName accepts "Name <addr@host>" and returns just "addr@host"
// for the SMTP MAIL FROM command, which doesn't allow display names.
func stripDisplayName(s string) string {
	if i := strings.LastIndex(s, "<"); i >= 0 {
		if j := strings.Index(s[i:], ">"); j >= 0 {
			return s[i+1 : i+j]
		}
	}
	return strings.TrimSpace(s)
}
