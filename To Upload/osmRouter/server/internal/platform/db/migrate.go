package db

import (
	"github.com/osmrouter/server/internal/models"
	"gorm.io/gorm"
)

// AutoMigrate creates and updates the schema for all entity models.
// In production this becomes a controlled SQL migration; for dev/test this is fine.
func AutoMigrate(db *gorm.DB) error {
	return db.AutoMigrate(
		&models.Plan{},
		&models.User{},
		&models.RefreshToken{},
		&models.EmailOTP{},
		&models.Device{},
		&models.DeviceCode{},
		&models.Domain{},
		&models.Subdomain{},
		&models.Tunnel{},
		&models.AuditLog{},
	)
}

// SeedPlans inserts default Free + Pro plans if not present.
func SeedPlans(db *gorm.DB) error {
	plans := []models.Plan{
		{Slug: "free", PriceCents: 0, MaxDomains: 1, MaxDevices: 1, BandwidthGB: 10},
		{Slug: "pro", PriceCents: 1200, MaxDomains: 9999, MaxDevices: 10, BandwidthGB: 500},
	}
	for _, p := range plans {
		var existing models.Plan
		if err := db.Where("slug = ?", p.Slug).First(&existing).Error; err == nil {
			continue
		}
		if err := db.Create(&p).Error; err != nil {
			return err
		}
	}
	return nil
}
