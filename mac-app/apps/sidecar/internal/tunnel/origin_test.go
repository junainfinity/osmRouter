package tunnel

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestIsAllowedTargetIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		{"127.0.0.1", true},
		{"127.99.0.1", true},
		{"::1", true},
		{"10.0.0.5", true},
		{"192.168.1.1", true},
		{"172.16.0.1", true},
		{"172.31.255.254", true},
		{"172.32.0.1", false}, // outside RFC1918
		{"8.8.8.8", false},
		{"0.0.0.0", false},
		{"224.0.0.1", false}, // multicast
		{"169.254.1.1", false}, // link-local
		{"", false},
		{"not-an-ip", false},
	}
	for _, c := range cases {
		t.Run(c.ip, func(t *testing.T) {
			assert.Equal(t, c.want, isAllowedTargetIP(c.ip))
		})
	}
}

func TestBackoff(t *testing.T) {
	assert.Equal(t, int64(1), int64(backoff(0).Seconds()))
	assert.Equal(t, int64(2), int64(backoff(1).Seconds()))
	assert.Equal(t, int64(4), int64(backoff(2).Seconds()))
	assert.Equal(t, int64(64), int64(backoff(6).Seconds()))
	assert.Equal(t, int64(64), int64(backoff(99).Seconds())) // capped
}
