import { render, screen } from '@testing-library/react';
import { RavenStoreContext } from '../src/context';
import { LocalParticipantView, ParticipantView, RavenAudio, RavenVideo } from '../src/components';
import type { RavenSnapshot } from '../src/store';

function fakeTrack(kind: string) {
  return {
    kind,
    isMuted: false,
    attach: jest.fn((el?: HTMLMediaElement) => el ?? document.createElement('video')),
    detach: jest.fn(() => []),
  };
}

function fakeParticipant(identity: string, tracks: ReturnType<typeof fakeTrack>[]) {
  return { identity, tracks, metadata: undefined };
}

/** Minimal store double — just enough for useLocalParticipant()'s useSyncExternalStore call. */
function fakeStore(snapshot: Partial<RavenSnapshot>) {
  const full: RavenSnapshot = { connectionState: 'connected', remoteParticipants: [], reconnectCount: 0, ...snapshot };
  return { subscribe: () => () => {}, getSnapshot: () => full };
}

describe('RavenVideo', () => {
  it('attaches the given track to its video element, and detaches on unmount', () => {
    const track = fakeTrack('camera');
    const { unmount } = render(<RavenVideo track={track as never} data-testid="video" />);

    expect(track.attach).toHaveBeenCalledTimes(1);

    unmount();
    expect(track.detach).toHaveBeenCalledTimes(1);
  });

  it('renders a bare <video> element with no track, without attaching anything', () => {
    render(<RavenVideo data-testid="video" />);
    expect(screen.getByTestId('video').tagName).toBe('VIDEO');
  });
});

describe('RavenAudio', () => {
  it('attaches the given track to its audio element', () => {
    const track = fakeTrack('microphone');
    render(<RavenAudio track={track as never} data-testid="audio" />);

    expect(track.attach).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('audio').tagName).toBe('AUDIO');
  });
});

describe('ParticipantView', () => {
  it('renders the video track, audio track, and identity label for a participant', () => {
    const camera = fakeTrack('camera');
    const mic = fakeTrack('microphone');
    const participant = fakeParticipant('alice', [camera, mic]);

    render(<ParticipantView participant={participant as never} />);

    expect(camera.attach).toHaveBeenCalledTimes(1);
    expect(mic.attach).toHaveBeenCalledTimes(1);
    expect(screen.getByText('alice')).toBeTruthy();
  });

  it('renders no video/audio elements for a participant with no tracks yet', () => {
    const participant = fakeParticipant('bob', []);
    const { container } = render(<ParticipantView participant={participant as never} />);

    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByText('bob')).toBeTruthy();
  });

  it('accepts a custom label overriding the identity text', () => {
    const participant = fakeParticipant('carol', []);
    render(<ParticipantView participant={participant as never} label="You" />);

    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByText('carol')).toBeNull();
  });
});

describe('LocalParticipantView', () => {
  it('renders nothing before a local participant exists', () => {
    const store = fakeStore({ localParticipant: undefined });
    const { container } = render(
      <RavenStoreContext.Provider value={store as never}>
        <LocalParticipantView />
      </RavenStoreContext.Provider>,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the local participant once it exists on the store', () => {
    const local = fakeParticipant('local-user', []);
    const store = fakeStore({ localParticipant: local as never });

    render(
      <RavenStoreContext.Provider value={store as never}>
        <LocalParticipantView />
      </RavenStoreContext.Provider>,
    );

    expect(screen.getByText('local-user')).toBeTruthy();
  });
});
