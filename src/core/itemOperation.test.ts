import { beforeEach, describe, expect, it, vi } from 'vitest';
import { itemBuy } from '../cloud/api';
import { ItemOperationCoordinator } from './itemOperation';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

const hash = 'ab'.repeat(32);

function jsonResponse(body: unknown, status = 200): Response {
  return { status, json: async () => body } as Response;
}

describe('shipped item operation path', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = index + 1; });
      return bytes;
    } });
  });

  it('sends the supplied valid operation_id through the cloud buy API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: 'ok', data: { balance: 800, item_id: 'undo', quantity: 2 } }));
    vi.stubGlobal('fetch', fetchMock);

    await itemBuy(hash, 'undo', 2, 'op_valid-123');

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      hash, item_id: 'undo', quantity: 2, game_id: 1, operation_id: 'op_valid-123',
    });
  });

  it('retries a committed buy after response loss with the persisted same ID and one logical debit', async () => {
    const receipts = new Map<string, { request: string; response: unknown }>();
    let balance = 1000;
    let quantity = 0;
    let logicalDebits = 0;
    let loseFirstResponse = true;
    const seenBodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      seenBodies.push(body);
      const operationId = body.operation_id as string;
      const exactRequest = JSON.stringify({ item_id: body.item_id, quantity: body.quantity, game_id: body.game_id });
      const receipt = receipts.get(operationId);
      if (receipt) {
        if (receipt.request !== exactRequest) return jsonResponse({ code: 1, message: 'operation_id已用于不同请求' }, 409);
        return jsonResponse(receipt.response);
      }
      balance -= 200;
      quantity += 2;
      logicalDebits++;
      const response = { code: 0, message: 'ok', data: { balance, item_id: 'undo', quantity } };
      receipts.set(operationId, { request: exactRequest, response });
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new TypeError('response lost after commit');
      }
      return jsonResponse(response);
    }));

    const firstCoordinator = new ItemOperationCoordinator();
    const request = { hash, itemId: 'undo', quantity: 2 };
    const first = await firstCoordinator.execute(request);
    expect(first.definitive).toBe(false);

    // Simulate refresh/new UI instance. Outstanding exact request remains durable.
    const retryCoordinator = new ItemOperationCoordinator();
    const retry = await retryCoordinator.execute(request);

    expect(retry.definitive).toBe(true);
    if (!retry.definitive) throw new Error('expected definitive receipt replay');
    expect(retry.response).toEqual({ code: 0, message: 'ok', data: { balance: 800, item_id: 'undo', quantity: 2 }, httpStatus: 200 });
    expect(logicalDebits).toBe(1);
    expect(seenBodies).toHaveLength(2);
    expect(seenBodies[0].operation_id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(seenBodies[1]).toEqual(seenBodies[0]);
    expect(retryCoordinator.find(request)).toBeUndefined();
  });

  it('does not reuse one operation ID for a different exact request', async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      bodies.push(body);
      throw new TypeError('transport lost');
    }));
    const coordinator = new ItemOperationCoordinator();

    await coordinator.execute({ hash, itemId: 'undo', quantity: 1 });
    await coordinator.execute({ hash, itemId: 'undo', quantity: 2 });

    expect(bodies[0].operation_id).not.toBe(bodies[1].operation_id);
  });
});
