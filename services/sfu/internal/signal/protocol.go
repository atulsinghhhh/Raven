// Package signal defines and serves the node link — the WebSocket between
// Raven's control plane and this SFU node.
//
// # Why a node link at all
//
// Clients never talk to the SFU's signaling directly. They hold one
// WebSocket to the Raven API, and the API relays negotiation to whichever
// SFU was allocated for their room. That indirection is the whole point:
// it is what lets the media plane be re-shaped, re-deployed, or replaced
// without an SDK release, because no client ever learned an SFU's address
// or protocol. Media itself, of course, goes straight from the client to
// this node over WebRTC — only *control* takes the longer path.
//
// # Why one connection per node, not per participant
//
// The link is bidirectional: the SFU has to initiate renegotiation
// whenever a room's track set changes, which is not a response to anything
// the client did. A request/response HTTP API cannot express that without
// polling or callbacks, and one WebSocket per participant would mean
// thousands of connections between two processes to carry very little
// traffic. So it is one multiplexed link per node, and every frame names
// the session it concerns.
package signal

import (
	"encoding/json"

	"github.com/corvidhq/raven/services/sfu/internal/room"
)

// Frame is the envelope every node-link message travels in.
//
// `SessionID` identifies one client connection — the control plane's own
// connection id, reused here so a log line on either side of the link can
// be joined to the other without a translation table.
type Frame struct {
	Type      MessageType     `json:"type"`
	SessionID string          `json:"sessionId,omitempty"`
	RoomID    string          `json:"roomId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`

	// RequestID correlates a query with its reply.
	//
	// Separate from SessionID on purpose. Session-scoped frames bind a
	// session to the link they arrived on (see server.go), so using a
	// session id to correlate a query would register a session that does
	// not exist and then have it swept as an orphan. A query is not about
	// a participant, so it gets its own identifier.
	RequestID string `json:"requestId,omitempty"`
}

type MessageType string

const (
	// --- Control plane → SFU -------------------------------------------

	// TypeParticipantAdd asks the node to create a PeerConnection for a
	// participant. The node answers with TypeSDPOffer.
	TypeParticipantAdd MessageType = "participant.add"
	// TypeParticipantRemove tears down a participant's PeerConnection and
	// unpublishes their tracks.
	TypeParticipantRemove MessageType = "participant.remove"
	// TypeSDPAnswer carries a client's answer to an SFU-initiated offer.
	TypeSDPAnswer MessageType = "sdp.answer"
	// TypeSDPOfferFromClient carries a client-initiated offer — what a
	// client sends when it starts publishing. Named distinctly from the
	// SFU's own TypeSDPOffer so a frame's direction is unambiguous from
	// its type alone, rather than depending on which side read it.
	TypeSDPOfferFromClient MessageType = "sdp.offer.client"
	// TypeICECandidate flows both ways; the direction is implied by which
	// side sent it.
	TypeICECandidate MessageType = "ice.candidate"
	// TypeTrackMute tells the node a publisher muted a track, so it can
	// stop forwarding it without tearing the track down.
	TypeTrackMute MessageType = "track.mute"
	// TypeTrackSource declares what a track being published is *of*.
	//
	// WebRTC has no notion of source, and a browser page cannot choose the
	// MediaStream or MediaStreamTrack id that ends up in the SDP — both
	// are read-only. So codec kind is all this node could otherwise infer
	// from, and that cannot tell a screen share from a camera. The client
	// declares it before negotiating; the declaration is held against the
	// track id and applied when the media arrives.
	TypeTrackSource MessageType = "track.source"
	// TypeSubscriptionUpdate changes which simulcast layer a subscriber
	// receives for one publisher's video.
	TypeSubscriptionUpdate MessageType = "subscription.update"
	// TypeRoomClose evicts a whole room — an admin action.
	TypeRoomClose MessageType = "room.close"
	// TypeRoomState asks for a snapshot of a room's live participants and
	// tracks. This is what replaced polling LiveKit's RoomServiceClient.
	TypeRoomState MessageType = "room.state"
	// TypeSessionKeepalive re-binds an idle session to the link it arrives
	// on. Sessions are owned by the link that created them (see
	// server.go); without this, a session with no negotiation traffic
	// would stay orphaned after a link reconnect until it was swept.
	TypeSessionKeepalive MessageType = "session.keepalive"

	// --- SFU → control plane -------------------------------------------

	// TypeSDPOffer is an SFU-initiated offer. Sent on join and again
	// whenever the room's track set changes, since the SFU owns the
	// subscriber side of every PeerConnection.
	TypeSDPOffer MessageType = "sdp.offer"
	// TypeSDPAnswerToClient answers a client-initiated offer.
	TypeSDPAnswerToClient MessageType = "sdp.answer.sfu"
	// TypeTrackPublished/Unpublished report what a participant is actually
	// sending, as observed on the wire — not what they claimed they would
	// send.
	TypeTrackPublished   MessageType = "track.published"
	TypeTrackUnpublished MessageType = "track.unpublished"
	// TypeConnectionState reports real ICE/DTLS progress for one session,
	// so the control plane's telemetry reflects the media plane rather
	// than guessing from the WebSocket's health.
	TypeConnectionState MessageType = "connection.state"
	// TypeParticipantStats carries the SFU's own measurement of a
	// participant's connection — the vantage point a client cannot have,
	// since the node sees every leg of the room.
	TypeParticipantStats MessageType = "participant.stats"
	// TypeRoomStateResult answers TypeRoomState.
	TypeRoomStateResult MessageType = "room.state.result"
	// TypeError reports that a frame could not be carried out. Always
	// carries the session it concerns, so the control plane can fail one
	// participant rather than assuming the node is broken.
	TypeError MessageType = "error"
)

// Permissions is the wire form of a participant's grant.
//
// A separate type from room.Permissions, and deliberately so: this one has
// JSON tags and is part of a contract two processes must agree on, while
// the domain type is free to change shape. `ToDomain` is the one place the
// two are related.
type Permissions struct {
	Publish      bool `json:"publish"`
	Subscribe    bool `json:"subscribe"`
	PublishAudio bool `json:"publishAudio"`
	PublishVideo bool `json:"publishVideo"`
	PublishData  bool `json:"publishData"`
}

func (p Permissions) ToDomain() room.Permissions {
	return room.Permissions{
		Publish:      p.Publish,
		Subscribe:    p.Subscribe,
		PublishAudio: p.PublishAudio,
		PublishVideo: p.PublishVideo,
		PublishData:  p.PublishData,
	}
}

type ParticipantAddPayload struct {
	ParticipantID string      `json:"participantId"`
	Permissions   Permissions `json:"permissions"`
	// ICEServers the *client* should use, forwarded so the node can include
	// them in the offer's context. The node does not relay through these
	// itself.
	ICEServers []ICEServer `json:"iceServers,omitempty"`
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type SDPPayload struct {
	SDP string `json:"sdp"`
	// Type is "offer" or "answer" — carried explicitly rather than inferred
	// from the frame type, so a mismatched pair fails loudly at
	// SetRemoteDescription instead of silently half-negotiating.
	Type string `json:"type"`
}

type ICECandidatePayload struct {
	Candidate     string  `json:"candidate"`
	SDPMid        *string `json:"sdpMid,omitempty"`
	SDPMLineIndex *uint16 `json:"sdpMLineIndex,omitempty"`
	UsernameFrag  *string `json:"usernameFragment,omitempty"`
}

type TrackMutePayload struct {
	TrackID string `json:"trackId"`
	Muted   bool   `json:"muted"`
}

type TrackSourcePayload struct {
	TrackID string `json:"trackId"`
	Source  string `json:"source"`
}

// SubscriptionUpdatePayload asks for a different simulcast layer.
//
// `Layer` is a preference, not a command: the node will not hand a
// subscriber a layer the publisher is not actually sending, and congestion
// control may hold it lower. The distinction matters because a UI that
// treats this as a command will show the wrong quality badge.
type SubscriptionUpdatePayload struct {
	PublisherID string `json:"publisherId"`
	TrackID     string `json:"trackId"`
	Layer       string `json:"layer"` // "low" | "medium" | "high" | "auto"
}

type TrackPublishedPayload struct {
	ParticipantID string `json:"participantId"`
	TrackID       string `json:"trackId"`
	Kind          string `json:"kind"`   // "audio" | "video"
	Source        string `json:"source"` // "microphone" | "camera" | "screenShare" | "unknown"
	// Simulcast is true when the publisher is sending more than one spatial
	// layer for this track.
	Simulcast bool     `json:"simulcast"`
	Layers    []string `json:"layers,omitempty"`
}

type TrackUnpublishedPayload struct {
	ParticipantID string `json:"participantId"`
	TrackID       string `json:"trackId"`
}

type ConnectionStatePayload struct {
	// ICEState and PeerState are Pion's own state strings, passed through
	// unchanged. Deliberately not collapsed into a Raven vocabulary here —
	// this is a diagnostic channel, and the honest thing to report is what
	// the stack actually said.
	ICEState  string `json:"iceState"`
	PeerState string `json:"peerState"`
}

// ParticipantStatsPayload is the SFU's read on one participant's link.
//
// Every field is measured, never estimated: RTT and loss come from the
// RTCP reports the peer itself sends, jitter from the receiver report, and
// bitrates from bytes actually forwarded. A field the node has no
// measurement for is omitted rather than zeroed — zero packet loss and
// "we have not received a report yet" must not look the same (spec §19).
type ParticipantStatsPayload struct {
	ParticipantID    string   `json:"participantId"`
	RTTMillis        *float64 `json:"rttMs,omitempty"`
	JitterMillis     *float64 `json:"jitterMs,omitempty"`
	PacketLossPct    *float64 `json:"packetLossPct,omitempty"`
	InboundBitrate   *float64 `json:"inboundBps,omitempty"`
	OutboundBitrate  *float64 `json:"outboundBps,omitempty"`
	PublishedTracks  int      `json:"publishedTracks"`
	SubscribedTracks int      `json:"subscribedTracks"`
}

type RoomStateResultPayload struct {
	RoomID       string                 `json:"roomId"`
	Participants []RoomStateParticipant `json:"participants"`
}

type RoomStateParticipant struct {
	ParticipantID string           `json:"participantId"`
	SessionID     string           `json:"sessionId"`
	JoinedAtUnix  int64            `json:"joinedAt"`
	PeerState     string           `json:"peerState"`
	Tracks        []RoomStateTrack `json:"tracks"`
}

type RoomStateTrack struct {
	TrackID   string `json:"trackId"`
	Kind      string `json:"kind"`
	Source    string `json:"source"`
	Muted     bool   `json:"muted"`
	Simulcast bool   `json:"simulcast"`
}

type ErrorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Error codes on the node link. Coarse on purpose: the control plane needs
// to know whether to fail this participant, retry, or give up on the node,
// and finer detail belongs in logs rather than in a wire contract both
// sides have to agree on forever.
const (
	ErrCodeUnknownSession   = "UNKNOWN_SESSION"
	ErrCodeRoomFull         = "ROOM_FULL"
	ErrCodePermissionDenied = "PERMISSION_DENIED"
	ErrCodeNegotiation      = "NEGOTIATION_FAILED"
	// ErrCodeGlare means the server already has an offer in flight. Unlike
	// NEGOTIATION_FAILED it is retryable, and distinguishing them is what
	// lets the SDK retry a publish instead of surfacing an error to the
	// application.
	ErrCodeGlare    = "NEGOTIATION_GLARE"
	ErrCodeInternal = "INTERNAL"
)

// NewReply builds a response frame carrying the request's correlation id.
func NewReply(t MessageType, requestID, roomID string, payload any) (Frame, error) {
	frame, err := NewFrame(t, "", roomID, payload)
	if err != nil {
		return frame, err
	}
	frame.RequestID = requestID
	return frame, nil
}

// NewFrame builds a frame with its payload already marshalled.
//
// Marshalling can only fail here for a payload that cannot be represented
// as JSON, which for these fixed structs would be a programming error
// rather than a runtime condition — so the error is returned rather than
// panicking, and callers on the send path log it and drop the frame.
func NewFrame(t MessageType, sessionID, roomID string, payload any) (Frame, error) {
	frame := Frame{Type: t, SessionID: sessionID, RoomID: roomID}
	if payload == nil {
		return frame, nil
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return frame, err
	}
	frame.Payload = encoded
	return frame, nil
}

// RoomStateFromDomain maps a room's snapshot onto the wire form.
//
// The mapping exists so the domain type can gain a field without that
// field silently becoming part of a contract the control plane parses —
// every wire field is here, explicitly, on purpose.
func RoomStateFromDomain(state room.State) RoomStateResultPayload {
	payload := RoomStateResultPayload{
		RoomID:       state.RoomID,
		Participants: make([]RoomStateParticipant, 0, len(state.Participants)),
	}
	for _, participant := range state.Participants {
		entry := RoomStateParticipant{
			ParticipantID: participant.ParticipantID,
			SessionID:     participant.SessionID,
			JoinedAtUnix:  participant.JoinedAtUnix,
			PeerState:     participant.PeerState,
			Tracks:        make([]RoomStateTrack, 0, len(participant.Tracks)),
		}
		for _, track := range participant.Tracks {
			entry.Tracks = append(entry.Tracks, RoomStateTrack{
				TrackID:   track.TrackID,
				Kind:      track.Kind,
				Source:    track.Source,
				Muted:     track.Muted,
				Simulcast: track.Simulcast,
			})
		}
		payload.Participants = append(payload.Participants, entry)
	}
	return payload
}
