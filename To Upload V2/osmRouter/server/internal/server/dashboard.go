package server

import (
	"github.com/labstack/echo/v4"
	"github.com/osmrouter/server/internal/auth"
	"github.com/osmrouter/server/internal/devices"
	"github.com/osmrouter/server/internal/models"
	"github.com/osmrouter/server/internal/platform/httpx"
	"gorm.io/gorm"
)

type dashboardSummary struct {
	DomainsTotal       int64 `json:"domains_total"`
	DomainsVerified    int64 `json:"domains_verified"`
	DevicesTotal       int64 `json:"devices_total"`
	DevicesOnline      int64 `json:"devices_online"`
	ActiveTunnels      int64 `json:"active_tunnels"`
	BytesTransferred   int64 `json:"bytes_transferred"`
	RecentDomains      []models.Domain `json:"recent_domains"`
	RecentDevices      []models.Device `json:"recent_devices"`
}

func buildDashboard(db *gorm.DB) echo.HandlerFunc {
	return func(c echo.Context) error {
		uid := auth.CurrentUserID(c)
		ctx := c.Request().Context()
		var s dashboardSummary

		db.WithContext(ctx).Model(&models.Domain{}).Where("user_id = ?", uid).Count(&s.DomainsTotal)
		db.WithContext(ctx).Model(&models.Domain{}).Where("user_id = ? AND dns_status = ?", uid, models.DNSStatusVerified).Count(&s.DomainsVerified)
		db.WithContext(ctx).Model(&models.Device{}).Where("user_id = ? AND revoked_at IS NULL", uid).Count(&s.DevicesTotal)
		db.WithContext(ctx).Model(&models.Device{}).Where("user_id = ? AND revoked_at IS NULL AND is_online = ?", uid, true).Count(&s.DevicesOnline)

		// Active tunnels via subdomains owned by user.
		db.WithContext(ctx).
			Raw(`SELECT COUNT(*) FROM tunnels t
			     JOIN subdomains s ON s.id = t.subdomain_id
			     JOIN domains d ON d.id = s.parent_domain_id
			     WHERE d.user_id = ? AND t.ended_at IS NULL`, uid).
			Scan(&s.ActiveTunnels)

		// Bytes transferred all-time for this user.
		db.WithContext(ctx).
			Raw(`SELECT COALESCE(SUM(t.bytes_transferred), 0) FROM tunnels t
			     JOIN subdomains s ON s.id = t.subdomain_id
			     JOIN domains d ON d.id = s.parent_domain_id
			     WHERE d.user_id = ?`, uid).
			Scan(&s.BytesTransferred)

		db.WithContext(ctx).Where("user_id = ?", uid).Order("created_at DESC").Limit(5).Find(&s.RecentDomains)
		db.WithContext(ctx).Where("user_id = ? AND revoked_at IS NULL", uid).Order("created_at DESC").Limit(5).Find(&s.RecentDevices)
		for i := range s.RecentDevices {
			d := s.RecentDevices[i]
			if d.LastSeenAt != nil && d.LastSeenAt.Add(devices.OfflineAfter).After(d.LastSeenAt.Add(0)) {
				// computed; leave as-is (recompute is in handlers if needed)
			}
		}
		return httpx.WriteOK(c, s)
	}
}
