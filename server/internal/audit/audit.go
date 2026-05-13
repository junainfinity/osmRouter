package audit

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/osmrouter/server/internal/models"
	"gorm.io/gorm"
)

// Writer is an append-only logger for security/forensics-relevant events.
type Writer struct {
	db     *gorm.DB
	logger *slog.Logger
}

func New(db *gorm.DB, logger *slog.Logger) *Writer {
	return &Writer{db: db, logger: logger}
}

type Event struct {
	ActorUserID  string
	TargetUserID string
	Action       models.AuditAction
	TargetKind   string
	TargetID     string
	Metadata     map[string]any
	IP           string
	UserAgent    string
	RequestID    string
}

func (w *Writer) Write(ctx context.Context, e Event) {
	var metaJSON string
	if len(e.Metadata) > 0 {
		b, err := json.Marshal(e.Metadata)
		if err == nil {
			metaJSON = string(b)
		}
	}
	row := models.AuditLog{
		ActorUserID: e.ActorUserID,
		Action:      e.Action,
		TargetKind:  e.TargetKind,
		TargetID:    e.TargetID,
		Metadata:    metaJSON,
		IP:          e.IP,
		UserAgent:   e.UserAgent,
		RequestID:   e.RequestID,
	}
	if e.TargetUserID != "" {
		row.TargetUserID = &e.TargetUserID
	}
	if err := w.db.WithContext(ctx).Create(&row).Error; err != nil {
		// Audit write failure is significant but must never block the user-visible operation.
		w.logger.Error("audit write failed",
			"action", e.Action,
			"actor", e.ActorUserID,
			"target_kind", e.TargetKind,
			"err", err,
		)
	}
}
