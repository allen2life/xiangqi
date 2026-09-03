// ── Key Names ──
const HASH_KEY = 'xiangqi-blast-hash';
const RECORD_KEY = 'xiangqi-blast-record';
const CHECKPOINT_KEY = 'xiangqi-blast-checkpoint';

// ── Encrypted Storage ──
import { encrypt, decrypt } from '../utils/crypto';
import { AppError } from '../i18n/AppError';
import type { PieceType } from './types';
import type { RecordBinding } from './runBinding';

const FIXED_SALT = 'hash-salt-fixed'; // used only for HASH_KEY (chicken-and-egg)

function safeGet(key: string, hash: string): string | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return decrypt(raw, hash);
  } catch { return null; }
}

function safeSet(key: string, value: string, hash: string): void {
  try {
    localStorage.setItem(key, encrypt(value, hash));
  } catch { /* ignore */ }
}

// ── Old keys for migration ──
const OLD_HASH_KEY = 'chess-storm-hash';
const OLD_NICKNAME_KEY = 'chess-storm-nickname';
const OLD_SAVE_KEY = 'chess-storm-save';
const OLD_GAME_STATE_KEY = 'chess-storm-game';
const OLD_RECORDS_KEY = 'chess-storm-records';
const OLD_TOTAL_KEY = 'chess-storm-total';
const OLD_MAX_LEVEL_KEY = 'chess-storm-max-level';

// ── Public Interfaces ──

export interface UnitSaveData {
  id: string;
  camp: string;
  pieceType: PieceType; // 枚举数字（序列化直接存 PieceType 数值）
  position: { col: number; row: number } | null;
  alive: boolean;
  active: boolean;
  isCity: boolean;
  isStatue: boolean;
}

export interface PendingItemUsageSaveData {
  version: 1;
  actionCount: number;
  bindingHash: string;
  bindingNonce: string;
  items: Record<string, number>;
}

export interface GameSaveData {
  /** WASM binary state blob — the primary save/restore mechanism via C++ init_from_state */
  _wasmState?: number[];
  level: number;
  phase: string;
  turnCount: number;
  score: number;
  gameResult: string;
  boardCols: number;
  boardRows: number;
  /** Piece snapshot for fromSaveData to rebuild JS-side arrays after C++ restore */
  units: UnitSaveData[];
  placedUnitIds: string[];
  boardPieceUnitIds: string[];
  /** Server-issued binding for the game record; absent/error games remain playable but cannot publish. */
  recordBinding?: RecordBinding;
  recordPublishError?: string;
  pendingItemUsage?: PendingItemUsageSaveData;
}

export interface SaveData {
  level: number;
  score: number;
  timestamp: number;
}

export interface LevelRecord {
  level: number;
  score: number;
  timestamp: number;
}

// ── Internal Types ──

interface HashData {
  hash: string;
  nickname: string;
  invite_code?: string;
}

interface RecordData {
  maxLevel: number;
  totalScore: number;
  records: LevelRecord[];
  save: SaveData | null;
  levelStars?: Record<number, number>; // per-level max stars (0-5)
}

// ── Encryption: XOR+displacement (replaces old base64 obfuscation) ──
// Uses player hash as key; falls back to old method for migration

function getEncryptKey(): string {
  try {
    const hd = JSON.parse(localStorage.getItem(HASH_KEY) || '{}');
    return (hd.hash as string) || '';
  } catch { return ''; }
}

function encode(data: unknown): string {
  const json = JSON.stringify(data);
  const hash = getEncryptKey();
  if (hash) return encrypt(json, hash);
  // Fallback: old obfuscation (for data written before crypto upgrade)
  const b64 = btoa(json);
  if (b64.length < 8) return b64;
  return b64.slice(-4) + b64.slice(4, -4) + b64.slice(0, 4);
}

function decode<T>(stored: string): T {
  const hash = getEncryptKey();
  if (hash) {
    try { return JSON.parse(decrypt(stored, hash)) as T; } catch { /* fall through */ }
  }
  // Fallback: old deobfuscation (migration)
  try {
    let b64 = stored;
    if (b64.length >= 8) {
      b64 = b64.slice(-4) + b64.slice(4, -4) + b64.slice(0, 4);
    }
    return JSON.parse(atob(b64)) as T;
  } catch { return JSON.parse(atob(stored)) as T; }
}

// ═══════════════════════════════════════════════════════════════════
//  SaveManager
// ═══════════════════════════════════════════════════════════════════

export class SaveManager {
  // ── Hash (plaintext key) ──

  static hasHash(): boolean {
    return this.getHash() !== '';
  }

  static getHash(): string {
    const data = this.readHash();
    return data?.hash ?? '';
  }

  static getNickname(): string {
    const data = this.readHash();
    return data?.nickname ?? '';
  }

  static saveNickname(name: string): void {
    const data = this.readHash();
    if (data) {
      data.nickname = name;
      this.writeHash(data);
    } else {
      this.writeHash({ hash: '', nickname: name });
    }
  }

  /** Persist an identity derived from the existing kouling UX before a ranked run starts. */
  static persistKoulingIdentity(kouling: string, nickname?: string): string {
    const parts = kouling.split('.');
    if (parts.length !== 3 || parts.some(part => !/^[a-zA-Z0-9_\-)(*^%$@#!]{1,8}$/.test(part))) {
      throw new AppError('err.kouling_format');
    }
    const hash = this.koulingToHash(kouling);
    const data = this.readHash() || { hash: '', nickname: '' };
    data.hash = hash;
    if (nickname !== undefined) data.nickname = nickname;
    this.writeHash(data);
    return hash;
  }

  /** Replace the stored hash with a kouling-derived one after successful sync. */
  static persistSyncHash(hash: string): void {
    const data = this.readHash() || { hash: '', nickname: '' };
    data.hash = hash;
    this.writeHash(data);
  }

  /** Store the invite code from a share link URL parameter. */
  static setInviteCode(code: string): void {
    const data = this.readHash() || { hash: this.generateHash(), nickname: '' };
    data.invite_code = code;
    this.writeHash(data);
  }

  /** Get the stored invite code, or null if not present. */
  static getInviteCode(): string | null {
    const data = this.readHash();
    return data?.invite_code ?? null;
  }

  // ── Records (obfuscated key) ──

  /** Save current progress (next level, current score). */
  static save(level: number, score: number): void {
    const data = this.readRecord() || this.emptyRecord();
    data.save = { level, score, timestamp: Date.now() };
    this.writeRecord(data);
  }

  /** Load current progress info for cloud sync. */
  static load(): SaveData | null {
    const data = this.readRecord();
    return data?.save ?? null;
  }

  /** Record a completed level. Returns the cumulative total score. */
  static addRecord(level: number, score: number): number {
    const data = this.readRecord() || this.emptyRecord();
    data.records.push({ level, score, timestamp: Date.now() });
    data.totalScore += score;
    if (level > data.maxLevel) data.maxLevel = level;
    this.writeRecord(data);
    return data.totalScore;
  }

  static loadRecords(): LevelRecord[] {
    const data = this.readRecord();
    return data?.records ?? [];
  }

  static getTotalScore(): number {
    return this.readRecord()?.totalScore ?? 0;
  }

  static getMaxLevel(): number {
    return this.readRecord()?.maxLevel ?? 0;
  }

  static saveMaxLevel(level: number): void {
    const data = this.readRecord() || this.emptyRecord();
    if (level > data.maxLevel) {
      data.maxLevel = level;
      this.writeRecord(data);
    }
  }

  /** Record per-level max stars achieved. */
  static saveLevelStars(level: number, stars: number): void {
    const data = this.readRecord() || this.emptyRecord();
    if (!data.levelStars) data.levelStars = {};
    const prev = data.levelStars[level] ?? 0;
    if (stars > prev) {
      data.levelStars[level] = stars;
      this.writeRecord(data);
    }
  }

  /** Get max stars for a level (0 = no stars/not played). */
  static getLevelStars(level: number): number {
    const data = this.readRecord();
    if (!data?.levelStars) return 0;
    return data.levelStars[level] ?? 0;
  }

  /** Get all level stars data. */
  static getAllLevelStars(): Record<number, number> {
    return this.readRecord()?.levelStars ?? {};
  }

  /** Clear all records and save data (keeps hash intact). */
  static clear(): void {
    try { localStorage.removeItem(RECORD_KEY); } catch { /* ignore */ }
    for (const k of [OLD_SAVE_KEY, OLD_RECORDS_KEY, OLD_TOTAL_KEY, OLD_MAX_LEVEL_KEY]) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  }

  // ── Cloud sync helpers ──

  /** Return raw localStorage value of record (already obfuscated). */
  static getRecordRaw(): string | null {
    try {
      const raw = localStorage.getItem(RECORD_KEY);
      if (raw) return raw;
      // Trigger migration from old keys
      if (this.migrateOldRecords()) return localStorage.getItem(RECORD_KEY);
      return null;
    } catch { return null; }
  }

  /** Return raw localStorage value of checkpoint (already obfuscated). */
  static getCheckpointRaw(): string | null {
    try {
      const raw = localStorage.getItem(CHECKPOINT_KEY);
      if (raw) return raw;
      const old = localStorage.getItem(OLD_GAME_STATE_KEY);
      return old ? btoa(old) : null;
    } catch { return null; }
  }

  /** Write raw record and checkpoint strings from cloud download. */
  static restoreCloudData(recordRaw: string | null, checkpointRaw: string | null): void {
    try {
      if (recordRaw) localStorage.setItem(RECORD_KEY, recordRaw);
      if (checkpointRaw) localStorage.setItem(CHECKPOINT_KEY, checkpointRaw);
    } catch { /* ignore */ }
  }

  // ── Checkpoint (obfuscated key) ──

  static saveGameState(data: GameSaveData): boolean {
    try {
      localStorage.setItem(CHECKPOINT_KEY, encode(data));
      return true;
    } catch { return false; }
  }

  static loadGameState(): GameSaveData | null {
    try {
      const raw = localStorage.getItem(CHECKPOINT_KEY);
      if (raw) return decode<GameSaveData>(raw);
      // Migration from old key
      const old = localStorage.getItem(OLD_GAME_STATE_KEY);
      if (old) {
        const data = JSON.parse(old) as GameSaveData;
        this.saveGameState(data);
        try { localStorage.removeItem(OLD_GAME_STATE_KEY); } catch { /* ignore */ }
        return data;
      }
      return null;
    } catch { return null; }
  }

  static hasGameState(): boolean {
    try {
      return localStorage.getItem(CHECKPOINT_KEY) !== null
        || localStorage.getItem(OLD_GAME_STATE_KEY) !== null;
    } catch { return false; }
  }

  static clearGameState(): void {
    try { localStorage.removeItem(CHECKPOINT_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(OLD_GAME_STATE_KEY); } catch { /* ignore */ }
    this.clearTurnSnapshot();
  }

  // ── Turn snapshot ──

  static readonly TURN_SNAPSHOT_KEY = 'xiangqi-blast-turn-snapshot';
  static readonly PREVIOUS_TURN_SNAPSHOT_KEY = 'xiangqi-blast-turn-snapshot-previous';

  static initializeTurnSnapshots(data: GameSaveData): boolean {
    try {
      localStorage.setItem(this.TURN_SNAPSHOT_KEY, encode(data));
      localStorage.removeItem(this.PREVIOUS_TURN_SNAPSHOT_KEY);
      return true;
    } catch { return false; }
  }

  static rotateTurnSnapshots(data: GameSaveData): boolean {
    try {
      const current = localStorage.getItem(this.TURN_SNAPSHOT_KEY);
      if (!current) return this.initializeTurnSnapshots(data);
      localStorage.setItem(this.PREVIOUS_TURN_SNAPSHOT_KEY, current);
      localStorage.setItem(this.TURN_SNAPSHOT_KEY, encode(data));
      return true;
    } catch { return false; }
  }

  static replaceCurrentTurnSnapshot(data: GameSaveData): boolean {
    try {
      localStorage.setItem(this.TURN_SNAPSHOT_KEY, encode(data));
      return true;
    } catch { return false; }
  }

  /** Commit paid undo final state before consuming its previous-turn source. */
  static commitPaidUndo(data: GameSaveData): boolean {
    const encoded = encode(data);
    let oldCheckpoint: string | null = null;
    let oldCurrent: string | null = null;
    try {
      oldCheckpoint = localStorage.getItem(CHECKPOINT_KEY);
      oldCurrent = localStorage.getItem(this.TURN_SNAPSHOT_KEY);
      localStorage.setItem(CHECKPOINT_KEY, encoded);
      localStorage.setItem(this.TURN_SNAPSHOT_KEY, encoded);
      localStorage.removeItem(this.PREVIOUS_TURN_SNAPSHOT_KEY);
      return true;
    } catch {
      try {
        if (oldCheckpoint === null) localStorage.removeItem(CHECKPOINT_KEY);
        else localStorage.setItem(CHECKPOINT_KEY, oldCheckpoint);
        if (oldCurrent === null) localStorage.removeItem(this.TURN_SNAPSHOT_KEY);
        else localStorage.setItem(this.TURN_SNAPSHOT_KEY, oldCurrent);
      } catch { /* fail closed; caller reports the storage failure */ }
      return false;
    }
  }

  static loadTurnSnapshot(): GameSaveData | null {
    try {
      const raw = localStorage.getItem(this.TURN_SNAPSHOT_KEY);
      if (raw) return decode<GameSaveData>(raw);
      return null;
    } catch { return null; }
  }

  static loadPreviousTurnSnapshot(): GameSaveData | null {
    try {
      const raw = localStorage.getItem(this.PREVIOUS_TURN_SNAPSHOT_KEY);
      return raw ? decode<GameSaveData>(raw) : null;
    } catch { return null; }
  }

  static clearTurnSnapshot(): void {
    try { localStorage.removeItem(this.TURN_SNAPSHOT_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(this.PREVIOUS_TURN_SNAPSHOT_KEY); } catch { /* ignore */ }
  }

  // ── Game record (HMAC-signed WASM record) ──

  static readonly GAME_RECORD_KEY = 'xiangqi-blast-game-record';

  static saveGameRecord(recordB64: string): void {
    try { localStorage.setItem(this.GAME_RECORD_KEY, recordB64); } catch { /* ignore */ }
  }

  static loadGameRecord(): string | null {
    try { return localStorage.getItem(this.GAME_RECORD_KEY); } catch { return null; }
  }

  static clearGameRecord(): void {
    try { localStorage.removeItem(this.GAME_RECORD_KEY); } catch { /* ignore */ }
  }

  // ── Internal helpers ──

  private static readHash(): HashData | null {
    try {
      const raw = localStorage.getItem(HASH_KEY);
      if (raw) return JSON.parse(raw) as HashData;
      // Migration from old keys
      return this.migrateOldHash();
    } catch { return null; }
  }

  private static writeHash(data: HashData): void {
    try { localStorage.setItem(HASH_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }

  private static readRecord(): RecordData | null {
    try {
      const raw = localStorage.getItem(RECORD_KEY);
      if (raw) return decode<RecordData>(raw);
      // Migration from old keys
      return this.migrateOldRecords();
    } catch { return null; }
  }

  private static writeRecord(data: RecordData): void {
    try { localStorage.setItem(RECORD_KEY, encode(data)); } catch { /* ignore */ }
  }

  private static emptyRecord(): RecordData {
    return { maxLevel: 0, totalScore: 0, records: [], save: null };
  }

  // ── Migration ──

  private static migrateOldHash(): HashData | null {
    const oldHash = (() => { try { return localStorage.getItem(OLD_HASH_KEY); } catch { return null; } })();
    const oldNick = (() => { try { return localStorage.getItem(OLD_NICKNAME_KEY); } catch { return null; } })();
    if (!oldHash) return null;
    const data: HashData = { hash: oldHash, nickname: oldNick ?? '' };
    this.writeHash(data);
    try { localStorage.removeItem(OLD_HASH_KEY); } catch { /* ignore */ }
    try { localStorage.removeItem(OLD_NICKNAME_KEY); } catch { /* ignore */ }
    return data;
  }

  private static migrateOldRecords(): RecordData | null {
    const save = (() => {
      try {
        const r = localStorage.getItem(OLD_SAVE_KEY);
        return r ? JSON.parse(r) as SaveData : null;
      } catch { return null; }
    })();
    const records = (() => {
      try {
        const r = localStorage.getItem(OLD_RECORDS_KEY);
        return r ? JSON.parse(r) as LevelRecord[] : [];
      } catch { return []; }
    })();
    const totalScore = (() => {
      try {
        const r = localStorage.getItem(OLD_TOTAL_KEY);
        return r ? parseInt(r, 10) || 0 : 0;
      } catch { return 0; }
    })();
    const maxLevel = (() => {
      try {
        const r = localStorage.getItem(OLD_MAX_LEVEL_KEY);
        return r ? parseInt(r, 10) || 0 : 0;
      } catch { return 0; }
    })();

    if (!save && records.length === 0 && totalScore === 0 && maxLevel === 0) return null;

    const data: RecordData = { maxLevel, totalScore, records, save };
    this.writeRecord(data);
    for (const k of [OLD_SAVE_KEY, OLD_RECORDS_KEY, OLD_TOTAL_KEY, OLD_MAX_LEVEL_KEY]) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
    return data;
  }

  // ── Hash generation ──

  /** Compute a deterministic hash from a kouling. */
  static koulingToHash(kouling: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < kouling.length; i++) {
      h ^= kouling.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
      h = h >>> 0;
    }
    // Expand 32-bit to 64 hex chars with a simple linear-feedback
    let result = '';
    for (let i = 0; i < 64; i++) {
      h = Math.imul(h ^ (h >>> 13), 0x45d9f3b);
      h = ((h << 16) ^ h ^ (h >>> 5)) >>> 0;
      result += '0123456789abcdef'.charAt(h & 0xf);
    }
    return result;
  }

  private static generateHash(): string {
    const chars = '0123456789abcdef';
    let result = '';
    for (let i = 0; i < 64; i++) {
      result += chars.charAt(Math.floor(Math.random() * 16));
    }
    return result;
  }
}
