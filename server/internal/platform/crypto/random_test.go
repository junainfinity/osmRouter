package crypto

import (
	"strings"
	"testing"
)

func TestRandomDigits_LengthAndAlphabet(t *testing.T) {
	got, err := RandomDigits(6)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 6 {
		t.Fatalf("len = %d, want 6", len(got))
	}
	for _, c := range got {
		if c < '0' || c > '9' {
			t.Fatalf("non-digit char %q in %s", c, got)
		}
	}
}

func TestRandomDigits_NotDeterministic(t *testing.T) {
	// 1 in 10^6 chance of false positive; acceptable
	a, _ := RandomDigits(6)
	b, _ := RandomDigits(6)
	if a == b {
		t.Fatalf("two random 6-digit codes were identical: %s == %s", a, b)
	}
}

func TestRandomURLToken_NoPaddingOrSlashes(t *testing.T) {
	tok, err := RandomURLToken(32)
	if err != nil {
		t.Fatal(err)
	}
	if strings.ContainsAny(tok, "=+/") {
		t.Fatalf("token must be url-safe without padding: %q", tok)
	}
}

func TestDomainVerifyToken_DeterministicAndUnforgeable(t *testing.T) {
	a := DomainVerifyToken([]byte("k"), "u-1", "example.com")
	b := DomainVerifyToken([]byte("k"), "u-1", "example.com")
	if a != b {
		t.Fatalf("expected deterministic token, got %s vs %s", a, b)
	}
	c := DomainVerifyToken([]byte("k"), "u-2", "example.com")
	if a == c {
		t.Fatalf("token for different user must differ")
	}
	d := DomainVerifyToken([]byte("k2"), "u-1", "example.com")
	if a == d {
		t.Fatalf("token under different secret must differ")
	}
}

func TestHMACVerify_ConstantTimeBehaviour(t *testing.T) {
	key := []byte("k")
	tag := HMACHex(key, []byte("hello"))
	if !HMACVerify(key, []byte("hello"), tag) {
		t.Fatal("valid HMAC must verify")
	}
	if HMACVerify(key, []byte("hellox"), tag) {
		t.Fatal("invalid HMAC must not verify")
	}
}
