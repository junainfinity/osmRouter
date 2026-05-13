package crypto

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	ErrInvalidToken    = errors.New("invalid token")
	ErrTokenExpired    = errors.New("token expired")
	ErrInvalidAudience = errors.New("invalid audience")
)

type Claims struct {
	UserID         string   `json:"sub"`
	Role           string   `json:"role"`
	Scopes         []string `json:"scopes,omitempty"`
	ImpersonatedBy string   `json:"impersonated_by,omitempty"`
	jwt.RegisteredClaims
}

type JWTIssuer struct {
	secret []byte
	issuer string
	aud    string
}

func NewJWTIssuer(secret []byte, issuer, audience string) *JWTIssuer {
	return &JWTIssuer{secret: secret, issuer: issuer, aud: audience}
}

func (j *JWTIssuer) Sign(c Claims, ttl time.Duration) (string, error) {
	now := time.Now()
	c.RegisteredClaims.Issuer = j.issuer
	c.RegisteredClaims.Audience = jwt.ClaimStrings{j.aud}
	c.RegisteredClaims.IssuedAt = jwt.NewNumericDate(now)
	c.RegisteredClaims.NotBefore = jwt.NewNumericDate(now)
	c.RegisteredClaims.ExpiresAt = jwt.NewNumericDate(now.Add(ttl))
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, &c)
	return tok.SignedString(j.secret)
}

func (j *JWTIssuer) Parse(raw string) (*Claims, error) {
	parser := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}))
	tok, err := parser.ParseWithClaims(raw, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		// Explicit alg confusion guard: only HS256 accepted.
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return j.secret, nil
	})
	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrTokenExpired
		}
		return nil, ErrInvalidToken
	}
	c, ok := tok.Claims.(*Claims)
	if !ok || !tok.Valid {
		return nil, ErrInvalidToken
	}
	if !slicesContain(c.Audience, j.aud) {
		return nil, ErrInvalidAudience
	}
	return c, nil
}

func slicesContain(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
