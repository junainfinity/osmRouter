package devices

import (
	"context"
	"errors"
	"net/http"
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
	ErrDeviceNotFound = httpx.New(http.StatusNotFound, "DEVICE_NOT_FOUND", "device not found")
	ErrDeviceExists   = httpx.New(http.StatusConflict, "DEVICE_EXISTS", "this hardware already registered to your account")
	ErrPlanLimit      = httpx.New(http.StatusForbidden, "PLAN_LIMIT", "plan limit reached for devices")
)

const OfflineAfter = 90 * time.Second

type Service struct {
	db     *gorm.DB
	auditw *audit.Writer
}

func NewService(db *gorm.DB, auditw *audit.Writer) *Service {
	return &Service{db: db, auditw: auditw}
}

// Create registers a device for a user and returns (device, plaintext-api-key).
// The plaintext key is shown to the user exactly once.
func (s *Service) Create(ctx context.Context, userID, name, osType, hardwareUUID, ip, ua string) (*models.Device, string, error) {
	if err := s.enforcePlanLimit(ctx, userID); err != nil {
		return nil, "", err
	}
	if hardwareUUID != "" {
		var existing models.Device
		err := s.db.WithContext(ctx).
			Where("user_id = ? AND hardware_uuid = ?", userID, hardwareUUID).
			First(&existing).Error
		if err == nil {
			return nil, "", ErrDeviceExists
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", err
		}
	}
	apiKey, err := cr.RandomURLToken(32)
	if err != nil {
		return nil, "", err
	}
	d := models.Device{
		ID:           uuid.NewString(),
		UserID:       userID,
		HardwareUUID: hardwareUUID,
		Name:         strings.TrimSpace(name),
		OSType:       strings.ToLower(osType),
		APIKeyHash:   cr.SHA256Hex(apiKey),
	}
	if err := s.db.WithContext(ctx).Create(&d).Error; err != nil {
		return nil, "", err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditDeviceCreated,
		TargetKind:  "device",
		TargetID:    d.ID,
		Metadata:    map[string]any{"os": d.OSType, "name": d.Name},
		IP:          ip, UserAgent: ua,
	})
	return &d, apiKey, nil
}

func (s *Service) List(ctx context.Context, userID string) ([]models.Device, error) {
	var out []models.Device
	err := s.db.WithContext(ctx).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Order("created_at DESC").
		Find(&out).Error
	for i := range out {
		out[i].IsOnline = out[i].LastSeenAt != nil && time.Since(*out[i].LastSeenAt) < OfflineAfter
	}
	return out, err
}

func (s *Service) Get(ctx context.Context, userID, id string) (*models.Device, error) {
	var d models.Device
	err := s.db.WithContext(ctx).
		Where("id = ? AND user_id = ? AND revoked_at IS NULL", id, userID).
		First(&d).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	d.IsOnline = d.LastSeenAt != nil && time.Since(*d.LastSeenAt) < OfflineAfter
	return &d, nil
}

// FindByAPIKey is used by the heartbeat handler — Bearer auth path.
func (s *Service) FindByAPIKey(ctx context.Context, apiKey string) (*models.Device, error) {
	if apiKey == "" {
		return nil, ErrDeviceNotFound
	}
	var d models.Device
	err := s.db.WithContext(ctx).
		Where("api_key_hash = ? AND revoked_at IS NULL", cr.SHA256Hex(apiKey)).
		First(&d).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDeviceNotFound
		}
		return nil, err
	}
	return &d, nil
}

// Heartbeat marks a device online and bumps last_seen_at.
func (s *Service) Heartbeat(ctx context.Context, deviceID, ip string) error {
	now := time.Now()
	return s.db.WithContext(ctx).Model(&models.Device{}).
		Where("id = ?", deviceID).
		Updates(map[string]any{
			"last_seen_at": &now,
			"last_seen_ip": ip,
			"is_online":    true,
		}).Error
}

// Revoke disables a device + nukes its bindings.
func (s *Service) Revoke(ctx context.Context, userID, id, ip, ua string) error {
	d, err := s.Get(ctx, userID, id)
	if err != nil {
		return err
	}
	now := time.Now()
	if err := s.db.WithContext(ctx).Model(d).Updates(map[string]any{
		"revoked_at": &now,
		"is_online":  false,
	}).Error; err != nil {
		return err
	}
	// Unbind any subdomains pointing at it (caller is expected to also clear Redis).
	if err := s.db.WithContext(ctx).Model(&models.Subdomain{}).
		Where("bound_device_id = ?", d.ID).
		Updates(map[string]any{"bound_device_id": nil, "bound_at": nil}).Error; err != nil {
		return err
	}
	s.auditw.Write(ctx, audit.Event{
		ActorUserID: userID,
		Action:      models.AuditDeviceRevoked,
		TargetKind:  "device",
		TargetID:    d.ID,
		IP:          ip, UserAgent: ua,
	})
	return nil
}

// SweepOffline periodically marks devices whose last_seen_at is older than OfflineAfter as offline.
// (Online status is computed on read too; this keeps the DB column honest for queries.)
func (s *Service) SweepOffline(ctx context.Context) error {
	cutoff := time.Now().Add(-OfflineAfter)
	return s.db.WithContext(ctx).Model(&models.Device{}).
		Where("is_online = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", true, cutoff).
		Update("is_online", false).Error
}

func (s *Service) enforcePlanLimit(ctx context.Context, userID string) error {
	var user models.User
	if err := s.db.WithContext(ctx).Where("id = ?", userID).First(&user).Error; err != nil {
		return err
	}
	var plan models.Plan
	if err := s.db.WithContext(ctx).Where("id = ?", user.PlanID).First(&plan).Error; err != nil {
		return nil
	}
	var count int64
	if err := s.db.WithContext(ctx).Model(&models.Device{}).
		Where("user_id = ? AND revoked_at IS NULL", userID).
		Count(&count).Error; err != nil {
		return err
	}
	if int(count) >= plan.MaxDevices {
		return ErrPlanLimit
	}
	return nil
}
