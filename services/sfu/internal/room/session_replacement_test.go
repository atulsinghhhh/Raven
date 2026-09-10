package room

import (
	"fmt"
	"io"
	"log/slog"
	"sync"
	"testing"

	"github.com/pion/webrtc/v4"
)

// Handing one identity from an old session to a new one.
//
// # The bug these exist for
//
// `AddParticipant` used to read `sessionByParticipant`, unlock, evict the
// session it found, lock again, and insert. Two joins for the same identity
// arriving together — which is exactly what a control plane does while its
// link to the node is flapping — both read the same stale session, both
// evicted it, and both inserted. What was left behind was a room whose
// reverse mapping named one session while a live PeerConnection belonged to
// another, and the cleanup that followed closed both of them. The identity
// disappeared from the room while its publisher was still sending.
//
// Nothing about that is visible from the publisher's side. It shows up one
// step later, and looking nothing like a locking bug: a viewer joining
// afterwards is offered a room with no publishers in it, correctly
// negotiates `inactive`, connects perfectly, and receives no media. That is
// the failure this guards against, so these assert the room invariant
// rather than anything about SDP.
//
// The invariant, at the end of every completed AddParticipant:
//
//	one identity → exactly one entry in participants
//	sessionByParticipant[identity] names that entry
//	every session it replaced is closed

// A viewer's grant: subscribe, never publish. Kept local rather than added
// to media_test.go's helpers so this file stands on its own.
func subscribeOnlyPermissions() Permissions {
	return Permissions{Subscribe: true}
}

func quietRoom(t *testing.T, maxParticipants int) *Room {
	t.Helper()
	return NewRoom("room-swap", maxParticipants, RoomEvents{}, slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func addSession(t *testing.T, r *Room, identity, sessionID string) *webrtc.PeerConnection {
	t.Helper()
	pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	if _, err := r.AddParticipant(identity, sessionID, publisherPermissions(), pc); err != nil {
		t.Fatalf("add %s/%s: %v", identity, sessionID, err)
	}
	return pc
}

// assertOneLiveSession checks the whole invariant for one identity, and
// returns the session that won.
func assertOneLiveSession(t *testing.T, r *Room, identity string) string {
	t.Helper()

	r.mu.Lock()
	defer r.mu.Unlock()

	held := make([]string, 0, 2)
	for sessionID, participant := range r.participants {
		if participant.ID == identity {
			held = append(held, sessionID)
		}
	}
	if len(held) != 1 {
		t.Fatalf("identity %q holds %d sessions in participants (%v), want exactly 1", identity, len(held), held)
	}

	mapped, ok := r.sessionByParticipant[identity]
	if !ok {
		t.Fatalf("identity %q has no reverse mapping, but is in participants as %q", identity, held[0])
	}
	if _, present := r.participants[mapped]; !present {
		t.Fatalf("sessionByParticipant[%q] = %q, which is not in participants", identity, mapped)
	}
	if mapped != held[0] {
		t.Fatalf("sessionByParticipant[%q] = %q but participants holds %q", identity, mapped, held[0])
	}
	return mapped
}

func TestConcurrentAddsForOneIdentityLeaveExactlyOneSession(t *testing.T) {
	// 2 is the case that actually happened in production; the larger ones
	// widen the window so the old implementation fails reliably rather than
	// occasionally.
	for _, adds := range []int{2, 10, 50} {
		t.Run(fmt.Sprintf("%d concurrent adds", adds), func(t *testing.T) {
			r := quietRoom(t, 200)
			defer r.Close()

			first := addSession(t, r, "alice", "sess-0")
			defer first.Close()

			pcs := make([]*webrtc.PeerConnection, adds)
			for i := range pcs {
				pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
				if err != nil {
					t.Fatalf("create peer connection %d: %v", i, err)
				}
				pcs[i] = pc
				defer pc.Close()
			}

			// Released together, so the adds genuinely overlap instead of
			// queueing behind each other's setup.
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := range pcs {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					// A rejection is a legitimate outcome for a losing
					// racer; a broken room is not. Only the invariant is
					// asserted.
					_, _ = r.AddParticipant("alice", fmt.Sprintf("sess-%d", i+1), publisherPermissions(), pcs[i])
				}(i)
			}
			close(start)
			wg.Wait()

			winner := assertOneLiveSession(t, r, "alice")

			// Everything the winner displaced must be shut down, or the
			// ghost the eviction exists to prevent is still in the process
			// holding a PeerConnection.
			for i := 0; i <= adds; i++ {
				sessionID := fmt.Sprintf("sess-%d", i)
				if sessionID == winner {
					continue
				}
				r.mu.Lock()
				_, stillHeld := r.participants[sessionID]
				r.mu.Unlock()
				if stillHeld {
					t.Fatalf("replaced session %q is still in the room alongside winner %q", sessionID, winner)
				}
			}
		})
	}
}

// The winner has to be a session that was actually added, not a leftover.
func TestConcurrentAddsKeepAWinnerThatCanStillBeFound(t *testing.T) {
	r := quietRoom(t, 200)
	defer r.Close()

	first := addSession(t, r, "alice", "sess-0")
	defer first.Close()

	const adds = 10
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 1; i <= adds; i++ {
		pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatalf("create peer connection %d: %v", i, err)
		}
		defer pc.Close()

		wg.Add(1)
		go func(i int, pc *webrtc.PeerConnection) {
			defer wg.Done()
			<-start
			_, _ = r.AddParticipant("alice", fmt.Sprintf("sess-%d", i), publisherPermissions(), pc)
		}(i, pc)
	}
	close(start)
	wg.Wait()

	winner := assertOneLiveSession(t, r, "alice")

	// FindParticipant is how the signalling layer resolves an inbound
	// frame, so a room that fails this looks fine internally and still
	// answers "no such session on this node".
	if _, found := r.Participant(winner); !found {
		t.Fatalf("winning session %q is not resolvable through the room", winner)
	}
	if r.Size() != 1 {
		t.Fatalf("room size is %d, want 1", r.Size())
	}
}

// The publisher surviving is the whole point: a subscriber joining after
// the churn must find something to subscribe to. This is the unit-level
// statement of what p10g-newsub.mjs checks against a real browser.
func TestASubscriberJoiningAfterIdentityChurnStillFindsThePublisher(t *testing.T) {
	r := quietRoom(t, 200)
	defer r.Close()

	first := addSession(t, r, "host", "host-0")
	defer first.Close()

	const adds = 8
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 1; i <= adds; i++ {
		pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatalf("create peer connection %d: %v", i, err)
		}
		defer pc.Close()

		wg.Add(1)
		go func(i int, pc *webrtc.PeerConnection) {
			defer wg.Done()
			<-start
			_, _ = r.AddParticipant("host", fmt.Sprintf("host-%d", i), publisherPermissions(), pc)
		}(i, pc)
	}
	close(start)
	wg.Wait()

	assertOneLiveSession(t, r, "host")

	viewerPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create viewer peer connection: %v", err)
	}
	defer viewerPC.Close()
	if _, err := r.AddParticipant("viewer", "viewer-0", subscribeOnlyPermissions(), viewerPC); err != nil {
		t.Fatalf("viewer rejected: %v", err)
	}

	// One host and one viewer. A room reporting anything else is the state
	// that produced an `inactive` offer.
	if r.Size() != 2 {
		t.Fatalf("room size is %d after the churn, want 2 (host + viewer)", r.Size())
	}
	others := r.otherParticipants("viewer-0")
	if len(others) != 1 || others[0].ID != "host" {
		got := make([]string, len(others))
		for i, o := range others {
			got[i] = o.ID
		}
		t.Fatalf("viewer sees %v, want exactly [host] — an empty room is what makes an offer inactive", got)
	}
}

// The lock now spans the hand-over, so this checks it did not turn into a
// room-wide gate on unrelated identities.
func TestConcurrentAddsForDifferentIdentitiesAllSurvive(t *testing.T) {
	const identities = 25

	r := quietRoom(t, 200)
	defer r.Close()

	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < identities; i++ {
		pc, err := webrtc.NewPeerConnection(webrtc.Configuration{})
		if err != nil {
			t.Fatalf("create peer connection %d: %v", i, err)
		}
		defer pc.Close()

		wg.Add(1)
		go func(i int, pc *webrtc.PeerConnection) {
			defer wg.Done()
			<-start
			identity := fmt.Sprintf("p-%d", i)
			if _, err := r.AddParticipant(identity, identity+"-sess", publisherPermissions(), pc); err != nil {
				t.Errorf("add %s: %v", identity, err)
			}
		}(i, pc)
	}
	close(start)
	wg.Wait()

	if r.Size() != identities {
		t.Fatalf("room size is %d, want %d — replacing one identity must not disturb another", r.Size(), identities)
	}
	for i := 0; i < identities; i++ {
		assertOneLiveSession(t, r, fmt.Sprintf("p-%d", i))
	}
}

// Re-adding the same session id must not orphan the first object: still
// wired to a PeerConnection, no longer reachable through the room.
func TestReAddingTheSameSessionIdReplacesItCleanly(t *testing.T) {
	r := quietRoom(t, 200)
	defer r.Close()

	firstPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create peer connection: %v", err)
	}
	defer firstPC.Close()
	firstParticipant, err := r.AddParticipant("alice", "sess-same", publisherPermissions(), firstPC)
	if err != nil {
		t.Fatalf("first add: %v", err)
	}

	secondPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("create second peer connection: %v", err)
	}
	defer secondPC.Close()
	secondParticipant, err := r.AddParticipant("alice", "sess-same", publisherPermissions(), secondPC)
	if err != nil {
		t.Fatalf("second add: %v", err)
	}

	assertOneLiveSession(t, r, "alice")

	held, found := r.Participant("sess-same")
	if !found {
		t.Fatal("session went missing after being re-added")
	}
	if held == firstParticipant {
		t.Fatal("the room still holds the first participant object; the second add was lost")
	}
	if held != secondParticipant {
		t.Fatal("the room holds neither the first nor the second participant object")
	}
}
