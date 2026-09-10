package room

import (
	"fmt"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

// The node's codec table, and the payload types it puts them on.
//
// This is Pion's RegisterDefaultCodecs list with one deliberate change: H265
// sits on 49/50 rather than 116/117. We spell the table out instead of
// calling RegisterDefaultCodecs because a MediaEngine has no way to move a
// codec after the fact, and the numbering is the entire point.
//
// A payload type is a permanent binding for the life of a PeerConnection.
// MediaEngine.updateFromRemoteDescription accumulates the codecs from every
// remote description a connection has ever applied, and addCodec fails with
// ErrCodecAlreadyRegistered the moment one of them gives a payload type a
// different codec than an earlier one did. SetRemoteDescription has already
// committed the signaling-state transition by the time that error comes
// back, so the connection is left in have-remote-offer and every round
// after it fails too. One clash ends the call, not the round.
//
// Chrome puts H264 (packetization-mode=1, profile-level-id=4d001f) on 116
// and H265 on 49. Pion's default table puts H265 on 116. Whichever
// numbering a connection negotiates first, a later description carrying the
// other one is fatal — and a browser sends its own numbering whenever it
// presents a PeerConnection that never applied a description from us.
// Matching Chrome on 49/50 makes the two tables agree, so it cannot happen.
//
// Everything else already agrees with Chrome, and the numbers Pion uses that
// Chrome doesn't (105, 106, 112, 113, 125, 127) are unclaimed on both sides.
// codec_payload_test.go holds the whole comparison and fails if that stops
// being true.
const (
	// payloadTypeH265 and payloadTypeH265RTX are the two that moved.
	payloadTypeH265    webrtc.PayloadType = 49
	payloadTypeH265RTX webrtc.PayloadType = 50
)

// videoFeedback is what we ask for on every video codec: the RTCP that
// standards-compliant recovery is built out of (spec §9).
var videoFeedback = []webrtc.RTCPFeedback{
	{Type: "goog-remb"},
	{Type: "ccm", Parameter: "fir"},
	{Type: "nack"},
	{Type: "nack", Parameter: "pli"},
}

func audioCodecs() []webrtc.RTPCodecParameters {
	return []webrtc.RTPCodecParameters{
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
				SDPFmtpLine: "minptime=10;useinbandfec=1",
			},
			PayloadType: 111,
		},
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeG722, ClockRate: 8000},
			PayloadType:        rtp.PayloadTypeG722,
		},
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypePCMU, ClockRate: 8000},
			PayloadType:        rtp.PayloadTypePCMU,
		},
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypePCMA, ClockRate: 8000},
			PayloadType:        rtp.PayloadTypePCMA,
		},
	}
}

func videoCodecs() []webrtc.RTPCodecParameters {
	h264 := func(pt webrtc.PayloadType, fmtpLine string) webrtc.RTPCodecParameters {
		return webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeH264, ClockRate: 90000,
				SDPFmtpLine: fmtpLine, RTCPFeedback: videoFeedback,
			},
			PayloadType: pt,
		}
	}
	rtx := func(pt, apt webrtc.PayloadType) webrtc.RTPCodecParameters {
		return webrtc.RTPCodecParameters{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeRTX, ClockRate: 90000,
				SDPFmtpLine: fmt.Sprintf("apt=%d", apt),
			},
			PayloadType: pt,
		}
	}

	return []webrtc.RTPCodecParameters{
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeVP8, ClockRate: 90000, RTCPFeedback: videoFeedback,
			},
			PayloadType: 96,
		},
		rtx(97, 96),

		h264(102, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f"),
		rtx(103, 102),
		h264(104, "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f"),
		rtx(105, 104),
		h264(106, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f"),
		rtx(107, 106),
		h264(108, "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f"),
		rtx(109, 108),
		h264(127, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f"),
		rtx(125, 127),
		h264(39, "level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f"),
		rtx(40, 39),

		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeH265, ClockRate: 90000, RTCPFeedback: videoFeedback,
			},
			PayloadType: payloadTypeH265,
		},
		rtx(payloadTypeH265RTX, payloadTypeH265),

		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeAV1, ClockRate: 90000, RTCPFeedback: videoFeedback,
			},
			PayloadType: 45,
		},
		rtx(46, 45),

		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeVP9, ClockRate: 90000,
				SDPFmtpLine: "profile-id=0", RTCPFeedback: videoFeedback,
			},
			PayloadType: 98,
		},
		rtx(99, 98),
		{
			RTPCodecCapability: webrtc.RTPCodecCapability{
				MimeType: webrtc.MimeTypeVP9, ClockRate: 90000,
				SDPFmtpLine: "profile-id=2", RTCPFeedback: videoFeedback,
			},
			PayloadType: 100,
		},
		rtx(101, 100),

		h264(112, "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f"),
		rtx(113, 112),
	}
}

// newMediaEngine builds the node's codec table.
func newMediaEngine() (*webrtc.MediaEngine, error) {
	engine := &webrtc.MediaEngine{}
	for _, codec := range audioCodecs() {
		if err := engine.RegisterCodec(codec, webrtc.RTPCodecTypeAudio); err != nil {
			return nil, fmt.Errorf("register audio codec %s on %d: %w", codec.MimeType, codec.PayloadType, err)
		}
	}
	for _, codec := range videoCodecs() {
		if err := engine.RegisterCodec(codec, webrtc.RTPCodecTypeVideo); err != nil {
			return nil, fmt.Errorf("register video codec %s on %d: %w", codec.MimeType, codec.PayloadType, err)
		}
	}
	return engine, nil
}
