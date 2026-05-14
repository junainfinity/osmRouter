package mockproxy

import (
	"crypto/tls"
	"crypto/x509"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Verify the mock proxy serves over TLS 1.3 with its pinned CA, refusing
// connections that don't trust the CA.
func TestMockProxy_PinnedTLSRoundTrip(t *testing.T) {
	srv, err := New()
	require.NoError(t, err)
	addr, err := srv.Listen()
	require.NoError(t, err)
	defer srv.Close()
	_ = addr

	// Build a client that trusts only the proxy's root.
	pool := x509.NewCertPool()
	require.True(t, pool.AppendCertsFromPEM(srv.RootPEM()))
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS13,
				RootCAs:    pool,
				ServerName: "127.0.0.1",
			},
		},
	}
	resp, err := client.Get(srv.URL() + "/")
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Contains(t, string(body), "hello from mock cloud proxy")
}

// Without the pinned CA, the client should refuse to validate the cert.
func TestMockProxy_RejectsUntrustedRoot(t *testing.T) {
	srv, err := New()
	require.NoError(t, err)
	_, err = srv.Listen()
	require.NoError(t, err)
	defer srv.Close()

	// Empty pool — system CAs irrelevant since the server cert is self-signed.
	emptyPool := x509.NewCertPool()
	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				MinVersion: tls.VersionTLS13,
				RootCAs:    emptyPool,
				ServerName: "127.0.0.1",
			},
		},
	}
	_, err = client.Get(srv.URL() + "/")
	assert.Error(t, err, "client trusting no roots must reject the self-signed proxy cert")
}
