package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
)

var ErrCipherInvalid = errors.New("ciphertext invalid")

// AESGCMEncrypt encrypts plaintext with AES-256-GCM using a per-message random nonce.
// Returns a base64-encoded string of nonce||ciphertext||tag.
// Key must be 32 bytes (AES-256).
func AESGCMEncrypt(key, plaintext []byte) (string, error) {
	if len(key) != 32 {
		return "", errors.New("aes: key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, g.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ct := g.Seal(nil, nonce, plaintext, nil)
	out := append(nonce, ct...)
	return base64.StdEncoding.EncodeToString(out), nil
}

func AESGCMDecrypt(key []byte, encoded string) ([]byte, error) {
	if len(key) != 32 {
		return nil, errors.New("aes: key must be 32 bytes")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, ErrCipherInvalid
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < g.NonceSize() {
		return nil, ErrCipherInvalid
	}
	nonce, ct := raw[:g.NonceSize()], raw[g.NonceSize():]
	pt, err := g.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, ErrCipherInvalid
	}
	return pt, nil
}
