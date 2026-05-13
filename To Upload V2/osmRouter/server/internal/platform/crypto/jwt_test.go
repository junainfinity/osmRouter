package crypto

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func newIssuer() *JWTIssuer {
	return NewJWTIssuer([]byte("test-secret-must-be-at-least-32-bytes-long!!"), "osmrouter", "osmrouter-web")
}

func TestJWT_SignAndParse_Roundtrip(t *testing.T) {
	j := newIssuer()
	tok, err := j.Sign(Claims{UserID: "u-1", Role: "user"}, time.Minute)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	got, err := j.Parse(tok)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.UserID != "u-1" || got.Role != "user" {
		t.Fatalf("unexpected claims: %+v", got)
	}
}

func TestJWT_ExpiredToken_ReturnsExpiredError(t *testing.T) {
	j := newIssuer()
	tok, err := j.Sign(Claims{UserID: "u-1"}, -time.Minute) // already expired
	if err != nil {
		t.Fatal(err)
	}
	_, err = j.Parse(tok)
	if err != ErrTokenExpired {
		t.Fatalf("expected ErrTokenExpired, got %v", err)
	}
}

func TestJWT_TamperedSignature_Rejected(t *testing.T) {
	j := newIssuer()
	tok, _ := j.Sign(Claims{UserID: "u-1"}, time.Minute)
	// Flip last byte before validation
	bad := tok[:len(tok)-1] + "X"
	if _, err := j.Parse(bad); err == nil {
		t.Fatal("expected error on tampered token")
	}
}

func TestJWT_AlgNone_Rejected(t *testing.T) {
	// Hand-craft a token with alg=none and try to pass it through.
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, &Claims{UserID: "attacker"})
	s, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	j := newIssuer()
	if _, err := j.Parse(s); err == nil {
		t.Fatal("alg=none token must be rejected")
	}
}

func TestJWT_WrongAudience_Rejected(t *testing.T) {
	a := NewJWTIssuer([]byte("k-12345678901234567890123456789012"), "osmrouter", "aud-a")
	b := NewJWTIssuer([]byte("k-12345678901234567890123456789012"), "osmrouter", "aud-b")
	tok, _ := a.Sign(Claims{UserID: "u-1"}, time.Minute)
	if _, err := b.Parse(tok); err == nil {
		t.Fatal("token issued for aud-a must not be accepted by aud-b verifier")
	}
}
