package room

import (
	"context"
	"testing"
)

// A subscription lives in two places: the subscriber's own map, and the
// publisher's list of who to forward to. These tests are about the two
// staying in step, because nothing downstream notices when they don't.
// Media keeps flowing to everyone who should have it, so even the mesh test
// passes; what changes is how much work a publisher does per packet and how
// many transceivers a subscriber carries.

// TestUnsubscribeTakesTheDownTrackOffThePublisher covers a subscription
// torn down from the subscriber's side.
//
// Unsubscribe used to drop its own record and close the DownTrack while
// leaving it in the publisher's list. A closed DownTrack discards whatever
// it's given, so no subscriber ever saw anything wrong — the publisher just
// copied a dead entry into its target slice for every packet it read, for
// the rest of the call. PublishedTrack.RemoveSubscriber existed for exactly
// this and had no callers.
func TestUnsubscribeTakesTheDownTrackOffThePublisher(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-unsub", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	// A track only exists at the SFU once its media turns up.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	bob := h.join("room-unsub", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	published, found := alice.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("alice's track never reached the sfu")
	}
	if ids := published.SubscriberIDs(); len(ids) != 1 || ids[0] != "bob" {
		t.Fatalf("publisher's subscribers = %v, want [bob]", ids)
	}

	if !bob.participant.Unsubscribe("alice", "alice-video") {
		t.Fatal("unsubscribe reported nothing to remove")
	}

	if ids := published.SubscriberIDs(); len(ids) != 0 {
		t.Errorf("publisher still forwarding to %v after they unsubscribed; the down track "+
			"is closed, so this costs a slice copy per packet and shows up nowhere else", ids)
	}
	if got := bob.participant.Stats().SubscribedTracks; got != 0 {
		t.Errorf("subscriber's own record = %d, want 0", got)
	}
}

// TestCloseTakesTheDownTrackOffEveryPublisher is the same invariant on the
// path a real call actually takes. Nobody calls Unsubscribe when a
// participant hangs up: the connection fails or closes, and
// Participant.Close tears the subscriptions down.
func TestCloseTakesTheDownTrackOffEveryPublisher(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-close", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	bob := h.join("room-close", "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	published, found := alice.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("alice's track never reached the sfu")
	}
	if ids := published.SubscriberIDs(); len(ids) != 1 {
		t.Fatalf("publisher's subscribers = %v, want one entry", ids)
	}

	bob.participant.Close()

	if ids := published.SubscriberIDs(); len(ids) != 0 {
		t.Errorf("publisher still forwarding to %v after they left the call", ids)
	}
}

// TestSubscribingTwiceAddsOneSender pins the dedup in Subscribe.
//
// Two callers reach it for the same pair: a joiner subscribes to everything
// already published, and a publisher fans its new track out to everyone
// already in the room. Someone joining while someone else starts publishing
// gets both.
//
// This asserts the outcome, not the interleaving. The window between
// Subscribe's check and its record is a few microseconds wide, and eight
// goroutines released together never landed inside it across twenty runs —
// so a test claiming to reproduce the concurrent case would pass whether or
// not the lock that closes it is there, which is worse than no test. What
// this does catch is the dedup being weakened or dropped, the same defect
// arriving by a route that can actually be tested.
func TestSubscribingTwiceAddsOneSender(t *testing.T) {
	h := newHarness(t)

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join("room-twice", "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpRTP(ctx, aliceTrack)
	h.awaitTrackEvent("alice", true)

	published, found := alice.participant.PublishedTrack("alice-video")
	if !found {
		t.Fatal("alice's track never reached the sfu")
	}

	// Added through the manager with no client registered, so the harness
	// never answers for her. Nothing here waits on a connection — Subscribe
	// builds the transceiver on its own.
	carol, err := h.manager.AddParticipant("room-twice", "carol", "sess-carol", publisherPermissions())
	if err != nil {
		t.Fatalf("add participant: %v", err)
	}

	for i := range 3 {
		if err := carol.Subscribe(published); err != nil {
			t.Fatalf("subscribe %d: %v", i, err)
		}
	}

	if got := carol.Stats().SubscribedTracks; got != 1 {
		t.Errorf("subscriber's own record = %d, want 1", got)
	}
	senders := 0
	for _, sender := range carol.pc.GetSenders() {
		if track := sender.Track(); track != nil && track.ID() == "alice-video" {
			senders++
		}
	}
	if senders != 1 {
		t.Errorf("senders for alice-video = %d, want 1; every extra one is an m-section "+
			"carrying a camera the subscriber already has, and a DownTrack orphaned "+
			"with nothing writing to it or closing it", senders)
	}
	if ids := published.SubscriberIDs(); len(ids) != 1 {
		t.Errorf("publisher's subscribers = %v, want one entry", ids)
	}
}
