package room

// Permissions is a participant's grant, as the media plane sees it.
//
// Lives in this package rather than the wire layer on purpose. The room is
// what enforces these, which makes them a domain concept; the node-link
// protocol is merely the current way of shipping them about. Keeping the
// dependency pointing that way (wire format knows about the domain, never
// the reverse) is also what lets this package be tested with no control
// plane anywhere near it.
//
// The node checks these itself instead of assuming signaling already did.
// Defence in depth is close to free here, four boolean checks on paths that
// exist anyway, and the alternative is that one bug in signaling turns into
// a media-plane authorization hole (spec §38).
type Permissions struct {
	Publish      bool
	Subscribe    bool
	PublishAudio bool
	PublishVideo bool
	PublishData  bool
}

// State snapshots a room's live media session.
//
// This is what replaced polling LiveKit's RoomServiceClient. The control
// plane's Postgres row can tell you a room exists; only the node serving it
// knows who's actually connected and what they're sending.
type State struct {
	RoomID       string
	Participants []ParticipantState
}

type ParticipantState struct {
	ParticipantID string
	SessionID     string
	JoinedAtUnix  int64
	PeerState     string
	Tracks        []TrackState
}

type TrackState struct {
	TrackID   string
	Kind      string
	Source    string
	Muted     bool
	Simulcast bool
}
