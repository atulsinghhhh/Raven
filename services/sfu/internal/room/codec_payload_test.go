package room

import (
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

// chromeNativeOffer is an offer as Chrome writes one from a *fresh*
// PeerConnection: one that has never applied a description from this SFU,
// so it carries Chrome's own payload-type numbering rather than ours.
// Candidates, ssrc and feedback lines are stripped; the payload map is the
// whole point of the fixture.
//
// The line that matters is a=rtpmap:116 H264/90000. Pion's default codec
// table binds 116 to H265 instead, and a MediaEngine that has already
// negotiated 116 as H265 rejects this entire description with
// ErrCodecAlreadyRegistered.
const chromeNativeOffer = `
v=0
o=- 5820690415918748746 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0 1
m=audio 9 UDP/TLS/RTP/SAVPF 111 63 9 0 8 13 110 126
c=IN IP4 0.0.0.0
a=ice-ufrag:9PfG
a=ice-pwd:51MbgVx82Mx+0GZdIVIkBoME
a=ice-options:trickle
a=fingerprint:sha-256 B2:7A:93:94:57:96:6F:04:B5:DF:A6:FA:B2:4E:BC:0A:F2:0D:43:98:B9:FD:26:FA:CA:71:7F:58:CC:E8:03:0B
a=setup:actpass
a=mid:0
a=sendrecv
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:111 opus/48000/2
a=fmtp:111 minptime=10;useinbandfec=1
a=rtpmap:63 red/48000/2
a=fmtp:63 111/111
a=rtpmap:9 G722/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:13 CN/8000
a=rtpmap:110 telephone-event/48000
a=rtpmap:126 telephone-event/8000
m=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104 107 108 109 114 115 116 117 39 40 45 46 98 99 100 101 118 119 49 50 122 123 124
c=IN IP4 0.0.0.0
a=ice-ufrag:9PfG
a=ice-pwd:51MbgVx82Mx+0GZdIVIkBoME
a=ice-options:trickle
a=fingerprint:sha-256 B2:7A:93:94:57:96:6F:04:B5:DF:A6:FA:B2:4E:BC:0A:F2:0D:43:98:B9:FD:26:FA:CA:71:7F:58:CC:E8:03:0B
a=setup:actpass
a=mid:1
a=sendrecv
a=rtcp-mux
a=rtcp-rsize
a=rtpmap:96 VP8/90000
a=rtpmap:97 rtx/90000
a=fmtp:97 apt=96
a=rtpmap:102 H264/90000
a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f
a=rtpmap:103 rtx/90000
a=fmtp:103 apt=102
a=rtpmap:104 H264/90000
a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42001f
a=rtpmap:107 rtx/90000
a=fmtp:107 apt=104
a=rtpmap:108 H264/90000
a=fmtp:108 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f
a=rtpmap:109 rtx/90000
a=fmtp:109 apt=108
a=rtpmap:114 H264/90000
a=fmtp:114 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f
a=rtpmap:115 rtx/90000
a=fmtp:115 apt=114
a=rtpmap:116 H264/90000
a=fmtp:116 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f
a=rtpmap:117 rtx/90000
a=fmtp:117 apt=116
a=rtpmap:39 H264/90000
a=fmtp:39 level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=4d001f
a=rtpmap:40 rtx/90000
a=fmtp:40 apt=39
a=rtpmap:45 AV1/90000
a=fmtp:45 level-idx=5;profile=0;tier=0
a=rtpmap:46 rtx/90000
a=fmtp:46 apt=45
a=rtpmap:98 VP9/90000
a=fmtp:98 profile-id=0
a=rtpmap:99 rtx/90000
a=fmtp:99 apt=98
a=rtpmap:100 VP9/90000
a=fmtp:100 profile-id=2
a=rtpmap:101 rtx/90000
a=fmtp:101 apt=100
a=rtpmap:118 H264/90000
a=fmtp:118 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64001f
a=rtpmap:119 rtx/90000
a=fmtp:119 apt=118
a=rtpmap:49 H265/90000
a=fmtp:49 level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST
a=rtpmap:50 rtx/90000
a=fmtp:50 apt=49
a=rtpmap:122 red/90000
a=rtpmap:123 rtx/90000
a=fmtp:123 apt=122
a=rtpmap:124 ulpfec/90000
`

// normalizeSDP gives a fixture the CRLF line endings an SDP parser expects.
func normalizeSDP(sdp string) string {
	return strings.ReplaceAll(strings.TrimSpace(sdp), "\n", "\r\n") + "\r\n"
}

// TestPayloadTypesDoNotClashWithChrome pins the node's payload-type map
// against the one Chrome writes.
//
// Pion's MediaEngine treats a payload type as a permanent binding for the
// life of a PeerConnection: mediaengine.addCodec fails with
// ErrCodecAlreadyRegistered the moment a second remote description gives an
// already-negotiated payload type a different codec, and
// PeerConnection.SetRemoteDescription has committed the signaling-state
// transition by then. So a single clash doesn't cost one round — it wedges
// the connection in have-remote-offer for good.
//
// Nothing in the offer/answer exchange renumbers a payload type, which is
// why this has to be checked statically. If a codec is registered on a
// number a browser uses for something else, the two only ever agree by
// luck.
func TestPayloadTypesDoNotClashWithChrome(t *testing.T) {
	// Every payload type Chrome 151 assigns from a fresh PeerConnection,
	// taken from chromeNativeOffer above.
	chrome := map[webrtc.PayloadType]string{
		111: webrtc.MimeTypeOpus, 9: webrtc.MimeTypeG722,
		0: webrtc.MimeTypePCMU, 8: webrtc.MimeTypePCMA,
		96: webrtc.MimeTypeVP8, 97: webrtc.MimeTypeRTX,
		102: webrtc.MimeTypeH264, 103: webrtc.MimeTypeRTX,
		104: webrtc.MimeTypeH264, 107: webrtc.MimeTypeRTX,
		108: webrtc.MimeTypeH264, 109: webrtc.MimeTypeRTX,
		114: webrtc.MimeTypeH264, 115: webrtc.MimeTypeRTX,
		116: webrtc.MimeTypeH264, 117: webrtc.MimeTypeRTX,
		39: webrtc.MimeTypeH264, 40: webrtc.MimeTypeRTX,
		45: webrtc.MimeTypeAV1, 46: webrtc.MimeTypeRTX,
		98: webrtc.MimeTypeVP9, 99: webrtc.MimeTypeRTX,
		100: webrtc.MimeTypeVP9, 101: webrtc.MimeTypeRTX,
		118: webrtc.MimeTypeH264, 119: webrtc.MimeTypeRTX,
		49: webrtc.MimeTypeH265, 50: webrtc.MimeTypeRTX,
	}

	// Registering the table is itself part of the check: RegisterCodec
	// rejects a table that puts two codecs on one number.
	if _, err := newMediaEngine(); err != nil {
		t.Fatalf("build media engine: %v", err)
	}

	ours := append(audioCodecs(), videoCodecs()...)
	for _, codec := range ours {
		theirs, shared := chrome[codec.PayloadType]
		if !shared {
			continue
		}
		if !strings.EqualFold(theirs, codec.MimeType) {
			t.Errorf("payload type %d is %s here and %s in Chrome; "+
				"a call that sees both numberings wedges on ErrCodecAlreadyRegistered",
				codec.PayloadType, codec.MimeType, theirs)
		}
	}
}

// TestParticipantAcceptsAnOfferNumberedByChrome is the end-to-end version.
//
// A participant joins normally, so the SFU's own numbering is what gets
// negotiated. Then an offer arrives carrying Chrome's numbering — which is
// what the SFU sees whenever a browser presents a PeerConnection that never
// applied one of our descriptions. Before the payload map was aligned this
// failed with "codec already registered for same payload type" and left the
// connection unable to negotiate ever again.
func TestParticipantAcceptsAnOfferNumberedByChrome(t *testing.T) {
	h := newHarness(t)
	client := h.join("room", "publisher", "session", Permissions{Publish: true, Subscribe: true}, nil)

	if _, err := client.participant.AcceptOffer(normalizeSDP(chromeNativeOffer)); err != nil {
		t.Fatalf("offer with Chrome's payload numbering rejected: %v", err)
	}

	// And the connection is still usable, which is the part a retry would
	// have hidden: a wedged PeerConnection sits in have-remote-offer and
	// fails every round after the first.
	if state := client.participant.pc.SignalingState(); state != webrtc.SignalingStateStable {
		t.Fatalf("signaling state after the offer is %s, want stable", state)
	}
}
