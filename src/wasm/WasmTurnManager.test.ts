import { describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({
  getBoardSize: vi.fn(() => ({ cols: 9, rows: 8 })),
  getEnemies: vi.fn<() => { type: number; col: number; row: number; alive: boolean }[]>(() => []),
  getHand: vi.fn(() => []),
  getScore: vi.fn(() => 0),
  getScoreDetails: vi.fn(() => ({ piecesScore: 0, cityScore: 0, statueScore: 0, allyPenalty: 0 })),
  getComboGain: vi.fn(() => 0),
  getMaxKillsPerStep: vi.fn(() => 0),
  getStarBonus: vi.fn(() => 0),
  getStarMask: vi.fn(() => 0),
  getTotalStars: vi.fn(() => 0),
  getLevelMultiplierX10: vi.fn(() => 10),
  getFinalScore: vi.fn(() => 0),
  getStormCharge: vi.fn(() => 0),
  getTurn: vi.fn(() => 0),
  getGameResult: vi.fn(() => 0),
  getLevel: vi.fn(() => 1),
  getProvisions: vi.fn(() => ({ remaining: 0, limit: 0, bonus: 0 })),
  getSummonedThisTurn: vi.fn(() => false),
  getUnitSpec: vi.fn(() => null),
  getUnsealed: vi.fn(() => false),
  getLoongFlamePositions: vi.fn(() => []),
  getLoongSoulCount: vi.fn(() => 0),
  getBonuses: vi.fn(() => []),
  forceVictory: vi.fn(),
  forceDefeat: vi.fn(),
  useItem: vi.fn(() => 0),
  redrawHand: vi.fn(),
  removePlatformItem: vi.fn(() => true),
  addPlatformItem: vi.fn(),
  platformSave: vi.fn(),
  getValidPlacements: vi.fn<() => { col: number; row: number }[]>(() => []),
}));

vi.mock('./EngineBridge', () => ({
  engineBridge: engine,
}));

import { WasmTurnManager, type PieceObj } from './WasmTurnManager';
import { PieceType, Camp, GamePhase } from '../core/types';
import { EngineItemType } from './types';
import { PendingItemUsage } from '../core/itemTransaction';

function makeManager(): WasmTurnManager {
  // Object.create 不执行类字段初始化器——手动补齐 selectHand 依赖的默认值
  const manager = Object.create(WasmTurnManager.prototype) as WasmTurnManager;
  manager.board = { cols: 9, rows: 8, getUnitAt: () => null };
  manager.phase = GamePhase.SELECT_HAND;
  manager.hand = [];
  manager.placed = [];
  manager.selectedHandIndex = -1;
  manager.summonedThisTurn = false;
  (manager as unknown as { pendingItemUsage: PendingItemUsage }).pendingItemUsage = new PendingItemUsage();
  return manager;
}

function makeHandPiece(type: PieceType, id: string): PieceObj {
  return {
    id, pieceType: type, position: null,
    alive: true, active: true, camp: Camp.PLAYER, isCity: false, isStatue: false,
    skill: { name: '', getAttackRange: () => [] },
  };
}

describe('WasmTurnManager.forceVictory', () => {
  it('marks a debug-forced result unpublishable before changing engine state', () => {
    const manager = makeManager();
    manager.recordBinding = {} as WasmTurnManager['recordBinding'];
    manager.recordPublishError = undefined;
    manager.syncState = vi.fn();

    manager.forceVictory();

    expect(manager.recordBinding).toBeUndefined();
    expect(manager.recordPublishError).toBe('err.debug_forced_win');
    expect(engine.forceVictory).toHaveBeenCalledOnce();
    expect(manager.syncState).toHaveBeenCalledOnce();
  });
});

describe('WasmTurnManager.forceDefeat', () => {
  it('marks a surrendered result unpublishable before changing engine state', () => {
    const manager = makeManager();
    manager.recordBinding = {} as WasmTurnManager['recordBinding'];
    manager.recordPublishError = undefined;
    manager.syncState = vi.fn();

    manager.forceDefeat();

    expect(manager.recordBinding).toBeUndefined();
    expect(manager.recordPublishError).toBe('err.surrendered');
    expect(engine.forceDefeat).toHaveBeenCalledOnce();
    expect(manager.syncState).toHaveBeenCalledOnce();
  });

  it('supports stalemate reason err.no_valid_moves', () => {
    engine.forceDefeat.mockClear();
    const manager = makeManager();
    manager.recordBinding = {} as WasmTurnManager['recordBinding'];
    manager.syncState = vi.fn();

    manager.forceDefeat('err.no_valid_moves');

    expect(manager.recordBinding).toBeUndefined();
    expect(manager.recordPublishError).toBe('err.no_valid_moves');
    expect(engine.forceDefeat).toHaveBeenCalledOnce();
  });
});

describe('WasmTurnManager.provisions', () => {
  const pawnSpec = {
    type: 1, attack: 1, defense: 1, blocksCannon: false, killScore: 100,
    soulCost: 0, playable: true, selfDestructs: false, exemptFriendlyFire: false,
    ignoresForbidden: false, rangeMode: 0, provisionCost: 1,
  };
  const heroSpec = { ...pawnSpec, type: 9, provisionCost: 0 };

  it('blocks selecting a hand card when provisions are insufficient', () => {
    // 粮草耗尽（remaining=0）→ 兵（cost 1）不可选，phase 不进入 PLACE_PIECE
    engine.getProvisions.mockReturnValue({ remaining: 0, limit: 0, bonus: 0 });
    engine.getUnitSpec.mockReturnValue(pawnSpec as never);
    const manager = makeManager();
    manager.phase = GamePhase.SELECT_HAND;
    manager.hand = [makeHandPiece(PieceType.PAWN, 'p1')];

    expect(manager.selectHand(0)).toBe(false);
    expect(manager.selectedHandIndex).toBe(-1);
    expect(manager.phase).toBe(GamePhase.SELECT_HAND);
  });

  it('allows selecting when provisions cover the cost (remaining 含本回合已放置消耗)', () => {
    engine.getProvisions.mockReturnValue({ remaining: 3, limit: 8, bonus: 0 });
    engine.getUnitSpec.mockReturnValue(pawnSpec as never);
    const manager = makeManager();
    manager.phase = GamePhase.SELECT_HAND;
    manager.hand = [makeHandPiece(PieceType.PAWN, 'p1')];

    expect(manager.selectHand(0)).toBe(true);
    expect(manager.selectedHandIndex).toBe(0);
    expect(manager.phase).toBe(GamePhase.PLACE_PIECE);
  });

  it('allows selecting a zero-cost piece even when provisions are exhausted', () => {
    // 英雄召唤/龙棋不消耗粮草——弹尽粮绝时仍可出牌
    engine.getProvisions.mockReturnValue({ remaining: 0, limit: 0, bonus: 0 });
    engine.getUnitSpec.mockReturnValue(heroSpec as never);
    const manager = makeManager();
    manager.phase = GamePhase.SELECT_HAND;
    manager.hand = [makeHandPiece(PieceType.LOONG_PIECE, 'p1')];

    expect(manager.selectHand(0)).toBe(true);
  });

  it('syncs remaining/limit/bonus from engine (limit = cap + 木牛流马累加)', () => {
    engine.getProvisions.mockReturnValue({ remaining: 3, limit: 13, bonus: 5 });
    const manager = makeManager();
    manager.syncState();
    expect(manager.provisionsRemaining).toBe(3);
    expect(manager.provisionsLimit).toBe(13);
    expect(manager.provisionsBonus).toBe(5);
  });

  it('syncs summonedThisTurn from engine (confirm gate 3+1)', () => {
    engine.getSummonedThisTurn.mockReturnValue(true);
    const manager = makeManager();
    manager.syncState();
    expect(manager.summonedThisTurn).toBe(true);
  });
});

describe('WasmTurnManager.canConfirm full-hand gate', () => {
  it('requires all 3 hand cards placed before confirming', () => {
    const manager = makeManager();
    manager.placed = [
      makeHandPiece(PieceType.PAWN, 'p1'),
      makeHandPiece(PieceType.PAWN, 'p2'),
    ];
    expect(manager.canConfirm()).toBe(false);
    manager.placed.push(makeHandPiece(PieceType.PAWN, 'p3'));
    expect(manager.canConfirm()).toBe(true);
  });

  it('requires 3+1 cards placed after summoning a hero', () => {
    const manager = makeManager();
    manager.summonedThisTurn = true;
    manager.placed = [
      makeHandPiece(PieceType.PAWN, 'p1'),
      makeHandPiece(PieceType.PAWN, 'p2'),
      makeHandPiece(PieceType.PAWN, 'p3'),
    ];
    expect(manager.canConfirm()).toBe(false);
    manager.placed.push(makeHandPiece(PieceType.HORSE_IRON, 'h1'));
    expect(manager.canConfirm()).toBe(true);
  });
});

describe('WasmTurnManager redraw/HAND_SET 收回已放置', () => {
  it('clears placed after REDRAW (引擎已收回，本地同步，防多用手牌)', () => {
    const manager = makeManager();
    manager.placed = [makeHandPiece(PieceType.PAWN, 'p1'), makeHandPiece(PieceType.PAWN, 'p2')];
    manager.selectedHandIndex = 1;
    engine.useItem.mockReturnValue(0);
    manager.useItem(EngineItemType.REDRAW);
    expect(manager.placed).toHaveLength(0);
    expect(manager.selectedHandIndex).toBe(-1);
  });

  it('clears placed after HAND_SET', () => {
    const manager = makeManager();
    manager.placed = [makeHandPiece(PieceType.PAWN, 'p1')];
    engine.useItem.mockReturnValue(0);
    manager.useItem(EngineItemType.HAND_SET, [PieceType.PAWN, PieceType.PAWN, PieceType.PAWN]);
    expect(manager.placed).toHaveLength(0);
  });

  it('keeps placed for other items (UNSEAL 不动棋盘)', () => {
    const manager = makeManager();
    const p1 = makeHandPiece(PieceType.PAWN, 'p1');
    manager.placed = [p1];
    engine.useItem.mockReturnValue(0);
    manager.useItem(EngineItemType.UNSEAL);
    expect(manager.placed).toHaveLength(1);
  });
});

describe('WasmTurnManager.syncState', () => {
  it('rebuilds the enemy when the type at a position changed (stale pawn → statue)', () => {
    // 引擎侧 (3,0) 已是雕像；前端残留旧卒对象（同位置）——必须重建而非复用，
    // 否则前端显示卒（无禁区假象）而引擎是雕像（range NONE 本无禁区）
    engine.getEnemies.mockReturnValue([{ type: 15, col: 3, row: 0, alive: true }]);
    const manager = makeManager();
    const stale: PieceObj = {
      id: 'stale-pawn', pieceType: PieceType.PAWN, position: { col: 3, row: 0 },
      alive: true, active: true, camp: Camp.ENEMY, isCity: false, isStatue: false,
      skill: { name: '', getAttackRange: () => [] },
    };
    (manager as unknown as { _enemies: PieceObj[] })._enemies = [stale];

    manager.syncState();

    const enemies = manager.enemyUnits;
    expect(enemies).toHaveLength(1);
    expect(enemies[0].pieceType).toBe(PieceType.STATUE);
    expect(enemies[0].id).not.toBe('stale-pawn');
  });

  it('reuses the existing object when the type matches', () => {
    engine.getEnemies.mockReturnValue([{ type: 1, col: 3, row: 0, alive: true }]);
    const manager = makeManager();
    const pawn: PieceObj = {
      id: 'same-pawn', pieceType: PieceType.PAWN, position: { col: 3, row: 0 },
      alive: false, active: true, camp: Camp.ENEMY, isCity: false, isStatue: false,
      skill: { name: '', getAttackRange: () => [] },
    };
    (manager as unknown as { _enemies: PieceObj[] })._enemies = [pawn];

    manager.syncState();

    const enemies = manager.enemyUnits;
    expect(enemies).toHaveLength(1);
    expect(enemies[0].id).toBe('same-pawn');
    expect(enemies[0].alive).toBe(true);
  });

  it('merges dead + alive entries at the same cell+type into one slot (spawn on freed cell)', () => {
    // 招兵/风暴生成物落到本回合刚被击杀的同型格子：引擎 enemies_ 同时有
    // 阵亡条目与活体条目（同格同型）。旧实现把同一对象推入 _enemies 两次，
    // renderAll 对同一格子重复 addPiece → 两枚棋子叠在同一位置。
    engine.getEnemies.mockReturnValue([
      { type: 1, col: 3, row: 0, alive: false },  // 本回合被击杀的旧卒（先入列）
      { type: 1, col: 3, row: 0, alive: true },   // 招兵复制生成的活卒（后入列）
    ]);
    const manager = makeManager();
    const oldPawn: PieceObj = {
      id: 'killed-pawn', pieceType: PieceType.PAWN, position: { col: 3, row: 0 },
      alive: false, active: true, camp: Camp.ENEMY, isCity: false, isStatue: false,
      skill: { name: '', getAttackRange: () => [] },
    };
    (manager as unknown as { _enemies: PieceObj[] })._enemies = [oldPawn];

    manager.syncState();

    const enemies = manager.enemyUnits;
    expect(enemies).toHaveLength(1);       // 不占双槽位 → renderAll 不会叠子
    expect(enemies[0].id).toBe('killed-pawn');  // 复用对象保持 ID 稳定
    expect(enemies[0].alive).toBe(true);   // 活体语义优先（引擎枚举死先活后）
  });
});

describe('WasmTurnManager.getBoardValidPlacements', () => {
  it('returns valid placements directly from engineBridge even when no hand is selected', () => {
    engine.getValidPlacements.mockReturnValue([{ col: 1, row: 2 }]);
    const manager = makeManager();
    manager.phase = GamePhase.SELECT_HAND;
    manager.selectedHandIndex = -1;

    expect(manager.getValidPlacements()).toEqual([]);
    expect(manager.getBoardValidPlacements()).toEqual([{ col: 1, row: 2 }]);
  });
});

