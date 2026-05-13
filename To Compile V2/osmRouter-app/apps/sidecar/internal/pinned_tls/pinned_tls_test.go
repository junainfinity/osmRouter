package pinned_tls

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// generateTestCA writes a self-signed P-256 root CA to disk and returns the path.
func generateTestCA(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(42),
		Subject:      pkix.Name{CommonName: "osmRouter Test CA"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         true,
		KeyUsage:     x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	require.NoError(t, err)
	dir := t.TempDir()
	p := filepath.Join(dir, "ca.pem")
	require.NoError(t, os.WriteFile(p, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600))
	return p
}

func TestLoadRootCA_OK(t *testing.T) {
	p := generateTestCA(t)
	pool, err := LoadRootCA(p)
	require.NoError(t, err)
	assert.NotNil(t, pool)
}

func TestLoadRootCA_EmptyPath(t *testing.T) {
	_, err := LoadRootCA("")
	assert.Error(t, err)
}

func TestLoadRootCA_BadPEM(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "junk.pem")
	require.NoError(t, os.WriteFile(p, []byte("not a pem"), 0o600))
	_, err := LoadRootCA(p)
	assert.Error(t, err)
}

func TestLoadRootCA_MissingFile(t *testing.T) {
	_, err := LoadRootCA("/nonexistent/path/ca.pem")
	assert.Error(t, err)
}

func TestConfig_TLS13Only(t *testing.T) {
	p := generateTestCA(t)
	pool, err := LoadRootCA(p)
	require.NoError(t, err)
	cfg := Config(pool, "example.com")
	assert.Equal(t, uint16(tls.VersionTLS13), cfg.MinVersion)
	assert.Equal(t, uint16(tls.VersionTLS13), cfg.MaxVersion)
	assert.False(t, cfg.InsecureSkipVerify)
	assert.Equal(t, "example.com", cfg.ServerName)
	assert.Same(t, pool, cfg.RootCAs)
}
