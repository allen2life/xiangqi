import { afterEach, describe, expect, it, vi } from 'vitest';

const howlOptions: Array<{
  onload: () => void;
  onloaderror: (soundId: number | null, error: unknown) => void;
}> = [];
const unload = vi.fn();

vi.mock('howler', () => ({
  Howl: vi.fn((options: {
    onload: () => void;
    onloaderror: (soundId: number | null, error: unknown) => void;
  }) => {
    howlOptions.push(options);
    return { play: vi.fn(), stop: vi.fn(), volume: vi.fn(), unload };
  }),
  Howler: { ctx: null },
}));

import { AudioManager } from './AudioManager';

afterEach(() => {
  AudioManager.getInstance().destroy();
  howlOptions.length = 0;
  unload.mockClear();
});

describe('AudioManager.initialize', () => {
  it('waits for every Howl load event and shares the in-flight initialization', async () => {
    const audio = AudioManager.getInstance();
    const first = audio.initialize();
    const second = audio.initialize();
    let settled = false;
    void first.then(() => { settled = true; });

    await vi.waitFor(() => expect(howlOptions.length).toBeGreaterThan(0));
    expect(second).toBe(first);
    expect(settled).toBe(false);

    howlOptions.forEach(({ onload }) => onload());
    await expect(first).resolves.toBeUndefined();
    expect(settled).toBe(true);
  });

  it('contains optional runtime playback failures and avoids repeated decode retries', async () => {
    const audio = AudioManager.getInstance();
    const playback = audio.play('cannonFire');

    await vi.waitFor(() => expect(howlOptions.length).toBeGreaterThan(0));
    const constructed = howlOptions.length;
    howlOptions[0].onloaderror(null, 'decode failed');
    await expect(playback).resolves.toBeUndefined();

    await expect(audio.play('victory')).resolves.toBeUndefined();
    expect(howlOptions).toHaveLength(constructed);
  });

  it('rejects on loaderror, unloads partial sounds, and permits a successful retry', async () => {
    const audio = AudioManager.getInstance();
    const failed = audio.initialize();

    await vi.waitFor(() => expect(howlOptions.length).toBeGreaterThan(0));
    howlOptions[0].onloaderror(null, 'decode failed');
    await expect(failed).rejects.toThrow('decode failed');
    expect(unload).toHaveBeenCalled();

    howlOptions.length = 0;
    const retry = audio.initialize();
    await vi.waitFor(() => expect(howlOptions.length).toBeGreaterThan(0));
    howlOptions.forEach(({ onload }) => onload());
    await expect(retry).resolves.toBeUndefined();
  });
});
