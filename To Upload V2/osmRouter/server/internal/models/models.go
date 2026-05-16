package models

import (
	"time"

	"gorm.io/gorm"
)

// Role represents a user's role in the system.
type Role string

const (
	RoleUser  Role = "user"
	RoleAdmin Role = "admin"
)

// DNSStatus tracks a domain's verification state.
type DNSStatus string

const (
	DNSStatusPending    DNSStatus = "pending"
	DNSStatusVerifying  DNSStatus = "verifying"
	DNSStatusVerified   DNSStatus = "verified"
	DNSStatusFailed     DNSStatus = "failed"
)

// Plan defines a subscription tier.
//
// Pricing convention: PriceCents is *minor units* of Currency. For INR
// (the default) that's paise — so PriceCents=10000 means ₹100. For USD
// it would be cents. The UI formats based on Currency.
//
// Status values:
//   - "active"       — visible to users, signups allowed
//   - "coming_soon"  — visible to users, but not selectable
//   - "archived"     — hidden from users; existing subscribers retain the plan
type Plan struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	Slug          string    `gorm:"uniqueIndex;size:32" json:"slug"`
	Name          string    `gorm:"size:64" json:"name"`
	Description   string    `gorm:"size:255" json:"description"`
	PriceCents    int       `json:"price_cents"`
	Currency      string    `gorm:"size:3;default:INR" json:"currency"`
	MaxDomains    int       `json:"max_domains"`
	MaxSubdomains int       `json:"max_subdomains"`
	MaxDevices    int       `json:"max_devices"`
	BandwidthGB   int       `json:"bandwidth_gb"`
	Status        string    `gorm:"size:16;default:active" json:"status"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// User is the core identity record.
type User struct {
	ID              string    `gorm:"primaryKey;size:36" json:"id"`
	Email           string    `gorm:"uniqueIndex;size:320;not null" json:"email"`
	Name            string    `gorm:"size:128" json:"name"`
	PasswordHash    string    `gorm:"size:255;not null" json:"-"`
	Role            Role      `gorm:"size:16;default:user;index" json:"role"`
	PlanID          uint      `gorm:"default:1" json:"plan_id"`
	EmailVerifiedAt *time.Time `json:"email_verified_at,omitempty"`
	MFAEnabled      bool      `gorm:"default:false" json:"mfa_enabled"`
	TOTPSecret      string    `gorm:"size:255" json:"-"`
	LastLoginAt     *time.Time `json:"last_login_at,omitempty"`
	LastLoginIP     string    `gorm:"size:64" json:"-"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	DeletedAt       gorm.DeletedAt `gorm:"index" json:"-"`
}

// RefreshToken stores rotated refresh tokens in a chain.
// On reuse of a parent token, the entire chain is revoked.
type RefreshToken struct {
	ID        string     `gorm:"primaryKey;size:36" json:"id"`
	UserID    string     `gorm:"index;size:36;not null" json:"user_id"`
	TokenHash string     `gorm:"uniqueIndex;size:64;not null" json:"-"`
	ParentID  *string    `gorm:"size:36;index" json:"parent_id,omitempty"`
	IssuedAt  time.Time  `json:"issued_at"`
	ExpiresAt time.Time  `gorm:"index" json:"expires_at"`
	RevokedAt *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	IP        string     `gorm:"size:64" json:"-"`
	UserAgent string     `gorm:"size:255" json:"-"`
}

// OTPPurpose disambiguates one-time codes.
type OTPPurpose string

const (
	OTPPurposeSignup        OTPPurpose = "signup"
	OTPPurposePasswordReset OTPPurpose = "password_reset"
	OTPPurposeSensitive     OTPPurpose = "sensitive"
)

// EmailOTP stores hashed one-time codes.
type EmailOTP struct {
	ID         string     `gorm:"primaryKey;size:36" json:"id"`
	UserID     string     `gorm:"index;size:36" json:"user_id"`
	Email      string     `gorm:"index;size:320;not null" json:"email"`
	CodeHash   string     `gorm:"size:64;not null" json:"-"`
	Purpose    OTPPurpose `gorm:"size:32" json:"purpose"`
	ExpiresAt  time.Time  `gorm:"index" json:"expires_at"`
	ConsumedAt *time.Time `json:"consumed_at,omitempty"`
	Attempts   int        `gorm:"default:0" json:"attempts"`
	CreatedAt  time.Time  `json:"created_at"`
}

// Device represents an authenticated desktop client machine.
type Device struct {
	ID           string     `gorm:"primaryKey;size:36" json:"id"`
	UserID       string     `gorm:"index;size:36;not null" json:"user_id"`
	HardwareUUID string     `gorm:"index;size:64" json:"hardware_uuid"`
	Name         string     `gorm:"size:128" json:"name"`
	OSType       string     `gorm:"size:32" json:"os_type"` // macos|windows|linux
	LastSeenAt   *time.Time `json:"last_seen_at,omitempty"`
	LastSeenIP   string     `gorm:"size:64" json:"last_seen_ip,omitempty"`
	IsOnline     bool       `gorm:"default:false;index" json:"is_online"`
	APIKeyHash   string     `gorm:"uniqueIndex;size:64" json:"-"`
	RevokedAt    *time.Time `gorm:"index" json:"revoked_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// DeviceCode powers the OAuth 2.1 device-code (PKCE) flow.
type DeviceCode struct {
	ID                  string     `gorm:"primaryKey;size:36" json:"id"`
	UserID              *string    `gorm:"index;size:36" json:"user_id,omitempty"` // nil until approved
	DeviceCode          string     `gorm:"uniqueIndex;size:64;not null" json:"-"`
	UserCode            string     `gorm:"uniqueIndex;size:16;not null" json:"user_code"`
	CodeChallenge       string     `gorm:"size:255" json:"-"`
	CodeChallengeMethod string     `gorm:"size:8" json:"-"`
	Scope               string     `gorm:"size:255" json:"scope"`
	ExpiresAt           time.Time  `gorm:"index" json:"expires_at"`
	ApprovedAt          *time.Time `json:"approved_at,omitempty"`
	ConsumedAt          *time.Time `json:"consumed_at,omitempty"`
	DeviceID            *string    `gorm:"size:36;index" json:"device_id,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
}

// Domain is a user-registered FQDN.
type Domain struct {
	ID                       string     `gorm:"primaryKey;size:36" json:"id"`
	UserID                   string     `gorm:"index;size:36;not null" json:"user_id"`
	FQDN                     string     `gorm:"uniqueIndex;size:255;not null" json:"fqdn"`
	Registrar                string     `gorm:"size:64" json:"registrar"`
	DNSStatus                DNSStatus  `gorm:"size:16;default:pending;index" json:"dns_status"`
	CNAMETarget              string     `gorm:"size:255" json:"cname_target"`
	TXTToken                 string     `gorm:"size:128" json:"txt_token"`
	VerificationAttempts     int        `gorm:"default:0" json:"verification_attempts"`
	VerificationAttemptedAt  *time.Time `json:"verification_attempted_at,omitempty"`
	VerifiedAt               *time.Time `json:"verified_at,omitempty"`
	RegistrarAPIKeyEnc       string     `gorm:"size:1024" json:"-"` // AES-GCM ciphertext
	CreatedAt                time.Time  `json:"created_at"`
	UpdatedAt                time.Time  `json:"updated_at"`
}

// Subdomain is a routing rule under a Domain.
// Prefix may be empty (apex routing).
// Subdomain represents one (parent domain, label) pair the user has bound or
// intends to bind to a device port. The composite unique index on
// (parent_domain_id, prefix) is enforced at the DB level so the Mac app's
// Domains tab never shows duplicate rows for the same hostname.
type Subdomain struct {
	ID             string     `gorm:"primaryKey;size:36" json:"id"`
	ParentDomainID string     `gorm:"index;size:36;not null;uniqueIndex:idx_subdomain_parent_prefix" json:"parent_domain_id"`
	Prefix         string     `gorm:"size:63;uniqueIndex:idx_subdomain_parent_prefix" json:"prefix"`
	TargetPort     int        `gorm:"default:0" json:"target_port"`
	BoundDeviceID  *string    `gorm:"size:36;index" json:"bound_device_id,omitempty"`
	BoundAt        *time.Time `json:"bound_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// Tunnel is a live (or historical) routed connection. Populated by proxy nodes.
type Tunnel struct {
	ID               string     `gorm:"primaryKey;size:36" json:"id"`
	SubdomainID      string     `gorm:"index;size:36;not null" json:"subdomain_id"`
	DeviceID         string     `gorm:"index;size:36;not null" json:"device_id"`
	ProxyNodeID      string     `gorm:"size:64" json:"proxy_node_id"`
	StartedAt        time.Time  `json:"started_at"`
	EndedAt          *time.Time `gorm:"index" json:"ended_at,omitempty"`
	BytesTransferred int64      `gorm:"default:0" json:"bytes_transferred"`
}

// AuditAction enumerates destructive / sensitive actions worth recording.
type AuditAction string

const (
	AuditUserCreated         AuditAction = "user.created"
	AuditUserLoggedIn        AuditAction = "user.logged_in"
	AuditUserLoggedOut       AuditAction = "user.logged_out"
	AuditUserPasswordChanged AuditAction = "user.password_changed"
	AuditUserDeleted         AuditAction = "user.deleted"
	AuditPasswordResetRequested AuditAction = "user.password_reset_requested"
	AuditPasswordResetCompleted AuditAction = "user.password_reset_completed"
	AuditRefreshReuseDetected AuditAction = "auth.refresh_reuse_detected"
	AuditDeviceCreated       AuditAction = "device.created"
	AuditDeviceRevoked       AuditAction = "device.revoked"
	AuditDomainCreated       AuditAction = "domain.created"
	AuditDomainDeleted       AuditAction = "domain.deleted"
	AuditDomainVerified      AuditAction = "domain.verified"
	AuditSubdomainCreated    AuditAction = "subdomain.created"
	AuditSubdomainDeleted    AuditAction = "subdomain.deleted"
	AuditSubdomainBound      AuditAction = "subdomain.bound"
	AuditSubdomainUnbound    AuditAction = "subdomain.unbound"
	AuditAdminImpersonate    AuditAction = "admin.impersonate"
	AuditAdminRoleChanged    AuditAction = "admin.role_changed"
	AuditAdminPlanUpdated    AuditAction = "admin.plan.updated"
)

// AuditLog is append-only. The DB role should grant INSERT only in production.
type AuditLog struct {
	ID           uint64      `gorm:"primaryKey;autoIncrement" json:"id"`
	ActorUserID  string      `gorm:"index;size:36" json:"actor_user_id"`
	TargetUserID *string     `gorm:"size:36;index" json:"target_user_id,omitempty"`
	Action       AuditAction `gorm:"size:64;index" json:"action"`
	TargetKind   string      `gorm:"size:32" json:"target_kind"`
	TargetID     string      `gorm:"size:64;index" json:"target_id"`
	Metadata     string      `gorm:"type:text" json:"metadata,omitempty"` // JSON
	IP           string      `gorm:"size:64" json:"ip,omitempty"`
	UserAgent    string      `gorm:"size:255" json:"user_agent,omitempty"`
	RequestID    string      `gorm:"size:64;index" json:"request_id,omitempty"`
	CreatedAt    time.Time   `gorm:"index" json:"created_at"`
}
