export interface Point { col: number; row: number; }
export interface CombatAttributes {
  damage: number;
  range: number;
  knockback: number;
  splash: number;
}
export enum Camp { PLAYER = 'player', ENEMY = 'enemy' }
export enum PieceType { PAWN = 'pawn', CHARIOT = 'chariot', CANNON = 'cannon', HORSE = 'horse', ELEPHANT = 'elephant', ADVISOR = 'advisor', GENERAL = 'general', LOONG_FLAME = 'loong_flame', LOONG_PIECE = 'loong_piece', HORSE_IRON = 'horse_iron', ELEPHANT_MENMA = 'elephant_mengma', CHARIOT_TANK = 'chariot_tank', PAWN_ENGINEER = 'pawn_engineer', CITY = 'city', STATUE = 'statue' }
export enum GamePhase {
  SELECT_HAND = 'select_hand', PLACE_PIECE = 'place_piece',
  CONFIRMING = 'confirming', RESOLVING = 'resolving',
  DRAWING = 'drawing', GAME_OVER = 'game_over',
}
export enum GameResult { NONE = 'none', WIN = 'win', LOSE = 'lose' }
export interface KillTarget extends Point {
  /** Enemy unit id killed at this position, or undefined if none. */
  eid?: string;
  /** Ally unit id killed by friendly fire at this position, or undefined if none. */
  aid?: string;
}
export interface ResolveStep {
  playerPieceIndex: number; origin: Point; targets: KillTarget[];
}
export interface EnemyConfig {
  pieceType: PieceType; col: number; row: number;
  isCity?: boolean; isStatue?: boolean;
}
export interface LevelData {
  level: number;
  cols: number; rows: number; enemies: EnemyConfig[]; playerHandTypes: PieceType[];
}
