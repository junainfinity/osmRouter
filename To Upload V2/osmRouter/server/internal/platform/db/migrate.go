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

// SeedPlans inserts the three default plans (Free + 2 "coming soon" paid)
// on first migration, then idempotently refreshes legacy rows in place so
// existing deployments pick up the new field defaults without losing any
// admin overrides made via the dashboard.
func SeedPlans(db *gorm.DB) error {
	defaults := []models.Plan{
		{
			Slug: "free", Name: "Free",
			Description:   "Everything you need to get started.",
			PriceCents:    0, Currency: "INR",
			MaxDomains:    10, MaxSubdomains: 10, MaxDevices: 5,
			BandwidthGB:   1024,
			Status:        "active",
		},
		{
			Slug: "pro", Name: "Pro",
			Description:   "Coming soon — higher limits + priority routing.",
			PriceCents:    0, Currency: "INR",
			MaxDomains:    100, MaxSubdomains: 100, MaxDevices: 25,
			BandwidthGB:   10240,
			Status:        "coming_soon",
		},
		{
			Slug: "business", Name: "Business",
			Description:   "Coming soon — team seats + custom SLA.",
			PriceCents:    0, Currency: "INR",
			MaxDomains:    1000, MaxSubdomains: 1000, MaxDevices: 100,
			BandwidthGB:   102400,
			Status:        "coming_soon",
		},
	}
	for _, p := range defaults {
		var existing models.Plan
		err := db.Where("slug = ?", p.Slug).First(&existing).Error
		if err != nil {
			// Not found — create.
			if err := db.Create(&p).Error; err != nil {
				return err
			}
			continue
		}
		// Already exists. Only patch fields that are obviously stale
		// from the v0.1 schema (no Name, no Currency, no MaxSubdomains).
		// Anything an admin has already customised stays.
		patch := map[string]any{}
		if existing.Name == "" {
			patch["name"] = p.Name
		}
		if existing.Description == "" {
			patch["description"] = p.Description
		}
		if existing.Currency == "" {
			patch["currency"] = p.Currency
		}
		if existing.MaxSubdomains == 0 {
			patch["max_subdomains"] = p.MaxSubdomains
		}
		if existing.Status == "" {
			patch["status"] = p.Status
		}
		if len(patch) > 0 {
			if err := db.Model(&existing).Updates(patch).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
