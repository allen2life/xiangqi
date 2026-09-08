/* eslint-disable @typescript-eslint/no-explicit-any */

import { PieceType } from '../core/types';

export type SoundName = 'place' | 'eliminate' | 'cannonFire' | 'cannonExplosion' | 'victory' | 'bgm'
  | 'hit-light' | 'hit-heavy' | 'hit-slash' | 'hit-blunt' | 'hit-whoosh' | 'hit-gong'
  | 'storm-spawn'
  | 'loong-roar' | 'dragon-breath' | 'iron-cavalry' | 'mammoth-crush' | 'iron-tank' | 'engineer-bomb';

const SOUND_DEFS: [SoundName, string, number, boolean][] = [
  ['place', `${import.meta.env.BASE_URL}audio/place.mp3`, 0.6, false],
  ['eliminate', `${import.meta.env.BASE_URL}audio/eliminate.mp3`, 0.6, false],
  ['cannonFire', `${import.meta.env.BASE_URL}audio/cannonFire.mp3`, 0.7, false],
  ['cannonExplosion', `${import.meta.env.BASE_URL}audio/explode.mp3`, 0.8, false],
  ['victory', `${import.meta.env.BASE_URL}audio/victory.mp3`, 0.6, false],
  ['bgm', `${import.meta.env.BASE_URL}audio/bgm.mp3`, 0.2, true],
  ['hit-light', `${import.meta.env.BASE_URL}audio/hit-light.mp3`, 0.5, false],
  ['hit-heavy', `${import.meta.env.BASE_URL}audio/hit-heavy.mp3`, 0.6, false],
  ['hit-slash', `${import.meta.env.BASE_URL}audio/hit-slash.mp3`, 0.6, false],
  ['hit-blunt', `${import.meta.env.BASE_URL}audio/hit-blunt.mp3`, 0.5, false],
  ['hit-whoosh', `${import.meta.env.BASE_URL}audio/hit-whoosh.mp3`, 0.5, false],
  ['hit-gong', `${import.meta.env.BASE_URL}audio/hit-gong-0.mp3`, 0.6, false],
  ['storm-spawn', `${import.meta.env.BASE_URL}audio/storm-explode.mp3`, 0.8, false],
  ['loong-roar', `${import.meta.env.BASE_URL}audio/loong-roar.wav`, 0.7, false],
  ['dragon-breath', `${import.meta.env.BASE_URL}audio/dragon-breath.wav`, 0.65, false],
  ['iron-cavalry', `${import.meta.env.BASE_URL}audio/iron-cavalry.wav`, 0.65, false],
  ['mammoth-crush', `${import.meta.env.BASE_URL}audio/mammoth-crush.wav`, 0.75, false],
  ['iron-tank', `${import.meta.env.BASE_URL}audio/iron-tank.wav`, 0.7, false],
  ['engineer-bomb', `${import.meta.env.BASE_URL}audio/engineer-bomb.wav`, 0.7, false],
];

export const PIECE_HIT_SOUNDS: Record<PieceType, SoundName> = {
  [PieceType.PAWN]: 'hit-light',
  [PieceType.CHARIOT]: 'hit-heavy',
  [PieceType.CANNON]: 'cannonExplosion',
  [PieceType.HORSE]: 'hit-slash',
  [PieceType.ELEPHANT]: 'hit-blunt',
  [PieceType.ADVISOR]: 'hit-whoosh',
  [PieceType.GENERAL]: 'hit-gong',
  [PieceType.LOONG_FLAME]: 'dragon-breath',
  [PieceType.LOONG_PIECE]: 'loong-roar',
  // 召唤令增强棋子：专属定制音效
  [PieceType.HORSE_IRON]: 'iron-cavalry',
  [PieceType.ELEPHANT_MENMA]: 'mammoth-crush',
  [PieceType.CHARIOT_TANK]: 'iron-tank',
  [PieceType.PAWN_ENGINEER]: 'engineer-bomb',
  // 障碍/地形：无技能命中音（不可被技能目标）——占位静音用
  [PieceType.CITY]: 'hit-blunt',
  [PieceType.STATUE]: 'hit-heavy',
};

/** 中国传统五音阶（宫商角徵羽）及其高音阶频率倍率 */
export const PENTATONIC_RATES = [1.0, 1.125, 1.25, 1.5, 1.667, 2.0, 2.25, 2.5] as const;

export function getPentatonicRate(step: number): number {
  if (step <= 0) return 1.0;
  const idx = Math.min(step, PENTATONIC_RATES.length - 1);
  return PENTATONIC_RATES[idx];
}

export class AudioManager {
  private static instance: AudioManager | null = null;
  private sounds = new Map<SoundName, any>();
  private bgmPlaying = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private runtimeUnavailable = false;
  private bgmVolume = 0;
  private sfxVolume = 0;
  private prefsLoaded = false;
  private bgmDucked = false;
  private Howl: any = null;
  private Howler: any = null;
  /** R4: 合成 UI 点击音/失败音用的 AudioContext（优先复用 Howler 已解锁的 ctx） */
  private audioCtx: AudioContext | null = null;
  private static readonly VOLUME_KEY = 'xiangqi-audio-volume';

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  private constructor() {
    this.loadVolumePrefs();
  }

  /** Initialize Howler and construct all sound objects without starting playback. */
  initialize(): Promise<void> {
    this.runtimeUnavailable = false;
    return this.ensureInit();
  }

  private ensureInit(): Promise<void> {
    if (this.runtimeUnavailable) return Promise.resolve();
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init().catch((error) => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  private async _init(): Promise<void> {
    const { Howl, Howler } = await import('howler');
    this.Howl = Howl;
    this.Howler = Howler;
    try {
      // bgm 采用 html5 流式播放，减少首屏 Web Audio 整体解码阻塞；SFX 采用 Web Audio 保证低延迟
      await Promise.all(SOUND_DEFS.map(([name, file, defaultVol, loop]) => new Promise<void>((resolve, reject) => {
        const isBgm = name === 'bgm';
        const prefVol = isBgm ? this.bgmVolume : this.sfxVolume;
        const vol = this.prefsLoaded ? prefVol : defaultVol;
        const sound = new Howl({
          src: [file],
          volume: vol,
          loop,
          html5: isBgm,
          preload: true,
          onload: () => resolve(),
          onloaderror: (_soundId: number | null, error: unknown) => {
            reject(new Error(`Failed to load ${name}: ${String(error)}`));
          },
        });
        this.sounds.set(name, sound);
      })));
      this.initialized = true;
      // Sync field values so volume getters match what's actually used
      if (!this.prefsLoaded) {
        this.bgmVolume = 0.2;
        this.sfxVolume = 0.6;
      }
    } catch (error) {
      this.sounds.forEach((sound) => sound.unload());
      this.sounds.clear();
      this.Howl = null;
      this.Howler = null;
      throw error;
    }
  }

  async play(name: SoundName, opts?: { rate?: number }): Promise<void> {
    try {
      await this.ensureInit();
    } catch {
      // Audio is optional at runtime. Startup reports the load failure and offers
      // continuation; later fire-and-forget SFX calls must not create unhandled
      // rejection or retry a full decode on every animation step.
      this.runtimeUnavailable = true;
      return;
    }
    if (this.sfxVolume <= 0) return;
    const sound = this.sounds.get(name);
    if (sound && name !== 'bgm') {
      const id = sound.play();
      // 音高微调（连击递增）：rate != 1 时按播放实例设置，避免影响后续播放
      if (opts?.rate && opts.rate !== 1) {
        try { sound.rate(opts.rate, id); } catch { /* rate not supported */ }
      }
    }
  }

  /** R4: 合成 SFX 音量（prefs 未加载时用默认 0.6，与 SFX Howl 一致）。 */
  private get synthSfxVolume(): number {
    return this.prefsLoaded ? this.sfxVolume : 0.6;
  }

  /**
   * R4: 取合成 SFX 用的 AudioContext。
   * 优先复用 Howler 已解锁的 ctx（与游戏 SFX 同源，首交互后即 running）；
   * Howler 不可用时回退到自建 ctx（首点击 resume）。
   */
  private getCtx(): AudioContext | null {
    try {
      const howlerCtx = this.Howler?.ctx as AudioContext | undefined;
      if (howlerCtx) {
        if (howlerCtx.state === 'suspended') void howlerCtx.resume();
        return howlerCtx;
      }
      if (!this.audioCtx) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.audioCtx = new Ctor();
      }
      if (this.audioCtx.state === 'suspended') void this.audioCtx.resume();
      return this.audioCtx;
    } catch { return null; }
  }

  /** 合成温润清脆的棋子轻叩音（玉石触感 + 盘面微共鸣），音量跟随 sfxVolume。 */
  playClick(): void {
    const vol = this.synthSfxVolume;
    if (vol <= 0) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;

    // 1. 高频清脆触碰声（模拟玉石/硬木棋子接触瞬间）
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'sine';
    clickOsc.frequency.setValueAtTime(1480, start);
    clickOsc.frequency.exponentialRampToValueAtTime(560, start + 0.035);
    clickGain.gain.setValueAtTime(0.0001, start);
    clickGain.gain.exponentialRampToValueAtTime(0.45 * vol, start + 0.002);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
    clickOsc.connect(clickGain).connect(ctx.destination);
    clickOsc.start(start);
    clickOsc.stop(start + 0.05);

    // 2. 低频木质盘面共鸣微弱底音（棋盘箱体微鸣）
    const thudOsc = ctx.createOscillator();
    const thudGain = ctx.createGain();
    thudOsc.type = 'triangle';
    thudOsc.frequency.setValueAtTime(220, start);
    thudOsc.frequency.exponentialRampToValueAtTime(90, start + 0.06);
    thudGain.gain.setValueAtTime(0.0001, start);
    thudGain.gain.exponentialRampToValueAtTime(0.25 * vol, start + 0.004);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
    thudOsc.connect(thudGain).connect(ctx.destination);
    thudOsc.start(start);
    thudOsc.stop(start + 0.08);
  }

  /** R4: 合成失败音（sawtooth 下行 420→110Hz），音量跟随 sfxVolume。 */
  playDefeat(): void {
    const vol = this.synthSfxVolume;
    if (vol <= 0) return;
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(110, now + 0.6);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2 * vol, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.75);
  }

  /** 终局击杀等高潮时刻临时压低 BGM，让 SFX 突出。调用 restoreBgm 恢复。 */
  duckBgm(): void {
    if (!this.initialized || !this.bgmPlaying || this.bgmVolume <= 0 || this.bgmDucked) return;
    this.bgmDucked = true;
    const bgm = this.sounds.get('bgm');
    if (bgm) bgm.fade(this.bgmVolume, this.bgmVolume * 0.3, 200);
  }

  /** 恢复 BGM 至用户设定音量。 */
  restoreBgm(): void {
    if (!this.initialized || !this.bgmDucked) return;
    this.bgmDucked = false;
    const bgm = this.sounds.get('bgm');
    if (bgm) bgm.fade(this.bgmVolume * 0.3, this.bgmVolume, 500);
  }

  async playBgm(): Promise<void> {
    try {
      await this.ensureInit();
    } catch {
      return;
    }
    if (this.bgmVolume <= 0) return;
    const bgm = this.sounds.get('bgm');
    if (bgm && !this.bgmPlaying) {
      bgm.play();
      this.bgmPlaying = true;
    }
  }

  stopBgm(): void {
    const bgm = this.sounds.get('bgm');
    if (bgm) {
      bgm.stop();
      this.bgmPlaying = false;
    }
    this.bgmDucked = false;
  }

  get isBgmPlaying(): boolean { return this.bgmPlaying; }

  setBgmVolume(v: number): void {
    this.bgmVolume = v;
    this.bgmDucked = false;
    this.saveVolumePrefs();
    if (this.initialized) {
      const bgm = this.sounds.get('bgm');
      if (bgm) {
        bgm.volume(v);
        if (v > 0 && !this.bgmPlaying) {
          bgm.play();
          this.bgmPlaying = true;
        }
        if (v === 0 && this.bgmPlaying) {
          bgm.stop();
          this.bgmPlaying = false;
        }
      }
    }
  }

  setSfxVolume(v: number): void {
    this.sfxVolume = v;
    this.saveVolumePrefs();
    if (this.initialized) {
      this.sounds.forEach((sound, name) => {
        if (name !== 'bgm') sound.volume(v);
      });
    }
  }

  private loadVolumePrefs(): void {
    try {
      const raw = localStorage.getItem(AudioManager.VOLUME_KEY);
      if (!raw) return;
      const { bgm, sfx } = JSON.parse(raw) as { bgm: number; sfx: number };
      if (typeof bgm === 'number' && Number.isFinite(bgm)) this.bgmVolume = bgm;
      if (typeof sfx === 'number' && Number.isFinite(sfx)) this.sfxVolume = sfx;
      this.prefsLoaded = true;
    } catch { /* ignore corrupt prefs */ }
  }

  private saveVolumePrefs(): void {
    try {
      localStorage.setItem(AudioManager.VOLUME_KEY, JSON.stringify({ bgm: this.bgmVolume, sfx: this.sfxVolume }));
    } catch { /* storage full or unavailable */ }
  }

  getBgmVolume(): number { return this.bgmVolume; }
  getSfxVolume(): number { return this.sfxVolume; }

  destroy(): void {
    this.sounds.forEach(s => s.unload());
    this.sounds.clear();
    this.bgmPlaying = false;
    this.bgmDucked = false;
    this.initialized = false;
    this.runtimeUnavailable = false;
    this.initPromise = null;
    if (this.audioCtx) { try { void this.audioCtx.close(); } catch { /* ignore */ } this.audioCtx = null; }
  }
}

