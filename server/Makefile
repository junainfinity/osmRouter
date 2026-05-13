.PHONY: run test test-race test-cover lint tidy build clean dev-deps

GO ?= go
PKG := ./...

run:
	$(GO) run ./cmd/api

build:
	$(GO) build -o bin/api ./cmd/api

test:
	$(GO) test $(PKG)

test-race:
	$(GO) test -race -count=1 $(PKG)

test-cover:
	$(GO) test -coverprofile=coverage.out $(PKG)
	$(GO) tool cover -func=coverage.out | tail -20

lint:
	$(GO) vet $(PKG)

tidy:
	$(GO) mod tidy

clean:
	rm -rf bin coverage.out
