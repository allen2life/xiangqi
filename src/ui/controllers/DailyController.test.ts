import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks (hoisted) ──
vi.mock('../../wasm/EngineBridge', () => ({
  engineBridge: {
    grantGold: vi.fn(),
    addPlatformItem: vi.fn(),
    platformSave: vi.fn(),
    platformSetBalance: vi.fn(),
    getPlatformItemCount: vi.fn().mockReturnValue(0),
  },
}));
vi.mock('../../cloud/api', () => ({
  walletGrant: vi.fn().mockResolvedValue({ code: 0, data: { balance: 1000, inventory: {} } }),
}));
vi.mock('../../core/SaveManager', () => ({
  SaveManager: {
    getHash: vi.fn().mockReturnValue('abcdef0123456789abcdef0123456789'),
  },
}));
vi.mock('../../i18n', () => ({
  t: vi.fn((key: string, params?: Record<string, string>) => {
    if (!params) return key;
    return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, v), key);
  }),
}));
vi.mock('../utils/domHelpers', () => ({ showToast: vi.fn() }));
vi.mock('../../config', () => ({ ITEM_DEFS: {} }));
vi.mock('../utils/pieceIcons', () => ({
  itemName: vi.fn().mockReturnValue('item'),
  PIECE_LABELS: {},
  PIECE_ICON_FILES: {},
  pieceIconTag: vi.fn(),
  itemIcon: vi.fn(),
}));

import { DailyController } from './DailyController';
import { walletGrant } from '../../cloud/api';
import { engineBridge } from '../../wasm/EngineBridge';

// ── In-memory localStorage ──
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const DAILY_KEY = 'daily_state_v1';

function readRawState(): Record<string, unknown> | null {
  const raw = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem(DAILY_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe('DailyController win streak', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.mocked(walletGrant).mockClear();
    vi.mocked(engineBridge.grantGold).mockClear();
    vi.mocked(engineBridge.addPlatformItem).mockClear();
    vi.mocked(engineBridge.platformSetBalance).mockClear();
  });

  it('increments winStreak on trackWinStreak', async () => {
    await DailyController.trackWinStreak();
    const s = readRawState()!;
    expect(s.winStreak).toBe(1);
    expect(s.claimedStreakMilestones).toEqual([]);
  });

  it('triggers milestone reward at 3 consecutive wins', async () => {
    await DailyController.trackWinStreak(); // 1
    await DailyController.trackWinStreak(); // 2
    vi.mocked(walletGrant).mockClear();
    await DailyController.trackWinStreak(); // 3 → milestone

    expect(walletGrant).toHaveBeenCalledTimes(1);
    // opId should contain streak_3 prefix
    const callArgs = vi.mocked(walletGrant).mock.calls[0];
    expect(callArgs[1]).toContain('streak_3');

    const s = readRawState()!;
    expect(s.winStreak).toBe(3);
    expect(s.claimedStreakMilestones).toContain(3);
  });

  it('triggers multiple milestones when jumping past threshold', async () => {
    // Win 5 times — should trigger both 3 and 5 milestones
    for (let i = 0; i < 5; i++) {
      await DailyController.trackWinStreak();
    }
    const s = readRawState()!;
    expect(s.winStreak).toBe(5);
    expect(s.claimedStreakMilestones).toContain(3);
    expect(s.claimedStreakMilestones).toContain(5);
  });

  it('does not re-trigger already claimed milestone', async () => {
    for (let i = 0; i < 3; i++) await DailyController.trackWinStreak(); // triggers milestone 3
    vi.mocked(walletGrant).mockClear();
    await DailyController.trackWinStreak(); // 4 — no new milestone
    expect(walletGrant).not.toHaveBeenCalled();
  });

  it('resets winStreak and claimed milestones on resetWinStreak', async () => {
    for (let i = 0; i < 5; i++) await DailyController.trackWinStreak();
    expect(readRawState()!.winStreak).toBe(5);

    DailyController.resetWinStreak();
    const s = readRawState()!;
    expect(s.winStreak).toBe(0);
    expect(s.claimedStreakMilestones).toEqual([]);
  });

  it('resetWinStreak is no-op when streak is already 0', () => {
    DailyController.resetWinStreak();
    const s = readRawState()!;
    expect(s.winStreak).toBe(0);
  });

  it('uses stable operation_id per milestone (idempotency)', async () => {
    // Win 3 → milestone 3 triggers with opId containing streak_3 + today + hashShort
    await DailyController.trackWinStreak();
    await DailyController.trackWinStreak();
    await DailyController.trackWinStreak();

    const firstOpId = vi.mocked(walletGrant).mock.calls[0][1];
    // OpId format: streak_3_YYYY-MM-DD_abcdef012345
    expect(firstOpId).toMatch(/^streak_3_\d{4}-\d{2}-\d{2}_abcdef012345$/);
  });

  it('different milestones produce different operation_ids', async () => {
    for (let i = 0; i < 5; i++) await DailyController.trackWinStreak();

    const opId3 = vi.mocked(walletGrant).mock.calls[0][1];
    const opId5 = vi.mocked(walletGrant).mock.calls[1][1];
    expect(opId3).not.toBe(opId5);
    expect(opId3).toContain('streak_3');
    expect(opId5).toContain('streak_5');
  });

  it('falls back to local grant when walletGrant fails', async () => {
    vi.mocked(walletGrant).mockRejectedValueOnce(new Error('network'));
    await DailyController.trackWinStreak();
    await DailyController.trackWinStreak();
    await DailyController.trackWinStreak(); // milestone 3, walletGrant throws → fallback

    expect(engineBridge.grantGold).toHaveBeenCalledWith(100);
  });
});
