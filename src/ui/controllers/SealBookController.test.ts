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
  walletGrant: vi.fn().mockResolvedValue({
    code: 0,
    data: { balance: 5000, inventory: { loong_soul: 10 } },
  }),
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

import { SealBookController } from './SealBookController';
import { walletGrant } from '../../cloud/api';
import { engineBridge } from '../../wasm/EngineBridge';
import type { DomUIContext } from '../DomUIContext';

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

const CLAIMED_TIERS_KEY = 'seal_claimed_tiers';
const STAR3_WINS_KEY = 'seal_3star_wins';

function makeController(): SealBookController {
  // claimTierReward doesn't use ctx, so a minimal stub suffices
  const ctx = { state: {}, host: {} } as unknown as DomUIContext;
  return new SealBookController(ctx);
}

function setStar3Wins(n: number): void {
  (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(STAR3_WINS_KEY, String(n));
}

function getClaimedTiers(): Set<number> {
  const raw = (globalThis as unknown as { localStorage: Storage }).localStorage.getItem(CLAIMED_TIERS_KEY);
  return new Set(raw ? (JSON.parse(raw) as number[]) : []);
}

describe('SealBookController claimTierReward idempotency', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.mocked(walletGrant).mockClear();
    vi.mocked(engineBridge.grantGold).mockClear();
    vi.mocked(engineBridge.addPlatformItem).mockClear();
    vi.mocked(engineBridge.platformSetBalance).mockClear();
    // Give enough star3 wins to unlock tier 0 (first seal)
    setStar3Wins(3);
  });

  it('calls walletGrant with stable operation_id bound to tier + user hash', async () => {
    const ctrl = makeController();
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);

    expect(walletGrant).toHaveBeenCalledTimes(1);
    const [hash, opId, gold, itemId, itemQty, reason] = vi.mocked(walletGrant).mock.calls[0];
    expect(hash).toBe('abcdef0123456789abcdef0123456789');
    // opId format: seal_tier_0_<hashShort>
    expect(opId).toBe('seal_tier_0_abcdef012345');
    expect(reason).toBe('seal_tier_0');
    expect(itemId).toBe('loong_soul');
  });

  it('same tier + hash always produces the same operation_id', async () => {
    const ctrl = makeController();
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);
    const firstOpId = vi.mocked(walletGrant).mock.calls[0][1];

    // Clear localStorage to simulate user wiping local state
    vi.stubGlobal('localStorage', new MemoryStorage());
    setStar3Wins(3);

    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);
    const secondOpId = vi.mocked(walletGrant).mock.calls[1][1];

    expect(secondOpId).toBe(firstOpId);
  });

  it('different tiers produce different operation_ids', async () => {
    const ctrl = makeController();
    setStar3Wins(10); // unlock tier 1

    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(1);

    const opId0 = vi.mocked(walletGrant).mock.calls[0][1];
    const opId1 = vi.mocked(walletGrant).mock.calls[1][1];
    expect(opId0).toBe('seal_tier_0_abcdef012345');
    expect(opId1).toBe('seal_tier_1_abcdef012345');
    expect(opId0).not.toBe(opId1);
  });

  it('skips reward if tier already claimed in localStorage', async () => {
    const ctrl = makeController();
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);
    expect(walletGrant).toHaveBeenCalledTimes(1);

    // Second call — should be no-op (tier 0 already in claimed set)
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);
    expect(walletGrant).toHaveBeenCalledTimes(1); // still 1, not 2
    expect(getClaimedTiers().has(0)).toBe(true);
  });

  it('falls back to local grant when walletGrant fails', async () => {
    vi.mocked(walletGrant).mockRejectedValueOnce(new Error('network'));
    const ctrl = makeController();
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);

    // Should have fallen through to local grant
    expect(engineBridge.grantGold).toHaveBeenCalled();
    expect(engineBridge.addPlatformItem).toHaveBeenCalledWith('loong_soul', expect.any(Number));
    expect(getClaimedTiers().has(0)).toBe(true);
  });

  it('syncs balance from server response on success', async () => {
    const ctrl = makeController();
    await (ctrl as unknown as { claimTierReward: (tier: number) => Promise<void> }).claimTierReward(0);

    expect(engineBridge.platformSetBalance).toHaveBeenCalledWith(5000, 0);
    expect(engineBridge.platformSave).toHaveBeenCalled();
  });
});
