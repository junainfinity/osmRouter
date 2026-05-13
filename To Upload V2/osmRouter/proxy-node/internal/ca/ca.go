// Package ca loads the operator's pinned root CA + the proxy's leaf cert.
//
// The CA bundle is mounted as files into the container; the leaf cert
// pair authenticates the proxy to connecting sidecars. The root CA is
// what the sidecars are pinned to. Same trust anchor is also embedded
// into the sidecar binary at compile time so the sidecar can verify the
// proxy without needing a separate PEM on disk.
package ca

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
)

// Bundle is the loaded set of certs + pool.
type Bundle struct {
	LeafCert  tls.Certificate
	RootPool  *x509.CertPool
	RootPEM   []byte // raw bytes — sidecars can embed this
}

// Load reads root.pem + leaf.pem + leaf.key from the given paths.
func Load(rootPath, leafCertPath, leafKeyPath string) (*Bundle, error) {
	rootPEM, err := os.ReadFile(rootPath)
	if err != nil {
		return nil, fmt.Errorf("ca: read root %q: %w", rootPath, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(rootPEM) {
		return nil, errors.New("ca: root.pem did not contain any valid certificates")
	}
	leaf, err := tls.LoadX509KeyPair(leafCertPath, leafKeyPath)
	if err != nil {
		return nil, fmt.Errorf("ca: load leaf keypair: %w", err)
	}
	return &Bundle{
		LeafCert: leaf,
		RootPool: pool,
		RootPEM:  rootPEM,
	}, nil
}

// ServerConfig returns a tls.Config the proxy uses to accept inbound
// sidecar connections. TLS 1.3 minimum.
func (b *Bundle) ServerConfig() *tls.Config {
	return &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{b.LeafCert},
		// We don't require client certs in v1; the sidecar identifies
		// itself via the register-frame Bearer token. mTLS client-cert
		// hardening is on the v1.1 list (see Planning/16 DR-D2).
		ClientAuth: tls.NoClientCert,
		NextProtos: []string{}, // ALPN not negotiated here — we use raw TLS, then framing, then h2
	}
}
