package crypto

import (
	"bytes"
	"testing"
)

func TestAESGCM_Roundtrip(t *testing.T) {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i)
	}
	enc, err := AESGCMEncrypt(key, []byte("hello world"))
	if err != nil {
		t.Fatal(err)
	}
	pt, err := AESGCMDecrypt(key, enc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pt, []byte("hello world")) {
		t.Fatalf("plaintext mismatch: %q", pt)
	}
}

func TestAESGCM_NonceUniqueness(t *testing.T) {
	key := make([]byte, 32)
	a, _ := AESGCMEncrypt(key, []byte("payload"))
	b, _ := AESGCMEncrypt(key, []byte("payload"))
	if a == b {
		t.Fatal("two encryptions of same plaintext must differ (random nonce)")
	}
}

func TestAESGCM_TamperRejected(t *testing.T) {
	key := make([]byte, 32)
	enc, _ := AESGCMEncrypt(key, []byte("payload"))
	tampered := enc[:len(enc)-2] + "Ab"
	if _, err := AESGCMDecrypt(key, tampered); err == nil {
		t.Fatal("tampered ciphertext must fail to decrypt")
	}
}

func TestAESGCM_WrongKeyRejected(t *testing.T) {
	k1 := make([]byte, 32)
	k2 := make([]byte, 32)
	k2[0] = 1
	enc, _ := AESGCMEncrypt(k1, []byte("payload"))
	if _, err := AESGCMDecrypt(k2, enc); err == nil {
		t.Fatal("decryption with wrong key must fail")
	}
}
