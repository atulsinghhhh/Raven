package room

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// This file covers the has-local-offer/offerInFlight desync a live trace
// caught in production: answerTimeout fires, abandonNegotiation() clears
// offerInFlight, and the renegotiation it triggers then tries a second
// SetLocalDescription(offer) on a PeerConnection Pion never actually moved
// off its first, unanswered offer — because Pion has no legal rollback out
// of have-local-offer for the offering side. See beginNegotiation's doc
// comment for the full mechanism; these tests pin it down independently of
// the 15s answerTimeout itself, which none of them wait on.

// waitForSignalingState polls, rather than sleeping a fixed amount, so this
// is only as slow as the goroutine it's waiting on actually is.
func waitForSignalingState(t *testing.T, pc *webrtc.PeerConnection, want webrtc.SignalingState) {
	t.Helper()
	deadline := time.After(negotiationTimeout)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	for {
		if pc.SignalingState() == want {
			return
		}
		select {
		case <-deadline:
			t.Fatalf("signaling state never reached %s (stuck at %s)", want, pc.SignalingState())
		case <-ticker.C:
		}
	}
}

// Test 1 — the exact illegal transition, independent of any timer.
//
// Reproduces "have-local-offer -> SetLocalDescription(offer) ->
// InvalidModificationError" directly against a real Pion PeerConnection,
// with nothing SFU-specific involved. This is the failure mode itself;
// Test 2 covers the SFU not attempting it anymore.
func TestPionRefusesASecondLocalOfferFromHaveLocalOffer(t *testing.T) {
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer pc.Close()

	// Something to negotiate; an empty offer is otherwise legal SDP but
	// pointless to reason about.
	if _, err := pc.CreateDataChannel("probe", nil); err != nil {
		t.Fatalf("create data channel: %v", err)
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create first offer: %v", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		t.Fatalf("set first local description: %v", err)
	}
	if got := pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state = %s, want have-local-offer", got)
	}

	// No answer ever arrives — abandonNegotiation's exact situation — and
	// a second offer is attempted anyway, the way the unguarded renegotiate
	// path used to.
	second, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create second offer: %v", err)
	}
	err = pc.SetLocalDescription(second)
	if err == nil {
		t.Fatal("expected pion to refuse a second SetLocalDescription(offer) from have-local-offer, got nil")
	}
	if !strings.Contains(err.Error(), "have-local-offer") {
		t.Fatalf("expected an error naming have-local-offer, got: %v", err)
	}
	if got := pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state changed to %s after the refused offer; want it to remain have-local-offer", got)
	}
}

// Test 2 — the SFU-side guard.
//
// Puts a real Participant into exactly the corrupted state a live trace
// showed: Pion still have-local-offer from a never-answered offer, but
// offerInFlight already cleared (what endNegotiation does when
// abandonNegotiation's timer fires). Triggering renegotiation from here
// must not touch Pion at all.
func TestRenegotiationGuardRefusesWhilePionIsNotStable(t *testing.T) {
	h := newHarness(t)

	participant, err := h.manager.AddParticipant("room-guard", "alice", "sess-alice", publisherPermissions())
	if err != nil {
		t.Fatalf("add participant: %v", err)
	}

	// Claim the round exactly as a real join does, but never answer it —
	// this is the state a genuinely-lost or very-late answer leaves
	// behind.
	if _, err := participant.CreateOffer(); err != nil {
		t.Fatalf("create initial offer: %v", err)
	}
	if got := participant.pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state = %s, want have-local-offer", got)
	}

	// Simulate abandonNegotiation's endNegotiation() call: offerInFlight
	// clears, but nothing ever touches participant.pc. Same-package test,
	// so this reaches into the real fields rather than re-implementing
	// them — the point is to reproduce the exact desync, not a proxy for
	// it.
	participant.negMu.Lock()
	participant.offerInFlight = false
	participant.pendingRenegotiation = true
	participant.negMu.Unlock()

	offer, err := participant.CreateOffer()
	if !errors.Is(err, ErrNegotiationInProgress) {
		t.Fatalf("CreateOffer() while pion is not stable = (%v, %v), want (nil, ErrNegotiationInProgress)", offer, err)
	}
	if offer != nil {
		t.Fatalf("expected no offer to be produced, got one")
	}

	// The whole point: no illegal SetLocalDescription was attempted, so
	// Pion's state is untouched.
	if got := participant.pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state = %s after the guarded attempt; want it unchanged at have-local-offer", got)
	}

	// The change is still on record for whenever this participant's
	// PeerConnection genuinely returns to stable.
	participant.negMu.Lock()
	pending := participant.pendingRenegotiation
	inFlight := participant.offerInFlight
	participant.negMu.Unlock()
	if !pending {
		t.Error("pendingRenegotiation was cleared; the queued change would be lost")
	}
	if inFlight {
		t.Error("offerInFlight was set true by the guarded attempt; no round was actually claimed")
	}
}

// Test 2b — the guard must not spin. A second attempt right behind the
// first must also refuse quietly, not warn or loop: CreateOffer's caller
// (room.renegotiate) already treats ErrNegotiationInProgress as expected,
// not a failure worth logging, and nothing here should give it a reason to
// retry immediately.
func TestRenegotiationGuardDoesNotLoopOrWarn(t *testing.T) {
	h := newHarness(t)

	participant, err := h.manager.AddParticipant("room-guard-loop", "alice", "sess-alice", publisherPermissions())
	if err != nil {
		t.Fatalf("add participant: %v", err)
	}
	if _, err := participant.CreateOffer(); err != nil {
		t.Fatalf("create initial offer: %v", err)
	}
	participant.negMu.Lock()
	participant.offerInFlight = false
	participant.negMu.Unlock()

	for i := 0; i < 5; i++ {
		offer, err := participant.CreateOffer()
		if !errors.Is(err, ErrNegotiationInProgress) {
			t.Fatalf("attempt %d: got (%v, %v), want (nil, ErrNegotiationInProgress)", i, offer, err)
		}
	}
	if got := participant.pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state = %s after repeated guarded attempts; want unchanged", got)
	}
}

// Test 3 — normal negotiation from stable is unaffected.
func TestNormalNegotiationFromStableStillSucceeds(t *testing.T) {
	h := newHarness(t)
	alice := h.join("room-normal-negotiation", "alice", "sess-alice", publisherPermissions(), nil)
	alice.waitConnected(t)

	if got := alice.participant.pc.SignalingState(); got != webrtc.SignalingStateStable {
		t.Fatalf("signaling state after join = %s, want stable", got)
	}

	offer, err := alice.participant.CreateOffer()
	if err != nil {
		t.Fatalf("CreateOffer() from stable should succeed: %v", err)
	}
	if got := alice.participant.pc.SignalingState(); got != webrtc.SignalingStateHaveLocalOffer {
		t.Fatalf("signaling state after offering = %s, want have-local-offer", got)
	}

	h.answerOffer(alice.participant, *offer)
	waitForSignalingState(t, alice.participant.pc, webrtc.SignalingStateStable)
}

// Test 4 — a track change queued behind an outstanding round still gets
// its own fresh offer once the real answer lands, exactly as before this
// change: AcceptAnswer's existing endNegotiation()/OnNegotiationNeeded
// interaction is untouched by the guard, which only ever fires inside
// CreateOffer's own beginNegotiation() call.
func TestPendingRenegotiationStillFlushesAfterARealAnswer(t *testing.T) {
	h := newHarness(t)
	alice := h.join("room-pending-renegotiation", "alice", "sess-alice", publisherPermissions(), nil)
	alice.waitConnected(t)

	offer, err := alice.participant.CreateOffer()
	if err != nil {
		t.Fatalf("create second-round offer: %v", err)
	}

	// A change queued while that offer is still outstanding — the same
	// shape as enableCamera(); enableMicrophone() landing back to back.
	if alice.participant.beginNegotiation() {
		t.Fatal("beginNegotiation() succeeded while a round was genuinely outstanding")
	}
	alice.participant.negMu.Lock()
	pendingBeforeAnswer := alice.participant.pendingRenegotiation
	alice.participant.negMu.Unlock()
	if !pendingBeforeAnswer {
		t.Fatal("pendingRenegotiation was not recorded for the queued change")
	}

	h.answerOffer(alice.participant, *offer)
	waitForSignalingState(t, alice.participant.pc, webrtc.SignalingStateStable)
	sdpAfterSecondRound := alice.participant.pc.CurrentLocalDescription().SDP

	// AcceptAnswer's own endNegotiation() sees pendingRenegotiation and
	// spawns a fresh renegotiate() asynchronously (room.go's
	// OnNegotiationNeeded -> CreateOffer -> the harness's own OnOffer,
	// which answers it the way a client would) — wait for that third
	// round's local description to actually commit, rather than asserting
	// immediately. Pion bumps the SDP's o= session version on every
	// renegotiation, so a genuinely fresh committed offer is guaranteed to
	// differ from the second round's, not just coincidentally equal.
	deadline := time.After(negotiationTimeout)
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		current := alice.participant.pc.CurrentLocalDescription()
		if current != nil && current.SDP != sdpAfterSecondRound {
			break
		}
		select {
		case <-deadline:
			t.Fatal("pending renegotiation never produced a fresh committed offer after the real answer landed")
		case <-ticker.C:
		}
	}
}
