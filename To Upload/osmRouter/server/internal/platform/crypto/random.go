package crypto

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
)

// RandomBytes returns n cryptographically secure random bytes.
func RandomBytes(n int) ([]byte, error) {
	b := make([]byte, n)
	if _, err := io.ReadFull(rand.Reader, b); err != nil {
		return nil, err
	}
	return b, nil
}

// RandomURLToken returns a URL-safe base64 token of approximately n bytes of entropy.
func RandomURLToken(nBytes int) (string, error) {
	b, err := RandomBytes(nBytes)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// RandomDigits returns a string of n decimal digits chosen uniformly at random.
// Uses rejection sampling to avoid modulo bias.
func RandomDigits(n int) (string, error) {
	const alphabet = "0123456789"
	out := make([]byte, n)
	buf := make([]byte, 1)
	for i := 0; i < n; {
		if _, err := io.ReadFull(rand.Reader, buf); err != nil {
			return "", err
		}
		v := buf[0]
		// 250 >= 10 * floor(256/10) = 250  -> use 0..249 only to avoid bias
		if v < 250 {
			out[i] = alphabet[int(v)%10]
			i++
		}
	}
	return string(out), nil
}

// SHA256Hex returns the hex-encoded SHA-256 of s.
func SHA256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// HMACHex returns hex-encoded HMAC-SHA-256 of msg using key.
func HMACHex(key, msg []byte) string {
	m := hmac.New(sha256.New, key)
	_, _ = m.Write(msg)
	return hex.EncodeToString(m.Sum(nil))
}

// HMACVerify compares an HMAC in constant time.
func HMACVerify(key, msg []byte, hexTag string) bool {
	expected, err := hex.DecodeString(hexTag)
	if err != nil {
		return false
	}
	m := hmac.New(sha256.New, key)
	_, _ = m.Write(msg)
	return hmac.Equal(m.Sum(nil), expected)
}

// DomainVerifyToken returns a deterministic, per-user-per-domain verification token
// the user places in a TXT record. Cannot be forged without the server secret.
func DomainVerifyToken(secret []byte, userID, fqdn string) string {
	msg := []byte(fmt.Sprintf("dns-verify|%s|%s", userID, fqdn))
	return "osm-verify=" + HMACHex(secret, msg)[:32]
}
