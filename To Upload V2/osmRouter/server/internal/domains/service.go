package domains

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/osmrouter/server/internal/audit"
	"github.com/osmrouter/server/internal/models"
	cr "github.com/osmrouter/server/internal/platform/crypto"
	"github.com/osmrouter/server/internal/platform/httpx"
	"gorm.io/gorm"
)

var (
	ErrDomainNotFound  = httpx.New(http.StatusNotFound, "DOMAIN_NOT_FOUND", "domain not found")
	ErrDomainExists    = httpx.New(http.StatusConflict, "DOMAIN_EXISTS", "domain is already registered")
	ErrInvalidFQDN     = httpx.New(http.StatusBadRequest, "INVALID_FQDN", "fqdn is not a valid domain name")
	ErrPlanLimit       = httpx.New(http.StatusForbidden, "PLAN_LIMIT", "plan limit reached for domains")
)

// fqdn validation: labels of [a-z0-9-]{1,63}, joined with dots, total <= 253, TLD letters >= 2.
var fqdnLabel = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var fqdnTLD = regexp.MustCompile(`^[a-z]{2,}$`)

func ValidateFQDN(s string) (string, error) {
	s = strings.ToLower(strings.TrimSpace(strings.TrimSuffix(s, ".")))
	if s == "" || len(s) > 253 {
		return "", ErrInvalidFQDN
	}
	labels := strings.Split(s, ".")
	if len(labels) < 2 {
		return "", ErrInvalidFQDN
	}
	for i, l := range labels {
		if i == len(labels)-1 {
			if !fqdnTLD.MatchString(l) {
				return "", ErrInvalidFQDN
			}
			continue
		}
		if !fqdnLabel.MatchString(l) {
			return "", ErrInvalidFQDN
		}
	}
	return s, nil
}

type Service struct {
	db          *gorm.DB
	auditw      *audit.Writer
	cnameTarget string
	tokenSecret []byte
}

func NewService(db *gorm.DB, auditw *audit.Writer, cnameTarget string, tokenSecret []byte) *Service {
	return &Service{db: db, auditw: auditw, cnameTarget: cnameTarget, tokenSecret: tokenSecret}
}

// Create registers a new domain for the user.
func (s *Service) Create(ctx context.Context, userID, fqdn, registrar, ip, ua string) (*models.Domain, error) {
	fqdn, err := ValidateFQDN(fqdn)
	if err != nil {
		return nil, err
	}
	var existing models.Domain
	err = s.db.WithContext(ctx).Where("fqdn = ?", fqdn).First(&existing).Error
	if err == nil {
		return nil, ErrDomainExists
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if err := s.enforcePlanLimit(ctx, userID); err != nil {
		return nil, err
	}
	d := models.Domain{
		ID:          uuid.NewString(),
		UserID:      userID,
		FQDN:        fqdn,
		Registrar:   strings.TrimSpace(registrar),
		DNSStatus:   models.DNSStatusPending,
		CNAMETarget: s.cnameTarget,
		TXTToken:    cr.DomainVerifyToken(s.tokenSecret, userID, fqdn),
	}
	if err := s.db.WithContext(ctx).Create(&d).Error; err != nil {
		return nil, err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditDomainCreated,
		TargetKind:  "domain",
		TargetID:    d.ID,
		Metadata:    map[string]any{"fqdn": fqdn},
		IP:          ip, UserAgent: ua,
	})
	return &d, nil
}

func (s *Service) List(ctx context.Context, userID string) ([]models.Domain, error) {
	var out []models.Domain
	err := s.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Find(&out).Error
	return out, err
}

func (s *Service) Get(ctx context.Context, userID, id string) (*models.Domain, error) {
	var d models.Domain
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", id, userID).
		First(&d).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDomainNotFound
		}
		return nil, err
	}
	return &d, nil
}

func (s *Service) Delete(ctx context.Context, userID, id, ip, ua string) error {
	d, err := s.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	// Cascade subdomains.
	if err := s.db.WithContext(ctx).Where("parent_domain_id = ?", d.ID).
		Delete(&models.Subdomain{}).Error; err != nil {
		return err
	}
	if err := s.db.WithContext(ctx).Delete(d).Error; err != nil {
		return err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditDomainDeleted,
		TargetKind:  "domain",
		TargetID:    d.ID,
		Metadata:    map[string]any{"fqdn": d.FQDN},
		IP:          ip, UserAgent: ua,
	})
	return nil
}

// MarkVerifying sets status to "verifying" for the verifier worker to claim.
func (s *Service) MarkVerifying(ctx context.Context, id string) error {
	now := time.Now()
	return s.db.WithContext(ctx).Model(&models.Domain{}).
		Where("id = ? AND dns_status IN ?", id, []models.DNSStatus{models.DNSStatusPending, models.DNSStatusFailed}).
		Updates(map[string]any{
			"dns_status":                models.DNSStatusVerifying,
			"verification_attempted_at": &now,
			"verification_attempts":     gorm.Expr("verification_attempts + 1"),
		}).Error
}

func (s *Service) MarkVerified(ctx context.Context, id, userID, ip, ua string) error {
	now := time.Now()
	tx := s.db.WithContext(ctx).Model(&models.Domain{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"dns_status":   models.DNSStatusVerified,
			"verified_at":  &now,
		})
	if tx.Error != nil {
		return tx.Error
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditDomainVerified,
		TargetKind:  "domain",
		TargetID:    id,
		IP:          ip, UserAgent: ua,
	})
	return nil
}

func (s *Service) MarkFailed(ctx context.Context, id string) error {
	return s.db.WithContext(ctx).Model(&models.Domain{}).
		Where("id = ?", id).
		Update("dns_status", models.DNSStatusFailed).Error
}

// PendingDomains returns domains needing verification, oldest-attempt first.
func (s *Service) PendingDomains(ctx context.Context, limit int) ([]models.Domain, error) {
	var out []models.Domain
	err := s.db.WithContext(ctx).
		Where("dns_status IN ?", []models.DNSStatus{models.DNSStatusPending, models.DNSStatusFailed}).
		Where("verification_attempts < ?", 30*24). // ~30 days @ 1/hr
		Order("verification_attempted_at ASC NULLS FIRST").
		Limit(limit).
		Find(&out).Error
	return out, err
}

func (s *Service) enforcePlanLimit(ctx context.Context, userID string) error {
	var user models.User
	if err := s.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error; err != nil {
		return err
	}
	var plan models.Plan
	if err := s.db.WithContext(ctx).Where("id = ?", user.PlanID).First(&plan).Error; err != nil {
		// no plan row -> allow; in dev seed may not have run
		return nil
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&models.Domain{}).
		Where("user_id = ?", userID).Count(&count).Error; err != nil {
		return err
	}
	if int(count) >= plan.MaxDomains {
		return ErrPlanLimit
	}
	return nil
}
