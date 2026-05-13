# 06 — Component Stack Map

> Every component in PRD §10 mapped to its concrete artifact in this repo.

| PRD Component | Implementation | Path |
|---|---|---|
| Frontend UI (Next.js 15) | Next.js 15 App Router | `web/app/**` |
| Tailwind | Tailwind CSS v4 | `web/app/globals.css`, `web/tailwind.config.ts` |
| Shadcn primitives | Selected components installed via `pnpm dlx shadcn@latest add ...` | `web/components/ui/**` |
| Design tokens (OKLCH) | Ported verbatim from `Design/.../index.html` | `web/app/globals.css` |
| Backend API (Go + Echo) | `cmd/api/main.go` + `internal/server/*` | `server/**` |
| ORM (GORM + pgx) | `internal/platform/db/db.go` | `server/internal/platform/db/` |
| Task queue (Asynq alt) | In-process goroutine pool for v1 | `server/internal/domains/verifier.go` |
| Identity / PKCE | Custom Go implementation per RFC 8628 + RFC 7636 | `server/internal/auth/device_code.go` |
| Primary DB (Postgres) | Local Postgres via docker-compose; SQLite in tests | `server/migrations/`, `docker-compose.yml` |
| Cache & Real-time state (Redis) | go-redis | `server/internal/platform/redis/` |
| Cloudflare for SaaS | **Stub** — interface ready for prod swap | `server/internal/platform/cf/cf.go` (interface only) |
| WebSocket engine | gorilla/websocket | `server/internal/platform/ws/hub.go` |
| Reverse proxy (data plane) | **Out of scope** — separate service | n/a |

## Frontend State Map

| State Class | Tool | Where |
|---|---|---|
| Server data (domains, devices, etc.) | TanStack Query | `lib/queries.ts` |
| UI state (modals open, sidebar collapsed) | Zustand | `lib/store.ts` |
| Auth user / session | TanStack Query (`useMe`) | `lib/queries.ts` |
| WebSocket events | Custom event bus → React subscription hook | `lib/websocket.ts`, `hooks/use-realtime.ts` |
| Form state | React state / react-hook-form (per page) | inline |
| Theme | `data-theme` on `<html>`, persisted to localStorage | `components/theme-provider.tsx` |
