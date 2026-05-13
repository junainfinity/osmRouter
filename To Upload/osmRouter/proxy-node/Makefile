.PHONY: run test test-race build clean tidy

GO ?= go
PKG := ./...

run:
	$(GO) run ./cmd/proxy

build:
	$(GO) build -o bin/proxy ./cmd/proxy

test:
	$(GO) test $(PKG)

test-race:
	$(GO) test -race -count=1 $(PKG)

tidy:
	$(GO) mod tidy

clean:
	rm -rf bin
