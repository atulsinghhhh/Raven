package registry

import (
	"runtime"
	"time"
)

// ResourceUsage is what this node can honestly say about its own load.
//
// Pointers, not values: a measurement we could not take is reported as
// absent rather than as zero. "0% CPU" and "we do not know" must not look
// the same on a dashboard — the first says the node is idle, the second
// says the reading is missing, and an operator deciding whether to scale
// needs to tell them apart (spec §19).
type ResourceUsage struct {
	CPUPercent    *float64
	MemoryPercent *float64
}

var (
	lastCPUSample time.Time
	lastGCPause   time.Duration
)

// readResourceUsage reports what the Go runtime can measure about this
// process without a platform-specific dependency.
//
// # What this deliberately does not do
//
// It does not report host CPU. A cgroup-aware CPU reading needs
// /sys/fs/cgroup parsing that differs between cgroup v1 and v2 and between
// container runtimes, and getting it subtly wrong produces a number that
// looks authoritative and is not. Since the allocator's actual inputs are
// room and participant counts — which are exact — the resource gauges are
// operator-facing colour, and it is better for them to be honestly absent
// than confidently wrong.
//
// Memory is reported as heap-in-use against the runtime's own ceiling,
// which is a real measurement of this process. When a deployment needs true
// host metrics, the Prometheus endpoint is where they belong: a node
// exporter already does that job properly.
func readResourceUsage() (ResourceUsage, error) {
	var stats runtime.MemStats
	runtime.ReadMemStats(&stats)

	usage := ResourceUsage{}

	// Sys is what the runtime has obtained from the OS; HeapInuse is what
	// is actually holding live data. The ratio is a fair "how full is this
	// process" signal, and unlike RSS it does not swing wildly with the
	// GC's release schedule.
	if stats.Sys > 0 {
		percent := float64(stats.HeapInuse) / float64(stats.Sys) * 100
		usage.MemoryPercent = &percent
	}

	// GC pause time as a fraction of wall clock since the last sample is a
	// genuine measure of how hard this process is working, and it is a
	// leading indicator for an SFU: packet forwarding allocates, so a node
	// under real media load spends visibly more time in GC.
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
