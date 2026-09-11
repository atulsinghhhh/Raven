// A shard of the audience: several real viewers inside one page.
//
// # Why several per page
//
// One Playwright page per viewer is the obvious shape and it does not
// reach 100 on a laptop — each page is a renderer process with its own
// heap, its own compositor and its own event loop, and the rig becomes
// the bottleneck long before the SFU does. A number produced that way
// measures Chromium, not Livqeno.
//
// Several viewers per page is cheap in exactly the way that matters:
// each still constructs its own `RTCPeerConnection`, negotiates its own
// DTLS-SRTP session, and receives and decodes its own RTP stream, so the
// SFU sees N genuinely independent subscribers and does N times the
// forwarding work. What is shared is the JavaScript heap and the
// compositor — neither of which the SFU can tell apart from N pages.
// The runner still shards across several pages so that no single
// renderer's main thread becomes the limit; `perViewerPage` controls it.
//
// The rig reports the shard layout with every result, because "100
// viewers" measured this way and "100 viewers" measured from 100 laptops
// are different claims and the report has to be able to say which one it
// is making.
import { LiveStream } from '@ravenkash/client';

const params = new URLSearchParams(location.search);
const joinStaggerMs = Number(params.get('stagger') ?? 120);
const withChat = params.get('chat') === 'true';

/**
 * Seats arrive by `page.evaluate`, not in the query string.
 *
 * They were a URL parameter at first, matching how the existing browser
 * e2e hands credentials over, and it worked for three viewers and
 * silently failed for ten: each seat carries an RTC JWT, a chat JWT and
 * an ICE server list, so a shard's worth runs to tens of kilobytes of
 * percent-encoded JSON and the navigation never completed. Passing them
 * in after load has no length limit and keeps credentials out of the
 * page URL, which is where they would otherwise show up in every
 * console line and screenshot.
 */
const seats = [];

const grid = document.getElementById('grid');
const logLines = [];
function log(message) {
  logLines.push(`${Math.round(performance.now())}ms ${message}`);
  if (logLines.length % 5 === 0) document.getElementById('log').textContent = logLines.slice(-30).join('\n');
  console.log(`[shard] ${message}`);
}
window.__log = () => logLines.join('\n');

/** id -> viewer record. The runner reads this; nothing here is derived or smoothed. */
const viewers = new Map();
window.__viewers = viewers;

function record(id) {
  if (!viewers.has(id)) {
    viewers.set(id, {
      id,
      joinStartedAt: null,
      joinedAt: null,
      firstMediaAt: null,
      subscribedKinds: [],
      connectionState: 'idle',
      error: null,
      leftAt: null,
      reconnects: 0,
    });
  }
  return viewers.get(id);
}

async function joinOne(seat) {
  const v = record(seat.id);
  v.joinStartedAt = performance.now();
  v.error = null;
  v.leftAt = null;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.id = `v-${seat.id}`;
  grid.appendChild(video);

  try {
    // The tag is what ties the PeerConnections built during this join to
    // this viewer. Joins are sequential within a shard for exactly that
    // reason — see pc-tap.js.
    window.__pcTag = seat.id;
    const stream = await LiveStream.join(seat.credentials);
    window.__pcTag = null;

    v.joinedAt = performance.now();
    v.connectionState = stream.room.connectionState;
    v.stream = stream;

    stream.room.on('connectionStateChanged', (next) => {
      if (next === 'reconnecting') v.reconnects += 1;
      v.connectionState = next;
    });
    stream.room.on('error', (e) => {
      v.error = { code: e?.code, message: e?.message };
    });
    stream.room.on('trackSubscribed', (track) => {
      if (!v.subscribedKinds.includes(track.kind)) v.subscribedKinds.push(track.kind);
      if (track.kind === 'camera') {
        track.attach(video);
        // Not "media works" — only that a track arrived. Whether frames
        // are actually being decoded is decided by the runner, off
        // framesDecoded advancing between two samples.
        v.firstMediaAt = v.firstMediaAt ?? performance.now();
      }
    });
    stream.room.on('trackUnsubscribed', (track) => {
      v.subscribedKinds = v.subscribedKinds.filter((k) => k !== track.kind);
    });

    if (withChat && stream.chat) {
      v.chatConnected = true;
    }
    return true;
  } catch (err) {
    window.__pcTag = null;
    v.error = { code: err?.code, message: err?.message ?? String(err) };
    log(`viewer ${seat.id} join failed: ${v.error.code ?? ''} ${v.error.message}`);
    return false;
  }
}

/** Joins every seat this shard was handed, staggered. Resolves when all have settled. */
window.__joinAll = async () => {
  for (const seat of seats) {
    await joinOne(seat);
    if (joinStaggerMs > 0) await new Promise((r) => setTimeout(r, joinStaggerMs));
  }
  window.__joined = true;
  log(`shard joined ${[...viewers.values()].filter((v) => v.joinedAt).length}/${seats.length}`);
};

/** Adds viewers mid-run, for the churn phase. */
window.__joinSeats = async (extraSeats) => {
  for (const seat of extraSeats) {
    seats.push(seat);
    await joinOne(seat);
    if (joinStaggerMs > 0) await new Promise((r) => setTimeout(r, joinStaggerMs));
  }
};

/** A clean `stream.leave()`, which is what fires live_stream.viewer_left. */
window.__leave = async (ids) => {
  for (const id of ids) {
    const v = viewers.get(id);
    if (!v?.stream) continue;
    try {
      await v.stream.leave();
    } catch (err) {
      v.error = { code: 'LEAVE_FAILED', message: err?.message ?? String(err) };
    }
    v.leftAt = performance.now();
    v.connectionState = 'left';
    document.getElementById(`v-${id}`)?.remove();
  }
};

/**
 * Kills a viewer without a clean leave: closes the PeerConnections and the
 * signaling socket out from under the SDK, which is what a viewer walking
 * into a lift or closing a laptop lid looks like to the server. Distinct
 * from `__leave`, and the server is expected to treat them differently.
 */
window.__kill = (ids) => {
  for (const id of ids) {
    const v = viewers.get(id);
    if (!v?.stream) continue;
    for (const pc of window.__pcsFor(id)) pc.close();
    v.leftAt = performance.now();
    v.connectionState = 'killed';
    document.getElementById(`v-${id}`)?.remove();
  }
};

/** One raw sample per live viewer. Cumulative counters, unsmoothed; the runner differences them. */
window.__sample = async () => {
  const out = [];
  for (const v of viewers.values()) {
    if (!v.joinedAt || v.leftAt) {
      out.push({ id: v.id, live: false, connectionState: v.connectionState, error: v.error });
      continue;
    }
    const raw = await window.__rawStats(v.id, v.stream?.room);
    const el = document.getElementById(`v-${v.id}`);
    // A second, independent witness that pixels are moving: the element's
    // own decoded-frame counter, which is maintained by the renderer
    // rather than by the WebRTC stats subsystem. If these two ever
    // disagree the sample is suspect, and the runner says so.
    const quality = el?.getVideoPlaybackQuality?.();
    out.push({
      id: v.id,
      live: true,
      connectionState: v.connectionState,
      sdkConnectionState: v.stream?.room?.connectionState ?? null,
      subscribedKinds: v.subscribedKinds,
      reconnects: v.reconnects,
      error: v.error,
      joinMs: v.joinedAt - v.joinStartedAt,
      firstMediaMs: v.firstMediaAt ? v.firstMediaAt - v.joinStartedAt : null,
      raw,
      elementTotalVideoFrames: quality?.totalVideoFrames ?? null,
      elementDroppedVideoFrames: quality?.droppedVideoFrames ?? null,
      currentTime: el?.currentTime ?? null,
    });
  }
  return out;
};

/** Called by the runner once the page has loaded. Returns when the seats are registered, not when they have joined. */
window.__setSeats = (incoming) => {
  seats.push(...incoming);
  return seats.length;
};

window.__ready = true;
