package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/osmrouter/server/internal/audit"
	mailer "github.com/osmrouter/server/internal/mail"
	"github.com/osmrouter/server/internal/models"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
	"gorm.io/gorm"
)

// Errors specific to auth, mapped to httpx codes by handlers.
var (
	ErrEmailInUse        = httpx.New(http.StatusConflict, "EMAIL_IN_USE", "an account with this email already exists")
	ErrInvalidCredentials = httpx.New(http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password incorrect")
	ErrUserNotVerified   = httpx.New(http.StatusForbidden, "EMAIL_NOT_VERIFIED", "verify your email before signing in")
	ErrOTPInvalid        = httpx.New(http.StatusBadRequest, httpx.CodeOTPInvalid, "code is incorrect or expired")
	ErrOTPExhausted      = httpx.New(http.StatusTooManyRequests, "OTP_ATTEMPTS_EXCEEDED", "too many attempts; request a new code")
	ErrPasswordTooWeak   = httpx.New(http.StatusBadRequest, "WEAK_PASSWORD", "password must be at least 8 characters and contain a digit")
	ErrInvalidEmail      = httpx.New(http.StatusBadRequest, "INVALID_EMAIL", "email looks malformed")
	// ErrEmailNotRegistered tells the caller that no account exists for the given email.
	// We surface this on the /forgot-password endpoint per product spec — yes, it leaks
	// account-existence (an enumeration risk), but the spec explicitly asks for the
	// clearer UX of "email not registered" instead of the silent-success pattern.
	ErrEmailNotRegistered = httpx.New(http.StatusNotFound, "EMAIL_NOT_REGISTERED", "no account is registered with this email")
)

// Service holds dependencies for the auth flow.
type Service struct {
	db           *gorm.DB
	jwt          *cr.JWTIssuer
	auditw       *audit.Writer
	mailer       mailer.Mailer
	logger       *slog.Logger
	accessTTL    time.Duration
	refreshTTL   time.Duration
	otpTTL       time.Duration
	devExposeOTP bool
}

func NewService(db *gorm.DB, jwtIssuer *cr.JWTIssuer, auditw *audit.Writer, mlr mailer.Mailer, logger *slog.Logger,
	accessTTL, refreshTTL, otpTTL time.Duration, devExposeOTP bool) *Service {
	if mlr == nil {
		mlr = &mailer.NoopMailer{Logger: logger}
	}
	return &Service{
		db:           db,
		jwt:          jwtIssuer,
		auditw:       auditw,
		mailer:       mlr,
		logger:       logger,
		accessTTL:    accessTTL,
		refreshTTL:   refreshTTL,
		otpTTL:       otpTTL,
		devExposeOTP: devExposeOTP,
	}
}

// RegisterResult is what we return to the caller after a registration call.
type RegisterResult struct {
	UserID  string
	Email   string
	DevOTP  string // populated only in dev/test for E2E flows
}

// Register validates and creates a user, generating + storing an OTP.
// Returns the OTP plaintext if devExposeOTP is on (dev mode only).
func (s *Service) Register(ctx context.Context, email, password, name, ip, ua string) (*RegisterResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, ErrInvalidEmail
	}
	if err := validatePassword(password); err != nil {
		return nil, err
	}
	// Uniqueness check (case-insensitive via lower-cased storage).
	var existing models.User
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&existing).Error
	if err == nil {
		return nil, ErrEmailInUse
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	hash, err := cr.HashPassword(password)
	if err != nil {
		return nil, err
	}
	user := models.User{
		ID:           uuid.NewString(),
		Email:        email,
		Name:         strings.TrimSpace(name),
		PasswordHash: hash,
		Role:         models.RoleUser,
		PlanID:       1, // free plan by convention
	}
	otpCode, err := s.issueOTP(ctx, &user, models.OTPPurposeSignup)
	if err != nil {
		return nil, err
	}
	if err := s.db.WithContext(ctx).Create(&user).Error; err != nil {
		return nil, err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: user.ID,
		Action:      models.AuditUserCreated,
		TargetKind:  "user",
		TargetID:    user.ID,
		IP:          ip,
		UserAgent:   ua,
	})
	// Deliver the OTP. Failure is logged but doesn't break signup — the
	// user can request a new code from the verify page. NoopMailer logs
	// the code itself when SMTP isn't configured, so a dev/staging deploy
	// can still complete the flow by reading server logs.
	if err := s.mailer.SendOTP(user.Email, user.Name, otpCode); err != nil {
		if s.logger != nil {
			s.logger.Warn("mail:send-failed", "to", user.Email, "err", err.Error())
		}
	}
	r := &RegisterResult{UserID: user.ID, Email: user.Email}
	if s.devExposeOTP {
		r.DevOTP = otpCode
	}
	return r, nil
}

// VerifyOTP consumes a code, marks email verified, and issues a session.
func (s *Service) VerifyOTP(ctx context.Context, email, code, ip, ua string) (*SessionTokens, *models.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var user models.User
	if err := s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrOTPInvalid
		}
		return nil, nil, err
	}
	var otp models.EmailOTP
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
			user.ID, models.OTPPurposeSignup, time.Now()).
		Order("created_at DESC").
		First(&otp).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrOTPInvalid
		}
		return nil, nil, err
	}
	if otp.Attempts >= 5 {
		return nil, nil, ErrOTPExhausted
	}
	if cr.SHA256Hex(code) != otp.CodeHash {
		// Atomic increment
		s.db.WithContext(ctx).Model(&otp).UpdateColumn("attempts", gorm.Expr("attempts + 1"))
		return nil, nil, ErrOTPInvalid
	}
	now := time.Now()
	// Mark consumed atomically — fail if someone else already consumed it.
	tx := s.db.WithContext(ctx).Model(&models.EmailOTP{}).
		Where("id = ? AND consumed_at IS NULL", otp.ID).
		Update("consumed_at", &now)
	if tx.Error != nil {
		return nil, nil, tx.Error
	}
	if tx.RowsAffected == 0 {
		return nil, nil, ErrOTPInvalid
	}
	if user.EmailVerifiedAt == nil {
		if err := s.db.WithContext(ctx).Model(&user).Update("email_verified_at", &now).Error; err != nil {
			return nil, nil, err
		}
		user.EmailVerifiedAt = &now
	}
	tokens, err := s.issueSession(ctx, &user, ip, ua, nil)
	if err != nil {
		return nil, nil, err
	}
	return tokens, &user, nil
}

// Login validates password and issues a session. Identical error on no-such-user vs wrong-password.
func (s *Service) Login(ctx context.Context, email, password, ip, ua string) (*SessionTokens, *models.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var user models.User
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		// Constant-time-ish: still hash a dummy password to equalize timing.
		_ = cr.VerifyPassword("$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", password)
		return nil, nil, ErrInvalidCredentials
	}
	if err := cr.VerifyPassword(user.PasswordHash, password); err != nil {
		return nil, nil, ErrInvalidCredentials
	}
	if user.EmailVerifiedAt == nil {
		return nil, nil, ErrUserNotVerified
	}
	tokens, err := s.issueSession(ctx, &user, ip, ua, nil)
	if err != nil {
		return nil, nil, err
	}
	now := time.Now()
	s.db.WithContext(ctx).Model(&user).Updates(map[string]any{
		"last_login_at": &now,
		"last_login_ip": ip,
	})
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: user.ID,
		Action:      models.AuditUserLoggedIn,
		TargetKind:  "user",
		TargetID:    user.ID,
		IP:          ip,
		UserAgent:   ua,
	})
	return tokens, &user, nil
}

// Refresh rotates a refresh token. Returns new session tokens.
// If the presented token has already been rotated, the entire chain is revoked.
func (s *Service) Refresh(ctx context.Context, presentedToken, ip, ua string) (*SessionTokens, error) {
	hash := cr.SHA256Hex(presentedToken)
	var rt models.RefreshToken
	if err := s.db.WithContext(ctx).Where("token_hash = ?", hash).First(&rt).Error; err != nil {
		return nil, httpx.ErrUnauthorized
	}
	if rt.RevokedAt != nil || time.Now().After(rt.ExpiresAt) {
		// Possible reuse — revoke entire chain.
		s.revokeChain(ctx, rt.UserID, &rt)
		s.auditw.Write(ctx, audit.Event{
			ActorUserID: rt.UserID,
			Action:      models.AuditRefreshReuseDetected,
			TargetKind:  "refresh_token",
			TargetID:    rt.ID,
			IP:          ip,
			UserAgent:   ua,
		})
		return nil, httpx.ErrUnauthorized
	}
	now := time.Now()
	// Mark current as revoked, then issue a child token in the same chain.
	if err := s.db.WithContext(ctx).Model(&rt).Update("revoked_at", &now).Error; err != nil {
		return nil, err
	}
	var user models.User
	if err := s.db.WithContext(ctx).Where("id = ?", rt.UserID).First(&user).Error; err != nil {
		return nil, err
	}
	parentID := rt.ID
	return s.issueSession(ctx, &user, ip, ua, &parentID)
}

// Logout revokes the user's current refresh chain.
func (s *Service) Logout(ctx context.Context, userID, presentedRefresh, ip, ua string) {
	if presentedRefresh != "" {
		hash := cr.SHA256Hex(presentedRefresh)
		var rt models.RefreshToken
		if err := s.db.WithContext(ctx).Where("token_hash = ?", hash).First(&rt).Error; err == nil {
			s.revokeChain(ctx, rt.UserID, &rt)
		}
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditUserLoggedOut,
		TargetKind:  "user",
		TargetID:    userID,
		IP:          ip,
		UserAgent:   ua,
	})
}

// LookupByDeviceAPIKey resolves a raw device API key (as pasted into the
// Mac client) to (device, user). Returns ErrUnauthorized for any miss so
// the handler doesn't leak whether the key was syntactically valid but
// unknown vs. revoked.
func (s *Service) LookupByDeviceAPIKey(ctx context.Context, apiKey string) (*models.Device, *models.User, error) {
	hash := cr.SHA256Hex(apiKey)
	var dev models.Device
	if err := s.db.WithContext(ctx).
		Where("api_key_hash = ? AND revoked_at IS NULL", hash).
		First(&dev).Error; err != nil {
		return nil, nil, ErrInvalidCredentials
	}
	var user models.User
	if err := s.db.WithContext(ctx).First(&user, "id = ?", dev.UserID).Error; err != nil {
		return nil, nil, ErrInvalidCredentials
	}
	return &dev, &user, nil
}

// FindUserByID is a helper used by middleware to materialize the actor.
func (s *Service) FindUserByID(ctx context.Context, id string) (*models.User, error) {
	var u models.User
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&u).Error; err != nil {
		return nil, err
	}
	return &u, nil
}

// --- internals ---

// SessionTokens is what we hand to the cookie setters.
type SessionTokens struct {
	AccessToken  string
	RefreshToken string
	AccessExp    time.Time
	RefreshExp   time.Time
}

func (s *Service) issueSession(ctx context.Context, user *models.User, ip, ua string, parentID *string) (*SessionTokens, error) {
	accessTok, err := s.jwt.Sign(cr.Claims{UserID: user.ID, Role: string(user.Role)}, s.accessTTL)
	if err != nil {
		return nil, err
	}
	refreshPlain, err := cr.RandomURLToken(32)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	exp := now.Add(s.refreshTTL)
	rt := models.RefreshToken{
		ID:        uuid.NewString(),
		UserID:    user.ID,
		TokenHash: cr.SHA256Hex(refreshPlain),
		ParentID:  parentID,
		IssuedAt:  now,
		ExpiresAt: exp,
		IP:        ip,
		UserAgent: ua,
	}
	if err := s.db.WithContext(ctx).Create(&rt).Error; err != nil {
		return nil, err
	}
	return &SessionTokens{
		AccessToken:  accessTok,
		RefreshToken: refreshPlain,
		AccessExp:    now.Add(s.accessTTL),
		RefreshExp:   exp,
	}, nil
}

func (s *Service) issueOTP(ctx context.Context, user *models.User, purpose models.OTPPurpose) (string, error) {
	code, err := cr.RandomDigits(6)
	if err != nil {
		return "", err
	}
	otp := models.EmailOTP{
		ID:        uuid.NewString(),
		UserID:    user.ID,
		Email:     user.Email,
		CodeHash:  cr.SHA256Hex(code),
		Purpose:   purpose,
		ExpiresAt: time.Now().Add(s.otpTTL),
	}
	if err := s.db.WithContext(ctx).Create(&otp).Error; err != nil {
		return "", err
	}
	return code, nil
}

// revokeChain walks parent_id pointers and marks the entire chain revoked.
// In SQLite + GORM, a single UPDATE with a CTE isn't portable; we use an iterative walk.
func (s *Service) revokeChain(ctx context.Context, userID string, start *models.RefreshToken) {
	now := time.Now()
	// Revoke all tokens for this user that are part of the chain (defence in depth: nuke them all).
	s.db.WithContext(ctx).Model(&models.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Update("revoked_at", &now)
}

func validatePassword(p string) error {
	if len(p) < 8 {
		return ErrPasswordTooWeak
	}
	hasDigit := false
	for _, r := range p {
		if r >= '0' && r <= '9' {
			hasDigit = true
			break
		}
	}
	if !hasDigit {
		return ErrPasswordTooWeak
	}
	return nil
}

// ForgotPasswordResult is what we return after a forgot-password request.
type ForgotPasswordResult struct {
	UserID string
	Email  string
	DevOTP string // populated only in dev/test for E2E flows
}

// ForgotPassword issues a password-reset OTP and emails it. Reuses the
// existing EmailOTP infrastructure with OTPPurposePasswordReset.
//
// Per the product spec, we DO surface "email not registered" explicitly
// (ErrEmailNotRegistered, HTTP 404) instead of the privacy-preferred
// silent-success pattern — clearer UX, but it lets attackers enumerate
// account-existence by trying emails one at a time. Rate limiting on the
// route (5/min/IP, declared in server.go) is the compensating control.
func (s *Service) ForgotPassword(ctx context.Context, email, ip, ua string) (*ForgotPasswordResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, ErrInvalidEmail
	}
	var user models.User
	err := s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrEmailNotRegistered
		}
		return nil, err
	}
	otpCode, err := s.issueOTP(ctx, &user, models.OTPPurposePasswordReset)
	if err != nil {
		return nil, err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: user.ID,
		Action:      models.AuditPasswordResetRequested,
		TargetKind:  "user",
		TargetID:    user.ID,
		IP:          ip,
		UserAgent:   ua,
	})
	// Email delivery — same NoopMailer fallback as the signup OTP path.
	if err := s.mailer.SendPasswordReset(user.Email, user.Name, otpCode); err != nil {
		if s.logger != nil {
			s.logger.Warn("mail:send-password-reset-failed", "to", user.Email, "err", err.Error())
		}
	}
	r := &ForgotPasswordResult{UserID: user.ID, Email: user.Email}
	if s.devExposeOTP {
		r.DevOTP = otpCode
	}
	return r, nil
}

// ResetPassword consumes a password-reset OTP, sets a new password hash,
// and invalidates every existing session (so a leaked old session can't
// outlive the reset). Mirrors VerifyOTP's atomic single-use pattern.
func (s *Service) ResetPassword(ctx context.Context, email, code, newPassword, ip, ua string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if err := validatePassword(newPassword); err != nil {
		return err
	}
	var user models.User
	if err := s.db.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// Same opaque error as a bad code — once they're here we don't
			// re-leak that the email is unknown.
			return ErrOTPInvalid
		}
		return err
	}
	var otp models.EmailOTP
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?",
			user.ID, models.OTPPurposePasswordReset, time.Now()).
		Order("created_at DESC").
		First(&otp).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrOTPInvalid
		}
		return err
	}
	if otp.Attempts >= 5 {
		return ErrOTPExhausted
	}
	if cr.SHA256Hex(code) != otp.CodeHash {
		s.db.WithContext(ctx).Model(&otp).UpdateColumn("attempts", gorm.Expr("attempts + 1"))
		return ErrOTPInvalid
	}
	now := time.Now()
	// Atomic single-use mark — fail if someone else won the race.
	tx := s.db.WithContext(ctx).Model(&models.EmailOTP{}).
		Where("id = ? AND consumed_at IS NULL", otp.ID).
		Update("consumed_at", &now)
	if tx.Error != nil {
		return tx.Error
	}
	if tx.RowsAffected == 0 {
		return ErrOTPInvalid
	}
	// Hash + persist the new password.
	hash, err := cr.HashPassword(newPassword)
	if err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Model(&user).Update("password_hash", hash).Error; err != nil {
		return err
	}
	// Nuke every existing refresh-token chain for this user — a leaked
	// session must not survive a password reset.
	s.db.WithContext(ctx).Model(&models.RefreshToken{}).
		Where("user_id = ? AND revoked_at IS NULL", user.ID).
		Update("revoked_at", &now)
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: user.ID,
		Action:      models.AuditPasswordResetCompleted,
		TargetKind:  "user",
		TargetID:    user.ID,
		IP:          ip,
		UserAgent:   ua,
	})
	return nil
}
