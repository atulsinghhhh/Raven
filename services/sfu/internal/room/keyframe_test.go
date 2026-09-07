package room

import "testing"

func TestIsVP8Keyframe(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{
			// Minimal descriptor (no extension), start of partition 0,
			// frame header with bit 0 clear.
			name:    "keyframe, simple descriptor",
			payload: []byte{0x10, 0x00, 0x00, 0x00},
			want:    true,
		},
		{
			name:    "interframe, simple descriptor",
			payload: []byte{0x10, 0x01, 0x00, 0x00},
			want:    false,
		},
		{
			// A continuation packet carries no frame header, so there is no
			// keyframe bit to read — switching on it would hand the decoder
			// the middle of a picture.
			name:    "not start of partition",
			payload: []byte{0x00, 0x00, 0x00, 0x00},
			want:    false,
		},
		{
			name:    "non-zero partition index",
			payload: []byte{0x11, 0x00, 0x00, 0x00},
			want:    false,
		},
		{
			// X set, then I set with a one-byte PictureID: header is at
			// offset 3.
			name:    "keyframe behind an extended descriptor",
			payload: []byte{0x90, 0x80, 0x01, 0x00},
			want:    true,
		},
		{
			// X set, I set with the 2-byte PictureID marker (0x80 in the
			// first PictureID byte): header moves to offset 4.
			name:    "keyframe behind a two-byte picture id",
			payload: []byte{0x90, 0x80, 0x80, 0x01, 0x00},
			want:    true,
		},
		{
			// X, I(1 byte), L (TL0PICIDX), T: header at offset 5.
			name:    "keyframe behind every optional field",
			payload: []byte{0x90, 0xF0, 0x01, 0x02, 0x03, 0x00},
			want:    true,
		},
		{name: "empty payload", payload: nil, want: false},
		{
			// Truncated after the descriptor: there is no frame header, and
			// guessing "keyframe" would commit a layer switch on nothing.
			name:    "descriptor with no frame header",
			payload: []byte{0x10},
			want:    false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isKeyframe("video/VP8", test.payload); got != test.want {
				t.Errorf("isKeyframe(VP8) = %v, want %v", got, test.want)
			}
		})
	}
}

func TestIsH264Keyframe(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		want    bool
	}{
		{name: "IDR slice", payload: []byte{0x65, 0x00}, want: true},
		{name: "SPS", payload: []byte{0x67, 0x00}, want: true},
		{name: "PPS", payload: []byte{0x68, 0x00}, want: true},
		{name: "non-IDR slice", payload: []byte{0x61, 0x00}, want: false},
		{
			// Browsers commonly bundle SPS+PPS+IDR into one STAP-A, so a
			// parser that only looked at the outer NAL type would miss
			// every keyframe Chrome sends.
			name:    "STAP-A containing SPS then PPS",
			payload: []byte{0x78, 0x00, 0x02, 0x67, 0x42, 0x00, 0x02, 0x68, 0xCE},
			want:    true,
		},
		{
			name:    "STAP-A containing only non-IDR",
			payload: []byte{0x78, 0x00, 0x02, 0x61, 0x42},
			want:    false,
		},
		{
			name:    "STAP-A with a length that overruns the payload",
			payload: []byte{0x78, 0x00, 0xFF, 0x67},
			want:    false,
		},
		{
			// FU-A first fragment (S bit set) of an IDR.
			name:    "FU-A start of IDR",
			payload: []byte{0x7C, 0x85},
			want:    true,
		},
		{
			// A middle fragment is not a switch point even though the frame
			// it belongs to is a keyframe — the decoder needs the start.
			name:    "FU-A middle fragment of IDR",
			payload: []byte{0x7C, 0x05},
			want:    false,
		},
		{name: "FU-A start of non-IDR", payload: []byte{0x7C, 0x81}, want: false},
		{name: "truncated FU-A", payload: []byte{0x7C}, want: false},
		{name: "empty payload", payload: nil, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isKeyframe("video/H264", test.payload); got != test.want {
				t.Errorf("isKeyframe(H264) = %v, want %v", got, test.want)
			}
		})
	}
}

func TestIsVP9Keyframe(t *testing.T) {
	// P bit clear (no inter-picture prediction) and B bit set (start of
	// frame) means keyframe.
	if !isKeyframe("video/VP9", []byte{0x08}) {
		t.Error("expected keyframe for P=0 B=1")
	}
	if isKeyframe("video/VP9", []byte{0x48}) {
		t.Error("expected non-keyframe for P=1")
	}
	if isKeyframe("video/VP9", []byte{0x00}) {
		t.Error("expected non-keyframe when not start of frame")
	}
}

func TestIsKeyframeUnknownCodec(t *testing.T) {
	// The safe answer for an unrecognised codec is "no": a layer switch
	// simply waits, and the periodic PLI forces a keyframe eventually. The
	// unsafe answer would commit a switch mid-frame.
	if isKeyframe("video/AV1", []byte{0xFF, 0xFF}) {
		t.Error("unknown codec must not be reported as a keyframe")
	}
	if isKeyframe("audio/opus", []byte{0xFF}) {
		t.Error("audio must not be reported as a keyframe")
	}
}

func TestKeyframeDetectionIsCaseInsensitive(t *testing.T) {
	// Pion reports "video/VP8"; SDP and some stacks use other casings.
	// Getting this wrong would silently disable every layer switch.
	if !isKeyframe("video/vp8", []byte{0x10, 0x00}) {
		t.Error("lowercase mime type should still be recognised")
	}
}
