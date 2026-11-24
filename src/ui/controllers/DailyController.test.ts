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

import { DailyController, dailyDateToSeed, computeDailyStreak } from './DailyController';
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

  describe('hasPendingNotification', () => {
    it('returns true if not signed in today', () => {
      const ctrl = new DailyController();
      expect(ctrl.hasPendingNotification()).toBe(true);
    });

    it('returns false if signed in and no tasks completed', () => {
      const today = new Date().toISOString().slice(0, 10);
      globalThis.localStorage.setItem(DAILY_KEY, JSON.stringify({
        date: today,
        signInDay: 1,
        signedInToday: true,
        tasks: [
          { id: 'play', target: 3, progress: 0, claimed: false, reward: {} },
        ],
        winStreak: 0,
        claimedStreakMilestones: [],
      }));
      const ctrl = new DailyController();
      expect(ctrl.hasPendingNotification()).toBe(false);
    });

    it('returns true if signed in but has claimable task', () => {
      const today = new Date().toISOString().slice(0, 10);
      globalThis.localStorage.setItem(DAILY_KEY, JSON.stringify({
        date: today,
        signInDay: 1,
        signedInToday: true,
        tasks: [
          { id: 'play', target: 3, progress: 3, claimed: false, reward: {} },
        ],
        winStreak: 0,
        claimedStreakMilestones: [],
      }));
      const ctrl = new DailyController();
      expect(ctrl.hasPendingNotification()).toBe(true);
    });
  });

  describe('Daily global challenge & streak calendar', () => {
    it('dailyDateToSeed produces deterministic non-zero seeds per date', () => {
      const a1 = dailyDateToSeed('2026-11-24');
      const a2 = dailyDateToSeed('2026-11-24');
      const b = dailyDateToSeed('2026-11-25');
      expect(a1).toBe(a2);
      expect(a1).not.toBe(b);
      expect(a1).toBeGreaterThan(0);
    });

    it('computeDailyStreak counts consecutive cleared days up to today/yesterday', () => {
      expect(computeDailyStreak(['2026-11-22', '2026-11-23', '2026-11-24'], '2026-11-24')).toBe(3);
      expect(computeDailyStreak(['2026-11-21', '2026-11-23'], '2026-11-24')).toBe(1);
      expect(computeDailyStreak(['2026-11-20'], '2026-11-24')).toBe(0);
    });

    it('saveDailyChallengeResult tracks best score and cleared dates', () => {
      const today = new Date().toISOString().slice(0, 10);
      DailyController.saveDailyChallengeResult(today, 3200, 2, 5);
      DailyController.saveDailyChallengeResult(today, 2800, 1, 6);
      const rec = DailyController.getDailyChallengeRecord(today);
      expect(rec?.bestScore).toBe(3200);
      expect(rec?.bestStars).toBe(2);
      expect(DailyController.getDailyClearedDates()).toContain(today);
      expect(DailyController.getDailyStreak(today)).toBe(1);
      const text = DailyController.formatDailyShareText(today, 3200, 2, 5);
      expect(text).toContain(today);
      expect(text).toContain('3200');
    });
  });
});
