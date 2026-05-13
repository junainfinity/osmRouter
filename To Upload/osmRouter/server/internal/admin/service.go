package admin

import (
	"context"
	"errors"
	"net/http"
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

