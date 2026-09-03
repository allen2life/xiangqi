import { describe, expect, it, vi } from 'vitest';
import { EngineBridge, type EngineModule } from './EngineBridge';
import { EngineItemType, PieceType } from './types';

function moduleWith(ccall: EngineModule['ccall']): EngineModule {
  let nextPtr = 4;
  return {
    _malloc: vi.fn((size: number) => { const ptr = nextPtr; nextPtr += size; return ptr; }),
    _free: vi.fn(),
    HEAP32: new Int32Array(32768),
    HEAPU8: new Uint8Array(131072),
    ccall,
    cwrap: vi.fn(),
  };
}

describe('EngineBridge.setHandPiece', () => {
  it('passes the piece and clear flag to the atomic hand-set API and returns its status', () => {
    const ccall = vi.fn().mockReturnValue(-2);
    const bridge = new EngineBridge();
    bridge.setModule(moduleWith(ccall));
    ccall.mockClear();

    expect(bridge.setHandPiece(6, true)).toBe(-2);
    expect(ccall).toHaveBeenCalledWith('engine_set_hand_piece', 'number',
      ['number', 'number'], [6, 1]);
  });
});

describe('EngineBridge v4 state and item APIs', () => {
  it('sends one grouped hand-set call with exactly three piece arguments', () => {
    const ccall = vi.fn().mockReturnValue(0);
    const bridge = new EngineBridge();
    bridge.setModule(moduleWith(ccall));
    ccall.mockClear();

    expect(bridge.useItem(EngineItemType.HAND_SET, [1, 2, 8])).toBe(0);
    expect(ccall).toHaveBeenCalledTimes(1);
    expect(ccall).toHaveBeenCalledWith('engine_use_item_v4', 'number',
      ['number', 'number', 'number', 'number', 'number'], [4, 3, 1, 2, 8]);
    expect(bridge.useItem(EngineItemType.HAND_SET, [1, 2])).toBe(-3);
    expect(ccall).toHaveBeenCalledTimes(1);
  });

  it('routes loong use through v4 as add-to-hand semantics', () => {
    const ccall = vi.fn().mockReturnValue(0);
    const bridge = new EngineBridge();
    bridge.setModule(moduleWith(ccall));
    ccall.mockClear();

    expect(bridge.useItem(EngineItemType.LOONG)).toBe(0);
    expect(ccall).toHaveBeenCalledWith('engine_use_item_v4', 'number',
      ['number', 'number', 'number', 'number', 'number'], [5, 0, 0, 0, 0]);
    expect(ccall).not.toHaveBeenCalledWith('engine_place_loong_piece', expect.anything(), expect.anything(), expect.anything());
  });

  it('imports state through the validated v4 entry point', () => {
    const ccall = vi.fn().mockImplementation((name: string) => name === 'engine_import_state_v4' ? 1 : 0);
    const module = moduleWith(ccall);
    const bridge = new EngineBridge();
    bridge.setModule(module);
    ccall.mockClear();

    expect(bridge.importState(Uint8Array.of(3, 0, 0, 0))).toBe(true);
    expect(ccall).toHaveBeenNthCalledWith(1, 'engine_import_state_v4', 'number',
      ['number', 'number'], [expect.any(Number), 4]);
  });
});

describe('EngineBridge.getUnitSpec', () => {
  it('reads UnitSpec fields from engine memory', () => {
    const ccall = vi.fn().mockReturnValue(0);
    const module = moduleWith(ccall);
    const bridge = new EngineBridge();
    bridge.setModule(module);
    ccall.mockClear();
    // buf = 4 → HEAP32[1] 起，12 个字段
    const base = 1;
    module.HEAP32[base] = PieceType.PAWN;  // type
    module.HEAP32[base + 1] = 150;         // attack
    module.HEAP32[base + 2] = 100;         // defense
    module.HEAP32[base + 3] = 0;           // blocks_cannon
    module.HEAP32[base + 4] = 100;         // kill_score
    module.HEAP32[base + 5] = 0;           // soul_cost
    module.HEAP32[base + 6] = 1;           // playable
    module.HEAP32[base + 7] = 0;           // self_destructs
    module.HEAP32[base + 8] = 0;           // exempt_friendly_fire
    module.HEAP32[base + 9] = 0;           // ignores_forbidden
    module.HEAP32[base + 10] = 1;          // range_mode = PAWN
    module.HEAP32[base + 11] = 1;          // provision_cost = PAWN

    const spec = bridge.getUnitSpec(PieceType.PAWN);
    expect(spec).toEqual({
      type: PieceType.PAWN,
      attack: 150, defense: 100, blocksCannon: false, killScore: 100,
      soulCost: 0, playable: true, selfDestructs: false,
      exemptFriendlyFire: false, ignoresForbidden: false, rangeMode: 1,
      provisionCost: 1,
    });
    expect(ccall).toHaveBeenCalledWith('engine_get_unit_spec', 'number', expect.anything(), expect.anything());
  });

  it('returns null for unknown piece type', () => {
    const ccall = vi.fn().mockReturnValue(-1);
    const bridge = new EngineBridge();
    bridge.setModule(moduleWith(ccall));

    expect(bridge.getUnitSpec(0)).toBeNull();
  });
});

describe('EngineBridge.setRecordBinding', () => {
  it('splits millisecond timestamps into uint32 halves and accepts only return 1', () => {
    const ccall = vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0);
    const bridge = new EngineBridge();
    bridge.setModule(moduleWith(ccall));
    ccall.mockClear();

    expect(bridge.setRecordBinding('hash-a', 'nonce-b', 1700000000000, 1700003600000)).toBe(true);
    expect(ccall).toHaveBeenNthCalledWith(1, 'engine_set_record_binding', 'number',
      ['string', 'string', 'number', 'number', 'number', 'number'],
      ['hash-a', 'nonce-b', 3487918080, 395, 3491518080, 395]);
    expect(bridge.setRecordBinding('hash-a', 'nonce-b', 1, 2)).toBe(false);
    ccall.mockClear();
    expect(bridge.setRecordBinding('hash-a', 'nonce-b', -1, 2)).toBe(false);
    expect(bridge.setRecordBinding('hash-a', 'nonce-b', 1.5, 2)).toBe(false);
    expect(bridge.setRecordBinding('hash-a', 'nonce-b', 2, 2)).toBe(false);
    expect(ccall).not.toHaveBeenCalled();
  });
});

describe('EngineBridge.verifyRecord', () => {
  it('returns score zero for invalid records and releases temporary buffers', () => {
    const ccall = vi.fn().mockImplementation((name: string, _returnType: unknown, _argTypes: unknown, args: unknown[]) => {
      if (name === 'engine_verify_record') {
        const scorePtr = args[2] as number;
        module.HEAP32[scorePtr / 4] = 999;
        return 0;
      }
      return 0;
    });
    const module = moduleWith(ccall);
    const bridge = new EngineBridge();
    bridge.setModule(module);
    (module._free as ReturnType<typeof vi.fn>).mockClear();

    expect(bridge.verifyRecord(new Uint8Array([1, 2, 3]))).toEqual({ valid: false, score: 0 });
    expect(module._free).toHaveBeenCalledTimes(2);
  });
});
