package redis

import (
	"context"
	"errors"
	"time"

	"github.com/osmrouter/server/internal/config"
	goredis "github.com/redis/go-redis/v9"
)

// Client wraps go-redis with an optional "absent" mode used when Redis is unreachable.
type Client struct {
	rdb *goredis.Client
}

// Open returns a Client. If the URL is empty, returns nil with no error.
func Open(cfg *config.Config) (*Client, error) {
	if cfg.RedisURL == "" {
		return nil, nil
	}
	opt, err := goredis.ParseURL(cfg.RedisURL)
	if err != nil {
		return nil, err
	}
	rdb := goredis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return &Client{rdb: rdb}, nil
}

func (c *Client) Available() bool { return c != nil && c.rdb != nil }

func (c *Client) Set(ctx context.Context, key, value string, ttl time.Duration) error {
	if !c.Available() {
		return errors.New("redis unavailable")
	}
	return c.rdb.Set(ctx, key, value, ttl).Err()
}

func (c *Client) Get(ctx context.Context, key string) (string, error) {
	if !c.Available() {
		return "", errors.New("redis unavailable")
	}
	v, err := c.rdb.Get(ctx, key).Result()
	if errors.Is(err, goredis.Nil) {
		return "", nil
	}
	return v, err
}

func (c *Client) Del(ctx context.Context, key string) error {
	if !c.Available() {
		return errors.New("redis unavailable")
	}
	return c.rdb.Del(ctx, key).Err()
}

func (c *Client) Incr(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	if !c.Available() {
		return 0, errors.New("redis unavailable")
	}
	pipe := c.rdb.TxPipeline()
	n := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return n.Val(), nil
}

func (c *Client) Ping(ctx context.Context) error {
	if !c.Available() {
		return errors.New("redis unavailable")
	}
	return c.rdb.Ping(ctx).Err()
}

func (c *Client) Close() error {
	if !c.Available() {
		return nil
	}
	return c.rdb.Close()
}
