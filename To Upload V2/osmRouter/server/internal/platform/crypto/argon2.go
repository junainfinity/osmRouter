package crypto

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

type Argon2Params struct {
	Memory      uint32
	Iterations  uint32
	Parallelism uint8
	SaltLength  uint32
	KeyLength   uint32
}

var DefaultArgon2 = Argon2Params{
	Memory:      64 * 1024,
	Iterations:  3,
	Parallelism: 4,
	SaltLength:  16,
	KeyLength:   32,
}

var ErrInvalidHashFormat = errors.New("invalid argon2 hash format")
var ErrHashMismatch = errors.New("hash mismatch")

// HashPassword returns an argon2id PHC-encoded hash.
func HashPassword(password string) (string, error) {
	return hashWithParams(password, DefaultArgon2)
}

func hashWithParams(password string, p Argon2Params) (string, error) {
	if password == "" {
		return "", errors.New("empty password")
	}
	salt := make([]byte, p.SaltLength)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)
	b64salt := base64.RawStdEncoding.EncodeToString(salt)
	b64key := base64.RawStdEncoding.EncodeToString(key)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, p.Memory, p.Iterations, p.Parallelism, b64salt, b64key), nil
}

// VerifyPassword returns nil on match, ErrHashMismatch on mismatch,
// ErrInvalidHashFormat on malformed input.
func VerifyPassword(encoded, password string) error {
	p, salt, key, err := decodeArgon2(encoded)
	if err != nil {
		return err
	}
	candidate := argon2.IDKey([]byte(password), salt, p.Iterations, p.Memory, p.Parallelism, p.KeyLength)
	if subtle.ConstantTimeCompare(candidate, key) != 1 {
		return ErrHashMismatch
	}
	return nil
}

func decodeArgon2(encoded string) (Argon2Params, []byte, []byte, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	if version != argon2.Version {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	var p Argon2Params
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.Memory, &p.Iterations, &p.Parallelism); err != nil {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return Argon2Params{}, nil, nil, ErrInvalidHashFormat
	}
	p.SaltLength = uint32(len(salt))
	p.KeyLength = uint32(len(key))
	return p, salt, key, nil
}
