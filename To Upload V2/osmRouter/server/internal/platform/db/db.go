package db

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/osmrouter/server/internal/config"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Open returns a configured gorm.DB. Supports sqlite:// and postgres:// URLs.
func Open(cfg *config.Config) (*gorm.DB, error) {
	gcfg := &gorm.Config{
		Logger: logger.New(
			log.New(os.Stdout, "", log.LstdFlags),
			logger.Config{
				SlowThreshold:             1 * time.Second,
				LogLevel:                  logger.Warn,
				IgnoreRecordNotFoundError: true,
				ParameterizedQueries:      true,
				Colorful:                  false,
			},
		),
		DisableForeignKeyConstraintWhenMigrating: false,
	}
	switch {
	case strings.HasPrefix(cfg.DatabaseURL, "sqlite://"):
		path := strings.TrimPrefix(cfg.DatabaseURL, "sqlite://")
		return gorm.Open(sqlite.Open(path), gcfg)
	case strings.HasPrefix(cfg.DatabaseURL, "postgres://"), strings.HasPrefix(cfg.DatabaseURL, "postgresql://"):
		return gorm.Open(postgres.Open(cfg.DatabaseURL), gcfg)
	default:
		return nil, fmt.Errorf("unsupported db url: %s", cfg.DatabaseURL)
	}
}

// OpenInMemory returns an in-memory SQLite DB for tests.
// Each call returns an ISOLATED database so parallel tests don't share state.
func OpenInMemory() (*gorm.DB, error) {
	dsn := fmt.Sprintf("file:test-%d?mode=memory&cache=shared", time.Now().UnixNano())
	return gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
}
