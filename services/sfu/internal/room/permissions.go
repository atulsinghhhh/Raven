package room

// Permissions is a participant's grant, as the media plane sees it.
//
// Owned by this package rather than by the wire layer on purpose: the room
// enforces these, so they are a domain concept, and the node-link protocol
// is one (current) way of transporting them. That direction of dependency
// — wire format knows about the domain, never the reverse — is also what
// keeps this package testable without a control plane.
//
// The node checks these itself rather than trusting that signaling already
// did. Defence in depth is nearly free here (four boolean checks on paths
// that already exist), and the alternative is that a bug in signaling
// becomes a media-plane authorization hole (spec §38).
type Permissions struct {
	Publish      bool
	Subscribe    bool
	PublishAudio bool
	PublishVideo bool
	PublishData  bool
}

// State is a snapshot of a room's live media session.
//
// This is what replaced polling LiveKit's RoomServiceClient: the control
// plane's Postgres row says a room exists, and only the node serving it can
// say who is actually connected and what they are sending.
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
