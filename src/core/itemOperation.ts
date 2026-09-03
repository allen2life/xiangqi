import { itemBuy, type ItemBuyResponse, type ApiResponse } from '../cloud/api';
import { AppError } from '../i18n/AppError';
import { createKeyedInFlightGuard } from './itemTransaction';

const STORAGE_KEY = 'xiangqi-blast-item-operations-v1';
const OPERATION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type ItemOperationRequest = {
  hash: string;
  itemId: string;
  quantity: number;
};

type PersistedItemOperation = ItemOperationRequest & {
  version: 1;
  operationId: string;
};

type OperationStore = Record<string, PersistedItemOperation>;

export type ItemOperationResult =
  | { definitive: true; response: ApiResponse<ItemBuyResponse>; operationId: string }
  | { definitive: false; operationId: string; error?: unknown };

function requestKey(request: ItemOperationRequest): string {
  return `${request.hash}:${request.itemId}:${request.quantity}`;
}

function sameRequest(a: ItemOperationRequest, b: ItemOperationRequest): boolean {
  return a.hash === b.hash && a.itemId === b.itemId && a.quantity === b.quantity;
}

function readStore(): OperationStore {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as OperationStore;
    const valid: OperationStore = {};
    for (const [key, operation] of Object.entries(parsed)) {
      if (operation?.version === 1 && OPERATION_ID_RE.test(operation.operationId) &&
          key === requestKey(operation) && Number.isInteger(operation.quantity) && operation.quantity > 0) {
        valid[key] = operation;
      }
    }
    return valid;
  } catch { return {}; }
}

function writeStore(store: OperationStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    return true;
  } catch { return false; }
}

export function generateItemOperationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const id = `op_${Date.now().toString(36)}_${random}`;
  if (!OPERATION_ID_RE.test(id)) throw new AppError('err.item_op_id_failed');
  return id;
}

export class ItemOperationCoordinator {
  private readonly runInFlight = createKeyedInFlightGuard();

  async execute(request: ItemOperationRequest): Promise<ItemOperationResult> {
    let result: ItemOperationResult = { definitive: false, operationId: '' };
    const ran = await this.runInFlight(requestKey(request), async () => {
      result = await this.executeOnce(request);
      return true;
    });
    return ran ? result : { definitive: false, operationId: this.find(request)?.operationId ?? '' };
  }

  private async executeOnce(request: ItemOperationRequest): Promise<ItemOperationResult> {
    const store = readStore();
    const key = requestKey(request);
    let operation = store[key];
    if (operation && !sameRequest(operation, request)) {
      return { definitive: true, operationId: operation.operationId,
        response: { code: 1, message: '本地 operation_id 请求绑定冲突', httpStatus: 409 } };
    }
    if (!operation) {
      let operationId = generateItemOperationId();
      const usedIds = new Set(Object.values(store).map(saved => saved.operationId));
      while (usedIds.has(operationId)) operationId = generateItemOperationId();
      operation = { version: 1, ...request, operationId };
      store[key] = operation;
      if (!writeStore(store)) throw new AppError('err.item_op_save_failed');
    }

    try {
      const response = await itemBuy(request.hash, request.itemId, request.quantity, operation.operationId);
      const definitive = response.httpStatus < 500;
      if (definitive) {
        const latest = readStore();
        if (latest[key]?.operationId === operation.operationId) {
          delete latest[key];
          writeStore(latest);
        }
      }
      return { definitive, response, operationId: operation.operationId } as ItemOperationResult;
    } catch (error) {
      return { definitive: false, operationId: operation.operationId, error };
    }
  }

  find(request: ItemOperationRequest): PersistedItemOperation | undefined {
    return readStore()[requestKey(request)];
  }
}

export const itemOperationCoordinator = new ItemOperationCoordinator();
