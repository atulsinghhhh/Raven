export function createFakeVideoTrack(overrides: Partial<MediaStreamTrack> = {}): MediaStreamTrack {
  const track = {
    kind: 'video',
    id: 'fake-track',
    enabled: true,
    muted: false,
    readyState: 'live',
    getSettings: () => ({ width: 1280, height: 720, frameRate: 30 }),
    stop: () => {},
    clone: () => createFakeVideoTrack(overrides),
    addEventListener: () => {},
    removeEventListener: () => {},
    ...overrides,
  };
  return track as unknown as MediaStreamTrack;
}
