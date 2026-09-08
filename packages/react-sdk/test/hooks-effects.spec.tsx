jest.mock('@ravenkash/rtc', () => require('./helpers/fake-rtc-client'));

import { act, render, screen, waitFor } from '@testing-library/react';
import { FakeRoom, lastClient, resetFakeRtc } from './helpers/fake-rtc-client';
import { RavenRoom } from '../src/raven-room';
import { useCameraEffects } from '../src/hooks';
import { filters } from '@ravenkash/effects';

async function renderJoined(children: React.ReactNode) {
  const room = new FakeRoom('room-1');
  render(
    <RavenRoom token="t" endpoint="wss://rtc.example.com" room="room-1">
      {children}
    </RavenRoom>,
  );
  await act(async () => {
    lastClient().pendingJoin.resolve(room);
    await lastClient().pendingJoin.promise;
  });
  return room;
}

function fakeCameraTrack() {
  return {
    kind: 'camera' as const,
    attachEffects: jest.fn().mockResolvedValue(undefined),
    detachEffects: jest.fn().mockResolvedValue(undefined),
  };
}

describe('useCameraEffects', () => {
  beforeEach(() => resetFakeRtc());

  it('starts with an empty, enabled pipeline and no attachment before a camera track exists', async () => {
    let result!: ReturnType<typeof useCameraEffects>;
    function Probe() {
      result = useCameraEffects();
      return <div>{result.isAttached ? 'attached' : 'detached'}</div>;
    }

    await renderJoined(<Probe />);

    expect(screen.getByText('detached')).toBeTruthy();
    expect(result.effects).toHaveLength(0);
    expect(result.isEnabled).toBe(true);
  });

  it('calls track.attachEffects(pipeline) once a camera track is published, and reports isAttached', async () => {
    function Probe() {
      const effects = useCameraEffects();
      return <div>{effects.isAttached ? 'attached' : 'detached'}</div>;
    }

    const room = await renderJoined(<Probe />);
    const track = fakeCameraTrack();
    act(() => {
      room.localParticipant.tracks.push(track);
      room.emit('localTrackPublished', track);
    });

    await waitFor(() => expect(screen.getByText('attached')).toBeTruthy());
    expect(track.attachEffects).toHaveBeenCalledTimes(1);
  });

  it('add()/remove()/update()/clear() mutate the pipeline and re-render the component', async () => {
    let result!: ReturnType<typeof useCameraEffects>;
    function Probe() {
      result = useCameraEffects();
      return <div>{result.effects.length}</div>;
    }

    await renderJoined(<Probe />);

    let instanceId = '';
    act(() => {
      const instance = result.add(filters.brightness({ value: 0.2 }));
      instanceId = instance.id;
    });
    await waitFor(() => expect(screen.getByText('1')).toBeTruthy());
    expect(result.effects[0].params.value).toBe(0.2);

    act(() => result.update(instanceId, { value: 0.5 }));
    await waitFor(() => expect(result.effects[0].params.value).toBe(0.5));

    act(() => result.clear());
    await waitFor(() => expect(screen.getByText('0')).toBeTruthy());
  });

  it('enable()/disable() toggle isEnabled and re-render', async () => {
    let result!: ReturnType<typeof useCameraEffects>;
    function Probe() {
      result = useCameraEffects();
      return <div>{result.isEnabled ? 'on' : 'off'}</div>;
    }

    await renderJoined(<Probe />);
    expect(screen.getByText('on')).toBeTruthy();

    act(() => result.disable());
    await waitFor(() => expect(screen.getByText('off')).toBeTruthy());

    act(() => result.enable());
    await waitFor(() => expect(screen.getByText('on')).toBeTruthy());
  });

  it('calls track.detachEffects() when the camera track is unpublished/unmounted', async () => {
    function Probe() {
      const effects = useCameraEffects();
      return <div>{effects.isAttached ? 'attached' : 'detached'}</div>;
    }

    const room = await renderJoined(<Probe />);
    const track = fakeCameraTrack();
    act(() => {
      room.localParticipant.tracks.push(track);
      room.emit('localTrackPublished', track);
    });
    await waitFor(() => expect(screen.getByText('attached')).toBeTruthy());

    act(() => {
      room.localParticipant.tracks = [];
      room.emit('localTrackUnpublished', track);
    });

    await waitFor(() => expect(screen.getByText('detached')).toBeTruthy());
    expect(track.detachEffects).toHaveBeenCalled();
  });
});
