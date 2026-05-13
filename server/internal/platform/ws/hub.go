package ws

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Event is the wire format pushed to clients.
type Event struct {
	Type      string         `json:"type"`
	Timestamp int64          `json:"ts"`
	Data      map[string]any `json:"data,omitempty"`
}

// Hub fans-out events to per-user channels.
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]struct{} // userID -> set of clients
	logger  *slog.Logger
}

func NewHub(logger *slog.Logger) *Hub {
	return &Hub{
		clients: make(map[string]map[*Client]struct{}),
		logger:  logger,
	}
}

func (h *Hub) Register(userID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[userID]; !ok {
		h.clients[userID] = make(map[*Client]struct{})
	}
	h.clients[userID][c] = struct{}{}
}

func (h *Hub) Unregister(userID string, c *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.clients[userID]; ok {
		delete(set, c)
		if len(set) == 0 {
			delete(h.clients, userID)
		}
	}
}

// PublishTo sends event to every client currently connected as userID.
func (h *Hub) PublishTo(userID string, evt Event) {
	if evt.Timestamp == 0 {
		evt.Timestamp = time.Now().UnixMilli()
	}
	payload, err := json.Marshal(evt)
	if err != nil {
		return
	}
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients[userID]))
	for c := range h.clients[userID] {
		clients = append(clients, c)
	}
	h.mu.RUnlock()
	for _, c := range clients {
		select {
		case c.out <- payload:
		default:
			// slow consumer — drop
		}
	}
}

// Broadcast sends event to all connected users.
func (h *Hub) Broadcast(evt Event) {
	h.mu.RLock()
	uids := make([]string, 0, len(h.clients))
	for uid := range h.clients {
		uids = append(uids, uid)
	}
	h.mu.RUnlock()
	for _, uid := range uids {
		h.PublishTo(uid, evt)
	}
}

func (h *Hub) Stats() (totalConns int, users int) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	users = len(h.clients)
	for _, set := range h.clients {
		totalConns += len(set)
	}
	return
}

// Client is one connected WebSocket session.
type Client struct {
	conn   *websocket.Conn
	out    chan []byte
	userID string
	hub    *Hub
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Origin allowlist is enforced upstream by CORS middleware before upgrade.
		return true
	},
}

// Upgrade promotes an HTTP request to WS for the given user and starts the pump goroutines.
func (h *Hub) Upgrade(w http.ResponseWriter, r *http.Request, userID string) error {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return err
	}
	c := &Client{
		conn:   conn,
		out:    make(chan []byte, 64),
		userID: userID,
		hub:    h,
	}
	h.Register(userID, c)
	go c.writePump()
	go c.readPump()
	return nil
}

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = 30 * time.Second
	maxMessageSize = 4096
)

func (c *Client) readPump() {
	defer func() {
		c.hub.Unregister(c.userID, c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
		// We treat the channel as server-push-only — discard inbound frames.
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.out:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
