package framing

import (
	"bytes"
	"errors"
	"net"
	"strings"
	"testing"
	"time"
)

// pipeConn is a net.Conn wrapper around an in-memory pipe so we can drive
// reads/writes deterministically.
type pipeConn struct {
	r *bytes.Buffer
	w *bytes.Buffer
}

func (p *pipeConn) Read(b []byte) (int, error)         { return p.r.Read(b) }
func (p *pipeConn) Write(b []byte) (int, error)        { return p.w.Write(b) }
func (p *pipeConn) Close() error                        { return nil }
func (p *pipeConn) LocalAddr() net.Addr                 { return &net.TCPAddr{} }
func (p *pipeConn) RemoteAddr() net.Addr                { return &net.TCPAddr{} }
func (p *pipeConn) SetDeadline(t time.Time) error       { return nil }
func (p *pipeConn) SetReadDeadline(t time.Time) error   { return nil }
func (p *pipeConn) SetWriteDeadline(t time.Time) error  { return nil }

func newPipe(input string) *pipeConn {
	return &pipeConn{r: bytes.NewBufferString(input), w: &bytes.Buffer{}}
}

func TestReadRegisterFrame_HappyPath(t *testing.T) {
	in := `{"v":1,"device_id":"d-1","token":"t-1","host":"app.example.com"}` + "\n"
	c := newPipe(in)
	f, err := ReadRegisterFrame(c, 0)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if f.DeviceID != "d-1" || f.Token != "t-1" || f.Host != "app.example.com" {
		t.Fatalf("unexpected frame: %+v", f)
	}
}

// DR-D5 regression: after ReadRegisterFrame returns, the next byte the
// caller reads must be the byte right after '\n'. If we used bufio,
// we'd accidentally swallow bytes meant for the HTTP/2 preface.
func TestReadRegisterFrame_LeavesRemainderForCaller(t *testing.T) {
	frame := `{"v":1,"device_id":"d","token":"t","host":"h.test"}` + "\n"
	preface := "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"
	c := newPipe(frame + preface)
	if _, err := ReadRegisterFrame(c, 0); err != nil {
		t.Fatalf("read: %v", err)
	}
	got := make([]byte, len(preface))
	n, _ := c.Read(got)
	if string(got[:n]) != preface {
		t.Fatalf("preface corrupted; got %q want %q", string(got[:n]), preface)
	}
}

func TestReadRegisterFrame_OverSize(t *testing.T) {
	big := strings.Repeat("X", MaxFrameBytes+1) + "\n"
	c := newPipe(big)
	if _, err := ReadRegisterFrame(c, 0); !errors.Is(err, ErrFrameOverSize) {
		t.Fatalf("expected ErrFrameOverSize, got %v", err)
	}
}

func TestReadRegisterFrame_BadJSON(t *testing.T) {
	c := newPipe("not-json\n")
	_, err := ReadRegisterFrame(c, 0)
	if !errors.Is(err, ErrInvalidJSON) {
		t.Fatalf("expected ErrInvalidJSON, got %v", err)
	}
}

func TestReadRegisterFrame_MissingFields(t *testing.T) {
	c := newPipe(`{"v":1,"device_id":"d"}` + "\n")
	_, err := ReadRegisterFrame(c, 0)
	if !errors.Is(err, ErrMissingFields) {
		t.Fatalf("expected ErrMissingFields, got %v", err)
	}
}

func TestWriteRegisterResponse_AppendsNewline(t *testing.T) {
	c := newPipe("")
	r := &RegisterResponse{OK: true, NodeID: "n-1", KeepaliveMS: 30000}
	if err := WriteRegisterResponse(c, r); err != nil {
		t.Fatal(err)
	}
	out := c.w.String()
	if !strings.HasSuffix(out, "\n") {
		t.Fatalf("response not newline-terminated: %q", out)
	}
	if !strings.Contains(out, `"ok":true`) || !strings.Contains(out, `"node_id":"n-1"`) {
		t.Fatalf("unexpected body: %s", out)
	}
}
