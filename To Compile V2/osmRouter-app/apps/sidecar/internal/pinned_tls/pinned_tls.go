// Package pinned_tls produces tls.Config values that enforce TLS 1.3 + a
// pinned root CA. Implements S7.1–S7.3.
//
// No system CA store is trusted: only the PEM the operator pinned at build
// time. This is the strongest defense against active MITM (rogue ISP,
// captive portal, local-network attacker).
package pinned_tls

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
)

// LoadRootCA reads a PEM file and returns a CertPool containing only those
// roots. Empty pool => error.
func LoadRootCA(path string) (*x509.CertPool, error) {
	if path == "" {
		return nil, errors.New("pinned-ca-path-empty")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read-pinned-ca: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(b) {
		return nil, errors.New("pinned-ca-pem-invalid")
	}
	return pool, nil
}

// LoadRootCABytes builds a CertPool from an in-memory PEM blob. Used to
// turn the embedded operator CA (see internal/embedded_ca) into a pool
// without going through the filesystem — which keeps a local attacker
// from swapping the trust anchor between launches.
func LoadRootCABytes(pem []byte) (*x509.CertPool, error) {
	if len(pem) == 0 {
		return nil, errors.New("pinned-ca-pem-empty")
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		return nil, errors.New("pinned-ca-pem-invalid")
	}
	return pool, nil
}

// Config returns a TLS config with TLS 1.3 only and the pinned root CA.
// ServerName is used for SNI and hostname verification.
func Config(pool *x509.CertPool, serverName string) *tls.Config {
	return &tls.Config{
		MinVersion: tls.VersionTLS13,
		// Force TLS 1.3 by also setting MaxVersion. Older proxies fall outside
		// our compat window for v0.1.
		MaxVersion: tls.VersionTLS13,
		// CipherSuites is ignored in TLS 1.3 (suites are negotiated by the
		// runtime), but we set it for documentation. The TLS-1.3 ciphers
		// always used by Go are AES_128_GCM, AES_256_GCM, CHACHA20_POLY1305.
		CipherSuites:       []uint16{tls.TLS_AES_256_GCM_SHA384, tls.TLS_CHACHA20_POLY1305_SHA256, tls.TLS_AES_128_GCM_SHA256},
		RootCAs:            pool,
		ServerName:         serverName,
		InsecureSkipVerify: false, // S7.3: never override
	}
}
