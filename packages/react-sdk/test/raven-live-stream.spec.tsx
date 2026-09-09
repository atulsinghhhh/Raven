import { FakeParticipant, FakeRoom } from './helpers/fake-rtc-client';

class FakeChatClient {
  readonly userId = 'user-1';
  connectionState = 'connected';
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  readonly messages = {
    list: async () => ({ data: [], nextCursor: null, hasMore: false }),
    addReaction: async () => ({ reactions: [] }),
    removeReaction: async () => ({ reactions: [] }),
  };

  on(event: string, handler: (payload: unknown) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }

  disconnect = jest.fn(async () => undefined);
  async getPresence(): Promise<unknown[]> {
    return [];
  }
  async getReadReceipts(): Promise<unknown[]> {
    return [];
  }
}

function fakeStream(overrides: { isHost?: boolean; room?: FakeRoom; chat?: FakeChatClient | null } = {}) {
  const room = overrides.room ?? new FakeRoom('room-1');
  const chat = overrides.chat === null ? undefined : overrides.chat ?? new FakeChatClient();
  const role = overrides.isHost ? 'HOST' : 'VIEWER';
  return {
    streamId: 'stream_1',
    role,
    rtc: { leave: jest.fn(async () => undefined) },
    room,
    chat,
    isHost: Boolean(overrides.isHost),
    leave: jest.fn(async () => undefined),
    react: jest.fn(async () => undefined),
  };
}

const joinLiveStream = jest.fn();
jest.mock('@ravenkash/client', () => ({ joinLiveStream: (...args: unknown[]) => joinLiveStream(...args) }));

import { act, render, screen, waitFor } from '@testing-library/react';
import { RavenLiveStream } from '../src/live/raven-live-stream';
import { useLiveStream, useLiveStreamHost, useLiveStreamViewer } from '../src/live/live-hooks';
import { useParticipants } from '../src/hooks';
import { useMessages } from '../src/chat/chat-hooks';

const CREDENTIALS = { streamId: 'stream_1', role: 'VIEWER' as const, rtc: { token: 't', endpoint: 'wss://rtc.example.com' } };

function StatusProbe() {
  const { status, isHost } = useLiveStream();
  return <div data-testid="status">{status}:{String(isHost)}</div>;
}

function ParticipantsProbe() {
  const participants = useParticipants();
  return <div data-testid="participants">{participants.length}</div>;
}

function MessagesProbe() {
  const { messages } = useMessages();
  return <div data-testid="messages">{messages.length}</div>;
}

describe('<RavenLiveStream>', () => {
  beforeEach(() => {
    joinLiveStream.mockReset();
  });

  it('shows the fallback while joining, then renders children once ready', async () => {
    let resolveJoin!: (stream: unknown) => void;
    joinLiveStream.mockReturnValue(new Promise((resolve) => (resolveJoin = resolve)));

    render(
      <RavenLiveStream credentials={CREDENTIALS} fallback={<div>Connecting…</div>}>
        <div>Live!</div>
      </RavenLiveStream>,
    );

    expect(screen.queryByText('Connecting…')).not.toBeNull();
    expect(screen.queryByText('Live!')).toBeNull();

    act(() => resolveJoin(fakeStream()));
    await waitFor(() => expect(screen.queryByText('Live!')).not.toBeNull());
  });

  it('calls onError and shows the fallback when joinLiveStream() rejects', async () => {
    const onError = jest.fn();
    joinLiveStream.mockRejectedValue(new Error('nope'));

    render(
      <RavenLiveStream credentials={CREDENTIALS} fallback={<div>Failed</div>} onError={onError}>
        <div>Live!</div>
      </RavenLiveStream>,
    );

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(screen.queryByText('Live!')).toBeNull();
  });

  it('exposes role/isHost through useLiveStream()', async () => {
    joinLiveStream.mockResolvedValue(fakeStream({ isHost: true }));

    render(
      <RavenLiveStream credentials={{ ...CREDENTIALS, role: 'HOST' }}>
        <StatusProbe />
      </RavenLiveStream>,
    );

    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready:true'));
  });

  it('makes useParticipants() work automatically, without a separate live-streaming hook', async () => {
    const room = new FakeRoom('room-1');
    joinLiveStream.mockResolvedValue(fakeStream({ room }));

    render(
      <RavenLiveStream credentials={CREDENTIALS}>
        <ParticipantsProbe />
      </RavenLiveStream>,
    );
    await waitFor(() => expect(screen.getByTestId('participants').textContent).toBe('1')); // local participant

    act(() => {
      room.remoteParticipants.push(new FakeParticipant('bob'));
      room.emit('participantJoined');
    });

    await waitFor(() => expect(screen.getByTestId('participants').textContent).toBe('2'));
  });

  it('makes useMessages() work automatically when the stream has chat', async () => {
    const chat = new FakeChatClient();
    joinLiveStream.mockResolvedValue(fakeStream({ chat }));

    render(
      <RavenLiveStream credentials={{ ...CREDENTIALS, chat: { token: 't', conversations: ['conv_1'] } }}>
        <MessagesProbe />
      </RavenLiveStream>,
    );
    await waitFor(() => expect(screen.getByTestId('messages').textContent).toBe('0'));

    act(() => chat.emit('message', { id: 'm1', reactions: [] }));

    await waitFor(() => expect(screen.getByTestId('messages').textContent).toBe('1'));
  });

  it('never calls client.connect()/disconnect() a chat client already connected before joining', async () => {
    const chat = new FakeChatClient();
    joinLiveStream.mockResolvedValue(fakeStream({ chat }));

    const { unmount } = render(
      <RavenLiveStream credentials={{ ...CREDENTIALS, chat: { token: 't', conversations: ['conv_1'] } }}>
        <div>Live!</div>
      </RavenLiveStream>,
    );
    await waitFor(() => expect(screen.queryByText('Live!')).not.toBeNull());

    unmount();

    // Teardown goes through stream.leave(), never the store's own
    // disconnect. Do both and the socket gets disconnected twice.
    expect(chat.disconnect).not.toHaveBeenCalled();
  });

  it('calls stream.leave() exactly once on unmount', async () => {
    const stream = fakeStream();
    joinLiveStream.mockResolvedValue(stream);

    const { unmount } = render(
      <RavenLiveStream credentials={CREDENTIALS}>
        <div>Live!</div>
      </RavenLiveStream>,
    );
    await waitFor(() => expect(screen.queryByText('Live!')).not.toBeNull());

    unmount();

    expect(stream.leave).toHaveBeenCalledTimes(1);
  });

  it('useLiveStreamHost() throws for a VIEWER-role stream', async () => {
    joinLiveStream.mockResolvedValue(fakeStream({ isHost: false }));
    let caught: unknown;
    function HostProbe() {
      try {
        useLiveStreamHost();
      } catch (error) {
        caught = error;
      }
      return null;
    }

    render(
      <RavenLiveStream credentials={CREDENTIALS}>
        <HostProbe />
      </RavenLiveStream>,
    );

    await waitFor(() => expect(caught).toBeInstanceOf(Error));
  });

  it('useLiveStreamViewer() throws for a HOST-role stream', async () => {
    joinLiveStream.mockResolvedValue(fakeStream({ isHost: true }));
    let caught: unknown;
    function ViewerProbe() {
      try {
        useLiveStreamViewer();
      } catch (error) {
        caught = error;
      }
      return null;
    }

    render(
      <RavenLiveStream credentials={{ ...CREDENTIALS, role: 'HOST' }}>
        <ViewerProbe />
      </RavenLiveStream>,
    );

    await waitFor(() => expect(caught).toBeInstanceOf(Error));
  });
});
