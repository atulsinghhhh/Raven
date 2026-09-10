package signal

import (
	"fmt"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"
)

// awaitWithin is await without the t.Fatalf, for callers that want to
// report a timeout themselves rather than end the test on the spot.
func (p *fakeControlPlane) awaitWithin(timeout time.Duration, match func(Frame) bool) (Frame, bool) {
	deadline := time.After(timeout)
	for {
		p.mu.Lock()
		for _, frame := range p.received {
			if match(frame) {
				p.mu.Unlock()

				return frame, true
			}
		}
		waiter := make(chan Frame, 1)
		p.waiters = append(p.waiters, waiter)
		p.mu.Unlock()

		select {
		case <-waiter:
		case <-deadline:
			return Frame{}, false
		}
	}
}

// clientOffer builds an offer the way a publishing client would.
func clientOffer(t *testing.T) string {
	t.Helper()

	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("client peer connection: %v", err)
	}
	defer func() { _ = pc.Close() }()

	if _, err := pc.AddTrack(testVideoTrack(t, "cam", "stream")); err != nil {
		t.Fatalf("add track: %v", err)
	}
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}

	return offer.SDP
}

// TestSessionFramesAreHandledInArrivalOrder pins the ordering guarantee the
// node link gives a session.
//
// A session's frames arrive on one WebSocket in the order the client sent
// them, and they have to be handled that way. They used to get a goroutine
// each, which handled them in whatever order the scheduler picked.
//
// The test sends participant.add and a client offer back to back. Building
// a PeerConnection takes long enough that a concurrently dispatched offer
// loses the race every time and gets answered "no such session on this
// node" — a published track silently dropped on the floor. Handled in
// order, the offer waits for the participant to exist and gets the glare
// refusal it deserves, which the SDK knows to retry.
func TestSessionFramesAreHandledInArrivalOrder(t *testing.T) {
	_, _, url := newLinkServer(t)

	const rounds = 20
	for i := range rounds {
		plane, err := dialLink(t, url, linkSecret)
		if err != nil {
			t.Fatalf("dial link: %v", err)
		}
		session := fmt.Sprintf("ordered-%d", i)

		offer := clientOffer(t)

		plane.send(mustFrame(t, TypeParticipantAdd, session, "ordered-room", ParticipantAddPayload{
			ParticipantID: session,
			Permissions: Permissions{
				Publish: true, Subscribe: true, PublishAudio: true, PublishVideo: true,
			},
		}))
		plane.send(mustFrame(t, TypeSDPOfferFromClient, session, "ordered-room",
			SDPPayload{SDP: offer, Type: "offer"}))

		verdict, ok := plane.awaitWithin(frameWait, func(f Frame) bool {
			return f.SessionID == session &&
				(f.Type == TypeError || f.Type == TypeSDPAnswerToClient)
		})
		if !ok {
			t.Fatalf("round %d: no verdict on the client offer", i)
		}
		if verdict.Type != TypeError {
			continue // applied, which means it certainly waited for the add
		}

		payload := payloadOf[ErrorPayload](t, verdict)
		if payload.Code == ErrCodeUnknownSession {
			t.Fatalf("round %d: the offer was handled before the participant.add that "+
				"precedes it on the wire — a session's frames are being handled out of order",
				i)
		}
		if payload.Code != ErrCodeGlare {
			t.Fatalf("round %d: unexpected refusal %s: %s", i, payload.Code, payload.Message)
		}
	}
}

// TestGlareOfferIsRefusedNotApplied covers the sequence the ordering bug
// actually broke.
//
// A client that glares sends its offer, then — having rolled that offer
// back and answered ours — an answer. Our offer is outstanding throughout,
// so the client's must come back as glare. Applied out of order, the answer
// landed first, ended the round trip, and the abandoned offer behind it
// then passed the glare check and was applied on top of the description
// that had just superseded it.
func TestGlareOfferIsRefusedNotApplied(t *testing.T) {
	_, _, url := newLinkServer(t)

	plane, err := dialLink(t, url, linkSecret)
	if err != nil {
		t.Fatalf("dial link: %v", err)
	}
	const session = "glare-1"

	plane.send(mustFrame(t, TypeParticipantAdd, session, "glare-room", ParticipantAddPayload{
		ParticipantID: "publisher",
		Permissions: Permissions{
			Publish: true, Subscribe: true, PublishAudio: true, PublishVideo: true,
		},
	}))
	sfuOffer := payloadOf[SDPPayload](t, plane.awaitType(TypeSDPOffer, session))

	client, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("client peer connection: %v", err)
	}
	defer func() { _ = client.Close() }()

	// The offer the client made before ours reached it, and then abandoned.
	if _, err := client.AddTrack(testVideoTrack(t, "cam", "stream")); err != nil {
		t.Fatalf("add track: %v", err)
	}
	superseded, err := client.CreateOffer(nil)
	if err != nil {
		t.Fatalf("create offer: %v", err)
	}

	// Rolling back and answering ours instead.
	if err := client.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer, SDP: sfuOffer.SDP,
	}); err != nil {
		t.Fatalf("apply the sfu offer: %v", err)
	}
	answer, err := client.CreateAnswer(nil)
	if err != nil {
		t.Fatalf("create answer: %v", err)
	}
	if err := client.SetLocalDescription(answer); err != nil {
		t.Fatalf("set the answer: %v", err)
	}

	plane.send(mustFrame(t, TypeSDPOfferFromClient, session, "glare-room",
		SDPPayload{SDP: superseded.SDP, Type: "offer"}))
	plane.send(mustFrame(t, TypeSDPAnswer, session, "glare-room",
		SDPPayload{SDP: answer.SDP, Type: "answer"}))

	verdict, ok := plane.awaitWithin(frameWait, func(f Frame) bool {
		return f.SessionID == session &&
			(f.Type == TypeError || f.Type == TypeSDPAnswerToClient)
	})
	if !ok {
		t.Fatal("no verdict on the superseded offer")
	}
	if verdict.Type == TypeSDPAnswerToClient {
		t.Fatal("the superseded offer was applied; it should have been refused as glare")
	}
	if payload := payloadOf[ErrorPayload](t, verdict); payload.Code != ErrCodeGlare {
		t.Fatalf("superseded offer refused with %s (%s), want glare", payload.Code, payload.Message)
	}
}
