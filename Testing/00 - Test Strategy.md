# 00 — Test Strategy

## Layers

| Layer | Tool | Where | When |
|---|---|---|---|
| Backend unit | Go `testing` + `testify` | `server/internal/**/*_test.go` | With each module |
| Backend integration | Go `testing` + `httptest` + SQLite (in-memory) | `server/internal/server/integration_test.go` | After M2 |
| Backend security | Go `testing` against the same harness | `server/internal/server/security_test.go` | After M2 |
| Backend race | `go test -race` | All packages | CI gate |
| Frontend unit / component | Vitest + Testing Library | `web/tests/**/*.test.tsx` | After component build |
| Frontend E2E | Playwright (optional) | `web/tests/e2e/**` | After M4 |
| **End-to-end (localhost)** | Bash + curl + miniredis | `scripts/smoke_data_plane.sh` | Phase 2 onwards |
| **End-to-end (cross-boundary)** | Bash + curl + Docker | `scripts/docker_remote_laptop_demo.sh` | Phase 2 onwards |
| **Live multi-process demo** | Docker compose + Mac host | `scripts/demo_live.sh` (+ puppeteer screenshots) | Phase 3 onwards |

## Achieved (Phases 1–4)

- **72 Go tests passing under `go test -race -count=1`** — 51 in the Control Plane (auth, crypto, CSRF, rate limit, integration, security, proxy-ingest) + 21 in the Data Plane (wire protocol, hub concurrency, router, forwarder).
- **10 frontend Vitest tests** — Button, Badge, StatusDot, api wrapper.
- **3 end-to-end smokes**:
  1. `smoke_data_plane.sh` — all on localhost. Asserts visitor→proxy→tunnel→local app returns 200 with the expected body + holding-state returns 503 on disconnect.
  2. `docker_remote_laptop_demo.sh` — the tunnel-client + local app run inside a Docker container; asserts the response hostname matches `docker exec ... hostname` (proves the byte crossed the kernel-namespace boundary).
  3. `demo_live.sh` — the cloud-side stack in Docker, the user side on the Mac host, with the Python to-do app. Verified via puppeteer-driven screenshots (`Screenshots/17-todo-direct-mac.png` and `Screenshots/18-todo-via-proxy.png`, both showing the same content with the Mac's hostname in the banner).

## Conventions

- **Naming:** `TestService_Method_Scenario_Expected` — e.g. `TestAuth_Register_DuplicateEmail_ReturnsConflict`
- **Isolation:** every test creates a fresh DB schema (sqlite memory db) and a fresh Redis miniredis instance
- **Fixtures:** factories in `testdata/factories.go` — `NewUser()`, `NewDomain()` with sensible defaults
- **Time:** services accept a `clock` interface; tests use a frozen clock
- **No real network:** DNS verifier accepts a `Resolver` interface; tests provide a fake resolver

## Critical-path coverage minimums (enforced via `go test -cover`)

| Package | Min coverage |
|---|---|
| `internal/auth` | 85% |
| `internal/platform/crypto` | 90% |
| `internal/platform/csrf` | 90% |
| `internal/platform/ratelimit` | 90% |
| `internal/domains` | 80% |
| `internal/devices` | 80% |
| `internal/subdomains` | 80% |
| `internal/admin` | 75% |

## What we deliberately DO NOT unit-test

- Echo's own middleware (covered by Echo's own tests)
- GORM query construction (covered by GORM's own tests)
- Logger output formatting

## E2E happy path (target)

1. Visit `/` (marketing)
2. Click "Sign up" → `/signup`
3. Enter email + strong password + accept terms → submit
4. Land on `/verify` with OTP input
5. Read the most recent log line / dev-only endpoint that returns the OTP (`/api/v1/dev/last-otp` only in dev mode)
6. Enter the code → submit → land on dashboard
7. Navigate to `/domains`
8. Click "Add domain" → enter `example.test` → submit
9. See DNS records (CNAME + TXT) appear in a copyable list
10. Click "Verify now" → with the fake resolver returning matching records, status flips to `Verified` within a few seconds (or after manual trigger)
11. Sign out → land on marketing
