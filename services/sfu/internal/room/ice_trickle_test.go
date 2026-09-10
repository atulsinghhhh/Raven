package room

import (
	"testing"

	"github.com/pion/webrtc/v4"
)

// Trickle ICE sends a candidate and the description it belongs to as
// separate signaling messages, and nothing orders them. A client that
// gathers a host candidate quickly — which on a LAN is essentially all of
// them — sends it the instant setLocalDescription returns, well before its
// answer has been serialised, queued and delivered.
//
// Pion rejects a candidate applied with no remote description, and that
// rejection is terminal: clients don't resend, so the candidate is simply
// gone. Every one lost is a path ICE never gets to try, and on a network
// where only one path works that is the call not connecting.

// trickleCandidate is a plausible host candidate on the offer's first
// m-section. The address never has to be reachable — nothing here waits for
// connectivity, only for the candidate to be accepted rather than binned.
func trickleCandidate() webrtc.ICECandidateInit {
	mid := "0"
	index := uint16(0)
	return webrtc.ICECandidateInit{
		Candidate:     "candidate:1 1 udp 2130706431 192.0.2.1 5000 typ host",
		SDPMid:        &mid,
		SDPMLineIndex: &index,
	}
}

func TestParticipantHoldsCandidatesThatBeatTheAnswer(t *testing.T) {
	h := newHarness(t)

	// Added straight through the manager, with no client registered for
	// this session, so the harness never answers the offer. That leaves the
	// participant parked in exactly the window a trickling client hits.
	participant, err := h.manager.AddParticipant("room-trickle", "carol", "sess-carol", publisherPermissions())
	if err != nil {
		t.Fatalf("add participant: %v", err)
	}

	offer, err := participant.CreateOffer()
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}

	if err := participant.AddICECandidate(trickleCandidate()); err != nil {
		t.Fatalf("candidate arriving before the answer was rejected: %v", err)
	}

	participant.iceMu.Lock()
	buffered := len(participant.pendingRemoteCandidates)
	participant.iceMu.Unlock()
	if buffered != 1 {
		t.Fatalf("buffered candidates = %d, want 1; a candidate accepted but not kept is still a candidate lost", buffered)
	}

	// Now the answer turns up, and with it something to attach the
	// candidate to.
	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create client peer connection: %v", err)
	}
	defer func() { _ = client.Close() }()

	if err := client.SetRemoteDescription(*offer); err != nil {
		t.Fatalf("client set remote description: %v", err)
	}
	answer, err := client.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("client create answer: %v", err)
	}
	if err := client.SetLocalDescription(answer); err != nil {
		t.Fatalf("client set local description: %v", err)
	}
	if err := participant.AcceptAnswer(answer.SDP); err != nil {
		t.Fatalf("accept answer: %v", err)
	}

	participant.iceMu.Lock()
	remaining := len(participant.pendingRemoteCandidates)
	participant.iceMu.Unlock()
	if remaining != 0 {
		t.Errorf("buffered candidates after the answer = %d, want 0; the answer has to drain the buffer or the candidates wait forever", remaining)
	}

	// Once there's a remote description the buffer stops being involved and
	// candidates go straight to ICE.
	if err := participant.AddICECandidate(trickleCandidate()); err != nil {
		t.Fatalf("candidate arriving after the answer was rejected: %v", err)
	}
	participant.iceMu.Lock()
	afterwards := len(participant.pendingRemoteCandidates)
	participant.iceMu.Unlock()
	if afterwards != 0 {
		t.Errorf("buffered candidates = %d after the description was set, want 0", afterwards)
	}
}
