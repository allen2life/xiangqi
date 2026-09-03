import { ITEM_IDS } from './itemCatalog';

export interface PersistedPendingItemUsage {
  version: 1;
  actionCount: number;
  bindingHash: string;
  bindingNonce: string;
  items: Record<string, number>;
}

export class PendingItemUsage {
  private authoritative: Record<string, number> = {};
  private pending: Record<string, number> = {};

  updateAuthoritative(items: Record<string, number>): void {
    this.authoritative = { ...items };
  }

  settleAuthoritative(items: Record<string, number>): void {
    this.authoritative = { ...items };
    this.pending = {};
  }

  recordSuccessfulUse(itemId: string): void {
    this.pending[itemId] = (this.pending[itemId] ?? 0) + 1;
  }

  restorePending(data: PersistedPendingItemUsage | undefined, actionCount: number, bindingHash: string, bindingNonce: string): boolean {
    if (!data) {
      this.pending = {};
      return actionCount === 0;
    }
    const validItems = Object.entries(data.items).every(([id, count]) =>
      ITEM_IDS.includes(id) && Number.isInteger(count) && count >= 0);
    if (data.version !== 1 || data.actionCount !== actionCount || data.bindingHash !== bindingHash ||
        data.bindingNonce !== bindingNonce || !validItems) return false;
    this.pending = { ...data.items };
    return true;
  }

  exportPending(actionCount: number, bindingHash: string, bindingNonce: string): PersistedPendingItemUsage {
    return { version: 1, actionCount, bindingHash, bindingNonce, items: { ...this.pending } };
  }

  replacePending(items: Record<string, number>): void {
    this.pending = { ...items };
  }

  get authoritativeItems(): Readonly<Record<string, number>> {
    return this.authoritative;
  }

  get items(): Record<string, number> {
    // 引擎库存为单一数据源（扣减已实时落盘），pending 仅作发布对账用途
    return { ...this.authoritative };
  }

  get pendingUsage(): Readonly<Record<string, number>> {
    return this.pending;
  }
}

export type ItemEffect = () => boolean | Promise<boolean>;

export function createKeyedInFlightGuard() {
  const inFlight = new Set<string>();
  return async (key: string, task: () => boolean | Promise<boolean>): Promise<boolean> => {
    if (inFlight.has(key)) return false;
    inFlight.add(key);
    try {
      return await task();
    } finally {
      inFlight.delete(key);
    }
  };
}

/**
 * Runs an item effect before mutating inventory. The item is persisted only
 * after both the effect and inventory deduction succeed.
 */
export async function consumeItemAfterSuccess(
  effect: ItemEffect,
  remove: () => boolean,
  persist: () => void,
): Promise<boolean> {
  if (!(await effect())) return false;
  if (!remove()) return false;
  persist();
  return true;
}
