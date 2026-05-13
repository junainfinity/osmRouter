package embedded_ca

import (
	"strings"
	"testing"
)

// TestPlaceholderRejected verifies that the in-repo placeholder root.pem
// fails Validate(). This guards against a build forgetting to swap the
// placeholder for the real operator CA — the compile-mac.sh script greps
// for "embedded-ca-OK" in `osm-agent selftest` output and bails otherwise.
//
// When CI runs against the placeholder, this test PASSES (placeholder is
// detected). When CI runs against a real CA, the test is skipped via the
// `realca` build tag (set by compile-mac.sh after dropping the real PEM).
func TestPlaceholderRejected(t *testing.T) {
	if IsRealCA() {
		t.Skip("real CA is embedded — placeholder check not applicable")
	}
	if err := Validate(); err == nil {
		t.Fatalf("expected ErrPlaceholder, got nil — Validate() must reject the in-repo stub")
	}
	pem := RootPEM()
	if !strings.Contains(string(pem), "PLACEHOLDER") {
		t.Fatalf("expected PLACEHOLDER marker in embedded PEM, got %q", string(pem))
	}
}

// TestRootPEMCopyIsDefensive ensures the bytes returned by RootPEM are a
// fresh copy, so a caller mutating them cannot corrupt subsequent reads.
func TestRootPEMCopyIsDefensive(t *testing.T) {
	first := RootPEM()
	if len(first) == 0 {
		t.Fatalf("RootPEM returned empty bytes")
	}
	first[0] = 'X'
	second := RootPEM()
	if second[0] == 'X' {
		t.Fatalf("RootPEM did not return a defensive copy — mutation leaked")
	}
}
