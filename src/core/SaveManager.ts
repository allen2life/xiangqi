// ── Key Names ──
const HASH_KEY = 'xiangqi-blast-hash';
const RECORD_KEY = 'xiangqi-blast-record';
const CHECKPOINT_KEY = 'xiangqi-blast-checkpoint';

// ── Encrypted Storage ──
import { encrypt, decrypt } from '../utils/crypto';
import { AppError } from '../i18n/AppError';
import type { PieceType } from './types';
import type { RecordBinding } from './runBinding';

// ── SHA-256 (NIST FIPS 180-4) ──
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = ((len + 8) >> 6) + 1;
  const words = new Uint32Array(padLen * 16);

  for (let i = 0; i < len; i++) {
    words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  }
  words[len >> 2] |= 0x80 << (24 - (len & 3) * 8);
  words[words.length - 2] = Math.floor(bitLen / 0x100000000);
  words[words.length - 1] = bitLen >>> 0;

  const w = new Uint32Array(64);

  for (let chunk = 0; chunk < words.length; chunk += 16) {
    for (let i = 0; i < 16; i++) {
      w[i] = words[chunk + i];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ ((~e) & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const toHex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4) + toHex(h5) + toHex(h6) + toHex(h7);
}

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

const GUEST_ENCRYPT_KEY = 'xq-guest-local';

function encode(data: unknown): string {
  const json = JSON.stringify(data);
  const hash = getEncryptKey() || GUEST_ENCRYPT_KEY;
  return encrypt(json, hash);
}

function decode<T>(stored: string): T {
  const hash = getEncryptKey() || GUEST_ENCRYPT_KEY;
  try { return JSON.parse(decrypt(stored, hash)) as T; } catch { /* fall through */ }
  if (hash !== GUEST_ENCRYPT_KEY) {
    try { return JSON.parse(decrypt(stored, GUEST_ENCRYPT_KEY)) as T; } catch { /* fall through */ }
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
    if (!this.isValidKouling(kouling)) {
      throw new AppError('err.kouling_format');
    }
    const hash = this.koulingToHash(kouling);
    const data = this.readHash() || { hash: '', nickname: '' };
    data.hash = hash;
    if (nickname !== undefined) data.nickname = nickname.trim();
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

  // ── SHA-256 & Kouling Identity (SPEC_IDENTITY v1.1.0) ──

  static isValidPart(part: string): boolean {
    if (!part || typeof part !== 'string') return false;
    const trimmed = part.trim();
    const chars = [...trimmed];
    return chars.length >= 1 && chars.length <= 8 && !trimmed.includes('.');
  }

  static isValidKouling(kouling: string): boolean {
    if (!kouling || typeof kouling !== 'string') return false;
    const parts = kouling.split('.');
    if (parts.length !== 3) return false;
    return parts.every(p => this.isValidPart(p));
  }

  /** Compute a deterministic UserHash from a kouling (hex(SHA-256(UTF-8(kouling + ":id")))). */
  static koulingToHash(kouling: string): string {
    if (!this.isValidKouling(kouling)) {
      throw new AppError('err.kouling_format');
    }
    return sha256Hex(kouling.trim() + ':id');
  }

  /** Compute a deterministic SyncToken from a kouling (hex(SHA-256(UTF-8(kouling + ":auth")))). */
  static deriveSyncToken(kouling: string): string {
    if (!this.isValidKouling(kouling)) {
      throw new AppError('err.kouling_format');
    }
    return sha256Hex(kouling.trim() + ':auth');
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
