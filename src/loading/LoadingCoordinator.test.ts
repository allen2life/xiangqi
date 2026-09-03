import { describe, expect, it, vi } from 'vitest';
import {
  LoadingCoordinator,
  createLoadingState,
  createOnceGuard,
  updateLoadingTask,
  type LoadingTask,
} from './LoadingCoordinator';

function task(overrides: Partial<LoadingTask> & Pick<LoadingTask, 'id'>): LoadingTask {
  return {
    label: overrides.id,
    weight: 1,
    required: true,
    run: async () => undefined,
    ...overrides,
  };
}

describe('pure loading state', () => {
  it('calculates settled progress by task weight', () => {
    const tasks = [task({ id: 'engine', weight: 3 }), task({ id: 'audio', weight: 1, required: false })];
    const initial = createLoadingState(tasks);
    const afterEngine = updateLoadingTask(initial, 'engine', { status: 'succeeded', attempts: 1 });

    expect(initial.progress).toBe(0);
    expect(afterEngine.progress).toBe(0.75);
    expect(afterEngine.canContinue).toBe(false);
  });

  it('permits continuation after optional failure but blocks required failure', () => {
    const tasks = [task({ id: 'engine' }), task({ id: 'audio', required: false })];
    let state = createLoadingState(tasks);
    state = updateLoadingTask(state, 'engine', { status: 'succeeded', attempts: 1 });
    state = updateLoadingTask(state, 'audio', { status: 'failed', attempts: 1, error: 'muted' });

    expect(state.canContinue).toBe(true);
    expect(state.requiredFailures).toHaveLength(0);
    expect(state.optionalFailures.map((failed) => failed.id)).toEqual(['audio']);

    const blocked = updateLoadingTask(state, 'engine', { status: 'failed', error: 'wasm unavailable' });
    expect(blocked.canContinue).toBe(false);
    expect(blocked.requiredFailures.map((failed) => failed.id)).toEqual(['engine']);
  });
});

describe('startup mount guard', () => {
  it('allows exactly one caller to claim dismissal and mount', () => {
    const claim = createOnceGuard();

    expect(claim()).toBe(true);
    expect(claim()).toBe(false);
    expect(claim()).toBe(false);
  });
});

describe('LoadingCoordinator', () => {
  it('shares an in-flight run and executes each task once', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(() => pending);
    const coordinator = new LoadingCoordinator([task({ id: 'engine', run })]);

    const first = coordinator.run();
    const second = coordinator.run();
    expect(second).toBe(first);
    expect(run).toHaveBeenCalledTimes(1);

    release();
    await first;
    expect(coordinator.snapshot.canContinue).toBe(true);
  });

  it('retries only failed tasks and increments attempts', async () => {
    const requiredRun = vi.fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(undefined);
    const optionalRun = vi.fn().mockResolvedValue(undefined);
    const coordinator = new LoadingCoordinator([
      task({ id: 'engine', run: requiredRun }),
      task({ id: 'audio', required: false, run: optionalRun }),
    ]);

    const failed = await coordinator.run();
    expect(failed.canContinue).toBe(false);
    expect(failed.canRetry).toBe(true);

    const recovered = await coordinator.retryFailed();
    expect(recovered.canContinue).toBe(true);
    expect(requiredRun).toHaveBeenCalledTimes(2);
    expect(optionalRun).toHaveBeenCalledTimes(1);
    expect(recovered.tasks.find((entry) => entry.id === 'engine')?.attempts).toBe(2);
  });
});
