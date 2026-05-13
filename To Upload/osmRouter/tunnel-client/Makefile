.PHONY: run test test-race build clean tidy

GO ?= go
PKG := ./...

build:
	$(GO) build -o bin/osmrouter-client ./cmd/osmrouter-client

test:
	$(GO) test $(PKG)

test-race:
	$(GO) test -race -count=1 $(PKG)

tidy:
	$(GO) mod tidy

clean:
	rm -rf bin
