package tunnel

import (
	"bytes"
	"testing"
)

func TestFrame_HelloRoundTrip(t *testing.T) {
	in := Frame{Type: FrameHello, DeviceID: "dev-1", APIKey: "abc", Version: "1"}
	b, err := in.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	out, err := Unmarshal(b)
	if err != nil {
		t.Fatal(err)
	}
	if out.Type != FrameHello || out.DeviceID != "dev-1" || out.APIKey != "abc" {
		t.Fatalf("unexpected: %+v", out)
	}
}

func TestFrame_RequestResponseRoundTrip(t *testing.T) {
	body := []byte("hello world")
	req := Frame{
		Type:     FrameRequest,
		StreamID: "s-1",
		Method:   "POST",
		URL:      "/api/x",
		Headers:  map[string][]string{"Content-Type": {"text/plain"}},
		BodyB64:  EncodeBody(body),
	}
	b, _ := req.Marshal()
	out, err := Unmarshal(b)
	if err != nil {
		t.Fatal(err)
	}
	got, err := DecodeBody(out.BodyB64)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, body) {
		t.Fatalf("body mismatch: %q vs %q", got, body)
	}
}

func TestFrame_Validate_RejectsMissingFields(t *testing.T) {
	cases := []Frame{
		{Type: ""},                          // missing type
		{Type: FrameHello},                  // missing device_id, api_key
		{Type: FrameHello, DeviceID: "x"},   // missing api_key
		{Type: FrameRequest, StreamID: "s"}, // missing method/url
		{Type: FrameResponse, Status: 0},    // missing stream_id and status
	}
	for i, f := range cases {
		if err := f.Validate(); err == nil {
			t.Errorf("case %d: expected validation error for %+v", i, f)
		}
	}
}

func TestFrame_Validate_AcceptsWellFormed(t *testing.T) {
	good := []Frame{
		{Type: FrameHello, DeviceID: "d", APIKey: "k"},
		{Type: FrameRequest, StreamID: "s", Method: "GET", URL: "/"},
		{Type: FrameResponse, StreamID: "s", Status: 200},
		{Type: FramePing},
		{Type: FramePong},
	}
	for i, f := range good {
		if err := f.Validate(); err != nil {
			t.Errorf("case %d: %+v expected ok, got %v", i, f, err)
		}
	}
}

func TestEncodeDecodeBody_Empty(t *testing.T) {
	if s := EncodeBody(nil); s != "" {
		t.Fatalf("empty input should encode to empty string, got %q", s)
	}
	b, err := DecodeBody("")
	if err != nil {
		t.Fatal(err)
	}
	if b != nil {
		t.Fatalf("empty input should decode to nil, got %v", b)
	}
}

func TestEncodeDecodeBody_Roundtrip(t *testing.T) {
	in := []byte{0, 1, 2, 255, 254, 253, 'h', 'i'}
	enc := EncodeBody(in)
	out, err := DecodeBody(enc)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(in, out) {
		t.Fatalf("roundtrip mismatch")
	}
}
