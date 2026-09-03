// EngineBridge wraps the C++ WASM engine with typed methods.
// All game logic runs in WASM — JS is purely a rendering/input layer.

import { setEngineVersion } from '../utils/buildInfo';
import {
  PieceType, GamePhase, GameResult, GameMode, EngineItemType,
  type Point, type EnemyData, type StormSpawn,
  MAX_HAND_SIZE, MAX_FORBIDDEN, MAX_STORM_SPAWNS,
} from './types';
import type { SealUpdate } from '../ui/sealDefs';

// Shared buffer sizes for WASM memory transfer — large enough for max arrays
const BUF_SIZE = 4096;
const INT32 = 4;

/** 单位属性视图（引擎 engine_get_unit_spec 导出的 UnitSpec 字段） */
export interface UnitSpecView {
  type: PieceType;
  attack: number;
  defense: number;
  blocksCannon: boolean;
  killScore: number;
  soulCost: number;
  playable: boolean;
  selfDestructs: boolean;
  exemptFriendlyFire: boolean;
  ignoresForbidden: boolean;
  rangeMode: number;
  provisionCost: number;  // 出征粮草消耗（英雄召唤/龙棋/地形为 0）
}

export type EngineModule = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  ccall: (ident: string, returnType: string | null, argTypes: string[], args: unknown[]) => unknown;
  cwrap: (ident: string, returnType: string | null, argTypes: string[]) => (...args: unknown[]) => unknown;
  /** Set by loadEngine — C++ platform persistence hook (localStorage write) */
  _platform_store?: (key: string, data: number, len: number) => void;
  /** Set by loadEngine — C++ platform persistence hook (localStorage read) */
  _platform_load?: (key: string, out_len: number) => number;
};

export class EngineBridge {
  private mod: EngineModule | null = null;
  private buf: number | null = null;       // shared int32 buffer ptr
  private buf2: number | null = null;      // second buffer for paired arrays
  private buf3: number | null = null;      // third buffer for triple arrays

  // Cached query results (valid after a get* call until next engine mutation)
  private cachedBoardCols = 7;
  private cachedBoardRows = 7;

  /** Attach a loaded WASM module instance and allocate scratch buffers. */
  setModule(mod: EngineModule): void {
    this.mod = mod;
    // Allocate scratch buffers for reading arrays from WASM memory
    this.buf = mod._malloc(BUF_SIZE * INT32);
    this.buf2 = mod._malloc(BUF_SIZE * INT32);
    this.buf3 = mod._malloc(BUF_SIZE * INT32);
  }

  /** Free scratch buffers. Call when the engine is being torn down. */
  destroy(): void {
    if (this.mod && this.buf !== null) this.mod._free(this.buf);
    if (this.mod && this.buf2 !== null) this.mod._free(this.buf2);
    if (this.mod && this.buf3 !== null) this.mod._free(this.buf3);
    this.mod = null;
    this.buf = null;
    this.buf2 = null;
    this.buf3 = null;
  }

  private get m(): EngineModule {
    if (!this.mod) throw new Error('EngineBridge not initialized');
    return this.mod;
  }

  // ── Core Game Actions ────────────────────────────────────────────

  init(mode: GameMode, levelId: number, rngSeed: number, configJson?: string): number {
    const modeStr = mode === GameMode.CAMPAIGN ? 'campaign' : 'endless';
    const ret = this.m.ccall('engine_init', 'number', ['string', 'number', 'string', 'number'],
      [modeStr, levelId, configJson ?? '', rngSeed]) as number;
    this.readBoardSize();
    return ret; // 0 成功 / -1 失败
  }

  placePiece(pieceType: PieceType, col: number, row: number): number {
    return this.m.ccall('engine_place_piece', 'number', ['number', 'number', 'number'],
      [pieceType, col, row]) as number;
  }

  undoPlacement(): number {
    return this.m.ccall('engine_undo_placement', 'number', [], []) as number;
  }

  skipTurn(): number {
    return this.m.ccall('engine_skip_turn', 'number', [], []) as number;
  }

  confirmTurn(): number {
    return this.m.ccall('engine_confirm_turn', 'number', [], []) as number;
  }

  useItem(type: EngineItemType, args: readonly number[] = []): number {
    if (type === EngineItemType.HAND_SET && args.length !== 3) return -3;
    if (type !== EngineItemType.HAND_SET && args.length !== 0) return -3;
    return this.m.ccall('engine_use_item_v4', 'number',
      ['number', 'number', 'number', 'number', 'number'],
      [type, args.length, args[0] ?? 0, args[1] ?? 0, args[2] ?? 0]) as number;
  }

  // ── Hand ─────────────────────────────────────────────────────────

  getHandCount(): number {
    return this.m.ccall('engine_get_hand_count', 'number', [], []) as number;
  }

  getHand(): PieceType[] {
    const count = this.getHandCount();
    if (count === 0) return [];
    const n = Math.min(count, MAX_HAND_SIZE);
    const heap = this.m.HEAP32;
    const ptr1 = this.buf!;
    const ptr2 = this.buf2!;
    this.m.ccall('engine_get_hand', null, ['number', 'number', 'number'],
      [ptr1, ptr2, n]);
    const result: PieceType[] = [];
    for (let i = 0; i < n; i++) {
      result.push(heap[ptr1 / INT32 + i] as PieceType);
    }
    return result;
  }

  // ── Valid Placements ─────────────────────────────────────────────

  getValidPlacements(): Point[] {
    const count = this.m.ccall('engine_get_valid_placements', 'number',
      ['number', 'number', 'number'], [this.buf!, this.buf2!, BUF_SIZE]) as number;
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const cols = heap.slice(this.buf! / INT32, this.buf! / INT32 + count);
    const rows = heap.slice(this.buf2! / INT32, this.buf2! / INT32 + count);
    const result: Point[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ col: cols[i], row: rows[i] });
    }
    return result;
  }

  // ── Board ────────────────────────────────────────────────────────

  private readBoardSize(): void {
    const heap = this.m.HEAP32;
    const ptr = this.buf!;
    this.m.ccall('engine_get_board_size', null, ['number', 'number'], [ptr, ptr + 4]);
    this.cachedBoardCols = heap[ptr / INT32];
    this.cachedBoardRows = heap[(ptr + 4) / INT32];
  }

  getBoardSize(): { cols: number; rows: number } {
    return { cols: this.cachedBoardCols, rows: this.cachedBoardRows };
  }

  // ── Enemies ──────────────────────────────────────────────────────

  getEnemyCount(): number {
    return this.m.ccall('engine_get_enemy_count', 'number', [], []) as number;
  }

  getEnemies(): EnemyData[] {
    const count = this.getEnemyCount();
    if (count === 0) return [];
    // enemies_ accumulates dead entries (referenced by resolve step indices),
    // so size can exceed MAX_ENEMIES. Cap at buffer size, not spawn cap.
    const n = Math.min(count, BUF_SIZE);
    const heap = this.m.HEAP32;
    const types = this.buf!;
    const cols = this.buf2!;
    const rowsPtr = this.buf3!;
    const alive = this.m._malloc(n * INT32);
    this.m.ccall('engine_get_enemies', null,
      ['number', 'number', 'number', 'number', 'number'],
      [types, cols, rowsPtr, alive, n]);
    const result: EnemyData[] = [];
    for (let i = 0; i < n; i++) {
      result.push({
        type: heap[types / INT32 + i],
        col: heap[cols / INT32 + i],
        row: heap[rowsPtr / INT32 + i],
        alive: heap[alive / INT32 + i] !== 0,
      });
    }
    this.m._free(alive);
    return result;
  }

  // ── Forbidden Zone ───────────────────────────────────────────────

  getForbiddenCount(): number {
    return this.m.ccall('engine_get_forbidden_count', 'number', [], []) as number;
  }

  getForbidden(): Point[] {
    const count = this.getForbiddenCount();
    if (count === 0) return [];
    const n = Math.min(count, MAX_FORBIDDEN);
    const heap = this.m.HEAP32;
    const ptr1 = this.buf!;
    const ptr2 = this.buf2!;
    this.m.ccall('engine_get_forbidden', null, ['number', 'number', 'number'],
      [ptr1, ptr2, n]);
    const result: Point[] = [];
    for (let i = 0; i < n; i++) {
      result.push({ col: heap[ptr1 / INT32 + i], row: heap[ptr2 / INT32 + i] });
    }
    return result;
  }

  // ── Storm Spawns ─────────────────────────────────────────────────

  getStormSpawns(): StormSpawn[] {
    const count = this.m.ccall('engine_get_storm_spawns', 'number',
      ['number', 'number', 'number'], [this.buf!, this.buf2!, MAX_STORM_SPAWNS]) as number;
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const cols = heap.slice(this.buf! / INT32, this.buf! / INT32 + count);
    const rows = heap.slice(this.buf2! / INT32, this.buf2! / INT32 + count);
    const result: StormSpawn[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ col: cols[i], row: rows[i] });
    }
    return result;
  }

  // 敌将"招兵买马"：引擎按每 5 int 一条写入（src_col, src_row, wasm_type, col, row）
  getRecruitSpawns(): { srcCol: number; srcRow: number; type: number; col: number; row: number }[] {
    const count = this.m.ccall('engine_get_recruit_spawns', 'number',
      ['number', 'number'], [this.buf!, MAX_STORM_SPAWNS]) as number;
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const base = this.buf! / INT32;
    const result: { srcCol: number; srcRow: number; type: number; col: number; row: number }[] = [];
    for (let i = 0; i < count; i++) {
      result.push({
        srcCol: heap[base + i * 5],
        srcRow: heap[base + i * 5 + 1],
        type: heap[base + i * 5 + 2],
        col: heap[base + i * 5 + 3],
        row: heap[base + i * 5 + 4],
      });
    }
    return result;
  }

  // ── State Queries ────────────────────────────────────────────────

  getScore(): number {
    return this.m.ccall('engine_get_score', 'number', [], []) as number;
  }

  getTurn(): number {
    return this.m.ccall('engine_get_turn', 'number', [], []) as number;
  }

  getGameResult(): GameResult {
    return this.m.ccall('engine_get_game_result', 'number', [], []) as GameResult;
  }

  // ── 状态版本协议（v10 重构）：版本号对比决定是否拉全量快照 ──
  getStateVersion(): number {
    return this.m.ccall('engine_get_state_version', 'number', [], []) as number;
  }

  getStateSnapshot(): {
    version: number; phase: number; turn: number; score: number;
    handCount: number; enemyCount: number; forbiddenCount: number; flameCount: number;
  } {
    const heap = this.m.HEAP32;
    const v = this.m._malloc(INT32), p = this.m._malloc(INT32), t = this.m._malloc(INT32),
          s = this.m._malloc(INT32), hc = this.m._malloc(INT32), ec = this.m._malloc(INT32),
          fc = this.m._malloc(INT32), fl = this.m._malloc(INT32);
    this.m.ccall('engine_get_state_snapshot', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [v, p, t, s, hc, ec, fc, fl]);
    const out = {
      version: heap[v / INT32], phase: heap[p / INT32], turn: heap[t / INT32],
      score: heap[s / INT32], handCount: heap[hc / INT32],
      enemyCount: heap[ec / INT32], forbiddenCount: heap[fc / INT32],
      flameCount: heap[fl / INT32],
    };
    this.m._free(v); this.m._free(p); this.m._free(t); this.m._free(s);
    this.m._free(hc); this.m._free(ec); this.m._free(fc); this.m._free(fl);
    return out;
  }

  getStateHash(): string {
    const hashPtr = this.m._malloc(32);
    this.m.ccall('engine_get_state_hash', null, ['number'], [hashPtr]);
    const bytes = this.m.HEAPU8.subarray(hashPtr, hashPtr + 32);
    let hex = '';
    for (let i = 0; i < 32; i++) hex += bytes[i].toString(16).padStart(2, '0');
    this.m._free(hashPtr);
    return hex;
  }

  // ── 粮草（Provisions）── 出征粮草：limit = 初始上限(cap) + 木牛流马累加(bonus)；
  // remaining = limit − 已确认消耗(spent) − 本回合已放置未确认(committed)，≤0 即弹尽粮绝
  getProvisions(): { remaining: number; limit: number; bonus: number } {
    const heap = this.m.HEAP32;
    const p = this.buf!;
    this.m.ccall('engine_get_provisions', null, ['number', 'number', 'number'],
      [p, p + 4, p + 8]);
    return {
      remaining: heap[p / INT32],
      limit:     heap[(p + 4) / INT32],
      bonus:     heap[(p + 8) / INT32],
    };
  }

  // 本回合是否已召唤英雄棋子（召唤令）——confirm 全落子门控（3+1）的依据
  getSummonedThisTurn(): boolean {
    return this.m.ccall('engine_get_summoned_this_turn', 'number', [], []) === 1;
  }

  // ── Game Records ─────────────────────────────────────────────────

  setRecordBinding(hash: string, runNonce: string, issuedAt: number, expiresAt: number): boolean {
    if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) ||
        issuedAt <= 0 || expiresAt <= issuedAt) {
      return false;
    }
    const splitUint64 = (value: number): [number, number] => [
      value >>> 0,
      Math.floor(value / 0x100000000) >>> 0,
    ];
    const [issuedLow, issuedHigh] = splitUint64(issuedAt);
    const [expiresLow, expiresHigh] = splitUint64(expiresAt);
    return this.m.ccall('engine_set_record_binding', 'number',
      ['string', 'string', 'number', 'number', 'number', 'number'],
      [hash, runNonce, issuedLow, issuedHigh, expiresLow, expiresHigh]) === 1;
  }

  exportRecord(): Uint8Array {
    // Need to call once to get length, but the C API returns a pointer
    // to internal buffer. We use a two-call pattern:
    // First allocate an uint32 to receive the length
    const lenPtr = this.m._malloc(4);
    const dataPtr = this.m.ccall('engine_export_record', 'number',
      ['number'], [lenPtr]) as number;
    const len = this.m.HEAP32[lenPtr / INT32];
    try {
      if (!dataPtr || len <= 0) throw new Error('Engine returned an empty game record');
      return new Uint8Array(this.m.HEAPU8.buffer, dataPtr, len).slice();
    } finally {
      if (dataPtr) this.freeBuffer(dataPtr);
      this.m._free(lenPtr);
    }
  }

  verifyRecord(data: Uint8Array): { valid: boolean; score: number } {
    const dataPtr = this.m._malloc(data.length);
    const scorePtr = this.m._malloc(4);
    try {
      this.m.HEAPU8.set(data, dataPtr);
      this.m.HEAP32[scorePtr / INT32] = 0;
      const valid = this.m.ccall('engine_verify_record', 'number',
        ['number', 'number', 'number'], [dataPtr, data.length, scorePtr]) as number;
      return { valid: valid !== 0, score: valid !== 0 ? this.m.HEAP32[scorePtr / INT32] : 0 };
    } finally {
      this.m._free(dataPtr);
      this.m._free(scorePtr);
    }
  }

  getRecordActionCount(): number {
    return this.m.ccall('engine_get_record_action_count', 'number', [], []) as number;
  }

  truncateRecord(actionCount: number): boolean {
    return Number.isInteger(actionCount) && actionCount >= 0 &&
      this.m.ccall('engine_truncate_record', 'number', ['number'], [actionCount]) === 1;
  }

  exportState(): Uint8Array {
    const dataPtrPtr = this.m._malloc(4);
    const lenPtr = this.m._malloc(4);
    try {
      this.m.ccall('engine_export_state', null, ['number', 'number'], [dataPtrPtr, lenPtr]);
      const dataPtr = this.m.HEAP32[dataPtrPtr / INT32];
      const len = this.m.HEAP32[lenPtr / INT32];
      if (!dataPtr || len <= 0) throw new Error('Engine returned an empty state');
      try {
        return new Uint8Array(this.m.HEAPU8.buffer, dataPtr, len).slice();
      } finally {
        this.freeBuffer(dataPtr);
      }
    } finally {
      this.m._free(dataPtrPtr);
      this.m._free(lenPtr);
    }
  }

  importState(state: Uint8Array): boolean {
    if (state.byteLength === 0) return false;
    const dataPtr = this.m._malloc(state.byteLength);
    try {
      this.m.HEAPU8.set(state, dataPtr);
      const imported = this.m.ccall('engine_import_state_v4', 'number', ['number', 'number'],
        [dataPtr, state.byteLength]) === 1;
      if (imported) this.readBoardSize();
      return imported;
    } finally {
      this.m._free(dataPtr);
    }
  }

  // ── Skill Range ───────────────────────────────────────────────────

  getSkillRange(pieceType: PieceType, col: number, row: number, camp: number): Point[] {
    const count = this.m.ccall('engine_get_skill_range', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [pieceType, col, row, camp, this.buf!, this.buf2!, BUF_SIZE]) as number;
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const result: Point[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ col: heap[this.buf! / INT32 + i], row: heap[this.buf2! / INT32 + i] });
    }
    return result;
  }

  // ── Unit Spec ─────────────────────────────────────────────────────

  getUnitSpec(pieceType: PieceType): UnitSpecView | null {
    const heap = this.m.HEAP32;
    const rc = this.m.ccall('engine_get_unit_spec', 'number',
      ['number', 'number', 'number', 'number', 'number', 'number',
       'number', 'number', 'number', 'number', 'number', 'number', 'number'],
      [pieceType, this.buf!, this.buf! + INT32, this.buf! + 2 * INT32, this.buf! + 3 * INT32,
       this.buf! + 4 * INT32, this.buf! + 5 * INT32, this.buf! + 6 * INT32,
       this.buf! + 7 * INT32, this.buf! + 8 * INT32, this.buf! + 9 * INT32,
       this.buf! + 10 * INT32, this.buf! + 11 * INT32]) as number;
    if (rc !== 0) return null;
    const base = this.buf! / INT32;
    return {
      type: heap[base],
      attack: heap[base + 1], defense: heap[base + 2], blocksCannon: heap[base + 3] !== 0,
      killScore: heap[base + 4], soulCost: heap[base + 5], playable: heap[base + 6] !== 0,
      selfDestructs: heap[base + 7] !== 0, exemptFriendlyFire: heap[base + 8] !== 0,
      ignoresForbidden: heap[base + 9] !== 0, rangeMode: heap[base + 10],
      provisionCost: heap[base + 11],
    };
  }

  // ── Board Cell ────────────────────────────────────────────────────

  isCellOccupied(col: number, row: number): boolean {
    return this.m.ccall('engine_get_cell_occupied', 'number', ['number', 'number'], [col, row]) !== 0;
  }

  getCellCamp(col: number, row: number): number {
    return this.m.ccall('engine_get_cell_camp', 'number', ['number', 'number'], [col, row]) as number;
  }

  // ── Resolve Steps (Animation Data) ───────────────────────────────

  getResolveStepCount(): number {
    return this.m.ccall('engine_get_resolve_step_count', 'number', [], []) as number;
  }

  getResolveStep(stepIndex: number): { pieceType: number; col: number; row: number; targetCount: number } {
    const heap = this.m.HEAP32;
    const p = this.buf!;
    this.m.ccall('engine_get_resolve_steps', null, ['number', 'number', 'number', 'number', 'number'],
      [stepIndex, p, p + 4, p + 8, p + 12]);
    return {
      pieceType: heap[p / INT32],
      col: heap[(p + 4) / INT32],
      row: heap[(p + 8) / INT32],
      targetCount: heap[(p + 12) / INT32],
    };
  }

  getResolveTarget(stepIndex: number, targetIndex: number): { col: number; row: number; enemyIndex: number; score: number } {
    const heap = this.m.HEAP32;
    const p = this.buf!;
    this.m.ccall('engine_get_resolve_targets', null, ['number', 'number', 'number', 'number', 'number', 'number'],
      [stepIndex, targetIndex, p, p + 4, p + 8, p + 12]);
    return {
      col: heap[p / INT32],
      row: heap[(p + 4) / INT32],
      enemyIndex: heap[(p + 8) / INT32],
      score: heap[(p + 12) / INT32],
    };
  }

  // ── Storm / Unseal ────────────────────────────────────────────────

  getStormCharge(): number {
    return this.m.ccall('engine_get_storm_charge', 'number', [], []) as number;
  }

  getUnsealed(): boolean {
    return this.m.ccall('engine_get_unsealed', 'number', [], []) !== 0;
  }

  setUnsealed(val: boolean): void {
    this.m.ccall('engine_set_unsealed', null, ['number'], [val ? 1 : 0]);
  }

  // ── Loong Soul ──────────────────────────────────────────────────

  getLoongFlameCount(): number {
    return this.m.ccall('engine_get_loong_flame_count', 'number', [], []) as number;
  }

  getLoongFlamePositions(): Point[] {
    const count = this.getLoongFlameCount();
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const ptr1 = this.buf!;
    const ptr2 = this.buf2!;
    this.m.ccall('engine_get_loong_flames', null, ['number', 'number', 'number'],
      [ptr1, ptr2, count]);
    const result: Point[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ col: heap[ptr1 / INT32 + i], row: heap[ptr2 / INT32 + i] });
    }
    return result;
  }

  getLoongSoulCount(): number {
    return this.m.ccall('engine_get_loong_soul_count', 'number', [], []) as number;
  }

  getConsumedLoongFlameCount(): number {
    return this.m.ccall('engine_get_consumed_loong_flame_count', 'number', [], []) as number;
  }

  getConsumedLoongFlames(): Point[] {
    const count = this.getConsumedLoongFlameCount();
    if (count === 0) return [];
    const heap = this.m.HEAP32;
    const ptr1 = this.buf!;
    const ptr2 = this.buf2!;
    this.m.ccall('engine_get_consumed_loong_flames', null, ['number', 'number', 'number'],
      [ptr1, ptr2, count]);
    const result: Point[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ col: heap[ptr1 / INT32 + i], row: heap[ptr2 / INT32 + i] });
    }
    return result;
  }

  // ── 英雄棋子召唤 ─────────────────────────────────────────────────

  summonHero(pieceType: PieceType): number {
    return this.m.ccall('engine_summon_hero', 'number', ['number'], [pieceType]) as number;
  }

  forgeHero(itemId: string, qty: number): number {
    return this.m.ccall('engine_forge_hero', 'number', ['string', 'number'], [itemId, qty]) as number;
  }

  // ── Platform State ────────────────────────────────────────────────

  getPlatformGold(): number {
    return this.m.ccall('engine_get_platform_gold', 'number', [], []) as number;
  }

  getItemPrice(itemId: string): number {
    return this.m.ccall('engine_get_item_price', 'number', ['string'], [itemId]) as number;
  }

  getEngineVersion(): string {
    return this.m.ccall('engine_version', 'string', [], []) as string;
  }

  getItemSoulCost(itemId: string): number {
    return this.m.ccall('engine_get_item_soul_cost', 'number', ['string'], [itemId]) as number;
  }

  getPlatformItemCount(itemId: string): number {
    return this.m.ccall('engine_get_platform_item_count', 'number', ['string'], [itemId]) as number;
  }

  addPlatformItem(itemId: string, qty: number): void {
    this.m.ccall('engine_add_platform_item', null, ['string', 'number'], [itemId, qty]);
  }

  removePlatformItem(itemId: string, qty: number): number {
    return this.m.ccall('engine_remove_platform_item', 'number', ['string', 'number'], [itemId, qty]) as number;
  }

  platformAcquireItem(itemId: string, qty: number): number {
    return this.m.ccall('engine_platform_acquire_item', 'number', ['string', 'number'], [itemId, qty]) as number;
  }

  platformSave(): void { this.m.ccall('engine_platform_save', null, [], []); }
  platformLoad(): void { this.m.ccall('engine_platform_load', null, [], []); }

  platformInit(hash: string, gameId: string): void {
    this.m.ccall('engine_platform_init', null, ['string', 'string'], [hash, gameId]);
  }

  collectLoongSouls(count: number): void {
    this.m.ccall('engine_collect_loong_souls', null, ['number'], [count]);
  }

  platformSetBalance(totalGranted: number, totalPurchased: number): void {
    this.m.ccall('engine_platform_set_balance', null, ['number', 'number'], [totalGranted, totalPurchased]);
  }

  /** 客户端奖励金币（宝箱/签到/任务等），balance += amount */
  grantGold(amount: number): void {
    this.m.ccall('engine_grant_gold', null, ['number'], [amount]);
  }

  // ── 胜场计数 + 印级 ──────────────────────────────────────────────

  getPlatformWins(): number {
    return this.m.ccall('engine_get_platform_wins', 'number', [], []) as number;
  }

  /** 累加胜场，一次 ccall 返回 prev/new wins + tier + promoted */
  addPlatformWin(count: number): SealUpdate {
    this.m.ccall('engine_add_platform_win', 'number',
      ['number', 'number', 'number'],
      [count, this.buf!, 5]) as number;
    const heap = this.m.HEAP32;
    const base = this.buf! / INT32;
    return {
      prevWins: heap[base],
      newWins:  heap[base + 1],
      prevTier: heap[base + 2],
      newTier:  heap[base + 3],
      promoted: heap[base + 4] === 1,
    };
  }

  getSealTier(): number {
    return this.m.ccall('engine_get_seal_tier', 'number', [], []) as number;
  }

  getSealNextThreshold(): number {
    return this.m.ccall('engine_get_seal_next_threshold', 'number', [], []) as number;
  }

  // ── Score Details ─────────────────────────────────────────────────

  getScoreDetails(): { piecesScore: number; cityScore: number; statueScore: number; allyPenalty: number } {
    const heap = this.m.HEAP32;
    const p = this.buf!;
    this.m.ccall('engine_get_score_details', null, ['number', 'number', 'number', 'number', 'number'],
      [p, p + 4, p + 8, p + 12, p + 16]);
    return {
      piecesScore: heap[p / INT32],
      cityScore: heap[(p + 4) / INT32],
      statueScore: heap[(p + 8) / INT32],
      allyPenalty: heap[(p + 12) / INT32],
    };
  }


  // ── Unified scoring (engine is the single source of truth) ──

  getComboGain(): number {
    return this.m.ccall('engine_get_combo_gain', 'number', [], []) as number;
  }

  getMaxKillsPerStep(): number {
    return this.m.ccall('engine_get_max_kills_per_step', 'number', [], []) as number;
  }

  getStarBonus(): number {
    return this.m.ccall('engine_get_star_bonus', 'number', [], []) as number;
  }

  getStarMask(): number {
    return this.m.ccall('engine_get_star_mask', 'number', [], []) as number;
  }

  getTotalStars(): number {
    return this.m.ccall('engine_get_total_stars', 'number', [], []) as number;
  }

  getLevelMultiplierX10(): number {
    return this.m.ccall('engine_get_level_multiplier_x10', 'number', [], []) as number;
  }

  getFinalScore(): number {
    return this.m.ccall('engine_get_final_score', 'number', [], []) as number;
  }

  getBonusCount(): number {
    return this.m.ccall('engine_get_bonus_count', 'number', [], []) as number;
  }

  getBonusScores(): number[] {
    return this.getBonuses().map(b => b.score);
  }

  getBonuses(): { name: string; score: number }[] {
    const count = this.getBonusCount();
    const result: { name: string; score: number }[] = [];
    const heap = this.m.HEAP32;
    const u8 = this.m.HEAPU8;
    const p = this.buf!;      // receives const char* name ptr
    const p2 = this.buf2!;    // receives int score
    for (let i = 0; i < count; i++) {
      this.m.ccall('engine_get_bonus', null, ['number', 'number', 'number'],
        [i, p, p2]);
      const namePtr = heap[p / INT32];
      const score = heap[p2 / INT32];
      // Read C string from WASM linear memory
      let name = '';
      if (namePtr) {
        let off = namePtr;
        while (u8[off] !== 0) { name += String.fromCharCode(u8[off]); off++; }
      }
      result.push({ name, score });
    }
    return result;
  }

  getLevel(): number {
    return this.m.ccall('engine_get_level', 'number', [], []) as number;
  }

  // ── Debug ─────────────────────────────────────────────────────────

  forceVictory(): void {
    this.m.ccall('engine_force_victory', null, [], []);
  }

  forceDefeat(): void {
    this.m.ccall('engine_force_defeat', null, [], []);
  }

  addHandPiece(pieceType: PieceType): void {
    this.m.ccall('engine_add_hand_piece', null, ['number'], [pieceType]);
  }

  setHandPiece(pieceType: PieceType, clearFirst: boolean): number {
    return this.m.ccall('engine_set_hand_piece', 'number', ['number', 'number'],
      [pieceType, clearFirst ? 1 : 0]) as number;
  }

  clearHand(): void {
    this.m.ccall('engine_clear_hand', null, [], []);
  }

  redrawHand(): void {
    this.m.ccall('engine_redraw_hand', null, [], []);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  freeBuffer(ptr: number): void {
    this.m.ccall('engine_free_buffer', null, ['number'], [ptr]);
  }
}

/** Singleton engine instance shared across the app. */
export const engineBridge = new EngineBridge();
let engineLoadPromise: Promise<void> | null = null;
let engineLoaded = false;

/** Load the WASM engine once. Concurrent callers share the same attempt; failures remain retryable. */
export function loadEngine(): Promise<void> {
  if (engineLoaded) return Promise.resolve();
  if (engineLoadPromise) return engineLoadPromise;

  engineLoadPromise = initializeEngine()
    .then(() => { engineLoaded = true; })
    .catch((error) => {
      engineLoadPromise = null;
      throw error;
    });
  return engineLoadPromise;
}

async function initializeEngine(): Promise<void> {
  const initModule = (await import('wasm/xiangqiblast-engine.js')).default;
  // 不传 locateFile：emscripten 走 vite 打包的带 hash 的 wasm asset，
  // 避免固定文件名被浏览器启发式缓存命中旧版引擎
  const mod = await initModule({}) as EngineModule;
  // Wire up platform persistence — C++ EM_JS checks Module._platform_store
  // and Module._platform_load; without these the save/load chain silently no-ops
  mod._platform_store = (key: string, data: number, len: number) => {
    try {
      const bytes = new Uint8Array(mod.HEAPU8.buffer, data, len);
      const encoded = btoa(String.fromCharCode(...bytes));
      localStorage.setItem(key, encoded);
    } catch { /* localStorage quota exceeded or unavailable */ }
  };
  mod._platform_load = (key: string, out_len: number) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const ptr = mod._malloc(bytes.length);
      mod.HEAPU8.set(bytes, ptr);
      mod.HEAP32[out_len >> 2] = bytes.length;
      return ptr;
    } catch { return 0; }
  };
  engineBridge.setModule(mod);
  try { setEngineVersion(engineBridge.getEngineVersion()); } catch { /* old WASM without engine_version */ }
}
