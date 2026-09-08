import { FrameScheduler } from '@/engine/frame-scheduler';

jest.useFakeTimers();

function fakeVideo(rvfcImpl: ((cb: (now: number) => void) => number) | undefined) {
  return {
    requestVideoFrameCallback: rvfcImpl,
    cancelVideoFrameCallback: jest.fn(),
  } as unknown as HTMLVideoElement;
}

describe('FrameScheduler', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('uses requestVideoFrameCallback when it actually fires', () => {
    let pendingCb: ((now: number) => void) | undefined;
    const rvfc = jest.fn((cb: (now: number) => void) => {
      pendingCb = cb;
      return 1;
    });
    const video = fakeVideo(rvfc);
    const onFrame = jest.fn();

    new FrameScheduler(video, onFrame).start();
    pendingCb?.(123);

    expect(onFrame).toHaveBeenCalledWith(123);
    expect(rvfc).toHaveBeenCalledTimes(2); // initial + rescheduled after the frame fired
  });

  it('falls back to requestAnimationFrame if requestVideoFrameCallback never fires within the watchdog window', () => {
    const rvfc = jest.fn(() => 1); // registers but never invokes its callback; the bug this guards against
    const video = fakeVideo(rvfc);
    const onFrame = jest.fn();
    let rafCalls = 0;
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls += 1;
      if (rafCalls === 1) cb(999); // fire the first rAF frame only, to avoid recursing forever in a fake-timer test
      return 1;
    });

    new FrameScheduler(video, onFrame).start();
    expect(onFrame).not.toHaveBeenCalled();

    jest.advanceTimersByTime(800); // past the 750ms watchdog

    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(rafSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('uses requestAnimationFrame directly when requestVideoFrameCallback does not exist at all', () => {
    const video = fakeVideo(undefined);
    const onFrame = jest.fn();
    let rafCalls = 0;
    const rafSpy = jest.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCalls += 1;
      if (rafCalls === 1) cb(42);
      return 1;
    });

    new FrameScheduler(video, onFrame).start();

    expect(onFrame).toHaveBeenCalledWith(expect.any(Number));
    rafSpy.mockRestore();
  });

  it('stop() prevents any further frames, including a late-firing stale rVFC callback', () => {
    let pendingCb: ((now: number) => void) | undefined;
    const rvfc = jest.fn((cb: (now: number) => void) => {
      pendingCb = cb;
      return 1;
    });
    const video = fakeVideo(rvfc);
    const onFrame = jest.fn();

    const scheduler = new FrameScheduler(video, onFrame);
    scheduler.start();
    scheduler.stop();
    pendingCb?.(1);

    expect(onFrame).not.toHaveBeenCalled();
  });
});
