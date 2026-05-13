package crypto

import (
	"strings"
	"testing"
)

func TestArgon2_HashThenVerify_Matches(t *testing.T) {
	hash, err := HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("expected argon2id prefix, got %s", hash)
	}
	if err := VerifyPassword(hash, "correct horse battery staple"); err != nil {
		t.Fatalf("verify: %v", err)
	}
}

func TestArgon2_WrongPassword_ReturnsMismatch(t *testing.T) {
	hash, err := HashPassword("hunter2")
	if err != nil {
		t.Fatal(err)
	}
	if err := VerifyPassword(hash, "Hunter2"); err != ErrHashMismatch {
		t.Fatalf("expected ErrHashMismatch, got %v", err)
	}
}

func TestArgon2_MalformedHash_ReturnsInvalidFormat(t *testing.T) {
	cases := []string{"", "not-a-hash", "$argon2id$$$$", "$argon2id$v=19$m=1$invalid"}
	for _, c := range cases {
		if err := VerifyPassword(c, "x"); err != ErrInvalidHashFormat {
			t.Errorf("input %q: expected ErrInvalidHashFormat, got %v", c, err)
		}
	}
}

func TestArgon2_EmptyPassword_Refused(t *testing.T) {
	if _, err := HashPassword(""); err == nil {
		t.Fatal("expected error on empty password")
	}
}

func TestArgon2_TwoHashesOfSamePasswordDiffer(t *testing.T) {
	a, _ := HashPassword("x")
	b, _ := HashPassword("x")
	if a == b {
		t.Fatal("two hashes of same password must differ (salt)")
	}
}
