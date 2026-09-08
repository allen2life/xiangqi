import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReplayPlaybackRunner, ReplayPlaybackHost } from './ReplayPlaybackRunner';
import type { XqbrRecord } from './ReplayController';

describe('ReplayPlaybackRunner', () => {
  let mockHost: ReplayPlaybackHost;
  let runner: ReplayPlaybackRunner;

  beforeEach(() => {
    mockHost = {
      onPlace: vi.fn(),
      onUndo: vi.fn(),
      onSkip: vi.fn(),
      onConfirm: vi.fn(),
      onUseItem: vi.fn(),
      onComplete: vi.fn(),
      onClose: vi.fn(),
      isAnimating: vi.fn().mockReturnValue(false),
      isGameOver: vi.fn().mockReturnValue(false),
      showToast: vi.fn(),
    };
    runner = new ReplayPlaybackRunner(mockHost);
  });

  it('steps through replay actions accurately', () => {
    const mockRecord: XqbrRecord = {
      mode: 0,
      levelId: 1,
      rngSeed: 12345,
      configJson: '',
      actions: [
        { type: 1, code: 2, count: 1, arg0: 4, arg1: 8, arg2: 0 },
        { type: 2, code: 0, count: 0, arg0: 0, arg1: 0, arg2: 0 },
        { type: 3, code: 0, count: 0, arg0: 0, arg1: 0, arg2: 0 },
        { type: 4, code: 0, count: 0, arg0: 0, arg1: 0, arg2: 0 },
        { type: 8, code: 10, count: 1, arg0: 0, arg1: 0, arg2: 0 },
      ],
    };

    runner.start(mockRecord);
    expect(runner.isReplay).toBe(true);
    expect(runner.currentRecord).toBe(mockRecord);

    // Initial state after start (start calls step in tick, but timer is mock or immediate)
    // Step manually to check actions
    runner.step(); // action 1: PLACE
    expect(mockHost.onPlace).toHaveBeenCalledWith(2, 4, 8);

    runner.step(); // action 2: UNDO
    expect(mockHost.onUndo).toHaveBeenCalled();

    runner.step(); // action 3: SKIP
    expect(mockHost.onSkip).toHaveBeenCalled();

    runner.step(); // action 4: CONFIRM
    expect(mockHost.onConfirm).toHaveBeenCalled();

    runner.step(); // action 8: USE_ITEM
    expect(mockHost.onUseItem).toHaveBeenCalledWith(10);

    runner.step(); // past end -> onComplete
    expect(mockHost.onComplete).toHaveBeenCalled();
  });

  it('handles speed changes and pause/play state', () => {
    const mockRecord: XqbrRecord = {
      mode: 0,
      levelId: 2,
      rngSeed: 999,
      configJson: '',
      actions: [],
    };

    runner.start(mockRecord);
    runner.setSpeed(2);
    expect(runner.currentSpeed).toBe(2);

    runner.pause();
    expect(runner.running).toBe(false);

    runner.destroy();
    expect(runner.isReplay).toBe(false);
  });
});
