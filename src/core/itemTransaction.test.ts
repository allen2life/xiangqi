import { describe, expect, it, vi } from 'vitest';
import { consumeItemAfterSuccess, createKeyedInFlightGuard, PendingItemUsage } from './itemTransaction';

describe('createKeyedInFlightGuard', () => {
  it('blocks duplicate work for one item while allowing other items and later retries', async () => {
    let release!: (result: boolean) => void;
    const pending = new Promise<boolean>((resolve) => { release = resolve; });
    const task = vi.fn(() => pending);
    const run = createKeyedInFlightGuard();

    const first = run('undo', task);
    await expect(run('undo', task)).resolves.toBe(false);
    await expect(run('redraw', async () => true)).resolves.toBe(true);
    expect(task).toHaveBeenCalledTimes(1);

    release(true);
    await expect(first).resolves.toBe(true);
    await expect(run('undo', async () => true)).resolves.toBe(true);
  });
});

describe('PendingItemUsage', () => {
  it('exposes authoritative inventory directly; pending usage is record-reconciliation only', () => {
    const inventory = new PendingItemUsage();
    inventory.updateAuthoritative({ redraw: 2 });
    inventory.recordSuccessfulUse('redraw');

    // authoritative 已由引擎扣减（单一数据源），展示不再投影 pending
    expect(inventory.items).toEqual({ redraw: 2 });
    expect(inventory.pendingUsage).toEqual({ redraw: 1 });
    inventory.updateAuthoritative({ redraw: 1 });
    expect(inventory.items).toEqual({ redraw: 1 });
  });

  it('round-trips versioned pending usage and fails closed when record binding/action count changed', () => {
    const inventory = new PendingItemUsage();
    inventory.recordSuccessfulUse('redraw');
    const saved = inventory.exportPending(7, 'hash', 'nonce');
    const restored = new PendingItemUsage();

    expect(restored.restorePending(saved, 7, 'hash', 'nonce')).toBe(true);
    expect(restored.pendingUsage).toEqual({ redraw: 1 });
    expect(restored.restorePending(saved, 8, 'hash', 'nonce')).toBe(false);
    expect(new PendingItemUsage().restorePending(undefined, 1, 'hash', 'nonce')).toBe(false);
  });

  it('does not change pending usage for failed effects and clears it on publish refresh', () => {
    const inventory = new PendingItemUsage();
    inventory.updateAuthoritative({ undo: 1 });
    expect(inventory.pendingUsage).toEqual({});
    inventory.settleAuthoritative({ undo: 0, loong_soul: 3 });
    expect(inventory.items).toEqual({ undo: 0, loong_soul: 3 });
    expect(inventory.pendingUsage).toEqual({});
  });
});

describe('consumeItemAfterSuccess', () => {
  it('does not deduct or persist when the game effect fails', async () => {
    const remove = vi.fn(() => true);
    const persist = vi.fn();

    await expect(consumeItemAfterSuccess(() => false, remove, persist)).resolves.toBe(false);
    expect(remove).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('deducts and persists exactly once after an async effect succeeds', async () => {
    const remove = vi.fn(() => true);
    const persist = vi.fn();

    await expect(consumeItemAfterSuccess(async () => true, remove, persist)).resolves.toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('does not persist if authoritative inventory deduction fails', async () => {
    const persist = vi.fn();

    await expect(consumeItemAfterSuccess(() => true, () => false, persist)).resolves.toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });
});
