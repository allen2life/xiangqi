// Type definitions matching C++ engine types (engine/include/engine/types.h)
// These are the types used to communicate with the WASM engine bridge.

export enum PieceType {
  NONE = 0,
  PAWN = 1,
  CANNON = 2,
  CHARIOT = 3,
  HORSE = 4,
  ELEPHANT = 5,
  ADVISOR = 6,
  GENERAL = 7,
  LOONG_FLAME = 8,  // 龙息之地（纯地形，非棋子）
  // ── 英雄棋子（召唤令获得）──
  LOONG_PIECE = 9,   // 龙棋
  HORSE_IRON = 10,   // 重骑
  ELEPHANT_MENMA = 11,  // 猛犸象
  CHARIOT_TANK = 12,    // 铁甲车
  PAWN_ENGINEER = 13,   // 工兵
  // ── 障碍（v10 起真枚举，统一 PieceType）──
  CITY = 14,   // 城池
  STATUE = 15, // 石像（雕像）
}

export enum GamePhase {
  NONE = 0,
  INIT = 1,
  SELECT_HAND = 2,
  PLACING = 3,
  CONFIRMED = 4,
  RESOLVING = 5,
  KINGS_MEETING = 6,
  AFTER_RESOLVE = 7,
  STORM_SPAWN = 8,
  GAME_OVER = 9,
}

export enum GameResult {
  NONE = 0,
  WIN = 1,
  LOSE = 2,
}

export enum Camp {
  PLAYER = 0,
  ENEMY = 1,
}

export enum GameMode {
  ENDLESS = 0,
  CAMPAIGN = 1,
}

export enum EngineItemType {
  UNDO = 1,
  REDRAW = 2,
  UNSEAL = 3,
  HAND_SET = 4,
  LOONG = 5,  // 龙棋召唤令
  // ── 英雄棋子召唤令 ──
  SUMMON_HORSE_IRON = 6,
  SUMMON_ELEPHANT_MENMA = 7,
  SUMMON_CHARIOT_TANK = 8,
  SUMMON_PAWN_ENGINEER = 9,
  PROVISION_WAGON = 10,  // 木牛流马：+5 粮草上限（叠加；用过即失 ★2）
}

export interface Point {
  col: number;
  row: number;
}

export interface MoveRecord {
  pieceType: PieceType;
  col: number;
  row: number;
  scoreGained: number;
  turn: number;
}

export interface EnemyData {
  type: number; // v10 起：统一 PieceType 数值直接编码（CITY=14/STATUE=15）
  col: number;
  row: number;
  alive: boolean;
}

export interface StormSpawn {
  col: number;
  row: number;
}

// 敌将被动"招兵买马"：本回合复制生成的敌方单位（src 为被复制的源单位）
// type 为引擎原始编码（同 getEnemies），前端用 wasmToTsPiece 转 core PieceType
export interface RecruitSpawn {
  type: number;
  srcCol: number;
  srcRow: number;
  col: number;
  row: number;
}

export const MAX_BOARD_SIZE = 9;
export const MAX_HAND_SIZE = 7;
export const MAX_ENEMIES = 60;
export const MAX_FORBIDDEN = 60;
export const MAX_STORM_SPAWNS = 10;
export const MAX_MOVES = 500;
export const HMAC_SIZE = 32;

export const PIECE_NAMES: Record<PieceType, string> = {
  [PieceType.NONE]: 'none',
  [PieceType.PAWN]: 'pawn',
  [PieceType.CANNON]: 'cannon',
  [PieceType.CHARIOT]: 'chariot',
  [PieceType.HORSE]: 'horse',
  [PieceType.ELEPHANT]: 'elephant',
  [PieceType.ADVISOR]: 'advisor',
  [PieceType.GENERAL]: 'general',
  [PieceType.LOONG_FLAME]: 'loong_flame',
  [PieceType.LOONG_PIECE]: 'loong_piece',
  [PieceType.HORSE_IRON]: 'horse_iron',
  [PieceType.ELEPHANT_MENMA]: 'elephant_mengma',
  [PieceType.CHARIOT_TANK]: 'chariot_tank',
  [PieceType.PAWN_ENGINEER]: 'pawn_engineer',
  [PieceType.CITY]: 'city',
  [PieceType.STATUE]: 'statue',
};
