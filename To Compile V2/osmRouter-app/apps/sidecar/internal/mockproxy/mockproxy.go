// Package mockproxy is a tiny TLS/HTTP-2 server used in integration tests
// as a stand-in for the real cloud proxy. It generates a self-signed CA on
// startup and exposes the PEM for the sidecar to pin against.
package mockproxy

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/net/http2"
)

type Server struct {
	listener net.Listener
	srv      *http.Server
	rootCert *x509.Certificate
	rootKey  *ecdsa.PrivateKey
	addr     string

	mu       sync.Mutex
	rootPEM  []byte
	caPath   string
}

func New() (*Server, error) {
	s := &Server{}
	if err := s.makeCA(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Server) makeCA() error {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	tpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "osmRouter Dev Root CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		return err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return err
	}
	s.rootCert = cert
	s.rootKey = key
	s.rootPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return nil
}

// WritePinnedCA writes the root PEM to a temp file and returns its path.
func (s *Server) WritePinnedCA(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	p := filepath.Join(dir, "dev-root-ca.pem")
	if err := os.WriteFile(p, s.rootPEM, 0o600); err != nil {
		return "", err
	}
	s.caPath = p
	return p, nil
}

func (s *Server) RootPEM() []byte { return append([]byte(nil), s.rootPEM...) }

// Listen on 127.0.0.1:<auto>; returns the bound address as host:port.
func (s *Server) Listen() (string, error) {
	// Issue a leaf cert for 127.0.0.1 / "localhost".
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", err
	}
	leafTpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
		DNSNames:     []string{"localhost"},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTpl, s.rootCert, &leafKey.PublicKey, s.rootKey)
	if err != nil {
		return "", err
	}
	cert := tls.Certificate{
		Certificate: [][]byte{leafDER},
		PrivateKey:  leafKey,
	}
	cfg := &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{cert},
		NextProtos:   []string{"h2"},
	}
	ln, err := tls.Listen("tcp", "127.0.0.1:0", cfg)
	if err != nil {
		return "", err
	}
	s.listener = ln
	s.addr = ln.Addr().String()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("hello from mock cloud proxy"))
	})
	s.srv = &http.Server{Handler: mux}
	_ = http2.ConfigureServer(s.srv, &http2.Server{})

	go func() {
		_ = s.srv.Serve(ln)
	}()

	return s.addr, nil
}

func (s *Server) URL() string {
	return fmt.Sprintf("https://%s", s.addr)
}

func (s *Server) Close() error {
	if s.srv == nil {
		return errors.New("not-started")
	}
	return s.srv.Close()
}
