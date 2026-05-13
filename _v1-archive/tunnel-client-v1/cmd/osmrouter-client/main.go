// Command osmrouter-client is the desktop tunnel client.
//
// Usage:
//
//	osmrouter-client \
//	    --proxy-url ws://localhost:8001/ws/tunnel \
//	    --api-key   <your-device-api-key> \
//	    --device-id <your-device-id>      \
//	    --local     http://localhost:3000
//
// The client holds a persistent WebSocket to the proxy node. Visitor
// requests hitting `https://your-domain.com` arrive over that tunnel; we
// forward each to `--local` and send the response back. Reconnects on drop.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/osmrouter/tunnel-client/internal/client"
)

func main() {
	var (
		proxyURL = flag.String("proxy-url", "ws://localhost:8001/ws/tunnel", "WebSocket URL of the proxy node")
		apiKey   = flag.String("api-key", "", "device API key (required)")
		deviceID = flag.String("device-id", "", "device ID (required)")
		local    = flag.String("local", "http://localhost:3000", "URL of your local app")
		verbose  = flag.Bool("verbose", false, "verbose logging")
	)
	flag.Parse()
	if *apiKey == "" || *deviceID == "" {
		flag.Usage()
		os.Exit(2)
	}

	level := slog.LevelInfo
	if *verbose {
		level = slog.LevelDebug
	}
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sig
		logger.Info("shutdown requested")
		cancel()
	}()

	logger.Info("osmrouter-client starting", "proxy", *proxyURL, "local", *local, "device_id", *deviceID)
	err := client.Run(ctx, client.Config{
		ProxyURL:    *proxyURL,
		APIKey:      *apiKey,
		DeviceID:    *deviceID,
		LocalTarget: *local,
		Logger:      logger,
	})
	if err != nil && err != context.Canceled {
		logger.Error("client exited", "err", err)
		os.Exit(1)
	}
}
