import { Container, Graphics, Sprite } from 'pixi.js';
import gsap from 'gsap';
import { logicalToScreen } from '../utils/coord';
import { getCellSize } from '../utils/coord';
import { type ResolveStep, PieceType } from '../core/types';
import type {
  SkillEffectDef, CastEffect, TravelEffect, HitEffect, DefeatEffect, RippleEffect,
} from './EffectTheme';
import { type EffectTheme, validateTheme } from './EffectTheme';
import { EffectRenderer } from './EffectRenderer';
import { CharacterShatterPool } from './CharacterShatterPool';
import {
  IMPACT, HIT_STOP, COMBO_SHAKE, VIGNETTE, SCREEN_FLASH, SLOW_MO,
  STAGGER, CHAR_SPIN, SHATTER, TRAVEL, RING, EASE,
  KINGS_MEETING, GENERAL_WEIGHT, PALACE,
} from './EffectConstants';
import { getBattleSpeed, onBattleSpeedChange } from '../utils/battleSpeed';

// 可热调慢放系数：window.__fxSlow = 2 即可整体慢放，便于逐帧调试。
function getSlow(): number {
  const v = (typeof window !== 'undefined' ? (window as unknown as { __fxSlow?: number }).__fxSlow : undefined);
  return v && v > 0 ? v : 1;
}

/** Wrap a display object so it's invisible until `startAt`. */
function hide<T extends Container | Graphics | Sprite>(obj: T, tl: gsap.core.Timeline, startAt: number): T {
  obj.visible = false;
  tl.set(obj, { visible: true }, startAt);
  return obj;
}

interface Vec2 { x: number; y: number; }

interface EffectContext {
  tl: gsap.core.Timeline;
  layer: Container;
  pos: Vec2;
  startAt: number;
  primary: number;
  secondary: number;
  accent: number;
  /** Reduced motion 模式下，handler 应跳过装饰性动画，只保留极简版。 */
  reduceMotion: boolean;
  /** 当前步骤的棋子类型（用于 GENERAL 加权等差异化逻辑） */
  pieceType?: PieceType;
}

interface TravelContext extends EffectContext {
  from: Vec2;
  to: Vec2;
}

interface HitContext extends EffectContext {
  pieceKey: string;
  targetPiece?: Container | null;
}

interface DefeatContext extends EffectContext {
  pieceKey: string;
}

export class SkillEffectPlayer {
  private renderer = new EffectRenderer();
  private theme: EffectTheme;
  private activeTl: gsap.core.Timeline | null = null;
  private shatterPool: CharacterShatterPool | null = null;
  private shakeTarget: Container | null = null;
  private reduceMotion = false;
  private skipped = false;
  /** Called at the climax moment (first hit impact), synced with screen shake timing */
  onStepClimax: (() => void) | null = null;

  constructor(theme: EffectTheme, shatterPool?: CharacterShatterPool) {
    this.theme = validateTheme(theme);
    this.shatterPool = shatterPool ?? null;
    // 自动读 prefers-reduced-motion；外部可通过 setReduceMotion 覆盖
    try {
      this.reduceMotion = typeof window !== 'undefined'
        ? window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
        : false;
    } catch { this.reduceMotion = false; }
    onBattleSpeedChange((speed) => {
      if (this.activeTl) this.activeTl.timeScale(speed);
    });
  }

  setTheme(theme: EffectTheme): void { this.theme = validateTheme(theme); }
  setShatterPool(pool: CharacterShatterPool | null): void { this.shatterPool = pool; }
  setShakeTarget(target: Container | null): void { this.shakeTarget = target; }
  setReduceMotion(flag: boolean): void { this.reduceMotion = flag; }

  /** 主入口：按 steps 顺序依次播放动效 */
  playSteps(
    layer: Container,
    steps: ResolveStep[],
    pieceTypes: PieceType[],
    onComplete: () => void,
    targetPieceContainers?: (Container | null)[],
    options?: { isFinalKill?: boolean },
  ): void {
    if (steps.length === 0) { onComplete(); return; }

    const tl = gsap.timeline({ onComplete: () => { this.activeTl = null; onComplete(); } });
    tl.timeScale(getBattleSpeed());
    this.activeTl = tl;
    this.skipped = false;

    let accumulated = 0;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const pieceType = pieceTypes[i] ?? PieceType.PAWN;
      const def = this.resolveDef(pieceType);
      // resolveDef 已确保返回有效 def（validateTheme 兜底）
      const d = this.scaleDef(def);
      const slow = getSlow();
      // 终局判定：仅在最后一步且外部标记 isFinalKill 时生效
      const isFinalStep = !!(options?.isFinalKill && i === steps.length - 1);

      const useChar = this.shatterPool?.isReady() && (
        d.cast.type === 'char_spin' || d.travel.type === 'char_fly' ||
        d.hit.type === 'char_explode' || d.defeat.type === 'char_shatter'
      );
      const playerKey = useChar ? this.shatterPool!.getPlayerKey(pieceType) : '';
      const enemyKey = useChar ? this.shatterPool!.getEnemyKey(pieceType) : '';

      const originPos = logicalToScreen(step.origin.col, step.origin.row);
      const { primary, secondary, accent } = this.theme.palettes;

      // 1. Cast
      const baseCtx: EffectContext = { tl, layer, pos: originPos, startAt: accumulated, primary, secondary, accent, reduceMotion: this.reduceMotion, pieceType };
      this.runCast(d.cast, baseCtx, playerKey);
      const t1 = accumulated + d.cast.duration;

      // 2. Travel + Hit per target (with stagger)
      const isCharSequential = d.travel.type === 'char_fly' && d.hit.type === 'char_explode';
      const charGatherTime = isCharSequential ? 0.15 * slow : 0;
      const hitStartOffset = isCharSequential ? d.travel.duration + charGatherTime : 0;

      for (let ti = 0; ti < step.targets.length; ti++) {
        const target = step.targets[ti];
        const targetPos = logicalToScreen(target.col, target.row);
        // 错峰：第 i 个目标延迟 i * STAGGER.PER_TARGET_DELAY，累计上限
        const stagger = Math.min(ti * STAGGER.PER_TARGET_DELAY, STAGGER.PER_TARGET_MAX) * slow;
        const travelCtx: TravelContext = { ...baseCtx, pos: originPos, from: originPos, to: targetPos, startAt: t1 + stagger };
        if (d.travel.type === 'char_fly') {
          this.runCharFly(d.travel, travelCtx, playerKey);
        } else {
          this.runTravel(d.travel, travelCtx);
        }

        const hitStart = t1 + stagger + hitStartOffset;
        const hitCtx: HitContext = { ...baseCtx, pos: targetPos, startAt: hitStart, pieceKey: playerKey, targetPiece: targetPieceContainers?.[ti] };
        // impact frame（每个目标）+ hit-stop（仅首个目标，避免连续暂停卡顿；终局延长）
        if (!this.reduceMotion) {
          this.addImpactFrame(hitCtx);
          if (ti === 0) {
            this.addHitStop(hitCtx, isFinalStep, pieceType);
            // 首个命中瞬间触发 climax 视觉：shake + 终局独占（白闪/vignette/慢放）
            this.addHitClimax(baseCtx, hitStart, step.targets.length, isFinalStep, pieceType);
          }
        }
        // climax 回调（命中音/触觉/称号）不受 reduceMotion 门控：声音与称号非视觉运动
        if (ti === 0 && this.onStepClimax) {
          tl.call(() => { this.onStepClimax!(); }, [], hitStart);
        }
        if (d.hit.type === 'char_explode') {
          this.runCharExplode(d.hit, hitCtx);
        } else {
          this.runHit(d.hit, hitCtx);
        }
        // target piece punch（所有 hit 都让目标棋子弹一下）
        this.addTargetPunch(hitCtx);
        // screen shake 已移至链末 addStepClimax 单次触发，避免多目标乱抖
      }

      const perTargetMax = step.targets.length > 0
        ? Math.min((step.targets.length - 1) * STAGGER.PER_TARGET_DELAY, STAGGER.PER_TARGET_MAX) * slow
        : 0;
      const travelHitDuration = isCharSequential
        ? d.travel.duration + charGatherTime + d.hit.duration + perTargetMax
        : Math.max(d.travel.duration, d.hit.duration) + perTargetMax;
      const t2 = t1 + travelHitDuration;

      // 3. Defeat
      for (const t of step.targets) {
        if (!t.eid && !t.aid) continue;
        const targetPos = logicalToScreen(t.col, t.row);
        const defeatCtx: DefeatContext = { ...baseCtx, pos: targetPos, startAt: t2, pieceKey: enemyKey };
        if (d.defeat.type === 'char_shatter') {
          this.runCharShatter(d.defeat, defeatCtx);
        } else {
          this.runDefeat(d.defeat, defeatCtx);
        }
      }
      const t3 = t2 + d.defeat.duration;

      // 4. Ripple（reduceMotion 跳过）
      let climaxPos = originPos;
      if (d.ripple && !this.reduceMotion) {
        const totalTargets = step.targets.length;
        if (totalTargets > 0) {
          const centerX = step.targets.reduce((s, pt) => s + pt.col, 0) / totalTargets;
          const centerY = step.targets.reduce((s, pt) => s + pt.row, 0) / totalTargets;
          climaxPos = logicalToScreen(centerX, centerY);
          const rippleCtx: EffectContext = { ...baseCtx, pos: climaxPos, startAt: t3 };
          this.runRipple(d.ripple, rippleCtx);
        }
      }

      accumulated = t3 + (d.ripple && !this.reduceMotion ? d.ripple.duration : 0);
    }
  }

  /** 快进当前动效到结尾（不丢失 onComplete 中的状态同步）。 */
  skip(): void {
    if (!this.activeTl) return;
    this.skipped = true;
    // 若正处于 hit-stop 的 addPause 中，先 resume 再加速
    this.activeTl.resume();
    this.activeTl.timeScale(8);
  }

  destroy(): void {
    if (this.activeTl) { this.activeTl.kill(); this.activeTl = null; }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────────────────────────────

  private resolveDef(pieceType: PieceType): SkillEffectDef {
    // validateTheme 已在 setTheme/constructor 中保证 effects 完整
    return this.theme.effects[pieceType] as SkillEffectDef;
  }

  /** 应用慢放系数到所有 duration 字段 */
  private scaleDef(def: SkillEffectDef): SkillEffectDef {
    const s = getSlow();
    if (s === 1) return def;
    const r = (v: number) => v * s;
    return {
      cast: { ...def.cast, duration: r(def.cast.duration) },
      travel: { ...def.travel, duration: r(def.travel.duration) },
      hit: { ...def.hit, duration: r(def.hit.duration) },
      defeat: { ...def.defeat, duration: r(def.defeat.duration) },
      ripple: def.ripple ? { ...def.ripple, duration: r(def.ripple.duration) } : undefined,
    };
  }

  /** impact frame：命中瞬间一个 ADD blend 的亮闪 */
  private addImpactFrame(ctx: HitContext): void {
    const { tl, layer, pos, startAt, accent } = ctx;
    const flash = this.renderer.createImpactFlash(pos.x, pos.y, 0xffffff, 20);
    flash.blendMode = 'add';
    flash.alpha = IMPACT.FLASH_ALPHA;
    flash.visible = false;
    layer.addChild(flash);
    tl.set(flash, { visible: true }, startAt);
    tl.to(flash, { alpha: 0, scale: 3, duration: IMPACT.FLASH_DURATION, ease: EASE.POWER2_OUT,
      onComplete: () => { layer.removeChild(flash); flash.destroy(); } }, startAt);
  }

  /** hit-stop：命中瞬间整个 timeline 暂停；终局延长版；GENERAL 加权 */
  private addHitStop(ctx: HitContext, isFinal = false, pieceType?: PieceType): void {
    const { tl, startAt } = ctx;
    let dur = isFinal ? HIT_STOP.FINAL : HIT_STOP.PER_TARGET;
    // 坐镇中宫：帅命中停顿加权
    if (!isFinal && pieceType === PieceType.GENERAL) dur = GENERAL_WEIGHT.HIT_STOP;
    tl.addPause(startAt + 0.001, () => {
      // 用 gsap.delayedCall 而非 setTimeout：后台标签页 setTimeout 被节流到 1s+，
      // 会导致 hit-stop 暂停严重过长；delayedCall 随 gsap ticker 冻结，回到前台才继续。
      gsap.delayedCall(dur, () => { if (this.activeTl === tl) tl.resume(); });
    });
  }

  /** 目标棋子被击中后的弹放 + 白 tint 闪 */
  private addTargetPunch(ctx: HitContext): void {
    const { tl, targetPiece, startAt } = ctx;
    if (!targetPiece) return;
    const origScale = targetPiece.scale.x;
    tl.to(targetPiece.scale, { x: origScale * (1 + IMPACT.TARGET_PUNCH_SCALE), y: origScale * (1 + IMPACT.TARGET_PUNCH_SCALE), duration: IMPACT.TARGET_PUNCH_DURATION * 0.4, ease: EASE.BACK_OUT }, startAt);
    tl.to(targetPiece.scale, { x: origScale, y: origScale, duration: IMPACT.TARGET_PUNCH_DURATION * 0.6, ease: EASE.POWER2_OUT }, startAt + IMPACT.TARGET_PUNCH_DURATION * 0.4);
  }

  /** 屏幕震动（4 段折返） */
  private addScreenShake(tl: gsap.core.Timeline, startAt: number, intensity: number, duration: number): void {
    const target = this.shakeTarget;
    if (!target || intensity <= 0 || duration <= 0) return;
    const origX = target.x, origY = target.y;
    const stepDur = duration / 4;
    tl.to(target, { x: origX + intensity, y: origY - intensity * 0.5, duration: stepDur, ease: EASE.SINE_IN_OUT }, startAt);
    tl.to(target, { x: origX - intensity, y: origY + intensity * 0.5, duration: stepDur, ease: EASE.SINE_IN_OUT }, startAt + stepDur);
    tl.to(target, { x: origX + intensity * 0.5, y: origY - intensity * 0.3, duration: stepDur, ease: EASE.SINE_IN_OUT }, startAt + stepDur * 2);
    tl.to(target, { x: origX, y: origY, duration: stepDur, ease: EASE.SINE_IN_OUT }, startAt + stepDur * 3);
  }

  /**
   * 命中瞬间高潮反馈：在首个目标 hit 时刻触发，强化命中冲击。
   * - shake：按 COMBO_SHAKE.TIERS 分档，终局用 FINAL；GENERAL 起算阈值降为 2 连
   * - 终局独占：全屏白闪 + vignette 暗化 + 慢放收尾（命中瞬间爆发仪式感）
   */
  private addHitClimax(ctx: EffectContext, startAt: number, killCount: number, isFinal: boolean, pieceType?: PieceType): void {
    if (this.reduceMotion) return;

    // shake（按规模分档，终局超重）
    // 坐镇中宫：帅 shake 起算阈值降为 2 连
    const minKillsThreshold = pieceType === PieceType.GENERAL ? GENERAL_WEIGHT.SHAKE_MIN_KILLS : 3;
    const shakeParams = isFinal
      ? COMBO_SHAKE.FINAL
      : [...COMBO_SHAKE.TIERS].reverse().find(t => killCount >= t.minKills && t.minKills >= minKillsThreshold) ?? null;
    if (shakeParams && shakeParams.intensity > 0) {
      this.addScreenShake(ctx.tl, startAt, shakeParams.intensity, shakeParams.duration);
    }

    // 终局独占：命中瞬间爆发白闪 + 暗化 + 慢放
    if (isFinal) {
      this.addScreenFlash(ctx, startAt);
      this.addVignette(ctx, startAt);
      this.addSlowMo(ctx, startAt);
    }

    // 注意：onStepClimax（命中音/触觉/称号）的触发已移至主循环首目标 hitStart 处，
    // 不受 reduceMotion 门控——声音与称号非视觉运动，reduceMotion 用户不应丢失命中反馈。
  }

  /** 全屏白闪（ADD blend 白矩形，0.3s 淡出） */
  private addScreenFlash(ctx: EffectContext, startAt: number): void {
    const target = this.shakeTarget;
    if (!target) return;
    const { tl, layer } = ctx;
    const w = target.width;
    const h = target.height;
    if (w <= 0 || h <= 0) return;
    const flash = new Graphics();
    flash.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: SCREEN_FLASH.ALPHA });
    flash.blendMode = 'add';
    layer.addChild(flash);
    tl.to(flash, { alpha: 0, duration: SCREEN_FLASH.DURATION, ease: EASE.POWER2_OUT,
      onComplete: () => { layer.removeChild(flash); flash.destroy(); } }, startAt);
  }

  /** 屏幕边缘暗化（4 边黑边模拟 vignette，先暗后亮恢复） */
  private addVignette(ctx: EffectContext, startAt: number): void {
    const target = this.shakeTarget;
    if (!target) return;
    const { tl, layer } = ctx;
    const w = target.width;
    const h = target.height;
    if (w <= 0 || h <= 0) return;
    const thickness = Math.max(w, h) * 0.15;
    const vignette = new Graphics();
    vignette.rect(0, 0, w, thickness).fill({ color: 0x000000, alpha: VIGNETTE.ALPHA });
    vignette.rect(0, h - thickness, w, thickness).fill({ color: 0x000000, alpha: VIGNETTE.ALPHA });
    vignette.rect(0, 0, thickness, h).fill({ color: 0x000000, alpha: VIGNETTE.ALPHA });
    vignette.rect(w - thickness, 0, thickness, h).fill({ color: 0x000000, alpha: VIGNETTE.ALPHA });
    vignette.alpha = 0;
    layer.addChild(vignette);
    tl.to(vignette, { alpha: 1, duration: VIGNETTE.DURATION * 0.4, ease: EASE.POWER2_OUT }, startAt);
    tl.to(vignette, { alpha: 0, duration: VIGNETTE.DURATION * 0.6, ease: EASE.POWER2_IN,
      onComplete: () => { layer.removeChild(vignette); vignette.destroy(); } }, startAt + VIGNETTE.DURATION * 0.4);
  }

  /** 慢放收尾（终局仪式感，0.5s timeScale 0.5 后恢复；skip 时跳过） */
  private addSlowMo(ctx: EffectContext, startAt: number): void {
    const { tl } = ctx;
    tl.add(() => {
      if (!this.skipped && this.activeTl === tl) tl.timeScale(SLOW_MO.TIME_SCALE);
    }, startAt);
    tl.add(() => {
      if (!this.skipped && this.activeTl === tl) tl.timeScale(1);
    }, startAt + SLOW_MO.DURATION);
  }

  /** 通用 glow fallback（char_* 在 pool 未就绪时退化用） */
  private playGlowFallback(ctx: EffectContext, duration: number, radius = 30): void {
    const { tl, layer, pos, startAt, primary } = ctx;
    const glow = new Graphics();
    glow.circle(0, 0, radius).fill({ color: primary, alpha: 0.6 });
    glow.x = pos.x; glow.y = pos.y;
    glow.visible = false;
    layer.addChild(glow);
    tl.set(glow, { visible: true }, startAt);
    tl.to(glow, { scale: 2, alpha: 0, duration, ease: EASE.POWER3_OUT,
      onComplete: () => { layer.removeChild(glow); glow.destroy(); } }, startAt);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Cast
  // ─────────────────────────────────────────────────────────────────────

  private runCast(def: CastEffect, ctx: EffectContext, pieceKey: string): void {
    if (def.type === 'char_spin') {
      this.castCharSpin(def, ctx, pieceKey);
      return;
    }
    const handler = this.castHandlers[def.type];
    if (handler) handler(def, ctx);
  }

  private castHandlers: Record<CastEffect['type'], (def: CastEffect, ctx: EffectContext) => void> = {
    spin: (_def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const ring = hide(this.renderer.createInkRing(pos.x, pos.y, RING.BASE_RADIUS, primary), tl, startAt);
      layer.addChild(ring);
      tl.to(ring, { rotation: Math.PI * 2, scale: 1.5, alpha: 0, duration: _def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(ring); ring.destroy(); } }, startAt);
    },
    pulse: (_def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, 6), tl, startAt);
      layer.addChild(burst);
      tl.fromTo(burst, { scale: 0.5, alpha: 0.6 }, { scale: 1.2, alpha: 0, duration: _def.duration, ease: EASE.POWER3_OUT,
        onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);
    },
    contract: (_def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const ring = hide(this.renderer.createInkRing(pos.x, pos.y, RING.CAST_RADIUS, primary), tl, startAt);
      layer.addChild(ring);
      tl.to(ring, { scale: 0.3, alpha: 0, duration: _def.duration, ease: EASE.POWER2_IN,
        onComplete: () => { layer.removeChild(ring); ring.destroy(); } }, startAt);
    },
    gather_up: (_def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const glow = hide(new Graphics(), tl, startAt);
      glow.circle(0, 0, 30).fill({ color: primary, alpha: 0.6 });
      glow.x = pos.x; glow.y = pos.y;
      layer.addChild(glow);
      tl.to(glow, { scale: 2, alpha: 0, duration: _def.duration, ease: EASE.POWER3_OUT,
        onComplete: () => { layer.removeChild(glow); glow.destroy(); } }, startAt);
    },
    char_spin: (_def, ctx) => this.castCharSpin(_def, ctx, ''),
    palace_seal: (_def, ctx) => this.castPalaceSeal(_def, ctx),
    seal_press: (_def, ctx) => this.castPalaceSeal(_def, ctx),
    beam_clash: (_def, ctx) => this.castBeamClash(_def, ctx),
  };

  /** 印章下压（palace_seal / seal_press cast）：九宫格底纹 + 印章缩放 */
  private castPalaceSeal(def: CastEffect, ctx: EffectContext): void {
    const { tl, layer, pos, startAt, primary, accent, reduceMotion } = ctx;
    const cellSize = getCellSize();
    // 底纹九宫格（不缩放，淡入淡出）
    const grid = hide(this.renderer.createPalaceGrid(pos.x, pos.y, cellSize, accent), tl, startAt);
    grid.alpha = 0;
    layer.addChild(grid);
    tl.to(grid, { alpha: 0.8, duration: def.duration * 0.3, ease: EASE.POWER2_OUT }, startAt);
    tl.to(grid, { alpha: 0, duration: def.duration * 0.7, ease: EASE.POWER2_IN,
      onComplete: () => { layer.removeChild(grid); grid.destroy(); } }, startAt + def.duration * 0.3);
    if (reduceMotion) return;
    // 印章下压
    const seal = hide(this.renderer.createPalaceSeal(pos.x, pos.y, cellSize, primary, accent), tl, startAt);
    layer.addChild(seal);
    tl.to(seal, { scale: 1.15, duration: def.duration * 0.5, ease: EASE.BACK_OUT }, startAt);
    tl.to(seal, { scale: 0.3, alpha: 0, duration: def.duration * 0.5, ease: EASE.POWER2_IN,
      onComplete: () => { layer.removeChild(seal); seal.destroy(); } }, startAt + def.duration * 0.5);
  }

  /** 双王对峙光束（beam_clash cast）：仅在 playKingsMeeting 调用路径下使用，castHandlers 走兜底 */
  private castBeamClash(def: CastEffect, ctx: EffectContext): void {
    // 兜底实现：如果意外走标准路径，退化为 gather_up 效果
    const { tl, layer, pos, startAt, primary } = ctx;
    const glow = hide(new Graphics(), tl, startAt);
    glow.circle(0, 0, 30).fill({ color: primary, alpha: 0.6 });
    glow.x = pos.x; glow.y = pos.y;
    layer.addChild(glow);
    tl.to(glow, { scale: 2, alpha: 0, duration: def.duration, ease: EASE.POWER3_OUT,
      onComplete: () => { layer.removeChild(glow); glow.destroy(); } }, startAt);
  }

  private castCharSpin(def: CastEffect, ctx: EffectContext, pieceKey: string): void {
    const { tl, layer, pos, startAt, primary, accent, reduceMotion, pieceType } = ctx;
    if (!pieceKey || !this.shatterPool?.isReady()) {
      this.playGlowFallback(ctx, def.duration);
      return;
    }
    const container = this.shatterPool.buildCharacter(pieceKey);
    if (!container) {
      this.playGlowFallback(ctx, def.duration);
      return;
    }
    container.x = pos.x; container.y = pos.y;
    container.scale.set(CHAR_SPIN.INITIAL_SCALE);
    container.visible = true;
    layer.addChild(container);

    // 坐镇中宫：帅在 char_spin 时叠加九宫格底纹（Shatter 主题）
    if (pieceType === PieceType.GENERAL && !reduceMotion) {
      const cellSize = getCellSize();
      const palaceGrid = this.renderer.createPalaceGrid(pos.x, pos.y, cellSize, accent);
      palaceGrid.alpha = 0;
      layer.addChild(palaceGrid);
      tl.to(palaceGrid, { alpha: 0.8, duration: def.duration * 0.3, ease: EASE.POWER2_OUT }, startAt);
      tl.to(palaceGrid, { alpha: 0, duration: def.duration * 0.5, ease: EASE.POWER2_IN,
        onComplete: () => { layer.removeChild(palaceGrid); palaceGrid.destroy(); } }, startAt + def.duration * 0.5);
    }

    if (reduceMotion) {
      tl.to(container, { alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(container); container.destroy({ children: true }); } }, startAt);
      return;
    }

    // 0 ~ 0.2d: scale up
    tl.to(container, { scale: CHAR_SPIN.SCALE_UP_TARGET, duration: def.duration * CHAR_SPIN.TREMOR_PHASE_RATIO * 0.8, ease: EASE.POWER2_OUT }, startAt);
    // 0.2d ~ 0.75d: random tremor（repeatRefresh 让每次 repeat 重新采样）
    const tremorStart = startAt + def.duration * CHAR_SPIN.TREMOR_PHASE_RATIO;
    const tremorEnd = startAt + def.duration * 0.75;
    const tremorDur = tremorEnd - tremorStart;
    const stepCount = 6;
    tl.to(container, {
      x: () => pos.x + (Math.random() - 0.5) * CHAR_SPIN.RANDOM_TREMOR_AMP * 2,
      rotation: () => (Math.random() - 0.5) * CHAR_SPIN.TREMOR_ROTATION * 2.5,
      duration: tremorDur / stepCount, repeat: stepCount - 1, repeatRefresh: true, ease: EASE.SINE_IN_OUT,
    }, tremorStart);
    // 0.75d ~ 1.0d: fade out
    tl.to(container, { alpha: 0, duration: def.duration * CHAR_SPIN.FADE_DURATION_RATIO,
      onComplete: () => { layer.removeChild(container); container.destroy({ children: true }); } }, tremorEnd);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Travel
  // ─────────────────────────────────────────────────────────────────────

  private runTravel(def: TravelEffect, ctx: TravelContext): void {
    const handler = this.travelHandlers[def.type];
    if (handler) handler(def, ctx);
  }

  private travelHandlers: Record<TravelEffect['type'], (def: TravelEffect, ctx: TravelContext) => void> = {
    none: () => {},
    line: (def, ctx) => {
      const { tl, layer, from, to, startAt, primary } = ctx;
      const trail = hide(this.renderer.createInkTrail(from.x, from.y, to.x, to.y, primary), tl, startAt);
      layer.addChild(trail);
      trail.scale.x = 0;
      tl.to(trail.scale, { x: 1, duration: def.duration, ease: EASE.POWER2_OUT }, startAt);
      tl.to(trail, { alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(trail); trail.destroy(); } }, startAt);
    },
    dash: (def, ctx) => {
      const { tl, layer, from, to, startAt, primary } = ctx;
      const dot = hide(this.renderer.createInkDots(from.x, from.y, primary, 3), tl, startAt);
      layer.addChild(dot);
      tl.to(dot, { x: to.x, y: to.y, alpha: 0, scale: 0.3, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(dot); dot.destroy(); } }, startAt);
    },
    slash: (def, ctx) => {
      const { tl, layer, from, to, startAt, primary } = ctx;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const slash = hide(this.renderer.createInkSlash(from.x, from.y, angle, primary), tl, startAt);
      layer.addChild(slash);
      tl.to(slash, { x: to.x, y: to.y, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(slash); slash.destroy(); } }, startAt);
    },
    arc: (def, ctx) => {
      // 真实抛物线：from → midpoint(向上偏移) → to，两段 tween
      const { tl, layer, from, to, startAt, primary } = ctx;
      const dot = hide(this.renderer.createInkDots(from.x, from.y, primary, 1), tl, startAt);
      layer.addChild(dot);
      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2 - TRAVEL.ARC_MAX_OFFSET;
      tl.to(dot, { x: midX, y: midY, duration: def.duration * 0.5, ease: EASE.SINE_OUT }, startAt);
      tl.to(dot, { x: to.x, y: to.y, alpha: 0, duration: def.duration * 0.5, ease: EASE.SINE_OUT,
        onComplete: () => { layer.removeChild(dot); dot.destroy(); } }, startAt + def.duration * 0.5);
    },
    multi_arc: (def, ctx) => {
      // 多条交织弧线：每条独立抛物线，mid 点带随机偏移
      const { tl, layer, from, to, startAt, primary } = ctx;
      const segments = def.segments ?? 4;
      for (let s = 0; s < segments; s++) {
        const dot = hide(this.renderer.createInkDots(from.x, from.y, primary, 2), tl, startAt);
        layer.addChild(dot);
        const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * TRAVEL.ARC_MAX_OFFSET;
        const midY = (from.y + to.y) / 2 - 20 - Math.random() * TRAVEL.ARC_MAX_OFFSET * 0.6;
        const delay = s * 0.02;
        tl.to(dot, { x: midX, y: midY, duration: def.duration * 0.5, ease: EASE.SINE_OUT }, startAt + delay);
        tl.to(dot, { x: to.x, y: to.y, alpha: 0, duration: def.duration * 0.5, ease: EASE.SINE_OUT,
          onComplete: () => { layer.removeChild(dot); dot.destroy(); } }, startAt + def.duration * 0.5 + delay);
      }
    },
    pulse_wave: (def, ctx) => {
      // 中心同心环扩散 + 4 方向 trail，名实相符
      const { tl, layer, from, startAt, primary } = ctx;
      const ring = hide(this.renderer.createInkRing(from.x, from.y, 20, primary), tl, startAt);
      ring.blendMode = 'add';
      layer.addChild(ring);
      tl.fromTo(ring, { scale: 0.2, alpha: 0.8 }, { scale: 2.5, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(ring); ring.destroy(); } }, startAt);
      for (const dir of [{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }]) {
        const endX = from.x + dir.dx * TRAVEL.PULSE_WAVE_REACH;
        const endY = from.y + dir.dy * TRAVEL.PULSE_WAVE_REACH;
        const trail = hide(this.renderer.createInkTrail(from.x, from.y, endX, endY, primary), tl, startAt);
        layer.addChild(trail);
        tl.to(trail, { alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
          onComplete: () => { layer.removeChild(trail); trail.destroy(); } }, startAt);
      }
    },
    char_fly: (_def, ctx) => this.runCharFly(_def, ctx, ''),
    decree_wave: (def, ctx) => {
      // 金令符：4 方向令符拖尾从中心行进，名实相符
      const { tl, layer, from, startAt, primary, accent } = ctx;
      const wave = hide(this.renderer.createDecreeWave(from.x, from.y, primary, accent), tl, startAt);
      layer.addChild(wave);
      tl.to(wave, { scale: 1.1, alpha: 0.9, duration: def.duration * 0.5, ease: EASE.BACK_OUT }, startAt);
      tl.to(wave, { scale: 1.4, alpha: 0, duration: def.duration * 0.5, ease: EASE.POWER2_IN,
        onComplete: () => { layer.removeChild(wave); wave.destroy(); } }, startAt + def.duration * 0.5);
    },
    triple_sweep: (_def, ctx) => {
      // 兜底：标准路径下退化为 pulse_wave
      this.travelHandlers.pulse_wave(_def, ctx);
    },
  };

  private runCharFly(def: TravelEffect, ctx: TravelContext, pieceKey: string): void {
    const { tl, layer, from, to, startAt, primary, reduceMotion } = ctx;
    if (!pieceKey || !this.shatterPool?.isReady()) {
      // 退化到 dash
      this.travelHandlers.dash(def, ctx);
      return;
    }
    const fullTex = this.shatterPool.getFullTexture(pieceKey);
    if (!fullTex) {
      this.travelHandlers.dash(def, ctx);
      return;
    }
    if (reduceMotion) {
      // 极简：单个 sprite 直飞
      const sprite = new Sprite(fullTex);
      sprite.anchor.set(0.5);
      sprite.x = from.x; sprite.y = from.y;
      sprite.scale.set(0.6);
      sprite.visible = false;
      layer.addChild(sprite);
      tl.set(sprite, { visible: true, alpha: 0.8 }, startAt);
      tl.to(sprite, { x: to.x, y: to.y, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(sprite); sprite.destroy(); } }, startAt);
      return;
    }
    const count = SHATTER.FLY_MIN_COUNT + Math.floor(Math.random() * SHATTER.FLY_MAX_COUNT_EXTRA);
    for (let i = 0; i < count; i++) {
      const sprite = new Sprite(fullTex);
      sprite.anchor.set(0.5);
      sprite.x = from.x; sprite.y = from.y;
      const s = SHATTER.FLY_SCALE_MIN + Math.random() * SHATTER.FLY_SCALE_RANGE;
      sprite.scale.set(s);
      sprite.rotation = Math.random() * Math.PI * 2;
      sprite.tint = i % 2 === 0 ? 0xffffff : primary;
      sprite.visible = false;
      layer.addChild(sprite);
      const midX = (from.x + to.x) / 2 + (Math.random() - 0.5) * SHATTER.FLY_MID_OFFSET * 2;
      const midY = (from.y + to.y) / 2 + (Math.random() - 0.5) * SHATTER.FLY_MID_OFFSET * 2;
      const flyTl = gsap.timeline({
        onComplete: () => { layer.removeChild(sprite); sprite.destroy(); },
      });
      flyTl.set(sprite, { visible: true, alpha: 0.8 }, 0);
      flyTl.to(sprite, {
        x: midX, y: midY, rotation: sprite.rotation + Math.PI,
        scale: s * 1.2, duration: def.duration * 0.5, ease: EASE.SINE_OUT,
      }, 0);
      flyTl.to(sprite, {
        x: to.x, y: to.y, rotation: sprite.rotation + Math.PI * 2,
        scale: s * 1.8, alpha: 0.3, duration: def.duration * 0.5, ease: EASE.POWER2_IN,
      });
      tl.add(flyTl, startAt);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Hit
  // ─────────────────────────────────────────────────────────────────────

  private runHit(def: HitEffect, ctx: HitContext): void {
    const handler = this.hitHandlers[def.type];
    if (handler) handler(def, ctx);
  }

  private hitHandlers: Record<HitEffect['type'], (def: HitEffect, ctx: HitContext) => void> = {
    explode: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, def.particleCount ?? 8), tl, startAt);
      burst.blendMode = 'add';
      layer.addChild(burst);
      tl.to(burst, { scale: 2, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);
    },
    bloom: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const bloom = hide(this.renderer.createInkBloom(pos.x, pos.y, primary, accent), tl, startAt);
      layer.addChild(bloom);
      tl.to(bloom, { scale: 1.5, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(bloom); bloom.destroy(); } }, startAt);
    },
    stamp: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const stamp = hide(this.renderer.createInkRing(pos.x, pos.y, RING.STAMP_RADIUS, primary), tl, startAt);
      layer.addChild(stamp);
      const accentDot = hide(new Graphics(), tl, startAt);
      accentDot.circle(pos.x, pos.y, 8).fill({ color: accent, alpha: 0.8 });
      accentDot.blendMode = 'add';
      layer.addChild(accentDot);
      tl.to(stamp, { scale: 1.3, alpha: 0, duration: def.duration, ease: EASE.BACK_OUT,
        onComplete: () => { layer.removeChild(stamp); stamp.destroy(); } }, startAt);
      tl.to(accentDot, { alpha: 0, duration: def.duration * 0.5, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(accentDot); accentDot.destroy(); } }, startAt);
    },
    cross: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const cross = hide(this.renderer.createInkCross(pos.x, pos.y, TRAVEL.CROSS_DEFAULT_SIZE, primary, accent), tl, startAt);
      cross.blendMode = 'add';
      layer.addChild(cross);
      tl.fromTo(cross, { scale: 0.3, alpha: 0.8 }, { scale: 1.5, alpha: 0, duration: def.duration, ease: EASE.POWER3_OUT,
        onComplete: () => { layer.removeChild(cross); cross.destroy(); } }, startAt);
    },
    pierce: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const trail = hide(this.renderer.createInkTrail(pos.x - 30, pos.y, pos.x + 30, pos.y, primary), tl, startAt);
      layer.addChild(trail);
      const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, 4), tl, startAt);
      burst.blendMode = 'add';
      layer.addChild(burst);
      tl.to(trail, { alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(trail); trail.destroy(); } }, startAt);
      tl.to(burst, { scale: 1.5, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);
    },
    slice: (def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const s1 = hide(this.renderer.createInkSlash(pos.x, pos.y, Math.PI / 4, primary), tl, startAt);
      const s2 = hide(this.renderer.createInkSlash(pos.x, pos.y, -Math.PI / 4, primary), tl, startAt);
      layer.addChild(s1, s2);
      tl.to(s1, { alpha: 0, scale: 1.3, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(s1); s1.destroy(); } }, startAt);
      tl.to(s2, { alpha: 0, scale: 1.3, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(s2); s2.destroy(); } }, startAt);
    },
    char_explode: (_def, ctx) => this.runCharExplode(_def, ctx),
  };

  private runCharExplode(def: HitEffect, ctx: HitContext): void {
    const { tl, layer, pos, startAt, primary, accent, pieceKey, targetPiece, reduceMotion } = ctx;
    const particleCount = def.particleCount ?? 8;
    const fallback = () => {
      const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, particleCount), tl, startAt);
      burst.blendMode = 'add';
      layer.addChild(burst);
      tl.to(burst, { scale: 2, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);
    };
    if (!pieceKey || !this.shatterPool?.isReady()) { fallback(); return; }
    const strokes = this.shatterPool.getStrokes(pieceKey);
    if (!strokes || strokes.length === 0) { fallback(); return; }

    const center = this.shatterPool.getCenter(pieceKey) ?? { x: 32, y: 32 };

    // Phase 1: Piece icon appears at target then fades（reduceMotion 跳过）
    const gatherDur = reduceMotion ? 0 : SHATTER.EXPLODE_GATHER_DUR;
    if (!reduceMotion) {
      const fullTex = this.shatterPool.getFullTexture(pieceKey);
      if (fullTex) {
        const gatherSprite = new Sprite(fullTex);
        gatherSprite.anchor.set(0.5);
        gatherSprite.scale.set(1.2);
        gatherSprite.x = pos.x; gatherSprite.y = pos.y;
        gatherSprite.visible = false;
        layer.addChild(gatherSprite);
        tl.set(gatherSprite, { visible: true }, startAt);
        tl.to(gatherSprite, { alpha: 1, scale: 1.3, duration: gatherDur * 0.7, ease: EASE.BACK_OUT }, startAt);
        tl.to(gatherSprite, { alpha: 0, scale: 1.35, duration: gatherDur * 0.3,
          onComplete: () => { layer.removeChild(gatherSprite); gatherSprite.destroy(); } }, startAt + gatherDur * 0.7);
      }
    }

    // Phase 2: Stroke explosion — target piece fades, strokes fly apart
    const explodeStart = startAt + gatherDur;
    const explodeDur = Math.max(def.duration - gatherDur, 0.15);
    if (targetPiece) {
      tl.to(targetPiece, { alpha: 0, scale: 0.3, duration: 0.3, ease: EASE.POWER2_IN }, explodeStart);
    }
    for (const stroke of strokes) {
      const sprite = new Sprite(stroke.texture);
      sprite.anchor.set(0.5);
      sprite.scale.set(SHATTER.STROKE_BASE_SCALE);
      sprite.x = pos.x; sprite.y = pos.y;
      sprite.visible = false;
      layer.addChild(sprite);
      const dx = stroke.centroid.x - center.x;
      const dy = stroke.centroid.y - center.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 1.0;
      const speed = len > SHATTER.EXPLODE_LEN_THRESHOLD
        ? SHATTER.EXPLODE_FAST_SPEED_MIN + Math.random() * SHATTER.EXPLODE_FAST_SPEED_RANGE
        : SHATTER.EXPLODE_SLOW_SPEED_MIN + Math.random() * SHATTER.EXPLODE_SLOW_SPEED_RANGE;
      tl.set(sprite, { visible: true }, explodeStart);
      tl.to(sprite, {
        x: pos.x + Math.cos(angle) * speed,
        y: pos.y + Math.sin(angle) * speed,
        rotation: (Math.random() - 0.5) * Math.PI * 4,
        scale: 1.2, alpha: 0,
        duration: explodeDur, ease: EASE.POWER3_OUT,
        onComplete: () => { layer.removeChild(sprite); sprite.destroy(); },
      }, explodeStart);
    }
    const extra = particleCount - strokes.length;
    if (extra > 0) {
      const debris = hide(this.renderer.createDebris(pos.x, pos.y, primary, extra), tl, explodeStart);
      layer.addChild(debris);
      tl.to(debris, { alpha: 0, scale: 2, duration: explodeDur, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(debris); debris.destroy(); } }, explodeStart);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Defeat
  // ─────────────────────────────────────────────────────────────────────

  private runDefeat(def: DefeatEffect, ctx: DefeatContext): void {
    const handler = this.defeatHandlers[def.type];
    if (handler) handler(def, ctx);
  }

  private defeatHandlers: Record<DefeatEffect['type'], (def: DefeatEffect, ctx: DefeatContext) => void> = {
    ink_fade: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, 6), tl, startAt);
      layer.addChild(burst);
      tl.to(burst, { alpha: 0, scale: 2, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);
    },
    shatter: (def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const pieces = hide(this.renderer.createShatterPieces(pos.x, pos.y, primary), tl, startAt);
      layer.addChild(pieces);
      tl.to(pieces, { alpha: 0, scale: 1.5, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(pieces); pieces.destroy(); } }, startAt);
    },
    dissolve: (def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const fog = hide(this.renderer.createInkDots(pos.x, pos.y, primary, 8), tl, startAt);
      layer.addChild(fog);
      tl.to(fog, { alpha: 0, scale: 3, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(fog); fog.destroy(); } }, startAt);
    },
    melt: (def, ctx) => {
      const { tl, layer, pos, startAt, primary } = ctx;
      const drip = hide(this.renderer.createInkDots(pos.x, pos.y, primary, 5), tl, startAt);
      layer.addChild(drip);
      tl.to(drip, { y: drip.y + 30, alpha: 0, duration: def.duration, ease: EASE.POWER1_IN,
        onComplete: () => { layer.removeChild(drip); drip.destroy(); } }, startAt);
    },
    pop: (def, ctx) => {
      const { tl, layer, pos, startAt, primary, accent } = ctx;
      const pop = hide(this.renderer.createInkBurst(pos.x, pos.y, primary, accent, 4), tl, startAt);
      layer.addChild(pop);
      tl.to(pop, { alpha: 0, scale: 1.3, duration: def.duration, ease: EASE.BACK_OUT,
        onComplete: () => { layer.removeChild(pop); pop.destroy(); } }, startAt);
    },
    char_shatter: (_def, ctx) => this.runCharShatter(_def, ctx),
  };

  private runCharShatter(def: DefeatEffect, ctx: DefeatContext): void {
    const { tl, layer, pos, startAt, primary, secondary, accent, pieceKey, reduceMotion } = ctx;
    // Background ink burst
    const burst = hide(this.renderer.createInkBurst(pos.x, pos.y, secondary, accent, 6), tl, startAt);
    layer.addChild(burst);
    tl.to(burst, { alpha: 0, scale: 2, duration: def.duration, ease: EASE.POWER2_OUT,
      onComplete: () => { layer.removeChild(burst); burst.destroy(); } }, startAt);

    if (pieceKey && this.shatterPool?.isReady()) {
      const strokes = this.shatterPool.getStrokes(pieceKey);
      if (strokes && strokes.length > 0) {
        const center = this.shatterPool.getCenter(pieceKey) ?? { x: 32, y: 32 };
        for (const stroke of strokes) {
          const sprite = new Sprite(stroke.texture);
          sprite.anchor.set(0.5);
          sprite.scale.set(SHATTER.STROKE_BASE_SCALE);
          sprite.x = pos.x; sprite.y = pos.y;
          sprite.visible = false;
          const angle = Math.atan2(stroke.centroid.y - center.y, stroke.centroid.x - center.x)
            + (Math.random() - 0.5) * 0.8;
          const speed = SHATTER.DEFEAT_SPEED_MIN + Math.random() * SHATTER.DEFEAT_SPEED_RANGE;
          sprite.rotation = (Math.random() - 0.5) * 0.5;
          layer.addChild(sprite);
          tl.set(sprite, { visible: true }, startAt);
          tl.to(sprite, {
            x: pos.x + Math.cos(angle) * speed,
            y: pos.y + Math.sin(angle) * speed,
            rotation: sprite.rotation + (Math.random() - 0.5) * Math.PI * 2,
            scale: 1.2, alpha: 0,
            duration: def.duration, ease: EASE.POWER2_OUT,
            onComplete: () => { layer.removeChild(sprite); sprite.destroy(); },
          }, startAt);
        }
      }
    }
    // reduceMotion 时跳过额外 ink dots
    if (reduceMotion) return;
    const dots = hide(this.renderer.createInkDots(pos.x, pos.y, primary, 5), tl, startAt);
    layer.addChild(dots);
    tl.to(dots, { alpha: 0, scale: 2, duration: def.duration, ease: EASE.POWER2_OUT,
      onComplete: () => { layer.removeChild(dots); dots.destroy(); } }, startAt);
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Ripple
  // ─────────────────────────────────────────────────────────────────────

  private runRipple(def: RippleEffect, ctx: EffectContext): void {
    const handler = this.rippleHandlers[def.type];
    if (handler) handler(def, ctx);
  }

  private rippleHandlers: Record<RippleEffect['type'], (def: RippleEffect, ctx: EffectContext) => void> = {
    ring: (def, ctx) => {
      const { tl, layer, pos, startAt, secondary } = ctx;
      const radius = def.radius ?? RING.RIPPLE_DEFAULT;
      const ring = hide(this.renderer.createInkRing(pos.x, pos.y, radius, secondary), tl, startAt);
      layer.addChild(ring);
      tl.to(ring, { scale: 2, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(ring); ring.destroy(); } }, startAt);
    },
    mist: (def, ctx) => {
      const { tl, layer, pos, startAt, secondary } = ctx;
      for (const dir of [-1, 1]) {
        const mist = hide(this.renderer.createInkDots(pos.x + dir * 30, pos.y, secondary, 4), tl, startAt);
        layer.addChild(mist);
        tl.to(mist, { x: mist.x + dir * 40, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
          onComplete: () => { layer.removeChild(mist); mist.destroy(); } }, startAt);
      }
    },
    splash: (def, ctx) => {
      const { tl, layer, pos, startAt, secondary } = ctx;
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2;
        const dx = Math.cos(angle) * 40;
        const dy = Math.sin(angle) * 40;
        const dots = hide(this.renderer.createInkDots(pos.x + dx, pos.y + dy, secondary, 2), tl, startAt);
        layer.addChild(dots);
        tl.to(dots, { x: dots.x + dx * 0.5, y: dots.y + dy * 0.5, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
          onComplete: () => { layer.removeChild(dots); dots.destroy(); } }, startAt);
      }
    },
    fog: (def, ctx) => {
      const { tl, layer, pos, startAt, secondary } = ctx;
      const fog = hide(this.renderer.createInkDots(pos.x, pos.y, secondary, 8), tl, startAt);
      layer.addChild(fog);
      tl.to(fog, { scale: 3, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(fog); fog.destroy(); } }, startAt);
    },
    palace_grid: (def, ctx) => {
      // 九宫格印章纹外扩
      const { tl, layer, pos, startAt, secondary } = ctx;
      const cellSize = getCellSize();
      const grid = hide(this.renderer.createPalaceGrid(pos.x, pos.y, cellSize, secondary), tl, startAt);
      grid.alpha = 0.9;
      layer.addChild(grid);
      tl.to(grid, { scale: 1.8, alpha: 0, duration: def.duration, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(grid); grid.destroy(); } }, startAt);
    },
  };

  // ─────────────────────────────────────────────────────────────────────
  //  王见王（Kings' Meeting）专属播放
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 播放王见王·破阵动效：双王对峙光束 → 3 线扫荡 → 命中爆发 → 帅的舍身 → 九宫格印章纹。
   * 与 playSteps 不同，KM 不绑定单一 PieceType，而是从 theme.kingsMeeting 读取专属 def。
   *
   * @param ctx 几何上下文：双王位置、扫荡方向、敌目标列表、终局标记、回调
   */
  playKingsMeeting(
    layer: Container,
    ctx: {
      playerGen: { col: number; row: number };
      enemyGen: { col: number; row: number };
      isVertical: boolean;
      enemyTargets: { col: number; row: number }[];
      enemyTargetContainers?: (Container | null)[];
      isFinalKill: boolean;
      onSacrifice?: () => void;
    },
    onComplete: () => void,
  ): void {
    const def = this.theme.kingsMeeting;
    // 兜底：未配置 kingsMeeting def 时退化为 GENERAL 标准流程
    if (!def) {
      this.playSteps(
        layer,
        [{
          playerPieceIndex: 0,
          origin: ctx.playerGen,
          targets: ctx.enemyTargets.map(p => ({ col: p.col, row: p.row })),
        }],
        [PieceType.GENERAL],
        onComplete,
        ctx.enemyTargetContainers,
        { isFinalKill: ctx.isFinalKill },
      );
      return;
    }

    const tl = gsap.timeline({ onComplete: () => { this.activeTl = null; onComplete(); } });
    this.activeTl = tl;
    this.skipped = false;

    const d = this.scaleDef(def);
    const { primary, secondary, accent } = this.theme.palettes;
    const playerPos = logicalToScreen(ctx.playerGen.col, ctx.playerGen.row);
    const enemyPos = logicalToScreen(ctx.enemyGen.col, ctx.enemyGen.row);
    const midPos = { x: (playerPos.x + enemyPos.x) / 2, y: (playerPos.y + enemyPos.y) / 2 };
    const cellSize = getCellSize();

    // ── 1. Cast: beam_clash 双王对峙光束 ──
    const castStart = 0;
    if (!this.reduceMotion) {
      // 阶段 A：双向生长（两道光束分别从帅、将向中点延伸）
      const beamP = this.renderer.createBeamClash(playerPos.x, playerPos.y, midPos.x, midPos.y, accent);
      beamP.visible = false;
      layer.addChild(beamP);
      const beamE = this.renderer.createBeamClash(enemyPos.x, enemyPos.y, midPos.x, midPos.y, accent);
      beamE.visible = false;
      layer.addChild(beamE);
      const targetLenP = (beamP as Graphics & { __targetLen?: number }).__targetLen ?? 100;
      const targetLenE = (beamE as Graphics & { __targetLen?: number }).__targetLen ?? 100;
      const growDur = d.cast.duration * KINGS_MEETING.BEAM_GROW_DURATION_RATIO;
      tl.set(beamP, { visible: true }, castStart);
      tl.set(beamE, { visible: true }, castStart);
      tl.to(beamP.scale, { x: targetLenP, duration: growDur, ease: EASE.POWER2_OUT }, castStart);
      tl.to(beamE.scale, { x: targetLenE, duration: growDur, ease: EASE.POWER2_OUT }, castStart);
      // 阶段 B：中点相会爆发
      const clashStart = castStart + growDur;
      const flash = this.renderer.createBeamClashFlash(midPos.x, midPos.y, accent);
      flash.visible = false;
      layer.addChild(flash);
      tl.set(flash, { visible: true }, clashStart);
      tl.to(flash.scale, { x: 1.5, y: 1.5, duration: d.cast.duration * KINGS_MEETING.BEAM_CLASH_DURATION_RATIO, ease: EASE.BACK_OUT }, clashStart);
      tl.to(flash, { alpha: 0, duration: d.cast.duration * KINGS_MEETING.BEAM_CLASH_DURATION_RATIO, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(flash); flash.destroy(); } }, clashStart);
      // 双光束淡出
      tl.to(beamP, { alpha: 0, duration: d.cast.duration * 0.3, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(beamP); beamP.destroy(); } }, clashStart);
      tl.to(beamE, { alpha: 0, duration: d.cast.duration * 0.3, ease: EASE.POWER2_OUT,
        onComplete: () => { layer.removeChild(beamE); beamE.destroy(); } }, clashStart);
    } else {
      // reduceMotion：单点 glow
      const glow = new Graphics();
      glow.circle(0, 0, 30).fill({ color: accent, alpha: 0.6 });
      glow.x = midPos.x; glow.y = midPos.y;
      layer.addChild(glow);
      tl.to(glow, { scale: 2, alpha: 0, duration: d.cast.duration, ease: EASE.POWER3_OUT,
        onComplete: () => { layer.removeChild(glow); glow.destroy(); } }, castStart);
    }
    const t1 = castStart + d.cast.duration;

    // ── 2. Travel: triple_sweep 光柱从射线向两侧扩散 + 扫荡 + Hit ──
    // 从 beam_clash 射线（双王中线）向两侧扩散，形成笼罩三条线的光柱，再沿光束方向扫荡
    const sweepStart = t1;
    if (!this.reduceMotion) {
      // 光柱锚点在帅端，方向指向将端（与 beam_clash 射线重合）
      const pillarAngle = Math.atan2(enemyPos.y - playerPos.y, enemyPos.x - playerPos.x);
      const pillar = this.renderer.createSweepPillar(primary, accent, cellSize);
      pillar.x = playerPos.x; pillar.y = playerPos.y;
      pillar.rotation = pillarAngle;
      pillar.visible = false;
      layer.addChild(pillar);
      tl.set(pillar, { visible: true }, sweepStart);
      // 垂直扩散：scale.y 从 0 → 1（从中央射线向两边扩散成 3 线宽光柱）
      const spreadDur = d.travel.duration * KINGS_MEETING.SWEEP_PILLAR_SPREAD_RATIO;
      tl.to(pillar.scale, { y: 1, duration: spreadDur, ease: EASE.BACK_OUT }, sweepStart);
      // 沿光束方向扫荡：scale.x 从 0 → 自适应长度（随 cellSize 缩放，覆盖整盘；窄屏不溢出、大屏不短缺）
      const sweepLen = Math.max(KINGS_MEETING.SWEEP_LINE_LENGTH_MIN, cellSize * 9);
      tl.to(pillar.scale, { x: sweepLen, duration: d.travel.duration, ease: EASE.POWER2_OUT }, sweepStart);
      // 尾端淡出
      tl.to(pillar, { alpha: 0, duration: d.travel.duration * 0.6, ease: EASE.POWER2_IN,
        onComplete: () => { layer.removeChild(pillar); pillar.destroy(); } }, sweepStart + d.travel.duration * 0.4);
    }

    // Hit：每个敌目标在扫线抵达时触发十字爆
    // 用第一条线的扫出时间作为基准，按目标到帅的距离错峰
    const sortedTargets = [...ctx.enemyTargets].map((t, idx) => {
      const tp = logicalToScreen(t.col, t.row);
      const dist = Math.hypot(tp.x - playerPos.x, tp.y - playerPos.y);
      return { t, tp, dist, idx };
    }).sort((a, b) => a.dist - b.dist);

    const hitBaseCtx: EffectContext = {
      tl, layer, pos: playerPos, startAt: t1, primary, secondary, accent,
      reduceMotion: this.reduceMotion, pieceType: PieceType.GENERAL,
    };

    let firstHit = true;
    for (const { tp, idx } of sortedTargets) {
      // 距离归一化为 0~1，映射到 travel.duration 内的错峰
      const maxDist = sortedTargets.length > 0 ? sortedTargets[sortedTargets.length - 1].dist : 1;
      const dist = Math.hypot(tp.x - playerPos.x, tp.y - playerPos.y);
      const normDist = maxDist > 0 ? dist / maxDist : 0;
      const hitStart = t1 + normDist * d.travel.duration * 0.8;
      const targetPiece = ctx.enemyTargetContainers?.[idx] ?? null;
      const hitCtx: HitContext = {
        ...hitBaseCtx, pos: tp, startAt: hitStart, pieceKey: '', targetPiece,
      };
      if (!this.reduceMotion) {
        this.addImpactFrame(hitCtx);
        if (firstHit) {
          this.addHitStop(hitCtx, ctx.isFinalKill, PieceType.GENERAL);
          this.addHitClimax(hitBaseCtx, hitStart, ctx.enemyTargets.length, ctx.isFinalKill, PieceType.GENERAL);
        }
      }
      // climax 回调（命中音/触觉/称号）不受 reduceMotion 门控
      if (firstHit && this.onStepClimax) {
        tl.call(() => { this.onStepClimax!(); }, [], hitStart);
      }
      firstHit = false;
      // hit 视觉（cross）
      this.runHit(d.hit, hitCtx);
      this.addTargetPunch(hitCtx);
    }

    const t2 = t1 + d.travel.duration + d.hit.duration;

    // ── 3. Defeat：每个敌目标 dissolve ──
    for (const { tp } of sortedTargets) {
      const defeatCtx: DefeatContext = {
        ...hitBaseCtx, pos: tp, startAt: t2, pieceKey: '',
      };
      this.runDefeat(d.defeat, defeatCtx);
    }
    const t3 = t2 + d.defeat.duration;

    // ── 4. 帅的舍身（onSacrifice 回调） ──
    if (ctx.onSacrifice) {
      tl.call(() => { ctx.onSacrifice!(); }, [], t3);
    }
    // 占位等待舍身动画完整播放（scale_up + flash + shatter）
    const t4 = t3 + KINGS_MEETING.SACRIFICE_TOTAL_DUR;
    tl.to({}, { duration: KINGS_MEETING.SACRIFICE_TOTAL_DUR }, t3);

    // ── 5. Ripple：九宫格印章纹 ──
    if (d.ripple && !this.reduceMotion) {
      // 以双王中点为印章中心
      const rippleCtx: EffectContext = { ...hitBaseCtx, pos: midPos, startAt: t4 };
      this.runRipple(d.ripple, rippleCtx);
    }
  }
}
