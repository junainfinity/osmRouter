// Package embedded_ca exposes the operator's pinned root CA, baked into
// the sidecar binary at compile time via //go:embed.
//
// # Why embed?
//
// The whole point of osmRouter v2 is that the Mac sidecar talks to the
// cloud proxy over TLS 1.3 with a pinned trust anchor — the system trust
// store is deliberately ignored, so a corporate / hotel / state MITM with
// a "trusted" intermediate cert cannot break in. For pinning to mean
// anything, the trust anchor must travel with the binary the customer
// runs. Shipping it as a separate file on disk would let a local attacker
// swap it out before launch.
//
// # How to use
//
//  1. Before compiling, replace `root.pem` in this directory with your
//     operator root CA (the one minted by `osmRouter/scripts/init-ca.sh`
//     on the server side — see DEPLOY.md §3 of the To Upload V2 bundle).
//  2. `go build` will fail at compile time if `root.pem` is missing or
//     unreadable — that's intentional.
//  3. Calling `RootPEM()` at runtime returns the embedded bytes. The
//     tunnel package falls back to this when the `--root-ca` CLI flag is
//     not provided.
//
// # Rotation
//
// To rotate the root CA, rebuild the sidecar against a new `root.pem`
// and ship the new binary. During a multi-week overlap window the cloud
// proxy can accept both old and new roots, so existing clients keep
// working until everyone has updated. See DEPLOY.md §13 (CA rotation).
package embedded_ca

import (
	_ "embed"
	"errors"
)

//go:embed root.pem
var rootPEM []byte

// RootPEM returns a copy of the embedded operator root CA in PEM form.
// Empty bytes are treated as "no CA was embedded" — the caller should
// fall through to whatever the operator passed on the CLI, or fail.
//
// The placeholder shipped in source control has a single "PLACEHOLDER"
// marker that is not a real PEM. IsRealCA returns false for it so a
// developer who forgets to embed the real CA does not get a binary
// that silently fails TLS at runtime.
func RootPEM() []byte {
	// Defensive copy — callers must not mutate the embed.
	out := make([]byte, len(rootPEM))
	copy(out, rootPEM)
	return out
}

// IsRealCA returns true if the embedded blob looks like a real PEM
// certificate. Used by the build/selftest path to catch the "forgot to
// drop your operator CA in before compiling" mistake early.
func IsRealCA() bool {
	return len(rootPEM) > 100 &&
		hasPrefix(rootPEM, "-----BEGIN CERTIFICATE-----") &&
		!containsPlaceholder(rootPEM)
}

// ErrPlaceholder is returned by Validate when the embedded blob is the
// in-repo placeholder. The build script surfaces this as a hard failure.
var ErrPlaceholder = errors.New("embedded_ca: placeholder PEM detected — drop your operator root CA into apps/sidecar/internal/embedded_ca/root.pem before compiling")

// Validate is called from the sidecar's selftest. Returns nil for a
// real CA, ErrPlaceholder for the in-repo stub.
func Validate() error {
	if !IsRealCA() {
		return ErrPlaceholder
	}
	return nil
}

func hasPrefix(b []byte, p string) bool {
	if len(b) < len(p) {
		return false
	}
	for i := 0; i < len(p); i++ {
		if b[i] != p[i] {
			return false
		}
	}
	return true
}

func containsPlaceholder(b []byte) bool {
	needle := []byte("PLACEHOLDER")
	if len(b) < len(needle) {
		return false
	}
	for i := 0; i+len(needle) <= len(b); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			if b[i+j] != needle[j] {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}
