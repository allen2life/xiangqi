import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SaveManager, type GameSaveData } from './SaveManager';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

function state(turnCount: number): GameSaveData {
  return {
    _wasmState: [3, 0, 0, 0], level: 4, phase: 'select_hand', turnCount, score: turnCount,
    gameResult: 'none', boardCols: 7, boardRows: 7, units: [], placedUnitIds: [], boardPieceUnitIds: [],
  };
}

describe('turn snapshot persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  it('initializes and rotates explicit current/previous generations without losing them on resume', () => {
    expect(SaveManager.initializeTurnSnapshots(state(0))).toBe(true);
    expect(SaveManager.rotateTurnSnapshots(state(1))).toBe(true);

    expect(SaveManager.loadPreviousTurnSnapshot()?.turnCount).toBe(0);
    expect(SaveManager.loadTurnSnapshot()?.turnCount).toBe(1);
    expect(SaveManager.loadPreviousTurnSnapshot()?.turnCount).toBe(0);
  });

  it('commits paid undo to checkpoint/current before clearing previous', () => {
    SaveManager.initializeTurnSnapshots(state(0));
    SaveManager.rotateTurnSnapshots(state(1));

    expect(SaveManager.commitPaidUndo(state(0))).toBe(true);
    expect(SaveManager.loadGameState()?.turnCount).toBe(0);
    expect(SaveManager.loadTurnSnapshot()?.turnCount).toBe(0);
    expect(SaveManager.loadPreviousTurnSnapshot()).toBeNull();
  });

  it('keeps the previous undo source and rolls back partial writes when paid-undo persistence fails', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    SaveManager.initializeTurnSnapshots(state(0));
    SaveManager.rotateTurnSnapshots(state(1));
    const originalSet = storage.setItem.bind(storage);
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === SaveManager.TURN_SNAPSHOT_KEY && SaveManager.loadTurnSnapshot()?.turnCount === 1) throw new Error('quota');
      originalSet(key, value);
    });

    expect(SaveManager.commitPaidUndo(state(0))).toBe(false);
    expect(SaveManager.loadTurnSnapshot()?.turnCount).toBe(1);
    expect(SaveManager.loadPreviousTurnSnapshot()?.turnCount).toBe(0);
  });
});
