//go:build turnrelay

// Forced-TURN-relay media tests (spec §41).
//
// Behind a build tag, not an env-var skip, for two reasons: these need a
// reachable coturn with a known shared secret, which `go test ./...` has
// no way to provide, and the test matrix's "all passing with no skips"
// claim should keep meaning what it says.
//
// They must run somewhere every party — client, coturn, SFU — sees one
// consistent address for every other party. On Docker Desktop for macOS
// the host and the bridge network do not satisfy that (see
// docs/turn.md#known-limitations), so the supported way to run this is
// from inside a container attached to the same Docker network as coturn:
//
//	GOOS=linux GOARCH=arm64 CGO_ENABLED=0 \
//	  go test -tags turnrelay -c -o /tmp/turnrelay.test ./internal/room/
//	docker run --rm --network raven-network \
//	  -e TURN_HOST=coturn -e TURN_PORT=3478 -e TURN_SECRET="$TURN_SECRET" \
//	  -v /tmp:/t alpine:3 /t/turnrelay.test -test.v
//
// What this proves and does not prove is spelled out in each test.
package room

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"os"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const (
	// relayCredentialTTL matches the order of the control plane's own
	// default RTC token TTL. Long enough for a slow run, short enough that
	// a credential left in a shell history is worthless.
	relayCredentialTTL = 10 * time.Minute

	// latencySamples is how many forwarded packets a latency figure is
	// computed from. At the pump's 10ms cadence that is a few seconds of
	// media — enough for a stable median, short enough to keep the test
	// honest about being a smoke test rather than a soak.
	latencySamples = 300
)

// turnEnv is the coturn deployment under test.
type turnEnv struct {
	host      string
	port      int
	secret    string
	transport string
}

func loadTurnEnv(t *testing.T) turnEnv {
	t.Helper()

	secret := os.Getenv("TURN_SECRET")
	if secret == "" {
		// Fatal rather than skip: the build tag already says the caller
		// meant to run this, and silently passing a relay test that never
		// touched a relay is the failure mode this whole file exists to
		// avoid.
		t.Fatal("TURN_SECRET is required — this test authenticates against a real coturn")
	}

	host := os.Getenv("TURN_HOST")
	if host == "" {
		host = "coturn"
	}
	port := 3478
	if raw := os.Getenv("TURN_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			t.Fatalf("TURN_PORT %q is not a number: %v", raw, err)
		}
		port = parsed
	}
	transport := os.Getenv("TURN_TRANSPORT")
	if transport == "" {
		transport = "udp"
	}

	return turnEnv{host: host, port: port, secret: secret, transport: transport}
}

// relayOnlyConfig builds the client-side configuration a browser would get
// from a minted RTC token, minus every non-relay option.
//
// ICETransportPolicyRelay is the whole point: with it the ICE agent
// gathers *only* relay candidates, so a connection that comes up cannot
// have taken a host or server-reflexive path. There is no way to pass this
// test by accident.
func (e turnEnv) relayOnlyConfig(t *testing.T, label string) webrtc.Configuration {
	t.Helper()

	username, credential := e.credential(label)
	url := fmt.Sprintf("turn:%s:%d?transport=%s", e.host, e.port, e.transport)

	return webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{{
			URLs:           []string{url},
			Username:       username,
			Credential:     credential,
			CredentialType: webrtc.ICECredentialTypePassword,
		}},
		ICETransportPolicy: webrtc.ICETransportPolicyRelay,
	}
}

// credential mints coturn's time-limited REST credential — the same scheme
// as apps/api/src/modules/rtc-tokens/turn-credential.util.ts, reimplemented
// here rather than shared because a test that derives its credential from
// the same code it is testing proves nothing about the wire format coturn
// actually accepts.
func (e turnEnv) credential(label string) (username, credential string) {
	expiry := time.Now().Add(relayCredentialTTL).Unix()
	username = fmt.Sprintf("%d:%s", expiry, label)

	mac := hmac.New(sha1.New, []byte(e.secret))
	mac.Write([]byte(username))
	return username, base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// --- Timestamped media ---------------------------------------------------

// vp8KeyframePrefix is the payload prefix pumpRTP uses: a VP8 descriptor
// with the S bit set, followed by a keyframe header. Kept byte-identical so
// the SFU's keyframe detection behaves exactly as it does elsewhere.
var vp8KeyframePrefix = []byte{0x10, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03}

// stampedPayload carries a send timestamp inside the RTP payload.
//
// Keyed on the payload rather than the sequence number because the SFU
// rewrites sequence numbers for simulcast continuity, but never touches a
// payload — TestDownTrackDoesNotMutateTheSharedPacket is the guarantee this
// relies on. A packet therefore carries its own send time end to end, and
// the latency below needs no shared map and no correlation guesswork.
func stampedPayload(index uint32, sent time.Time) []byte {
	payload := make([]byte, len(vp8KeyframePrefix)+12)
	copy(payload, vp8KeyframePrefix)
	binary.BigEndian.PutUint32(payload[len(vp8KeyframePrefix):], index)
	binary.BigEndian.PutUint64(payload[len(vp8KeyframePrefix)+4:], uint64(sent.UnixNano()))
	return payload
}

func readStamp(payload []byte) (index uint32, sent time.Time, ok bool) {
	if len(payload) < len(vp8KeyframePrefix)+12 {
		return 0, time.Time{}, false
	}
	index = binary.BigEndian.Uint32(payload[len(vp8KeyframePrefix):])
	nanos := binary.BigEndian.Uint64(payload[len(vp8KeyframePrefix)+4:])
	return index, time.Unix(0, int64(nanos)), true
}

// pumpStampedRTP is pumpRTP with a send timestamp in every payload.
func pumpStampedRTP(ctx context.Context, track *webrtc.TrackLocalStaticRTP) {
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()

	var sequence uint16
	var timestamp uint32
	var index uint32
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sequence++
			timestamp += 3000
			index++
			_ = track.WriteRTP(&rtp.Packet{
				Header: rtp.Header{
					Version:        2,
					SequenceNumber: sequence,
					Timestamp:      timestamp,
					SSRC:           0xDEADBEEF,
				},
				Payload: stampedPayload(index, time.Now()),
			})
		}
	}
}

// --- Candidate-pair inspection -------------------------------------------

type selectedPair struct {
	localType  webrtc.ICECandidateType
	remoteType webrtc.ICECandidateType
	localProto string
	relayProto string
	rttSeconds float64
}

// selectedCandidatePair reads the nominated pair out of getStats().
//
// This is the assertion that matters. "The connection came up" is not
// evidence of a relay path; the candidate types on the pair actually
// carrying media are.
func selectedCandidatePair(t *testing.T, pc *webrtc.PeerConnection) selectedPair {
	t.Helper()

	report := pc.GetStats()

	var pair webrtc.ICECandidatePairStats
	found := false
	for _, entry := range report {
		stats, ok := entry.(webrtc.ICECandidatePairStats)
		if !ok {
			continue
		}
		if stats.State != webrtc.StatsICECandidatePairStateSucceeded {
			continue
		}
		// Prefer the nominated pair, but take a succeeded one if no pair
		// is flagged nominated — Pion does not always set it, and a
		// succeeded pair on a connected transport is still the pair
		// carrying media.
		if stats.Nominated || !found {
			pair = stats
			found = true
		}
		if stats.Nominated {
			break
		}
	}
	if !found {
		t.Fatalf("no succeeded ICE candidate pair in stats — connection state %s", pc.ConnectionState())
	}

	local, ok := report[pair.LocalCandidateID].(webrtc.ICECandidateStats)
	if !ok {
		t.Fatalf("local candidate %q missing from stats report", pair.LocalCandidateID)
	}
	remote, ok := report[pair.RemoteCandidateID].(webrtc.ICECandidateStats)
	if !ok {
		t.Fatalf("remote candidate %q missing from stats report", pair.RemoteCandidateID)
	}

	return selectedPair{
		localType:  local.CandidateType,
		remoteType: remote.CandidateType,
		localProto: local.Protocol,
		relayProto: local.RelayProtocol,
		rttSeconds: pair.CurrentRoundTripTime,
	}
}

// --- Latency ------------------------------------------------------------

type latencyStats struct {
	samples int
	median  time.Duration
	p95     time.Duration
	max     time.Duration
}

func (l latencyStats) String() string {
	return fmt.Sprintf("n=%d median=%s p95=%s max=%s", l.samples, l.median.Round(time.Microsecond), l.p95.Round(time.Microsecond), l.max.Round(time.Microsecond))
}

// measureForwardingLatency reads `want` forwarded packets and returns the
// distribution of publish→receive times.
//
// One-way, not a round trip: the send timestamp is written by the publisher
// and read by the subscriber in the same process, off the same clock, so
// there is no clock skew to correct for and no halving to fudge. The path
// measured is WriteRTP → SRTP → (relay) → SFU forward → (relay) → SRTP →
// ReadRTP.
func measureForwardingLatency(t *testing.T, track *webrtc.TrackRemote, want int) latencyStats {
	t.Helper()

	if err := track.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
		t.Fatalf("set read deadline: %v", err)
	}

	deltas := make([]time.Duration, 0, want)
	for len(deltas) < want {
		if err := track.SetReadDeadline(time.Now().Add(mediaTimeout)); err != nil {
			t.Fatalf("extend read deadline: %v", err)
		}
		packet, _, err := track.ReadRTP()
		if err != nil {
			t.Fatalf("read forwarded packet %d/%d: %v", len(deltas)+1, want, err)
		}
		_, sent, ok := readStamp(packet.Payload)
		if !ok {
			t.Fatalf("forwarded packet %d carried a %d-byte payload — the timestamp did not survive forwarding", len(deltas)+1, len(packet.Payload))
		}
		deltas = append(deltas, time.Since(sent))
	}

	sort.Slice(deltas, func(i, j int) bool { return deltas[i] < deltas[j] })
	return latencyStats{
		samples: len(deltas),
		median:  deltas[len(deltas)/2],
		p95:     deltas[(len(deltas)*95)/100],
		max:     deltas[len(deltas)-1],
	}
}

// runForwardingCase joins a publisher and a subscriber with the given
// client configuration, waits for media, and reports what path it took and
// how long forwarding cost.
func runForwardingCase(t *testing.T, roomID string, clientConfig webrtc.Configuration) (publisher, subscriber selectedPair, latency latencyStats) {
	t.Helper()

	h := newHarness(t)
	h.clientConfig = clientConfig

	aliceTrack := newVideoTrack(t, "alice-video", "alice-camera")
	alice := h.join(roomID, "alice", "sess-alice", publisherPermissions(), aliceTrack)
	alice.waitConnected(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go pumpStampedRTP(ctx, aliceTrack)

	h.awaitTrackEvent("alice", true)

	bob := h.join(roomID, "bob", "sess-bob", publisherPermissions(), nil)
	bob.waitConnected(t)

	var received *webrtc.TrackRemote
	select {
	case received = <-bob.tracksReceived:
	case <-time.After(mediaTimeout):
		t.Fatal("bob never received alice's track")
	}

	latency = measureForwardingLatency(t, received, latencySamples)

	// Read stats after media has flowed: a pair's RTT is unpopulated until
	// connectivity checks have actually run on it.
	return selectedCandidatePair(t, alice.pc), selectedCandidatePair(t, bob.pc), latency
}

// --- Tests ---------------------------------------------------------------

// TestTURNRelayOnlyForwardsMedia closes the largest gap in the RTC test
// matrix (§5, "Relay-only has never been exercised").
//
// Both clients are relay-only, so both legs of the path — publisher→SFU
// and SFU→subscriber — are TURN-relayed, and coturn handles the media in
// both directions. The SFU itself is not relay-only and is not meant to be:
// it holds no TURN credential by design (Manager.iceServers), because an
// SFU relaying its own traffic would put a third hop in every packet's
// path. So the pair this asserts on is relay(client)↔host(SFU), which is
// exactly the topology a real client behind symmetric NAT produces.
func TestTURNRelayOnlyForwardsMedia(t *testing.T) {
	env := loadTurnEnv(t)

	publisher, subscriber, latency := runForwardingCase(
		t, "relay-room", env.relayOnlyConfig(t, "relay-test"),
	)

	for name, pair := range map[string]selectedPair{"publisher": publisher, "subscriber": subscriber} {
		if pair.localType != webrtc.ICECandidateTypeRelay {
			t.Errorf("%s local candidate type = %s, want relay — media did not go through coturn, so this run proves nothing about the relay path",
				name, pair.localType)
		}
		t.Logf("%s pair: local=%s(%s, relay proto %q) remote=%s rtt=%v",
			name, pair.localType, pair.localProto, pair.relayProto, pair.remoteType,
			time.Duration(pair.rttSeconds*float64(time.Second)).Round(time.Microsecond))
	}

	t.Logf("relay-only forwarding latency: %s", latency)
}

// TestDirectPathForwardingBaseline is the comparison the relay number needs
// to mean anything: the same media, the same SFU, the same machine, with no
// relay in the path.
//
// It duplicates TestSFUForwardsMediaBetweenTwoParticipants' coverage on
// purpose — its output is the baseline, not the assertion.
func TestDirectPathForwardingBaseline(t *testing.T) {
	publisher, subscriber, latency := runForwardingCase(t, "direct-room", webrtc.Configuration{})

	if publisher.localType == webrtc.ICECandidateTypeRelay || subscriber.localType == webrtc.ICECandidateTypeRelay {
		t.Errorf("baseline took a relay path (publisher=%s subscriber=%s) — it is not a baseline",
			publisher.localType, subscriber.localType)
	}

	t.Logf("publisher pair: local=%s remote=%s", publisher.localType, publisher.remoteType)
	t.Logf("subscriber pair: local=%s remote=%s", subscriber.localType, subscriber.remoteType)
	t.Logf("direct forwarding latency: %s", latency)
}
