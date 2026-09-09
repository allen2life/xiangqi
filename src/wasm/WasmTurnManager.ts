// WasmTurnManager — thin adapter bridging EngineBridge to GameScene's rendering API.
// Tracks piece objects with string IDs for Pixi.js, delegates all game logic to WASM.

import { engineBridge } from './EngineBridge';
import { AppError } from '../i18n/AppError';
import {
  PieceType as WasmPiece, GamePhase as WasmPhase, GameResult as WasmResult,
  GameMode, Camp, EngineItemType, type Point, PIECE_NAMES, type RecruitSpawn,
} from './types';
import {
  PieceType, GamePhase, GameResult, Camp as TsCamp,
} from '../core/types';
import type { ResolveStep, KillTarget } from '../core/types';
import type { GameSaveData, UnitSaveData } from '../core/SaveManager';
import { PendingItemUsage } from '../core/itemTransaction';
import { createResumedPublicationState, type RecordBinding } from '../core/runBinding';
import { t } from '../i18n';
// Platform state managed by C++ PlatformCore via engine API

// ─── Piece-like objects for Pixi.js rendering ────────────────────────

let nextId = 1;
function genId(): string { return `p${nextId++}`; }
export function reseedId(v: number): void { nextId = v; }

export interface PieceObj {
  id: string;
  pieceType: PieceType;
  position: { col: number; row: number } | null;
  alive: boolean;
  active: boolean;
  camp: TsCamp;
  isCity: boolean;
  isStatue: boolean;
  skill: { name: string; getAttackRange: (pos: Point) => Point[] };
}

export function wasmToTsPiece(wt: WasmPiece): PieceType {
  const map: Record<WasmPiece, PieceType> = {
    [WasmPiece.NONE]: PieceType.PAWN,
    [WasmPiece.PAWN]: PieceType.PAWN,
    [WasmPiece.CANNON]: PieceType.CANNON,
    [WasmPiece.CHARIOT]: PieceType.CHARIOT,
    [WasmPiece.HORSE]: PieceType.HORSE,
    [WasmPiece.ELEPHANT]: PieceType.ELEPHANT,
    [WasmPiece.ADVISOR]: PieceType.ADVISOR,
    [WasmPiece.GENERAL]: PieceType.GENERAL,
    [WasmPiece.LOONG_FLAME]: PieceType.LOONG_FLAME,
    [WasmPiece.LOONG_PIECE]: PieceType.LOONG_PIECE,
    [WasmPiece.HORSE_IRON]: PieceType.HORSE_IRON,
    [WasmPiece.ELEPHANT_MENMA]: PieceType.ELEPHANT_MENMA,
    [WasmPiece.CHARIOT_TANK]: PieceType.CHARIOT_TANK,
    [WasmPiece.PAWN_ENGINEER]: PieceType.PAWN_ENGINEER,
    // v10：城池/雕像真枚举（原 bit12/13 编码已废弃）
    [WasmPiece.CITY]: PieceType.CITY,
    [WasmPiece.STATUE]: PieceType.STATUE,
  };
  return map[wt] ?? PieceType.PAWN;
}

const SKILL_NAMES: Record<string, string> = {
  pawn: t('skill.pawn'), cannon: t('skill.cannon'), chariot: t('skill.chariot'),
  horse: t('skill.horse'), elephant: t('skill.elephant'), advisor: t('skill.advisor'),
  general: t('skill.general'), loong_flame: t('skill.loong_flame'), loong_piece: t('skill.loong_piece'),
  horse_iron: t('skill.horse_iron'), elephant_mengma: t('skill.elephant_mengma'),
  chariot_tank: t('skill.chariot_tank'), pawn_engineer: t('skill.pawn_engineer'),
};

export class WasmTurnManager {
  phase: GamePhase = GamePhase.SELECT_HAND;
  hand: PieceObj[] = [];
  placed: PieceObj[] = [];
  boardPieces: PieceObj[] = [];
  selectedHandIndex = -1;
  turnCount = 0;
  gameResult: GameResult = GameResult.NONE;
  score = 0;
  piecesScore = 0;
  cityScore = 0;
  statueScore = 0;
  allyLostPenalty = 0;
  comboGain = 0;         // 连击加成累计（引擎唯一来源）
  bonusScores: { name: string; score: number }[] = [];
  level: number;
  provisionsRemaining = 0;  // 粮草剩余（≤0 即弹尽粮绝，不能出牌）
  provisionsLimit = 0;      // 粮草上限 = 初始上限 + 木牛流马累加
  provisionsBonus = 0;      // 木牛流马累加的额外上限
  stormCharge = 0;
  maxKillsPerStep = 0;   // 单步击杀上限（★5 判据，引擎唯一来源）
  starMask = 0;          // 位0-4 = ★1~★5（引擎唯一来源）
  totalStars = 0;
  starBonus = 0;         // 星星直接得分奖励（引擎唯一来源）
  finalScore = 0;        // 最终分 = round(score × 倍率)（引擎唯一来源）
  levelMultiplierX10 = 10;
  stormSpawns: { col: number; row: number }[] = [];
  // 敌将被动"招兵买马"：本回合复制生成的敌方单位（引擎在风暴生成前写入）
  recruitSpawns: RecruitSpawn[] = [];
  // 本回合已召唤英雄棋子（引擎权威）——confirm 门控 3+1
  summonedThisTurn = false;
  unsealed = false;
  readonly MAX_STORM_CHARGE = 5;
  readonly STORM_MIN_LEVEL = 5;

  // Loong soul state
  loongFlamePositions: Point[] = [];
  consumedFlames: Point[] = [];
  loongSoulsCollectedThisGame = 0;

  recordBinding?: RecordBinding;
  recordPublishError?: string;
  readonly pendingItemUsage = new PendingItemUsage();

  // Board access — returns real PieceObj if found in placed/boardPieces for correct ID lookup
  board = {
    cols: 7, rows: 7,
    getUnitAt: (col: number, row: number): PieceObj | null => {
      // Check placed pieces first (need real IDs for click-to-remove).
      // Filter alive — dead pieces have their board occupancy cleared by C++
      // (board_.remove in resolve), so returning them here would cause
      // onPointerDown to mistake the cell as occupied and skip placeOnBoard,
      // producing the "假禁区" symptom (clickable cell appears empty but rejects placement).
      const placed = this.placed.find(p => p.alive && p.position?.col === col && p.position?.row === row);
      if (placed) return placed;
      // Check boardPieces (pieces from previous turns)
      const bp = this.boardPieces.find(p => p.alive && p.position?.col === col && p.position?.row === row);
      if (bp) return bp;
      // Fall back to WASM query for enemies
      if (!engineBridge.isCellOccupied(col, row)) return null;
      const camp = engineBridge.getCellCamp(col, row);
      return { id: 'board-cell', pieceType: PieceType.PAWN, position: { col, row },
               alive: true, active: true, camp: camp === 1 ? TsCamp.PLAYER : TsCamp.ENEMY,
               isCity: false, isStatue: false,
               skill: { name: '', getAttackRange: () => [] } } as PieceObj;
    },
  };

  forbiddenZone = {
    getForbiddenSet: (): Set<string> => {
      const pts = engineBridge.getForbidden();
      const s = new Set<string>();
      for (const p of pts) s.add(`${p.col},${p.row}`);
      return s;
    },
    getAllZonePoints: (): Point[] => engineBridge.getForbidden(),
  };

  private _enemies: PieceObj[] = [];

  get enemyUnits(): PieceObj[] { return this._enemies; }

  get levelMultiplier(): number { return this.levelMultiplierX10 / 10; }

  /** Create a new game. Level generation is handled entirely in C++/WASM. */
  constructor(levelId: number, seed?: number, configJson?: string) {
    this.level = levelId;
    const deterministicSeed = seed ?? ((levelId * 73856093 + 1) >>> 0);
    // 有 configJson 时用 CAMPAIGN 模式加载手工设计的关卡布局
    const mode = configJson ? GameMode.CAMPAIGN : GameMode.ENDLESS;
    engineBridge.init(mode, levelId, deterministicSeed, configJson ?? '');
    this.syncState();
  }

  static fromSaveData(data: GameSaveData, currentHash: string): WasmTurnManager {
    // Reseed ID counter so freshly generated enemy/hand IDs (starting from p1
    // after page reload) don't collide with restored placed/boardPieces IDs
    // (which also start from p1 from the previous session). ID collision causes
    // PieceRenderer.pieceMap to map one ID to the wrong wrapper, leading to
    // animations/removals targeting the wrong piece — visually表现为棋子错位
    // 与"假禁区"（WASM 占用正确格子但渲染 wrapper 被错误销毁）。
    if (data.units) {
      let maxId = 0;
      for (const u of data.units) {
        const m = /^p(\d+)$/.exec(u.id);
        if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
      }
      reseedId(maxId + 1);
    }
    // Platform state is loaded independently — no-op for loong state here
    // Initialize a fresh game first (sets up JS properties like board, level, etc.)
    const tm = new WasmTurnManager(data.level);
    // Then restore saved WASM binary state on top of the fresh init
    if (!data._wasmState || !engineBridge.importState(new Uint8Array(data._wasmState))) {
      throw new AppError('err.save_invalid');
    }
    tm.syncState();
    const resumedState = createResumedPublicationState(data, currentHash, data.level);
    tm.recordBinding = resumedState.recordBinding;
    tm.recordPublishError = resumedState.recordPublishError;
    const binding = tm.recordBinding;
    if (binding && !tm.pendingItemUsage.restorePending(
      data.pendingItemUsage,
      engineBridge.getRecordActionCount(),
      binding.hash,
      binding.runNonce,
    )) {
      tm.recordBinding = undefined;
      tm.recordPublishError = 'err.resume_item_mismatch';
    }
    // Rebuild JS-side piece arrays from saved data (C++ state only tracks board cells,
    // while JS PieceObj carries IDs, types, and active flags needed for rendering).
    // Gate on data.units only — missing placedUnitIds/boardPieceUnitIds (old saves)
    // must not skip restoration, or tm.placed/boardPieces stay empty while WASM
    // board still has the pieces, causing "phantom forbidden zone" desync.
    if (data.units) {
      const unitMap = new Map(data.units.map((u: UnitSaveData) => [u.id, u] as const));
      const makePiece = (u: UnitSaveData | undefined): PieceObj | null => {
        if (!u) return null;  // id not in units — skip gracefully instead of throwing
        const pt = u.pieceType as PieceType;
        const wasmPt = TS_PIECE_TO_WASM[pt] ?? WasmPiece.PAWN;
        return {
          id: u.id, pieceType: pt,
          position: u.position ? { ...u.position } : null,
          alive: u.alive, active: u.active,
          camp: u.camp === 'player' ? TsCamp.PLAYER : TsCamp.ENEMY,
          isCity: u.isCity, isStatue: u.isStatue,
          skill: { name: SKILL_NAMES[pt] ?? '', getAttackRange: tm.makeGetRange(wasmPt) },
        };
      };
      tm.placed = (data.placedUnitIds || [])
        .map((id: string) => makePiece(unitMap.get(id)))
        .filter((p): p is PieceObj => p !== null && p.alive);
      tm.boardPieces = (data.boardPieceUnitIds || [])
        .map((id: string) => makePiece(unitMap.get(id)))
        .filter((p): p is PieceObj => p !== null && p.alive);
    }
    // ── Reconcile JS piece arrays with WASM board (the single source of truth) ──
    // exportState may persist JS arrays that desynced from the C++ board before save
    // (e.g. a placed piece was killed by friendly fire but JS kept alive=true, or a
    // storm-spawned city was added to enemies_ but a stale JS wrapper lingered).
    // On restore this surfaces as three symptoms:
    //  1) ghost pieces rendered off-grid (JS has piece, WASM board doesn't)
    //  2) 假禁区 (WASM board occupied, JS has no piece → empty cell rejects placement)
    //  3) city untargetable & placeable (JS renders city, WASM board has no occupancy)
    // Direction A — drop JS ghosts: any alive JS piece whose cell is not occupied in
    // WASM is stale; C++ already cleared it, so remove from JS arrays.
    const occ = (c: number, r: number) => engineBridge.isCellOccupied(c, r);
    tm.placed = tm.placed.filter(p => !p.position || occ(p.position.col, p.position.row));
    tm.boardPieces = tm.boardPieces.filter(p => !p.position || occ(p.position.col, p.position.row));
    // _enemies was rebuilt by syncState() from getEnemies(); filter any alive entry
    // whose cell is no longer occupied (defensive — syncState should already match).
    tm._enemies = tm._enemies.filter(e =>
      !e.alive || (e.position && occ(e.position.col, e.position.row))
    );
    // Direction B — fill JS gaps: any WASM ENEMY-occupied cell missing from _enemies
    // is a real enemy (city/statue/piece) that would otherwise be an invisible
    // blocker (假禁区). Reconstruct from getEnemies() which carries type/city/statue.
    const haveEnemy = (c: number, r: number) =>
      tm._enemies.some(e => e.position?.col === c && e.position?.row === r);
    const wasmEnemies = engineBridge.getEnemies();
    for (const we of wasmEnemies) {
      if (!we.alive) continue;
      if (haveEnemy(we.col, we.row)) continue;
      if (!occ(we.col, we.row)) continue;
      // v10：统一 PieceType 直接编码（CITY=14/STATUE=15）
      const rawPt = we.type & 0xFF;
      const pieceType = wasmToTsPiece(rawPt as WasmPiece);
      const isCity = rawPt === WasmPiece.CITY;
      const isStatue = rawPt === WasmPiece.STATUE;
      tm._enemies.push({
        id: genId(), pieceType,
        position: { col: we.col, row: we.row },
        alive: true, active: true, camp: TsCamp.ENEMY,
        isCity, isStatue,
        skill: { name: '', getAttackRange: () => [] },
      });
    }
    return tm;
  }

  // ─── State sync ────────────────────────────────────────────────────

  syncState(): void {
    // Board size — read from WASM after init
    const bs = engineBridge.getBoardSize();
    this.board.cols = bs.cols;
    this.board.rows = bs.rows;

    // Enemies — rebuild list
    const wasmEnemies = engineBridge.getEnemies();
    const newEnemies: PieceObj[] = [];
    for (const we of wasmEnemies) {
      // v10：统一 PieceType 直接编码（CITY=14/STATUE=15）
      const rawPt = we.type & 0xFF;
      const pieceType = wasmToTsPiece(rawPt as WasmPiece);
      const isCity = rawPt === WasmPiece.CITY;
      const isStatue = rawPt === WasmPiece.STATUE;
      // 仅当类型一致才复用旧对象（同一位置旧卒→新雕像时必须重建，
      // 否则前端显示旧类型：引擎雕像、前端卒，产生"无禁区"假象）
      const existing = this._enemies.find(e =>
        e.position?.col === we.col && e.position?.row === we.row &&
        e.pieceType === pieceType);
      if (existing) {
        existing.alive = we.alive;
        existing.isCity = isCity;
        existing.isStatue = isStatue;
        // 同格同型对象本次遍历已入列（先处理的旧阵亡条目）→ 只更新不死不重复入列。
        // 否则同一对象占两个槽位（阵亡条目 + 新生成活体），renderAll 会对同一格子
        // 重复 addPiece，叠出两枚重叠棋子（招兵/风暴生成物落到刚清空的同型格时必现）。
        if (!newEnemies.some(e => e === existing)) {
          newEnemies.push(existing);
        }
      } else {
        newEnemies.push({
          id: genId(), pieceType,
          position: { col: we.col, row: we.row },
          alive: we.alive, active: true, camp: TsCamp.ENEMY,
          isCity, isStatue,
          skill: { name: '', getAttackRange: () => [] },
        });
      }
    }
    this._enemies = newEnemies;

    // Hand
    const wh = engineBridge.getHand();
    this.hand = wh.map(p => ({
      id: genId(), pieceType: wasmToTsPiece(p), position: null,
      alive: true, active: true, camp: TsCamp.PLAYER,
      isCity: false, isStatue: false,
      skill: { name: SKILL_NAMES[wasmToTsPiece(p)] ?? '', getAttackRange: this.makeGetRange(p) },
    }));

    // Score
    this.score = engineBridge.getScore();
    const sd = engineBridge.getScoreDetails();
    this.piecesScore = sd.piecesScore;
    this.cityScore = sd.cityScore;
    this.statueScore = sd.statueScore;
    this.allyLostPenalty = sd.allyPenalty;
    // Unified scoring — engine is the single source of truth
    this.comboGain = engineBridge.getComboGain();
    this.maxKillsPerStep = engineBridge.getMaxKillsPerStep();
    this.starBonus = engineBridge.getStarBonus();
    this.starMask = engineBridge.getStarMask();
    this.totalStars = engineBridge.getTotalStars();
    this.levelMultiplierX10 = engineBridge.getLevelMultiplierX10();
    this.finalScore = engineBridge.getFinalScore();

    // Storm
    this.stormCharge = engineBridge.getStormCharge();
    this.turnCount = engineBridge.getTurn();
    this.gameResult = engineBridge.getGameResult() === WasmResult.WIN ? GameResult.WIN
                    : engineBridge.getGameResult() === WasmResult.LOSE ? GameResult.LOSE
                    : GameResult.NONE;
    // Sync phase from C++ (critical when restoring saved games)
    if (this.gameResult !== GameResult.NONE) {
      this.phase = GamePhase.GAME_OVER;
    }
    this.level = engineBridge.getLevel();
    this.refreshProvisions();
    this.summonedThisTurn = engineBridge.getSummonedThisTurn();
    this.unsealed = engineBridge.getUnsealed();

    // Loong soul state
    this.loongFlamePositions = engineBridge.getLoongFlamePositions();
    this.loongSoulsCollectedThisGame = engineBridge.getLoongSoulCount();

    // Bonus scores with names from C++
    this.bonusScores = engineBridge.getBonuses();
  }

  /** 实时刷新粮草（引擎权威）：放置/撤销后 remaining 随 committed 变化，需及时同步给 HUD */
  refreshProvisions(): void {
    const pv = engineBridge.getProvisions();
    this.provisionsRemaining = pv.remaining;
    this.provisionsLimit = pv.limit;
    this.provisionsBonus = pv.bonus;
  }

  // C++ Camp enum: NONE=0, PLAYER=1, ENEMY=2
  // TS Camp enum: PLAYER=0, ENEMY=1 (different from C++!)
  // Must send C++'s PLAYER value (1) to get correct forward direction for pawn/general.
  private static readonly CAMP_PLAYER = 1;

  private makeGetRange(pieceType: WasmPiece): (pos: Point) => Point[] {
    return (pos: Point) => engineBridge.getSkillRange(pieceType, pos.col, pos.row, WasmTurnManager.CAMP_PLAYER);
  }

  // ─── Game actions ──────────────────────────────────────────────────

  selectHand(index: number): boolean {
    if (this.phase !== GamePhase.SELECT_HAND) return false;
    if (index < 0 || index >= this.hand.length) return false;
    // 选牌即校验粮草：不足则不能选（引擎 place_piece -7 为兜底）
    const piece = this.hand[index];
    const wasmType = TS_PIECE_TO_WASM[piece.pieceType as PieceType] ?? WasmPiece.PAWN;
    const spec = engineBridge.getUnitSpec(wasmType);
    // remaining 实时查询（含本回合已放置的 committed 消耗）；0 消耗棋子（英雄/龙棋）不受限
    if (spec && engineBridge.getProvisions().remaining < spec.provisionCost) {
      this.refreshProvisions();
      return false;
    }
    this.selectedHandIndex = index;
    this.phase = GamePhase.PLACE_PIECE;
    return true;
  }

  getValidPlacements(): Point[] {
    if (this.phase !== GamePhase.PLACE_PIECE || this.selectedHandIndex < 0) return [];
    return engineBridge.getValidPlacements();
  }

  getBoardValidPlacements(): Point[] {
    return engineBridge.getValidPlacements();
  }

  placeOnBoard(col: number, row: number): number {
    if (this.phase !== GamePhase.PLACE_PIECE || this.selectedHandIndex < 0) return -1;
    const piece = this.hand[this.selectedHandIndex];
    if (!piece) return -1;

    const wasmType = TS_PIECE_TO_WASM[piece.pieceType as PieceType] ?? WasmPiece.PAWN;
    const ret = engineBridge.placePiece(wasmType, col, row);
    if (ret !== 0) return ret;

    piece.position = { col, row };
    this.placed.push(piece);
    this.hand.splice(this.selectedHandIndex, 1);
    this.selectedHandIndex = -1;
    // 放置即扣 committed 粮草（confirm 时才结算 spent）——实时刷新供 HUD/选牌校验
    this.refreshProvisions();

    if (this.hand.length === 0) {
      this.phase = GamePhase.CONFIRMING;
    } else {
      this.phase = GamePhase.SELECT_HAND;
    }
    return 0;
  }

  undoLastPlacement(): boolean {
    if (this.placed.length === 0) return false;
    const last = this.placed[this.placed.length - 1];
    return this.removePlaced(last.id);
  }

  skipTurn(): void {
    engineBridge.skipTurn();
    this.placed = [];
    this.selectedHandIndex = -1;
    this.phase = GamePhase.SELECT_HAND;
    this.syncState();
  }

  removePlaced(pieceId: string): boolean {
    const idx = this.placed.findIndex(p => p.id === pieceId);
    if (idx === -1) return false;
    const piece = this.placed[idx];
    // C++ only supports LIFO undo — for non-last pieces, undo all from top
    // to target, then re-place the ones after the target
    for (let i = this.placed.length - 1; i >= idx; i--) {
      engineBridge.undoPlacement();
    }
    for (let i = this.placed.length - 1; i > idx; i--) {
      const p = this.placed[i];
      if (p.position) {
        const wasmType = TS_PIECE_TO_WASM[p.pieceType as PieceType] ?? WasmPiece.PAWN;
        engineBridge.placePiece(wasmType, p.position.col, p.position.row);
      }
    }
    this.placed.splice(idx, 1);
    piece.position = null;
    this.hand.push(piece);
    this.selectedHandIndex = -1;
    this.phase = GamePhase.SELECT_HAND;
    // 撤销回退 committed 粮草
    this.refreshProvisions();
    return true;
  }

  canConfirm(): boolean {
    const okPhase = this.phase === GamePhase.CONFIRMING || this.phase === GamePhase.PLACE_PIECE || this.phase === GamePhase.SELECT_HAND;
    // 全落子门控：3 张手牌全部放置才能确定出牌；召唤英雄后 3+1=4 张
    const required = 3 + (this.summonedThisTurn ? 1 : 0);
    return okPhase && this.placed.length >= required;
  }

  confirm(): ResolveStep[] {
    if (!this.canConfirm()) return [];
    if (this.phase === GamePhase.PLACE_PIECE || this.phase === GamePhase.SELECT_HAND) {
      this.phase = GamePhase.CONFIRMING;
    }
    this.phase = GamePhase.RESOLVING;
    engineBridge.confirmTurn();
    // Sync score immediately so HUD updates during step animations reflect this turn's kills
    this.score = engineBridge.getScore();

    // Build resolve steps from WASM animation data
    const steps: ResolveStep[] = [];
    const stepCount = engineBridge.getResolveStepCount();

    for (let si = 0; si < stepCount; si++) {
      const sd = engineBridge.getResolveStep(si);
      const targets: KillTarget[] = [];

      for (let ti = 0; ti < sd.targetCount; ti++) {
        const td = engineBridge.getResolveTarget(si, ti);
        const t: KillTarget = { col: td.col, row: td.row };
        if (td.enemyIndex === -1) {
          // Ally loss — friendly piece hit by own attack
          const ally = this.boardPieces.find(p =>
            p.position?.col === td.col && p.position?.row === td.row)
            || this.placed.find(p =>
            p.position?.col === td.col && p.position?.row === td.row);
          if (ally) {
            t.aid = ally.id;
            ally.alive = false;
          }
        } else {
          const enemy = this._enemies.find(e =>
            e.position?.col === td.col && e.position?.row === td.row);
          if (enemy) {
            t.eid = enemy.id;
            enemy.alive = false;
          }
        }
        targets.push(t);
      }

      steps.push({
        playerPieceIndex: sd.pieceType === -1 ? -1
          : sd.pieceType === -2 ? -2
          : this.placed.findIndex(p =>
              p.position?.col === sd.col && p.position?.row === sd.row),
        origin: { col: sd.col, row: sd.row },
        targets,
      });
    }

    // ★5 连杀统计已由引擎维护（syncState 同步），此处不再本地计算

    return steps;
  }

  afterResolve(): { col: number; row: number }[] {
    this.consumedFlames = engineBridge.getConsumedLoongFlames();
    // Engine clears storm_spawns_ at the start of after_resolve(), so the
    // returned list is exactly this turn's newly spawned obstacles.
    this.stormSpawns = engineBridge.getStormSpawns();
    // 招兵买马：同样在 after_resolve 开头清空，此处读到的正是本回合新复制的单位
    this.recruitSpawns = engineBridge.getRecruitSpawns().map(r => ({
      type: r.type & 0xFF,
      srcCol: r.srcCol, srcRow: r.srcRow, col: r.col, row: r.row,
    }));
    this.placed.forEach(p => { if (p.pieceType !== PieceType.GENERAL) p.active = false; });
    // 英雄龙棋自毁在引擎（龙乂清野）— 此处跳过；LOONG_FLAME 为纯地形不参与 placed
    this.boardPieces.push(...this.placed.filter(p => p.alive && p.pieceType !== PieceType.LOONG_PIECE));
    // Remove sacrificed pieces (placed on LOONG_FLAME and removed by C++ after_resolve).
    // Also filter out alive=false pieces — C++ has already cleared their board occupancy
    // (board_.remove in resolve), so keeping them in JS array causes getUnitAt to return
    // stale wrappers and exportState to persist dead pieces that desync on restore.
    const consumedSet = new Set(this.consumedFlames.map(f => `${f.col},${f.row}`));
    this.boardPieces = this.boardPieces.filter(p =>
      p.alive &&
      (!p.position || !consumedSet.has(`${p.position.col},${p.position.row}`))
    );
    this.placed = [];
    this.selectedHandIndex = -1;
    this.syncState();

    // Souls remain run outcome only. The server credits authoritative inventory on publish.

    // Game-specific: 9 souls → 1 loong piece
    // Manual forging — no auto-convert. Player uses backpack to forge.

    if (this.gameResult !== GameResult.NONE) {
      this.phase = GamePhase.GAME_OVER;
    } else {
      this.phase = GamePhase.SELECT_HAND;
    }
    // Engine clears storm_spawns_ at the start of each after_resolve(),
    // so this list is exactly this turn's newly spawned obstacles.
    return this.stormSpawns;
  }

  /**
   * 引擎权威：按类别把本回合分数增量拆分到每个击杀目标，替代硬编码 150/200/100/-30（R2）。
   * 必须在 confirm() 之后调用——此时引擎已结算本回合，但 this.piecesScore 等仍是上回合值
   * （confirm 只同步 score），故直接读 engine 聚合分计算 delta。
   *
   * 类别增量 = confirm 后引擎聚合分 - confirm 前快照；同类别内均摊到每个目标。
   * 连击/星/额外奖励是回合级总量，不在此拆分（由 GameScene 在回合末对齐）。
   *
   * @param prev confirm 前的聚合分快照
   * @param steps 本回合结算步骤（含目标 ID 与位置）
   * @returns targetId → 该击杀的分数增量（敌方为正，盟友误伤为负）
   */
  buildPerKillScores(
    prev: { pieces: number; city: number; statue: number; ally: number },
    steps: ResolveStep[],
  ): Map<string, number> {
    const cur = engineBridge.getScoreDetails();
    const dPieces = cur.piecesScore - prev.pieces;
    const dCity = cur.cityScore - prev.city;
    const dStatue = cur.statueScore - prev.statue;
    const dAlly = cur.allyPenalty - prev.ally;

    let nPiece = 0, nCity = 0, nStatue = 0, nAlly = 0;
    for (const s of steps) {
      for (const t of s.targets) {
        if (t.aid) { nAlly++; continue; }
        if (t.eid) {
          const u = this._enemies.find(e => e.id === t.eid);
          if (u?.isStatue) nStatue++;
          else if (u?.isCity) nCity++;
          else nPiece++;
        }
      }
    }
    const perPiece = nPiece > 0 ? dPieces / nPiece : 0;
    const perCity = nCity > 0 ? dCity / nCity : 0;
    const perStatue = nStatue > 0 ? dStatue / nStatue : 0;
    const perAlly = nAlly > 0 ? dAlly / nAlly : 0;

    const map = new Map<string, number>();
    for (const s of steps) {
      for (const t of s.targets) {
        if (t.aid) { map.set(t.aid, perAlly); continue; }
        if (t.eid) {
          const u = this._enemies.find(e => e.id === t.eid);
          if (u?.isStatue) map.set(t.eid, perStatue);
          else if (u?.isCity) map.set(t.eid, perCity);
          else map.set(t.eid, perPiece);
        }
      }
    }
    return map;
  }

  // 召唤英雄棋子：消耗 1 枚对应召唤令（锻造时已扣金币+龙魂），加入手牌
  summonHero(pieceType: PieceType): number {
    const w = TS_PIECE_TO_WASM[pieceType] ?? WasmPiece.PAWN;
    const ret = engineBridge.summonHero(w);
    if (ret === 0) this.syncState();  // 刷新手牌数组（含新召唤的英雄棋子）
    return ret;
  }

  useItem(type: EngineItemType, pieces: readonly PieceType[] = []): number {
    // 引擎库存为本地权威：先扣减，引擎成功后立即落盘，失败则回滚
    const itemId = ENGINE_ITEM_IDS[type];
    if (!itemId) return -1; // 未登记的道具类型不可使用
    if (!engineBridge.removePlatformItem(itemId, 1)) return -1;
    const args = pieces.map(piece => TS_PIECE_TO_WASM[piece] ?? WasmPiece.PAWN);
    const result = engineBridge.useItem(type, args);
    if (result === 0) {
      // REDRAW/HAND_SET：引擎已收回本回合已放置的棋子（换手即重选），
      // 本地 placed 数组同步清空（hand 由 syncState 按引擎手牌重建）
      if (type === EngineItemType.REDRAW || type === EngineItemType.HAND_SET) {
        for (const p of this.placed) { p.position = null; p.active = true; }
        this.placed = [];
        this.selectedHandIndex = -1;
      }
      this.syncState();
      this.pendingItemUsage.recordSuccessfulUse(itemId);
      engineBridge.platformSave();
    } else {
      // Roll back item removal if engine rejected the use
      engineBridge.addPlatformItem(itemId, 1);
    }
    return result;
  }

  // ─── Debug ─────────────────────────────────────────────────────────

  addHandPiece(type: PieceType): void {
    const w = TS_PIECE_TO_WASM[type] ?? WasmPiece.PAWN;
    engineBridge.addHandPiece(w);
    this.syncState();
  }

  setHandPiece(type: PieceType, clearFirst: boolean): number {
    const w = TS_PIECE_TO_WASM[type] ?? WasmPiece.PAWN;
    const result = engineBridge.setHandPiece(w, clearFirst);
    if (result === 0) this.syncState();
    return result;
  }

  forceVictory(): void {
    this.markRecordUnpublishable('err.debug_forced_win');
    engineBridge.forceVictory();
    this.syncState();
  }

  forceDefeat(reason: 'err.surrendered' | 'err.no_valid_moves' = 'err.surrendered'): void {
    this.markRecordUnpublishable(reason);
    engineBridge.forceDefeat();
    this.syncState();
  }

  setRecordBinding(binding: RecordBinding): boolean {
    if (!engineBridge.setRecordBinding(binding.hash, binding.runNonce, binding.issuedAt, binding.expiresAt)) {
      this.recordBinding = undefined;
      this.recordPublishError = 'err.binding_init_failed';
      return false;
    }
    this.recordBinding = binding;
    this.recordPublishError = undefined;
    return true;
  }

  markRecordUnpublishable(message: string): void {
    this.recordBinding = undefined;
    this.recordPublishError = message;
  }

  redrawHand(): void {
    engineBridge.redrawHand();
    // 引擎已收回本回合已放置的棋子；本地同步清空（hand 由 syncState 重建）
    for (const p of this.placed) { p.position = null; p.active = true; }
    this.placed = [];
    this.selectedHandIndex = -1;
    this.syncState();
  }

  exportState(): GameSaveData {
    // Export WASM binary state blob
    let wasmState: number[] | undefined;
    try {
      wasmState = Array.from(engineBridge.exportState());
    } catch { /* WASM state export is best-effort */ }

    // Serialize JS-side piece state so placed/boardPieces survive restore
    const allPieces = [...this.placed, ...this.boardPieces, ...this.hand, ...this._enemies];
    const units: UnitSaveData[] = allPieces.map(p => ({
      id: p.id,
      camp: p.camp === TsCamp.PLAYER ? 'player' : 'enemy',
      pieceType: p.pieceType !== undefined ? p.pieceType : PieceType.PAWN,
      position: p.position ? { ...p.position } : null,
      alive: p.alive, active: p.active,
      isCity: p.isCity, isStatue: p.isStatue,
    }));

    return {
      _wasmState: wasmState,
      level: this.level,
      phase: this.phase,
      turnCount: this.turnCount,
      score: this.score,
      gameResult: this.gameResult,
      boardCols: this.board.cols,
      boardRows: this.board.rows,
      // needed by fromSaveData to rebuild JS-side piece arrays after C++ init_from_state
      units,
      placedUnitIds: this.placed.map(p => p.id),
      boardPieceUnitIds: this.boardPieces.map(p => p.id),
      recordBinding: this.recordBinding,
      recordPublishError: this.recordPublishError,
      pendingItemUsage: this.recordBinding ? this.pendingItemUsage.exportPending(
        engineBridge.getRecordActionCount(),
        this.recordBinding.hash,
        this.recordBinding.runNonce,
      ) : undefined,
    } as GameSaveData;
  }
}

// ─── Mapping tables ──────────────────────────────────────────────────

const ENGINE_ITEM_IDS: Record<EngineItemType, string> = {
  [EngineItemType.UNDO]: 'undo',
  [EngineItemType.REDRAW]: 'redraw',
  [EngineItemType.UNSEAL]: 'unseal',
  [EngineItemType.HAND_SET]: 'handSet',
  [EngineItemType.LOONG]: 'loong',
  [EngineItemType.SUMMON_HORSE_IRON]: 'horse_iron',
  [EngineItemType.SUMMON_ELEPHANT_MENMA]: 'elephant_mengma',
  [EngineItemType.SUMMON_CHARIOT_TANK]: 'chariot_tank',
  [EngineItemType.SUMMON_PAWN_ENGINEER]: 'pawn_engineer',
  [EngineItemType.PROVISION_WAGON]: 'provision_wagon',
};

export const TS_PIECE_TO_WASM: Record<PieceType, WasmPiece | undefined> = {
  [PieceType.PAWN]: WasmPiece.PAWN,
  [PieceType.CANNON]: WasmPiece.CANNON,
  [PieceType.CHARIOT]: WasmPiece.CHARIOT,
  [PieceType.HORSE]: WasmPiece.HORSE,
  [PieceType.ELEPHANT]: WasmPiece.ELEPHANT,
  [PieceType.ADVISOR]: WasmPiece.ADVISOR,
  [PieceType.GENERAL]: WasmPiece.GENERAL,
  [PieceType.LOONG_FLAME]: WasmPiece.LOONG_FLAME,
  [PieceType.LOONG_PIECE]: WasmPiece.LOONG_PIECE,
  [PieceType.HORSE_IRON]: WasmPiece.HORSE_IRON,
  [PieceType.ELEPHANT_MENMA]: WasmPiece.ELEPHANT_MENMA,
  [PieceType.CHARIOT_TANK]: WasmPiece.CHARIOT_TANK,
  [PieceType.PAWN_ENGINEER]: WasmPiece.PAWN_ENGINEER,
  [PieceType.CITY]: WasmPiece.CITY,
  [PieceType.STATUE]: WasmPiece.STATUE,
};
