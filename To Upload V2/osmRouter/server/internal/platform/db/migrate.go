package db

import (
	"github.com/osmrouter/server/internal/models"
	"gorm.io/gorm"
)

// AutoMigrate creates and updates the schema for all entity models.
// In production this becomes a controlled SQL migration; for dev/test this is fine.
//
// DedupSubdomains MUST run first — the Subdomain model added a unique index
// on (parent_domain_id, prefix) in May 2026, and AutoMigrate's CREATE
// UNIQUE INDEX call will fail on any database that has pre-existing
// duplicates from before the UPSERT fix in subdomains.Service.Create.
func AutoMigrate(db *gorm.DB) error {
	if err := DedupSubdomains(db); err != nil {
		return err
	}
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

// DedupSubdomains collapses any duplicate rows that share (parent_domain_id,
// prefix). The kept row is the one that's currently bound (BoundDeviceID
// not null) — and if multiple are bound, the most recently created. All
// other rows for the same (parent, prefix) pair are deleted.
//
// Idempotent: a database without duplicates is a no-op. Skips silently if
// the subdomains table doesn't exist yet (first-boot of a brand-new DB).
// Postgres-only — production uses Postgres; sqlite dev/test sees no rows.
func DedupSubdomains(db *gorm.DB) error {
	if !db.Migrator().HasTable("subdomains") {
		return nil
	}
	const sql = `
		DELETE FROM subdomains
		WHERE id NOT IN (
			SELECT DISTINCT ON (parent_domain_id, prefix) id
			FROM subdomains
			ORDER BY parent_domain_id, prefix,
			         (bound_device_id IS NULL) ASC,
			         created_at DESC
		);`
	return db.Exec(sql).Error
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
