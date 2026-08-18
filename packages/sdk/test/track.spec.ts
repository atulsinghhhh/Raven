import { LocalTrack, RemoteTrack } from '../src/track';
import type { LocalTrackDelegate, TrackDelegate } from '../src/track';

function fakeMediaStreamTrack(): MediaStreamTrack {
  return { id: 'track-1', stop: jest.fn() } as unknown as MediaStreamTrack;
}

function fakeDelegate(overrides: Partial<LocalTrackDelegate> = {}): LocalTrackDelegate {
  return {
    mediaStreamTrack: fakeMediaStreamTrack(),
    mediaStream: undefined,
    isMuted: false,
    attach: jest.fn((el?: HTMLMediaElement) => el ?? document.createElement('video')),
    detach: jest.fn((el?: HTMLMediaElement) => (el ? el : [])),
    mute: jest.fn().mockResolvedValue(undefined),
    unmute: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('RemoteTrack', () => {
  it('exposes kind, mediaStreamTrack, mediaStream, and isMuted from its delegate', () => {
    const delegate: TrackDelegate = {
      mediaStreamTrack: fakeMediaStreamTrack(),
      mediaStream: new MediaStream(),
      isMuted: true,
      attach: jest.fn(() => document.createElement('video')),
      detach: jest.fn(() => []),
    };

    const track = new RemoteTrack(delegate, 'camera');

    expect(track.kind).toBe('camera');
    expect(track.mediaStreamTrack).toBe(delegate.mediaStreamTrack);
    expect(track.mediaStream).toBe(delegate.mediaStream);
    expect(track.isMuted).toBe(true);
  });

  it('attach() delegates to the underlying track and returns the element', () => {
    const delegate = fakeDelegate();
    const track = new RemoteTrack(delegate, 'microphone');
    const el = document.createElement('audio');

    const result = track.attach(el);

    expect(delegate.attach).toHaveBeenCalledWith(el);
    expect(result).toBe(el);
  });

  it('detach() always normalizes to an array, whether the delegate returns one element or a list', () => {
    const el = document.createElement('video');
    const singleReturnDelegate = fakeDelegate({ detach: jest.fn(() => el) });
    const arrayReturnDelegate = fakeDelegate({ detach: jest.fn(() => [el]) });

    expect(new RemoteTrack(singleReturnDelegate, 'camera').detach(el)).toEqual([el]);
    expect(new RemoteTrack(arrayReturnDelegate, 'camera').detach()).toEqual([el]);
  });
});

describe('LocalTrack', () => {
  it('mute()/unmute() delegate to the underlying track', async () => {
    const delegate = fakeDelegate();
    const track = new LocalTrack(delegate, 'camera');

    await track.mute();
    await track.unmute();

    expect(delegate.mute).toHaveBeenCalledTimes(1);
    expect(delegate.unmute).toHaveBeenCalledTimes(1);
  });

  it('stop() stops the underlying native MediaStreamTrack', () => {
    const delegate = fakeDelegate();
    const track = new LocalTrack(delegate, 'microphone');

    track.stop();

    expect(delegate.mediaStreamTrack.stop).toHaveBeenCalledTimes(1);
  });
});
