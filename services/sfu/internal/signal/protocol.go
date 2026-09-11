// Package signal defines and serves the node link, the WebSocket sitting
// between Livqeno's control plane and this SFU node.
//
// # Why a node link at all
//
// Clients never talk to the SFU's signaling directly. They hold one
// WebSocket to the Livqeno API, and the API relays negotiation on to
// whichever SFU got allocated for their room. That indirection is the
// whole point. No client ever learns an SFU's address or its protocol, so
// the media plane can be re-shaped, re-deployed or replaced outright
// without an SDK release. Media itself still goes straight from client to
// node over WebRTC, naturally. Only *control* takes the scenic route.
//
// # Why one connection per node, not per participant
//
// The link has to be bidirectional. The SFU kicks off renegotiation
// whenever a room's track set changes, and that isn't a response to
// anything the client did. Request/response HTTP can't express it without
// polling or callbacks, and a WebSocket per participant would mean
// thousands of connections between two processes carrying almost no
// traffic. So: one multiplexed link per node, and every frame names the
// session it concerns.
package signal

import (
	"encoding/json"

	"github.com/atulsinghhhh/Raven/services/sfu/internal/room"
)

// Frame is the envelope every node-link message travels in.
//
// SessionID identifies one client connection. It's the control plane's own
// connection id, reused verbatim so a log line on either side of the link
// joins to the other without anyone maintaining a translation table.
type Frame struct {
	Type      MessageType     `json:"type"`
	SessionID string          `json:"sessionId,omitempty"`
	RoomID    string          `json:"roomId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`

	// RequestID correlates a query with its reply.
	//
	// Kept separate from SessionID on purpose. Session-scoped frames bind a
	// session to the link they arrived on (see server.go), so correlating a
	// query by session id would register a session that doesn't exist and
	// then get it swept up as an orphan. A query isn't about a participant.
	// It gets its own identifier.
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
	// TypeSDPOfferFromClient carries a client-initiated offer, which is
	// what a client sends when it starts publishing. Named differently from
	// the SFU's own TypeSDPOffer so a frame's direction is obvious from the
	// type alone, without needing to know which side read it.
	TypeSDPOfferFromClient MessageType = "sdp.offer.client"
	// TypeICECandidate flows both ways; the direction is implied by which
	// side sent it.
	TypeICECandidate MessageType = "ice.candidate"
	// TypeTrackMute tells the node a publisher muted a track, so it can
	// stop forwarding it without tearing the track down.
	TypeTrackMute MessageType = "track.mute"
	// TypeTrackSource declares what a track being published is *of*.
	//
	// WebRTC has no concept of a source, and a browser page can't pick the
	// MediaStream or MediaStreamTrack id that lands in the SDP; both are
	// read-only. Codec kind is all this node could otherwise go on, and
	// that can't tell a screen share from a camera. So the client declares
	// it before negotiating. We hold the declaration against the track id
	// and apply it when the media turns up.
	TypeTrackSource MessageType = "track.source"
	// TypeSubscriptionUpdate changes which simulcast layer a subscriber
	// receives for one publisher's video.
	TypeSubscriptionUpdate MessageType = "subscription.update"
	// TypeRoomClose evicts an entire room. Admin action.
	TypeRoomClose MessageType = "room.close"
	// TypeRoomState asks for a snapshot of a room's live participants and
	// tracks. This is what replaced polling LiveKit's RoomServiceClient.
	TypeRoomState MessageType = "room.state"
	// TypeSessionKeepalive re-binds an idle session to the link it arrived
	// on. Sessions belong to the link that created them (see server.go), so
	// without this a session with no negotiation traffic sits orphaned
	// after a link reconnect until the sweeper eventually eats it.
	TypeSessionKeepalive MessageType = "session.keepalive"

	// --- SFU → control plane -------------------------------------------

	// TypeSDPOffer is an SFU-initiated offer. Sent on join and again
	// whenever the room's track set changes, since the SFU owns the
	// subscriber side of every PeerConnection.
	TypeSDPOffer MessageType = "sdp.offer"
	// TypeSDPAnswerToClient answers a client-initiated offer.
	TypeSDPAnswerToClient MessageType = "sdp.answer.sfu"
	// TypeTrackPublished/Unpublished report what a participant is actually
	// sending, as seen on the wire. Not what they said they'd send.
	TypeTrackPublished   MessageType = "track.published"
	TypeTrackUnpublished MessageType = "track.unpublished"
	// TypeConnectionState reports real ICE/DTLS progress for one session,
	// so control-plane telemetry reflects the media plane instead of
	// guessing at it from how healthy the WebSocket looks.
	TypeConnectionState MessageType = "connection.state"
	// TypeParticipantStats carries the SFU's own measurement of a
	// participant's connection. This is the vantage point no client can
	// have, since the node sees every leg of the room at once.
	TypeParticipantStats MessageType = "participant.stats"
	// TypeRoomStateResult answers TypeRoomState.
	TypeRoomStateResult MessageType = "room.state.result"
	// TypeError reports that a frame couldn't be carried out. Always names
	// the session it concerns, so the control plane can fail a single
	// participant instead of writing off the whole node.
	TypeError MessageType = "error"
)

// Permissions is the wire form of a participant's grant.
//
// Separate from room.Permissions on purpose. This one has JSON tags and
// forms part of a contract two processes have to agree on; the domain type
// stays free to change shape whenever it likes. ToDomain is the only place
// the two ever meet.
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
	// ICEServers the *client* should use. Forwarded so the node can put
	// them in the offer's context. The node doesn't relay through them.
	ICEServers []ICEServer `json:"iceServers,omitempty"`
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type SDPPayload struct {
	SDP string `json:"sdp"`
	// Type is "offer" or "answer". Carried explicitly instead of inferred
	// from the frame type, so a mismatched pair blows up loudly at
	// SetRemoteDescription instead of quietly half-negotiating.
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
// Layer is a preference, not a command. The node won't hand a subscriber a
// layer the publisher isn't actually sending, and congestion control may
// well hold it lower anyway. Worth being clear about, because a UI that
// treats this as a command ends up showing the wrong quality badge.
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
	// Simulcast: the publisher is sending more than one spatial layer for
	// this track.
	Simulcast bool     `json:"simulcast"`
	Layers    []string `json:"layers,omitempty"`
}

type TrackUnpublishedPayload struct {
	ParticipantID string `json:"participantId"`
	TrackID       string `json:"trackId"`
}

type ConnectionStatePayload struct {
	// ICEState and PeerState are Pion's own state strings, passed straight
	// through. We don't collapse them into some Livqeno vocabulary. This is a
	// diagnostic channel; the honest thing to report is whatever the stack
	// actually said.
	ICEState  string `json:"iceState"`
	PeerState string `json:"peerState"`
}

// ParticipantStatsPayload is the SFU's read on one participant's link.
//
// Every field is measured, never estimated. RTT and loss come out of the
// RTCP reports the peer itself sends, jitter from the receiver report,
// bitrates from bytes we actually forwarded. Anything the node hasn't
// measured is omitted, not zeroed. Zero packet loss and "no report yet"
// must never look the same (spec §19).
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

// Error codes on the node link. Coarse on purpose. All the control plane
// needs to decide is whether to fail this participant, retry, or write off
// the node. Finer detail belongs in the logs, not in a wire contract both
// sides are stuck agreeing on forever.
const (
	ErrCodeUnknownSession   = "UNKNOWN_SESSION"
	ErrCodeRoomFull         = "ROOM_FULL"
	ErrCodePermissionDenied = "PERMISSION_DENIED"
	ErrCodeNegotiation      = "NEGOTIATION_FAILED"
	// ErrCodeGlare means the server already has an offer in flight. Unlike
	// NEGOTIATION_FAILED it's retryable, and keeping the two apart is what
	// lets the SDK quietly retry a publish instead of throwing an error at
	// the application.
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
// Marshalling can only fail on a payload that won't go to JSON, which for
// these fixed structs means somebody made a programming error rather than
// anything happening at runtime. Still returns the error instead of
// panicking; callers on the send path log it and drop the frame.
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
// The mapping exists so somebody can add a field to the domain type
// without it silently becoming part of a contract the control plane
// parses. Every wire field is written out here, by hand, on purpose.
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
