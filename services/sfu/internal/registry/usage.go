package registry

import (
	"runtime"
	"time"
)

// ResourceUsage is what this node can honestly say about its own load.
//
// Pointers instead of values, so a measurement we couldn't take reads as
// absent instead of zero. "0% CPU" and "no idea" must never look the same
// on a dashboard. One says the node is idle, the other says the reading is
// missing, and an operator deciding whether to scale really does need to
// tell them apart (spec §19).
type ResourceUsage struct {
	CPUPercent    *float64
	MemoryPercent *float64
}

var (
	lastCPUSample time.Time
	lastGCPause   time.Duration
)

// readResourceUsage reports whatever the Go runtime can measure about this
// process without dragging in a platform-specific dependency.
//
// # What it won't tell you
//
// Host CPU. A cgroup-aware CPU reading means parsing /sys/fs/cgroup, which
// differs between cgroup v1 and v2 and again between container runtimes.
// Get it subtly wrong and you produce a number that looks authoritative and
// isn't. The allocator's real inputs are room and participant counts, and
// those are exact, so the resource gauges here are operator-facing colour.
// Honestly absent beats confidently wrong.
//
// Memory is heap-in-use against the runtime's own ceiling, which is a real
// measurement of this process. If a deployment wants true host metrics, the
// Prometheus endpoint is where they belong; a node exporter already does
// that job properly.
func readResourceUsage() (ResourceUsage, error) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)

	usage := ResourceUsage{}

	// Sys is what the runtime has taken from the OS. HeapInuse is what's
	// actually holding live data. The ratio makes a fair "how full is this
	// process" signal, and unlike RSS it doesn't lurch about with the GC's
	// release schedule.
	if stats.Sys > 0 {
		percent := float64(stats.HeapInuse) / float64(stats.Sys) * 100
		usage.MemoryPercent = &percent
	}

	// GC pause as a fraction of wall clock since the last sample is a real
	// measure of how hard this process is working, and for an SFU it's a
	// leading indicator. Packet forwarding allocates, so a node under
	// genuine media load spends visibly more of its life in GC.
	now := time.Now()
	if !lastCPUSample.IsZero() {
		elapsed := now.Sub(lastCPUSample)
		pause := time.Duration(stats.PauseTotalNs) - lastGCPause
		if elapsed > 0 {
			percent := float64(pause) / float64(elapsed) * 100
			if percent > 100 {
				percent = 100
			}
			usage.CPUPercent = &percent
		}
	}
	lastCPUSample = now
	lastGCPause = time.Duration(stats.PauseTotalNs)

	return usage, nil
}
