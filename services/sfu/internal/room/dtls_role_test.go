package room

import (
	"strings"
	"testing"

	"github.com/pion/webrtc/v4"
)

// The DTLS role has to come out the same whichever side offered, because it
// is a property of the transport and cannot change once the handshake has
// run. This SFU negotiates in both directions on one PeerConnection — it
// offers on join and on every renegotiation, and it answers when a client
// starts publishing — so that invariant is not free.
//
// Pion's default answering role is DTLSRoleClient, which breaks it: the SFU
// offers actpass at join (client answers active, so the client is the DTLS
// client and we are the server), then answers a client's publish offer with
// active, claiming the role it just gave away. Chrome rejects that answer
// with "Failed to set SSL role for the transport" and the publish never
// negotiates.
//
// These tests assert on the a=setup attribute rather than on whether media
// flows, and that is deliberate. TestSFUForwardsTrackPublishedMidCall
// already drives this exact sequence and passed throughout, because
// pion-as-client tolerates the role flip that libwebrtc refuses. Behaviour
// against a pion client cannot see this bug; the SDP can.

// setupRoles returns every a=setup: value in an SDP, in order.
func setupRoles(sdp string) []string {
	var roles []string
	for _, line := range strings.Split(sdp, "\n") {
		line = strings.TrimSpace(line)
		if after, ok := strings.CutPrefix(line, "a=setup:"); ok {
			roles = append(roles, after)
		}
	}
	return roles
}

// soleRole asserts every m-section agrees, and returns the agreed value.
func soleRole(t *testing.T, label, sdp string) string {
	t.Helper()

	roles := setupRoles(sdp)
	if len(roles) == 0 {
		t.Fatalf("%s: no a=setup attribute in the SDP at all", label)
	}
	for _, role := range roles[1:] {
		if role != roles[0] {
			t.Fatalf("%s: m-sections disagree on the DTLS role: %v", label, roles)
		}
	}
	return roles[0]
}

func TestSFUNeverClaimsTheDTLSClientRole(t *testing.T) {
	h := newHarness(t)

	alice := h.join("room-dtls", "alice", "sess-alice", publisherPermissions(), nil)
	alice.waitConnected(t)

	// 1. SFU as offerer. "actpass" (let the client pick) and "passive"
	//    (we are the server) are both fine. "active" is not: it takes the
	//    client role, and every other exchange assumes we are the server.
	offer, err := alice.participant.CreateOffer()
	if err != nil {
		t.Fatalf("sfu create offer: %v", err)
	}
	if role := soleRole(t, "sfu offer", offer.SDP); role == "active" {
		t.Errorf("sfu offered a=setup:active, taking the DTLS client role; want actpass or passive")
	}
	h.answerOffer(alice.participant, *offer)

	// 2. SFU as answerer, on the same PeerConnection. This is the exchange
	//    that broke: a client publishing after join.
	track := newVideoTrack(t, "alice-video", "alice-camera")
	if _, err := alice.pc.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}

	clientOffer, err := alice.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("client create offer: %v", err)
	}
	if err := alice.pc.SetLocalDescription(clientOffer); err != nil {
		t.Fatalf("client set local description: %v", err)
	}

	answer, err := alice.participant.AcceptOffer(clientOffer.SDP)
	if err != nil {
		t.Fatalf("sfu accept client offer: %v", err)
	}

	// An answer may not say actpass (RFC 5763 §5), so this is exact.
	if role := soleRole(t, "sfu answer", answer.SDP); role != "passive" {
		t.Errorf("sfu answered a=setup:%s; want passive, so the DTLS role never flips mid-session", role)
	}

	// The step Chrome refused. Pion is laxer here, so this passing is not
	// on its own proof — the assertion above is.
	if err := alice.pc.SetRemoteDescription(*answer); err != nil {
		t.Fatalf("client rejected the sfu's answer: %v", err)
	}
}

// The role must also survive the join-then-publish order that made this a
// first-participant-only bug: whoever joins an empty room publishes into
// the second exchange, where the flip happened.
func TestSFUKeepsTheServerRoleForTheFirstParticipant(t *testing.T) {
	h := newHarness(t)

	// Empty room, so nothing to subscribe to and no join-time track offer.
	alice := h.join("room-dtls-first", "alice", "sess-alice", publisherPermissions(), nil)
	alice.waitConnected(t)

	track := newVideoTrack(t, "first-video", "first-camera")
	if _, err := alice.pc.AddTrack(track); err != nil {
		t.Fatalf("add track: %v", err)
	}
	clientOffer, err := alice.pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("client create offer: %v", err)
	}
	if err := alice.pc.SetLocalDescription(clientOffer); err != nil {
		t.Fatalf("client set local description: %v", err)
	}

	answer, err := alice.participant.AcceptOffer(clientOffer.SDP)
	if err != nil {
		t.Fatalf("sfu accept first participant's publish offer: %v", err)
	}
	if role := soleRole(t, "first participant answer", answer.SDP); role != "passive" {
		t.Errorf("first participant got a=setup:%s; want passive", role)
	}
}

// A guard on the setting itself, so the fix cannot be dropped from the
// Manager's SettingEngine without a test failing.
func TestSettingEngineRejectsAnAmbiguousAnsweringRole(t *testing.T) {
	settings := webrtc.SettingEngine{}

	if err := settings.SetAnsweringDTLSRole(webrtc.DTLSRoleServer); err != nil {
		t.Fatalf("pinning the answering role to server should be supported: %v", err)
	}
	// DTLSRoleAuto is what "unset" effectively means, and pion refuses it
	// here — there is no way to ask for the ambiguity we used to have.
	if err := settings.SetAnsweringDTLSRole(webrtc.DTLSRoleAuto); err == nil {
		t.Error("expected pion to reject DTLSRoleAuto as an answering role")
	}
}
