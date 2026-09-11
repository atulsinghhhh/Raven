/**
 * Reads the SFU's own Prometheus surface and turns two scrapes into rates.
 *
 * This is where the measured-throughput claim comes from, and it is worth
 * being precise about what it is. `raven_sfu_media_bytes_sent_total` is
 * summed at scrape time by walking every live downtrack and adding up the
 * bytes each has written — so it counts RTP payload the node actually
 * forwarded, not an estimate from a bitrate setting and not a guess from
 * subscriber count. Differencing two scrapes over a known interval gives
 * bytes per second, which is a measurement.
 *
 * What it excludes, stated rather than implied: UDP/IP framing, SRTP
 * authentication tags, RTCP, STUN keepalives, and the DTLS handshake. The
 * figure is therefore payload throughput and is a little below what a
 * network interface would show. Where a NIC-level number is wanted the
 * runner also samples `process_*` counters from the same endpoint.
 */

/** Parses Prometheus text exposition into { name: value } for unlabelled series, plus a labelled map. */
export function parsePrometheus(text) {
  const plain = new Map();
  const labelled = new Map();
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+]+|NaN|\+Inf|-Inf)$/.exec(line);
    if (!match) continue;
    const [, name, labels, rawValue] = match;
    const value = Number(rawValue);
    if (labels) {
      const bucket = labelled.get(name) ?? [];
      bucket.push({ labels, value });
      labelled.set(name, bucket);
    } else {
      plain.set(name, value);
    }
  }
  return { plain, labelled };
}

const FIELDS = {
  bytesSent: 'raven_sfu_media_bytes_sent_total',
  bytesReceived: 'raven_sfu_media_bytes_received_total',
  packetsSent: 'raven_sfu_media_packets_sent_total',
  packetsReceived: 'raven_sfu_media_packets_received_total',
  packetsDropped: 'raven_sfu_media_packets_dropped_total',
  activeRooms: 'raven_sfu_active_rooms',
  activeParticipants: 'raven_sfu_active_participants',
  activeAudioTracks: 'raven_sfu_active_audio_tracks',
  activeVideoTracks: 'raven_sfu_active_video_tracks',
  connectionsSucceeded: 'raven_sfu_connections_succeeded_total',
  connectionsFailed: 'raven_sfu_connections_failed_total',
  participantsJoined: 'raven_sfu_participants_joined_total',
  participantsLeft: 'raven_sfu_participants_left_total',
  negotiationFailures: 'raven_sfu_negotiation_failures_total',
  keyframesRequested: 'raven_sfu_keyframes_requested_total',
  // Added to the node's registry for this pass: a bare prometheus.Registry
  // carries no Go or process collectors, so goroutine and heap growth —
  // the two things a soak test is actually looking for — were not
  // observable at all.
  goroutines: 'go_goroutines',
  heapAllocBytes: 'go_memstats_heap_alloc_bytes',
  heapObjects: 'go_memstats_heap_objects',
  residentMemoryBytes: 'process_resident_memory_bytes',
  cpuSecondsTotal: 'process_cpu_seconds_total',
  openFds: 'process_open_fds',
};

export async function scrapeSfu(metricsUrl, timeoutMs = 5_000) {
  const res = await fetch(metricsUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`SFU /metrics answered ${res.status}`);
  const { plain } = parsePrometheus(await res.text());
  const sample = { at: Date.now() };
  for (const [key, metric] of Object.entries(FIELDS)) {
    sample[key] = plain.has(metric) ? plain.get(metric) : null;
  }
  return sample;
}

/** Bits per second between two scrapes. Null when either endpoint is missing the counter. */
function ratePerSecond(a, b, key) {
  if (a?.[key] == null || b?.[key] == null) return null;
  const seconds = (b.at - a.at) / 1000;
  if (seconds <= 0) return null;
  return (b[key] - a[key]) / seconds;
}

export function deriveRates(previous, current) {
  const bytesOutPerSec = ratePerSecond(previous, current, 'bytesSent');
  const bytesInPerSec = ratePerSecond(previous, current, 'bytesReceived');
  const cpuSecondsPerSec = ratePerSecond(previous, current, 'cpuSecondsTotal');
  return {
    outboundMbps: bytesOutPerSec == null ? null : (bytesOutPerSec * 8) / 1e6,
    inboundMbps: bytesInPerSec == null ? null : (bytesInPerSec * 8) / 1e6,
    packetsSentPerSec: ratePerSecond(previous, current, 'packetsSent'),
    packetsReceivedPerSec: ratePerSecond(previous, current, 'packetsReceived'),
    packetsDroppedPerSec: ratePerSecond(previous, current, 'packetsDropped'),
    // One core fully busy is 100%. Measured from inside the process, so it
    // is the SFU's CPU and not the browsers' or the API's.
    cpuPercent: cpuSecondsPerSec == null ? null : cpuSecondsPerSec * 100,
    rssMb: current.residentMemoryBytes == null ? null : current.residentMemoryBytes / 1e6,
    heapMb: current.heapAllocBytes == null ? null : current.heapAllocBytes / 1e6,
    goroutines: current.goroutines,
    activeParticipants: current.activeParticipants,
    activeRooms: current.activeRooms,
    activeVideoTracks: current.activeVideoTracks,
    activeAudioTracks: current.activeAudioTracks,
    openFds: current.openFds,
  };
}
