import { useEffect, useState } from 'react';
import {
  ParticipantView,
  RavenRoom,
  useCamera,
  useConnectionState,
  useLocalParticipant,
  useMicrophone,
  useRaven,
  useRavenClient,
  useRemoteParticipants,
  useRoom,
  type DeviceInfo,
} from '@raven/react';
import './index.css';

// This is the ONE thing a developer needs to think about client-side:
// forward the full JSON body from your backend's `POST /rtc-tokens` call
// (see examples/node-server, examples/python-server) straight into
// <RavenRoom> — never mint a token here, and no LiveKit types appear
// anywhere in this file (Phase 11 spec §27).
interface ParsedToken {
  token: string;
  endpoint: string;
  roomName: string;
  iceServers?: RTCIceServer[];
  telemetryUrl?: string;
}

export function App() {
  const [parsed, setParsed] = useState<ParsedToken | null>(null);

  if (!parsed) {
    return <JoinForm onParsed={setParsed} />;
  }

  return (
    <RavenRoom
      token={parsed.token}
      endpoint={parsed.endpoint}
      room={parsed.roomName}
      iceServers={parsed.iceServers}
      telemetryUrl={parsed.telemetryUrl}
      fallback={<main>Connecting…</main>}
      onError={(error) => {
        alert(`Join failed: ${error.code} — ${error.message}`);
        setParsed(null);
      }}
    >
      <CallScreen onLeft={() => setParsed(null)} />
    </RavenRoom>
  );
}

function JoinForm({ onParsed }: { onParsed: (token: ParsedToken) => void }) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleJoin() {
    try {
      const json = JSON.parse(raw) as Partial<ParsedToken>;
      if (!json.token || !json.endpoint || !json.roomName) {
        throw new Error('Expected a JSON body with token, endpoint, and roomName fields');
      }
      setError(null);
      onParsed(json as ParsedToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main>
      <h1>Raven video-call example (@raven/react)</h1>
      <p>
        Paste the full JSON body returned by <code>POST /v1/rooms/:roomId/rtc-tokens</code> (mint one via Swagger at{' '}
        <code>/docs</code>, or use two different <code>participantIdentity</code> values in the same room to test a
        call between two tabs).
      </p>
      <textarea rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} />
      {error && <p style={{ color: '#ff6b6b' }}>{error}</p>}
      <div className="toolbar">
        <button onClick={handleJoin}>Join Room</button>
      </div>
    </main>
  );
}

function CallScreen({ onLeft }: { onLeft: () => void }) {
  const connectionState = useConnectionState();
  const { leave, reconnectCount, error } = useRaven();
  const local = useLocalParticipant();
  const remote = useRemoteParticipants();
  const camera = useCamera();
  const microphone = useMicrophone();
  const room = useRoom();
  const client = useRavenClient();

  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [sharingScreen, setSharingScreen] = useState(false);

  // Device enumeration + change detection (Phase 11 §7) — a real headless
  // use of the client that doesn't need its own dedicated hook.
  useEffect(() => {
    if (!client) return undefined;
    const refresh = () => {
      client.getDevices('videoinput').then(setVideoDevices);
      client.getDevices('audioinput').then(setAudioDevices);
    };
    refresh();
    return client.onDeviceChange(refresh);
  }, [client]);

  async function handleLeave() {
    await leave();
    onLeft();
  }

  async function toggleScreenShare() {
    if (!room) return;
    if (sharingScreen) {
      await room.disableScreenShare();
    } else {
      await room.enableScreenShare();
    }
    setSharingScreen(!sharingScreen);
  }

  return (
    <main>
      <div className="status-bar">
        <span>
          Status: <strong>{connectionState}</strong>
          {reconnectCount > 0 ? ` · reconnected ${reconnectCount}x` : ''}
          {error ? ` · last error: ${error.code}` : ''}
        </span>
        <button onClick={handleLeave}>Leave</button>
      </div>

      <div className="toolbar">
        <button onClick={() => (camera.enabled ? camera.disable() : camera.enable())}>
          Camera: {camera.enabled ? 'on' : 'off'}
        </button>
        <button onClick={() => (microphone.enabled ? microphone.disable() : microphone.enable())}>
          Mic: {microphone.enabled ? 'on' : 'off'}
        </button>
        <button onClick={toggleScreenShare}>{sharingScreen ? 'Stop sharing' : 'Share screen'}</button>

        <select
          aria-label="Camera device"
          onChange={(e) => room?.setCameraDevice(e.target.value)}
          disabled={videoDevices.length === 0}
        >
          <option value="">Camera…</option>
          {videoDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
        <select
          aria-label="Microphone device"
          onChange={(e) => room?.setMicrophoneDevice(e.target.value)}
          disabled={audioDevices.length === 0}
        >
          <option value="">Microphone…</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
      </div>

      <h2>You {local ? `(${local.identity})` : ''}</h2>
      <div className="tiles">{local && <ParticipantView participant={local} className="participant-tile" />}</div>

      <h2>Participants ({remote.length})</h2>
      <div className="tiles">
        {remote.length === 0 && <p style={{ color: '#9a9aa5' }}>No one else has joined yet.</p>}
        {remote.map((participant) => (
          <ParticipantView key={participant.identity} participant={participant} className="participant-tile" />
        ))}
      </div>
    </main>
  );
}
