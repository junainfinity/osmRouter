package admin

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/osmrouter/server/internal/audit"
	"github.com/osmrouter/server/internal/models"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
	"gorm.io/gorm"
)

var ErrUserNotFound = httpx.New(http.StatusNotFound, "USER_NOT_FOUND", "user not found")

type Service struct {
	db             *gorm.DB
	jwt            *cr.JWTIssuer
	auditw         *audit.Writer
	impersonateTTL time.Duration
}

func NewService(db *gorm.DB, jwt *cr.JWTIssuer, auditw *audit.Writer, impersonateTTL time.Duration) *Service {
	return &Service{db: db, jwt: jwt, auditw: auditw, impersonateTTL: impersonateTTL}
}

type NetworkStats struct {
	ActiveTunnels    int     `json:"active_tunnels"`
	OnlineDevices    int64   `json:"online_devices"`
	DomainsVerified  int64   `json:"domains_verified"`
	GlobalThroughput float64 `json:"global_throughput_gbps"` // mock
	EdgeNodes        int     `json:"edge_nodes"`
	MedianLatencyMs  int     `json:"median_latency_ms"`
}

// Network returns mocked-but-grounded telemetry. Real numbers come from proxy-node ingest later.
func (s *Service) Network(ctx context.Context) (NetworkStats, error) {
	var st NetworkStats
	var activeTunnels int64
	if err := s.db.WithContext(ctx).Model(&models.Tunnel{}).
		Where("ended_at IS NULL").
		Count(&activeTunnels).Error; err != nil {
		return st, err
	}
	st.ActiveTunnels = int(activeTunnels)
	if err := s.db.WithContext(ctx).Model(&models.Device{}).
		Where("is_online = ? AND revoked_at IS NULL", true).
		Count(&st.OnlineDevices).Error; err != nil {
		return st, err
	}
	if err := s.db.WithContext(ctx).Model(&models.Domain{}).
		Where("dns_status = ?", models.DNSStatusVerified).
		Count(&st.DomainsVerified).Error; err != nil {
		return st, err
	}
	// These are deliberately mocked — proxy-node ingest is out of scope for v1 control plane.
	st.GlobalThroughput = 0.0 // no data yet
	st.EdgeNodes = 14
	st.MedianLatencyMs = 42
	return st, nil
}

type UserRow struct {
	ID            string    `json:"id"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	Role          string    `json:"role"`
	PlanID        uint      `json:"plan_id"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
	Devices       int64     `json:"devices"`
	Domains       int64     `json:"domains"`
}

func (s *Service) Users(ctx context.Context, q string, limit int) ([]UserRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := s.db.WithContext(ctx).Model(&models.User{})
	if q != "" {
		query = query.Where("email LIKE ? OR name LIKE ?", "%"+q+"%", "%"+q+"%")
	}
	var users []models.User
	if err := query.Order("created_at DESC").Limit(limit).Find(&users).Error; err != nil {
		return nil, err
	}
	rows := make([]UserRow, 0, len(users))
	for _, u := range users {
		var nd, nDom int64
		s.db.WithContext(ctx).Model(&models.Device{}).Where("user_id = ? AND revoked_at IS NULL", u.ID).Count(&nd)
		s.db.WithContext(ctx).Model(&models.Domain{}).Where("user_id = ?", u.ID).Count(&nDom)
		rows = append(rows, UserRow{
			ID: u.ID, Email: u.Email, Name: u.Name, Role: string(u.Role), PlanID: u.PlanID,
			EmailVerified: u.EmailVerifiedAt != nil, CreatedAt: u.CreatedAt,
			Devices: nd, Domains: nDom,
		})
	}
	return rows, nil
}

type UserDossier struct {
	User    UserRow           `json:"user"`
	Devices []models.Device   `json:"devices"`
	Domains []models.Domain   `json:"domains"`
	Recent  []models.AuditLog `json:"recent_audit"`
}

func (s *Service) Dossier(ctx context.Context, userID string) (*UserDossier, error) {
	var u models.User
	if err := s.db.WithContext(ctx).Where("id = ?", userID).First(&u).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	var devices []models.Device
	s.db.WithContext(ctx).Where("user_id = ?", u.ID).Order("created_at DESC").Find(&devices)
	var domains []models.Domain
	s.db.WithContext(ctx).Where("user_id = ?", u.ID).Order("created_at DESC").Find(&domains)
	var recent []models.AuditLog
	s.db.WithContext(ctx).Where("actor_user_id = ? OR target_user_id = ?", u.ID, u.ID).Order("created_at DESC").Limit(30).Find(&recent)
	var nd, nDom int64
	s.db.WithContext(ctx).Model(&models.Device{}).Where("user_id = ? AND revoked_at IS NULL", u.ID).Count(&nd)
	s.db.WithContext(ctx).Model(&models.Domain{}).Where("user_id = ?", u.ID).Count(&nDom)
	return &UserDossier{
		User: UserRow{
			ID: u.ID, Email: u.Email, Name: u.Name, Role: string(u.Role), PlanID: u.PlanID,
			EmailVerified: u.EmailVerifiedAt != nil, CreatedAt: u.CreatedAt,
			Devices: nd, Domains: nDom,
		},
		Devices: devices, Domains: domains, Recent: recent,
	}, nil
}

// Impersonate issues a short-lived JWT scoped to the target user, with `impersonated_by` claim.
func (s *Service) Impersonate(ctx context.Context, adminID, targetUserID, ip, ua string) (string, error) {
	var target models.User
	if err := s.db.WithContext(ctx).Where("id = ?", targetUserID).First(&target).Error; err != nil {
		return "", ErrUserNotFound
	}
	tok, err := s.jwt.Sign(cr.Claims{
		UserID:         target.ID,
		Role:           string(target.Role),
		ImpersonatedBy: adminID,
	}, s.impersonateTTL)
	if err != nil {
		return "", err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID:  adminID,
		TargetUserID: target.ID,
		Action:       models.AuditAdminImpersonate,
		TargetKind:   "user",
		TargetID:     target.ID,
		IP:           ip, UserAgent: ua,
	})
	return tok, nil
}

func (s *Service) Audit(ctx context.Context, limit int) ([]models.AuditLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var rows []models.AuditLog
	err := s.db.WithContext(ctx).Order("created_at DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

// PlanUpdate is the JSON body for PATCH /admin/plans/:id. Every field is
// a pointer so the handler can distinguish "not provided" from "set to zero".
type PlanUpdate struct {
	Name          *string `json:"name,omitempty"`
	Description   *string `json:"description,omitempty"`
	PriceCents    *int    `json:"price_cents,omitempty"`
	Currency      *string `json:"currency,omitempty"`
	MaxDomains    *int    `json:"max_domains,omitempty"`
	MaxSubdomains *int    `json:"max_subdomains,omitempty"`
	MaxDevices    *int    `json:"max_devices,omitempty"`
	BandwidthGB   *int    `json:"bandwidth_gb,omitempty"`
	Status        *string `json:"status,omitempty"`
}

// Plans lists every subscription tier the admin can edit, ordered by id
// so the legacy "free" plan stays at the top.
func (s *Service) Plans(ctx context.Context) ([]models.Plan, error) {
	var plans []models.Plan
	if err := s.db.WithContext(ctx).Order("id ASC").Find(&plans).Error; err != nil {
		return nil, err
	}
	return plans, nil
}

// UpdatePlan applies partial edits to a single plan. Validates basic
// constraints (non-negative limits, allowed status values) before writing.
func (s *Service) UpdatePlan(ctx context.Context, id uint, u PlanUpdate, actorID, ip, ua string) (*models.Plan, error) {
	var plan models.Plan
	if err := s.db.WithContext(ctx).First(&plan, id).Error; err != nil {
		return nil, err
	}
	updates := map[string]any{}
	if u.Name != nil {
		updates["name"] = strings.TrimSpace(*u.Name)
	}
	if u.Description != nil {
		updates["description"] = strings.TrimSpace(*u.Description)
	}
	if u.PriceCents != nil {
		if *u.PriceCents < 0 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"price_cents must be >= 0")
		}
		updates["price_cents"] = *u.PriceCents
	}
	if u.Currency != nil {
		c := strings.ToUpper(strings.TrimSpace(*u.Currency))
		if len(c) != 3 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"currency must be a 3-letter ISO code")
		}
		updates["currency"] = c
	}
	if u.MaxDomains != nil {
		if *u.MaxDomains < 0 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"max_domains must be >= 0")
		}
		updates["max_domains"] = *u.MaxDomains
	}
	if u.MaxSubdomains != nil {
		if *u.MaxSubdomains < 0 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"max_subdomains must be >= 0")
		}
		updates["max_subdomains"] = *u.MaxSubdomains
	}
	if u.MaxDevices != nil {
		if *u.MaxDevices < 0 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"max_devices must be >= 0")
		}
		updates["max_devices"] = *u.MaxDevices
	}
	if u.BandwidthGB != nil {
		if *u.BandwidthGB < 0 {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"bandwidth_gb must be >= 0")
		}
		updates["bandwidth_gb"] = *u.BandwidthGB
	}
	if u.Status != nil {
		st := strings.ToLower(strings.TrimSpace(*u.Status))
		if st != "active" && st != "coming_soon" && st != "archived" {
			return nil, httpx.New(http.StatusBadRequest, httpx.CodeBadRequest,"status must be one of: active, coming_soon, archived")
		}
		updates["status"] = st
	}
	if len(updates) == 0 {
		return &plan, nil
	}
	if err := s.db.WithContext(ctx).Model(&plan).Updates(updates).Error; err != nil {
		return nil, err
	}
	// Audit trail — admin changes are high-signal events.
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: actorID,
		Action:      models.AuditAdminPlanUpdated,
		TargetKind:  "plan",
		TargetID:    plan.Slug,
		IP:          ip, UserAgent: ua,
		Metadata:    updates,
	})
	// Re-fetch to return the canonical post-update row.
	_ = s.db.WithContext(ctx).First(&plan, id).Error
	return &plan, nil
}

