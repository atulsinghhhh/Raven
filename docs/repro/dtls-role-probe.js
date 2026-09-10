/**
 * DTLS role probe for a Raven RTC browser session.
 *
 * Paste into the DevTools console of a page that uses @ravenkash/rtc
 * *before* joining, or inject it with any automation tool. It installs a
 * pass-through wrapper around window.RTCPeerConnection and records, for
 * every SDP the browser applies:
 *
 *   - which side authored it (local = browser, remote = SFU)
 *   - offer or answer
 *   - every distinct a=setup: value in it
 *   - whether the browser accepted it, and the exact error if not
 *
 * That is the whole contract this probe exists to check. RFC 5763 §5: the
 * offerer says actpass, the answerer picks active (DTLS client) or passive
 * (DTLS server), and the resulting role belongs to the transport for the
 * rest of the session. A renegotiation that answers with the role the other
 * side already took is what makes Chrome say:
 *
 *   Failed to set SSL role for the transport.
 *
 * The wrapper is read-only: it never rewrites SDP and never changes an
 * argument. Nothing here is loaded by the SDK, the harness, or any test —
 * it is a diagnostic, and it stays one.
 *
 * Usage:
 *
 *   __dtlsProbe.events        // the SDP timeline, in order
 *   __dtlsProbe.roles()       // browser/SFU DTLS role per PeerConnection
 *   await __dtlsProbe.stats() // dtlsState, ICE state, selected pair, RTP counters
 *   __dtlsProbe.report()      // everything above, as one object
 */
(() => {
  if (window.__dtlsProbe) {
    return 'dtls probe already installed';
  }

  const Native = window.RTCPeerConnection;
  const events = [];
  const pcs = [];

  /** Every distinct a=setup: value in an SDP, in order of first appearance. */
  const setupRoles = (sdp) => [
    ...new Set(
      String(sdp ?? '')
        .split(/\r?\n/)
        .filter((line) => line.startsWith('a=setup:'))
        .map((line) => line.slice('a=setup:'.length).trim()),
    ),
  ];

  const mids = (sdp) =>
    String(sdp ?? '')
      .split(/\r?\n/)
      .filter((line) => line.startsWith('a=mid:'))
      .map((line) => line.slice('a=mid:'.length).trim());

  const record = (entry) => {
    events.push({ at: Math.round(performance.now()), ...entry });
    return entry;
  };

  const Wrapped = function RTCPeerConnectionProbe(...args) {
    const pc = new Native(...args);
    const index = pcs.push(pc) - 1;

    for (const method of ['setLocalDescription', 'setRemoteDescription']) {
      const original = pc[method].bind(pc);
      pc[method] = async function probed(description) {
        // setLocalDescription() may legally be called with no argument, in
        // which case the description only exists after it resolves.
        const before = description?.sdp;
        try {
          const result = await original(description);
          const applied =
            before ?? (method === 'setLocalDescription' ? pc.localDescription?.sdp : pc.remoteDescription?.sdp);
          record({
            pc: index,
            op: method,
            side: method === 'setLocalDescription' ? 'browser' : 'sfu',
            type: description?.type ?? pc.currentLocalDescription?.type ?? 'unknown',
            setup: setupRoles(applied),
            mids: mids(applied),
            ok: true,
          });
          return result;
        } catch (error) {
          record({
            pc: index,
            op: method,
            side: method === 'setLocalDescription' ? 'browser' : 'sfu',
            type: description?.type ?? 'unknown',
            setup: setupRoles(before),
            mids: mids(before),
            ok: false,
            error: String(error?.message ?? error),
          });
          throw error;
        }
      };
    }

    pc.addEventListener('iceconnectionstatechange', () =>
      record({ pc: index, op: 'iceConnectionState', value: pc.iceConnectionState }),
    );
    pc.addEventListener('connectionstatechange', () =>
      record({ pc: index, op: 'connectionState', value: pc.connectionState }),
    );

    return pc;
  };

  Wrapped.prototype = Native.prototype;
  if (Native.generateCertificate) {
    Wrapped.generateCertificate = Native.generateCertificate.bind(Native);
  }
  window.RTCPeerConnection = Wrapped;

  /**
   * The DTLS role each side ended up with, derived from the SDP the browser
   * actually applied.
   *
   * a=setup in the *answer* decides it: active means the answerer is the
   * DTLS client, passive means the answerer is the DTLS server. Which side
   * authored the answer is what the `side` field records.
   */
  const roles = () =>
    pcs.map((pc, index) => {
      const answers = events.filter((e) => e.pc === index && e.type === 'answer' && e.ok);
      const last = answers[answers.length - 1];
      if (!last) {
        return { pc: index, browser: 'unknown', sfu: 'unknown' };
      }
      const answered = last.setup[0];
      const answererIsClient = answered === 'active';
      const answererIsBrowser = last.side === 'browser';
      const browserIsClient = answererIsBrowser ? answererIsClient : !answererIsClient;
      return {
        pc: index,
        answeredBy: last.side,
        answerSetup: answered,
        browser: browserIsClient ? 'DTLS client' : 'DTLS server',
        sfu: browserIsClient ? 'DTLS server' : 'DTLS client',
      };
    });

  const stats = async () =>
    Promise.all(
      pcs.map(async (pc, index) => {
        const out = {
          pc: index,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState,
          transports: [],
          inbound: [],
          outbound: [],
        };
        const report = await pc.getStats();
        report.forEach((s) => {
          if (s.type === 'transport') {
            out.transports.push({
              dtlsState: s.dtlsState,
              // Chrome exposes this; where it does not, roles() derives it
              // from the SDP instead.
              dtlsRole: s.dtlsRole ?? '(not reported)',
              iceState: s.iceState,
              srtpCipher: s.srtpCipher,
              bytesSent: s.bytesSent,
              bytesReceived: s.bytesReceived,
              selectedCandidatePairId: s.selectedCandidatePairId,
            });
          }
          if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) {
            out.selectedPair = { state: s.state, bytesSent: s.bytesSent, bytesReceived: s.bytesReceived };
          }
          if (s.type === 'inbound-rtp') {
            out.inbound.push({
              kind: s.kind,
              packets: s.packetsReceived,
              bytes: s.bytesReceived,
              frames: s.framesDecoded,
            });
          }
          if (s.type === 'outbound-rtp') {
            out.outbound.push({ kind: s.kind, packets: s.packetsSent, bytes: s.bytesSent, frames: s.framesEncoded });
          }
        });
        return out;
      }),
    );

  const report = async () => ({ events, roles: roles(), stats: await stats() });

  window.__dtlsProbe = { events, pcs, native: Native, setupRoles, roles, stats, report };
  return 'dtls probe installed';
})();
