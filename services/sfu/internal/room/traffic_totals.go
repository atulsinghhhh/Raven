package room

import "sync/atomic"

// closedTrackTraffic accumulates the final byte/packet tallies of every
// PublishedTrack and DownTrack that has closed on this node, since process
// start.
//
// Package-level rather than threaded through Room/Participant/
// PublishedTrack/DownTrack's constructors because there is exactly one of
// these per SFU process (one node, one Manager). Unlike the plain package
// vars in registry/usage.go, every field here is an atomic.Uint64 — safe
// to add from any of the several goroutines (per-layer readers,
// per-subscriber forwarders, participant teardown) that can close a
// track concurrently.
//
// Exists to fix a specific bug: the /metrics traffic collector
// (internal/metrics) used to recompute its byte/packet totals by summing
// only currently-live tracks at scrape time. A track or downtrack torn
// down between scrapes dropped out of that sum — bytes it had already
// forwarded simply vanished from the total, which a `rate()`-based
// dashboard reads as traffic going backwards during ordinary churn. The
// fix: capture each track's final tally here, exactly once, at Close();
// the collector adds this to its live sum instead of only reporting the
// live sum.
var closedTrackTraffic struct {
	bytesReceived   atomic.Uint64
	bytesSent       atomic.Uint64
	packetsReceived atomic.Uint64
	packetsSent     atomic.Uint64
	packetsDropped  atomic.Uint64
}

// ClosedTrafficTotals returns the accumulated totals from every
// PublishedTrack/DownTrack that has closed on this node so far. Add a live
// sum over currently-active tracks (see Manager.Rooms()) for a true
// monotonic total across churn.
func ClosedTrafficTotals() (bytesReceived, bytesSent, packetsReceived, packetsSent, packetsDropped uint64) {
	return closedTrackTraffic.bytesReceived.Load(),
		closedTrackTraffic.bytesSent.Load(),
		closedTrackTraffic.packetsReceived.Load(),
		closedTrackTraffic.packetsSent.Load(),
		closedTrackTraffic.packetsDropped.Load()
}

// rtcpPacketsProcessed counts every RTCP packet forwardSubscriberFeedback
// has read off a subscriber's sender — PLI, FIR, Receiver/Sender Reports,
// everything. Unlike closedTrackTraffic this needs no closed/live split:
// it only ever grows, for the life of the process, with nothing to lose
// when a track closes.
var rtcpPacketsProcessed atomic.Uint64

// RTCPPacketsProcessed returns the total RTCP packets processed on this
// node so far.
func RTCPPacketsProcessed() uint64 {
	return rtcpPacketsProcessed.Load()
}
