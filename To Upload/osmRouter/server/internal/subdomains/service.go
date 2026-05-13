package subdomains

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
	"github.com/osmrouter/server/internal/platform/httpx"
	"github.com/osmrouter/server/internal/platform/redis"
	"github.com/osmrouter/server/internal/platform/ws"
	"gorm.io/gorm"
)

var (
	ErrSubdomainNotFound = httpx.New(http.StatusNotFound, "SUBDOMAIN_NOT_FOUND", "subdomain not found")
	ErrDomainNotVerified = httpx.New(http.StatusBadRequest, "DOMAIN_NOT_VERIFIED", "parent domain is not verified yet")
	ErrInvalidPrefix     = httpx.New(http.StatusBadRequest, "INVALID_PREFIX", "prefix must be 1–63 chars of [a-z0-9-]")
	ErrInvalidPort       = httpx.New(http.StatusBadRequest, "INVALID_PORT", "target_port must be 1..65535")
	ErrDeviceOffline     = httpx.New(http.StatusBadRequest, "DEVICE_OFFLINE", "selected device is offline")
	ErrDeviceNotOwned    = httpx.New(http.StatusForbidden, "DEVICE_NOT_OWNED", "device does not belong to you")
)

var prefixRE = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

type Service struct {
	db     *gorm.DB
	rdb    *redis.Client
	hub    *ws.Hub
	auditw *audit.Writer
}

func NewService(db *gorm.DB, rdb *redis.Client, hub *ws.Hub, auditw *audit.Writer) *Service {
	return &Service{db: db, rdb: rdb, hub: hub, auditw: auditw}
}

type CreateInput struct {
	ParentDomainID string
	Prefix         string
	TargetPort     int
}

func (s *Service) Create(ctx context.Context, userID string, in CreateInput, ip, ua string) (*models.Subdomain, error) {
	prefix := strings.ToLower(strings.TrimSpace(in.Prefix))
	if prefix != "" && !prefixRE.MatchString(prefix) {
		return nil, ErrInvalidPrefix
	}
	if in.TargetPort < 1 || in.TargetPort > 65535 {
		return nil, ErrInvalidPort
	}
	var domain models.Domain
	if err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ?", in.ParentDomainID, userID).
		First(&domain).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, httpx.ErrNotFound
		}
		return nil, err
	}
	if domain.DNSStatus != models.DNSStatusVerified {
		return nil, ErrDomainNotVerified
	}
	sd := models.Subdomain{
		ID:             uuid.NewString(),
		ParentDomainID: domain.ID,
		Prefix:         prefix,
		TargetPort:     in.TargetPort,
	}
	if err := s.db.WithContext(ctx).Create(&sd).Error; err != nil {
		return nil, err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditSubdomainCreated,
		TargetKind:  "subdomain",
		TargetID:    sd.ID,
		Metadata:    map[string]any{"prefix": prefix, "port": in.TargetPort, "domain": domain.FQDN},
		IP:          ip, UserAgent: ua,
	})
	return &sd, nil
}

func (s *Service) List(ctx context.Context, userID, domainID string) ([]models.Subdomain, error) {
	var domain models.Domain
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", domainID, userID).First(&domain).Error; err != nil {
		return nil, httpx.ErrNotFound
	}
	var out []models.Subdomain
	err := s.db.WithContext(ctx).Where("parent_domain_id = ?", domain.ID).Order("created_at ASC").Find(&out).Error
	return out, err
}

func (s *Service) Delete(ctx context.Context, userID, id, ip, ua string) error {
	sd, domain, err := s.getOwned(ctx, userID, id)
	if err != nil {
		return err
	}
	if sd.BoundDeviceID != nil {
		// Best-effort Redis cleanup.
		if s.rdb != nil && s.rdb.Available() {
			_ = s.rdb.Del(ctx, liveMapKey(domain.FQDN, sd.Prefix))
		}
	}
	if err := s.db.WithContext(ctx).Delete(sd).Error; err != nil {
		return err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditSubdomainDeleted,
		TargetKind:  "subdomain",
		TargetID:    sd.ID,
		IP:          ip, UserAgent: ua,
	})
	return nil
}

// Bind links a subdomain to a device. Transactional: write DB then Redis; rollback on Redis fail.
func (s *Service) Bind(ctx context.Context, userID, subdomainID, deviceID, ip, ua string) error {
	sd, domain, err := s.getOwned(ctx, userID, subdomainID)
	if err != nil {
		return err
	}
	var device models.Device
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ? AND revoked_at IS NULL", deviceID, userID).First(&device).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrDeviceNotOwned
		}
		return err
	}
	if device.LastSeenAt == nil || time.Since(*device.LastSeenAt) > 5*time.Minute {
		return ErrDeviceOffline
	}

	now := time.Now()
	// Tx: write Postgres, then Redis. If Redis fails, undo Postgres.
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&models.Subdomain{}).
			Where("id = ?", sd.ID).
			Updates(map[string]any{"bound_device_id": &device.ID, "bound_at": &now})
		if res.Error != nil {
			return res.Error
		}
		if s.rdb != nil && s.rdb.Available() {
			val := device.ID
			if err := s.rdb.Set(ctx, liveMapKey(domain.FQDN, sd.Prefix), val, 0); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	if s.hub != nil {
		s.hub.PublishTo(userID, ws.Event{
			Type: "subdomain.bound",
			Data: map[string]any{
				"subdomain_id": sd.ID,
				"device_id":    device.ID,
				"host":         hostnameOf(domain.FQDN, sd.Prefix),
			},
		})
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditSubdomainBound,
		TargetKind:  "subdomain",
		TargetID:    sd.ID,
		Metadata:    map[string]any{"device_id": device.ID, "host": hostnameOf(domain.FQDN, sd.Prefix)},
		IP:          ip, UserAgent: ua,
	})
	return nil
}

// Unbind clears the device binding + Redis + emits kill-tunnel event.
func (s *Service) Unbind(ctx context.Context, userID, subdomainID, ip, ua string) error {
	sd, domain, err := s.getOwned(ctx, userID, subdomainID)
	if err != nil {
		return err
	}
	prevDevice := ""
	if sd.BoundDeviceID != nil {
		prevDevice = *sd.BoundDeviceID
	}
	if err := s.db.WithContext(ctx).Model(sd).Updates(map[string]any{
		"bound_device_id": nil, "bound_at": nil,
	}).Error; err != nil {
		return err
	}
	if s.rdb != nil && s.rdb.Available() {
		_ = s.rdb.Del(ctx, liveMapKey(domain.FQDN, sd.Prefix))
	}
	if s.hub != nil {
		s.hub.PublishTo(userID, ws.Event{
			Type: "subdomain.unbound",
			Data: map[string]any{
				"subdomain_id":     sd.ID,
				"host":             hostnameOf(domain.FQDN, sd.Prefix),
				"previous_device":  prevDevice,
			},
		})
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditSubdomainUnbound,
		TargetKind:  "subdomain",
		TargetID:    sd.ID,
		Metadata:    map[string]any{"host": hostnameOf(domain.FQDN, sd.Prefix)},
		IP:          ip, UserAgent: ua,
	})
	return nil
}

// --- internals ---

// getOwned returns (subdomain, parent domain) iff both belong to userID.
func (s *Service) getOwned(ctx context.Context, userID, id string) (*models.Subdomain, *models.Domain, error) {
	var sd models.Subdomain
	if err := s.db.WithContext(ctx).Where("id = ?", id).First(&sd).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, ErrSubdomainNotFound
		}
		return nil, nil, err
	}
	var domain models.Domain
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", sd.ParentDomainID, userID).First(&domain).Error; err != nil {
		// Parent owned by someone else == treat as not found (do not leak existence).
		return nil, nil, ErrSubdomainNotFound
	}
	return &sd, &domain, nil
}

func liveMapKey(fqdn, prefix string) string {
	if prefix == "" {
		return "live:" + fqdn
	}
	return "live:" + prefix + "." + fqdn
}

func hostnameOf(fqdn, prefix string) string {
	if prefix == "" {
		return fqdn
	}
	return prefix + "." + fqdn
}
