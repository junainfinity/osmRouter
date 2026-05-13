// Command dev-redis runs an in-process miniredis instance for local
// development and end-to-end demos. Listens on OSM_DEV_REDIS_ADDR
// (default :6379). NOT for production — production uses real Redis.
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/alicebob/miniredis/v2"
)

func main() {
	addr := flag.String("addr", ":6379", "listen address (host:port)")
	flag.Parse()

	m := miniredis.NewMiniRedis()
	if err := m.StartAddr(*addr); err != nil {
		log.Fatalf("dev-redis: %v", err)
	}
	defer m.Close()
	fmt.Printf("dev-redis listening on %s (in-process, NOT for production)\n", *addr)

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	fmt.Println("dev-redis shutting down")
}
