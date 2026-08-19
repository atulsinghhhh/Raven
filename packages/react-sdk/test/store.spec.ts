jest.mock('@corvidhq/rtc', () => require('./helpers/fake-rtc-client'));

import { FakeParticipant, FakeRoom, lastClient, resetFakeRtc } from './helpers/fake-rtc-client';
import { RavenStore } from '../src/store';

describe('RavenStore', () => {
  beforeEach(() => {
    resetFakeRtc();
  });

  it('starts at connectionState "idle" before init()/join()', () => {
    const store = new RavenStore();
    expect(store.getSnapshot().connectionState).toBe('idle');
  });

  it('init() creates a client and makes it available on the snapshot', () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });

    expect(store.getSnapshot().client).toBeDefined();
  });

  it('join() resolves to "connected" state and populates room/localParticipant', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);

    await store.join('room-1');

    const snapshot = store.getSnapshot();
    expect(snapshot.connectionState).toBe('connected');
    expect(snapshot.room).toBe(room);
    expect(snapshot.localParticipant?.identity).toBe('local-user');
  });

  it('join() sets connectionState "failed" and records the error when the client rejects', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    lastClient().pendingJoin.reject(new Error('boom'));

    await expect(store.join('room-1')).rejects.toThrow('boom');
    expect(store.getSnapshot().connectionState).toBe('failed');
    expect(store.getSnapshot().error).toBeInstanceOf(Error);
  });

  it('notifies subscribers on every state change', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);
    const listener = jest.fn();
    store.subscribe(listener);

    await store.join('room-1');

    expect(listener).toHaveBeenCalled();
  });

  it('a new snapshot object is produced on every patch (referential inequality for useSyncExternalStore)', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const before = store.getSnapshot();
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);

    await store.join('room-1');

    expect(store.getSnapshot()).not.toBe(before);
  });

  it('reflects a remote participant joining, with a fresh remoteParticipants array reference each time', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);
    await store.join('room-1');
    const before = store.getSnapshot().remoteParticipants;

    const bob = new FakeParticipant('bob');
    room.remoteParticipants.push(bob);
    room.emit('participantJoined', bob);

    const after = store.getSnapshot().remoteParticipants;
    expect(after).not.toBe(before);
    expect(after).toEqual([bob]);
  });

  it('increments reconnectCount on "reconnecting", never resets it back down on its own', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);
    await store.join('room-1');

    room.emit('reconnecting');
    room.emit('reconnecting');

    expect(store.getSnapshot().reconnectCount).toBe(2);
  });

  it('leave() detaches room listeners so a later emit no longer changes the snapshot', async () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });
    const room = new FakeRoom('room-1');
    lastClient().pendingJoin.resolve(room);
    await store.join('room-1');

    await store.leave();
    expect(lastClient().leaveMock).toHaveBeenCalledTimes(1);

    const snapshotAfterLeave = store.getSnapshot();
    room.emit('reconnecting');
    expect(store.getSnapshot()).toBe(snapshotAfterLeave); // no patch happened — listener was detached
  });

  it('dispose() detaches listeners and calls leave() on the client, without throwing if never joined', () => {
    const store = new RavenStore();
    store.init({ token: 't', endpoint: 'wss://rtc.example.com' });

    expect(() => store.dispose()).not.toThrow();
    expect(lastClient().leaveMock).toHaveBeenCalledTimes(1);
  });
});
