package domains

import (
	"context"
	"log/slog"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/osmrouter/server/internal/models"
	"github.com/osmrouter/server/internal/platform/ws"
)

// Resolver abstracts DNS so tests can swap it for a fake.
type Resolver interface {
	LookupTXT(ctx context.Context, name string) ([]string, error)
	LookupCNAME(ctx context.Context, name string) (string, error)
}

// SystemResolver uses net.DefaultResolver.
type SystemResolver struct{}

func (SystemResolver) LookupTXT(ctx context.Context, name string) ([]string, error) {
	return net.DefaultResolver.LookupTXT(ctx, name)
}
func (SystemResolver) LookupCNAME(ctx context.Context, name string) (string, error) {
	return net.DefaultResolver.LookupCNAME(ctx, name)
}

// Verifier runs a background goroutine that drains the verification queue.
type Verifier struct {
	svc      *Service
	resolver Resolver
	hub      *ws.Hub
	logger   *slog.Logger

	mu     sync.Mutex
	queue  []string
	signal chan struct{}
	closed chan struct{}
}

func NewVerifier(svc *Service, resolver Resolver, hub *ws.Hub, logger *slog.Logger) *Verifier {
	return &Verifier{
		svc:      svc,
		resolver: resolver,
		hub:      hub,
		logger:   logger,
		signal:   make(chan struct{}, 1),
		closed:   make(chan struct{}),
	}
}

// Enqueue requests verification for a domain ID. Non-blocking.
func (v *Verifier) Enqueue(domainID string) {
	v.mu.Lock()
	v.queue = append(v.queue, domainID)
	v.mu.Unlock()
	select {
	case v.signal <- struct{}{}:
	default:
	}
}

// Run loops until ctx is canceled. Periodic sweep + on-demand.
func (v *Verifier) Run(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			close(v.closed)
			return
		case <-t.C:
			v.sweep(ctx)
		case <-v.signal:
			v.drainQueue(ctx)
		}
	}
}

func (v *Verifier) drainQueue(ctx context.Context) {
	v.mu.Lock()
	q := v.queue
	v.queue = nil
	v.mu.Unlock()
	for _, id := range q {
		v.verifyOne(ctx, id)
	}
}

func (v *Verifier) sweep(ctx context.Context) {
	pending, err := v.svc.PendingDomains(ctx, 20)
	if err != nil {
		v.logger.Error("verifier sweep failed", "err", err)
		return
	}
	for _, d := range pending {
		v.verifyOne(ctx, d.ID)
	}
}

func (v *Verifier) verifyOne(ctx context.Context, domainID string) {
	var d models.Domain
	if err := v.svc.db.WithContext(ctx).Where("id = ?", domainID).First(&d).Error; err != nil {
		return
	}
	if d.DNSStatus == models.DNSStatusVerified {
		return
	}
	_ = v.svc.MarkVerifying(ctx, d.ID)

	ok := v.checkRecords(ctx, &d)
	if ok {
		if err := v.svc.MarkVerified(ctx, d.ID, d.UserID, "", "system-verifier"); err != nil {
			v.logger.Error("mark verified failed", "domain", d.FQDN, "err", err)
			return
		}
		if v.hub != nil {
			v.hub.PublishTo(d.UserID, ws.Event{
				Type: "domain.verified",
				Data: map[string]any{"id": d.ID, "fqdn": d.FQDN},
			})
		}
		v.logger.Info("domain verified", "fqdn", d.FQDN, "user_id", d.UserID)
		return
	}
	_ = v.svc.MarkFailed(ctx, d.ID)
}

func (v *Verifier) checkRecords(ctx context.Context, d *models.Domain) bool {
	// PRIMARY: the documented v2 setup — A records at apex + a TXT token
	// at `_osm.<fqdn>`. This is what the dashboard's "Add a domain" wizard
	// instructs every new customer to add. We don't bother re-checking the
	// A records here; if they're wrong, requests will fail with HTTP 502
	// at proxy time, which is a clearer signal than refusing to mark the
	// domain "verified".
	if v.checkTXT(ctx, "_osm."+d.FQDN, d.TXTToken) {
		return true
	}

	// LEGACY: CNAME-based setup. Some early customers pointed their apex
	// at a CNAME instead of using A records. The CNAME target is stored on
	// the Domain row (d.CNAMETarget) — usually `tunnel.<brand-domain>`.
	// We keep this path so old setups don't break on a server upgrade.
	cname, err := v.resolver.LookupCNAME(ctx, d.FQDN)
	if err == nil && d.CNAMETarget != "" {
		got := strings.TrimSuffix(strings.ToLower(cname), ".")
		want := strings.TrimSuffix(strings.ToLower(d.CNAMETarget), ".")
		if got == want {
			return true
		}
	}

	// LEGACY: TXT token published at the apex instead of `_osm.<fqdn>`.
	// Some users add the token here by mistake (or via registrars whose
	// UI doesn't accept `_`-prefixed labels). Accepting it keeps the
	// experience forgiving.
	if v.checkTXT(ctx, d.FQDN, d.TXTToken) {
		return true
	}

	return false
}

// checkTXT looks up TXT records at the given name and returns true iff any
// of them matches the expected token exactly. Returns false on resolver
// error or no-match — callers treat both as "not verified yet".
func (v *Verifier) checkTXT(ctx context.Context, name, want string) bool {
	txts, err := v.resolver.LookupTXT(ctx, name)
	if err != nil {
		return false
	}
	for _, t := range txts {
		if t == want {
			return true
		}
	}
	return false
}
