package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/osmrouter/server/internal/config"
	"github.com/osmrouter/server/internal/platform/db"
	"github.com/osmrouter/server/internal/platform/redis"
	"github.com/osmrouter/server/internal/server"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level:     slog.LevelInfo,
		AddSource: false,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		logger.Error("config load failed", "err", err)
		os.Exit(1)
	}

	database, err := db.Open(cfg)
	if err != nil {
		logger.Error("db open failed", "err", err)
		os.Exit(1)
	}
	if err := db.AutoMigrate(database); err != nil {
		logger.Error("db migrate failed", "err", err)
		os.Exit(1)
	}

	rdb, err := redis.Open(cfg)
	if err != nil {
		logger.Warn("redis open failed — continuing without redis", "err", err)
	}

	app, err := server.New(server.Deps{
		Config: cfg,
		DB:     database,
		Redis:  rdb,
		Logger: logger,
	})
	if err != nil {
		logger.Error("server build failed", "err", err)
		os.Exit(1)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           app.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go app.StartBackgroundWorkers(context.Background())

	go func() {
		logger.Info("http server listening", "addr", cfg.HTTPAddr, "env", cfg.Env)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("listen failed", "err", err)
			os.Exit(1)
		}
	}()

	sigint := make(chan os.Signal, 1)
	signal.Notify(sigint, os.Interrupt, syscall.SIGTERM)
	<-sigint
	logger.Info("shutdown signal received, draining…")

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("http server shutdown error", "err", err)
	}
	app.Close()
	logger.Info("all active connections closed gracefully. system offline.")
}
