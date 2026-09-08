import { Container, Graphics } from 'pixi.js';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { logicalToScreen } from '../utils/coord';
import { Layout } from '../ui/Layout';
import type { Point } from '../core/types';

export enum IntersectionState {
  NONE,
  IDLE_DOT,
  FORBIDDEN,
  VALID_PLACEMENT,
  SKILL_TARGET,
  HOVER,
  ELIMINATING,
}

const PREVIEW_KEY = '__preview__';

/**
 * Unified cross-point state manager.
 *
 * Layer split:
 *   belowContainer (idle dots, forbidden zones) → below pieces
 *   container (valid placements, skill ranges, hover, eliminating) → above pieces
 */
export class IntersectionRenderer {
  /** Above-piece elements: valid placements, skill ranges, hover, eliminating. */
  readonly container = new Container();
  /** Below-piece elements: idle dots, forbidden zones. */
  readonly belowContainer = new Container();

  private idleGfx = new Graphics();
  private forbiddenGfx = new Graphics();
  private validGfx = new Graphics();
  private skillGfx = new Graphics();
  private hoverGfx = new Graphics();
  private reticleGfx = new Graphics();
  private eliminatingLayer = new Container();

  private pulseTween: gsap.core.Tween | null = null;
  private flashTween: gsap.core.Tween | null = null;

  // ── Skill range accumulation (reference-counted) ──────────────

  private skillRangeMap = new Map<string, Point[]>();
  private pointRefCount = new Map<string, number>();

  constructor() {
    // Below-piece layer (forbidden zones rendered under enemy pieces)
    this.belowContainer.addChild(this.idleGfx, this.forbiddenGfx);
    // Above-piece layer
    this.container.addChild(
      this.validGfx,
      this.skillGfx,
      this.hoverGfx,
      this.eliminatingLayer,
      this.reticleGfx,
    );
  }

  /** Pre-draw a subtle idle dot at every board intersection. */
  renderAllIntersections(_cols: number, _rows: number): void {
    // No-op: the original does not render idle dots on intersections.
    this.idleGfx.clear();
  }

  // ── Hover ──────────────────────────────────────────────────────

  /** Show gold dot + glow at one intersection. */
  showHover(col: number, row: number): void {
    const pos = logicalToScreen(col, row);
    this.hoverGfx.clear();
    this.hoverGfx.circle(pos.x, pos.y, 5)
      .fill({ color: 0xffd700 });
    this.hoverGfx.circle(pos.x, pos.y, 14)
      .fill({ color: 0xffd700, alpha: 0.12 });
  }

  clearHover(): void {
    this.hoverGfx.clear();
  }

  // ── Mobile Touch Reticle & Preview ────────────────────────────

  /** Show targeting reticle at (col, row) + floating indicator above touch point (touchX, touchY). */
  showReticle(col: number, row: number, touchX: number, touchY: number, isValid: boolean): void {
    const pos = logicalToScreen(col, row);
    this.reticleGfx.clear();

    const color = isValid ? 0xffd700 : 0xef5350;
    const r = Layout.pieceRadius || 24;

    // 1. Target corner brackets around candidate intersection
    const bracketSize = Math.max(8, r * 0.4);
    const offset = r + 4;

    // Top-Left
    this.reticleGfx.moveTo(pos.x - offset, pos.y - offset + bracketSize)
      .lineTo(pos.x - offset, pos.y - offset)
      .lineTo(pos.x - offset + bracketSize, pos.y - offset);
    // Top-Right
    this.reticleGfx.moveTo(pos.x + offset - bracketSize, pos.y - offset)
      .lineTo(pos.x + offset, pos.y - offset)
      .lineTo(pos.x + offset, pos.y - offset + bracketSize);
    // Bottom-Left
    this.reticleGfx.moveTo(pos.x - offset, pos.y + offset - bracketSize)
      .lineTo(pos.x - offset, pos.y + offset)
      .lineTo(pos.x - offset + bracketSize, pos.y + offset);
    // Bottom-Right
    this.reticleGfx.moveTo(pos.x + offset - bracketSize, pos.y + offset)
      .lineTo(pos.x + offset, pos.y + offset)
      .lineTo(pos.x + offset, pos.y + offset - bracketSize);

    this.reticleGfx.stroke({ width: 2.5, color, alpha: 0.9 });

    // Inner highlight halo
    this.reticleGfx.circle(pos.x, pos.y, r)
      .fill({ color, alpha: isValid ? 0.2 : 0.15 });
    this.reticleGfx.circle(pos.x, pos.y, 4)
      .fill({ color, alpha: 0.85 });

    // 2. Floating magnifying indicator ~48px above finger (touchX, touchY)
    const bubbleY = touchY - 48;
    const bubbleR = 20;

    // Subtle guide line from floating bubble to target intersection
    this.reticleGfx.moveTo(touchX, bubbleY + bubbleR)
      .lineTo(pos.x, pos.y - offset);
    this.reticleGfx.stroke({ width: 1.5, color, alpha: 0.5 });

    // Bubble outer ring + fill
    this.reticleGfx.circle(touchX, bubbleY, bubbleR)
      .fill({ color: 0x1a2130, alpha: 0.92 })
      .stroke({ width: 2, color, alpha: 0.9 });

    // Bubble center indicator
    this.reticleGfx.circle(touchX, bubbleY, 5)
      .fill({ color, alpha: 0.9 });
  }

  clearReticle(): void {
    this.reticleGfx.clear();
  }

  // ── Valid placements (gold dots matching hover style) ─────────

  showValidPlacements(points: Point[]): void {
    this.validGfx.clear();
    for (const p of points) {
      const pos = logicalToScreen(p.col, p.row);
      // Gold dot (matching original hover style but with pulse)
      this.validGfx.circle(pos.x, pos.y, 8)
        .fill({ color: 0xffd700, alpha: 0.6 });
      this.validGfx.circle(pos.x, pos.y, 14)
        .fill({ color: 0xffd700, alpha: 0.12 });
    }
    if (this.pulseTween) { this.pulseTween.kill(); this.pulseTween = null; }
    if (points.length > 0) {
      // 有限次数：无限 tween 在玩家思考期间常驻唤醒 gsap ticker，手机发热
      this.pulseTween = gsap.to(this.validGfx, {
        alpha: 0.35,
        duration: 0.8,
        yoyo: true,
        repeat: 5,
        ease: 'sine.inOut',
      });
    }
  }

  // ── Skill range (reference-counted, persistent) ───────────────

  /** Add/update a persistent skill range for a piece. Overlapping points from
   *  multiple pieces are reference-counted so removing one piece keeps the
   *  indicator alive when another piece still targets that cell. */
  addSkillRange(id: string, points: Point[]): void {
    // Remove previous entry for this id
    this.removeSkillRange(id);
    this.skillRangeMap.set(id, points);
    for (const p of points) {
      const key = `${p.col},${p.row}`;
      this.pointRefCount.set(key, (this.pointRefCount.get(key) || 0) + 1);
    }
    this.redrawSkillGfx();
  }

  /** Remove a persistent skill range. */
  removeSkillRange(id: string): void {
    const oldPoints = this.skillRangeMap.get(id);
    if (!oldPoints) return;
    for (const p of oldPoints) {
      const key = `${p.col},${p.row}`;
      const count = this.pointRefCount.get(key) || 1;
      if (count <= 1) {
        this.pointRefCount.delete(key);
      } else {
        this.pointRefCount.set(key, count - 1);
      }
    }
    this.skillRangeMap.delete(id);
    this.redrawSkillGfx();
  }

  /** Show a temporary preview skill range (replaces any previous preview). */
  showSkillRange(points: Point[]): void {
    this.addSkillRange(PREVIEW_KEY, points);
  }

  /** Clear the temporary preview. */
  clearSkillPreview(): void {
    this.removeSkillRange(PREVIEW_KEY);
  }

  /** Clear ALL persistent skill ranges (turn end / confirm). */
  clearAllSkillRanges(): void {
    this.skillRangeMap.clear();
    this.pointRefCount.clear();
    this.redrawSkillGfx();
  }

  private redrawSkillGfx(): void {
    this.skillGfx.clear();
    if (this.flashTween) { this.flashTween.kill(); this.flashTween = null; }
    const r = Layout.pieceRadius + 0.5;
    const innerR = r - 2;
    const dashCount = 12;
    const dashAngle = (Math.PI * 2) / dashCount;
    const gapAngle = dashAngle * 0.45;

    for (const key of this.pointRefCount.keys()) {
      const [col, row] = key.split(',').map(Number);
      const pos = logicalToScreen(col, row);
      // Outer glow ring (brighter, wider)
      this.skillGfx.circle(pos.x, pos.y, r)
        .stroke({ width: 5, color: CONFIG.COLORS.SKILL_RANGE, alpha: 0.35 });
      // Inner solid fill (semi-transparent)
      this.skillGfx.circle(pos.x, pos.y, innerR)
        .fill({ color: CONFIG.COLORS.SKILL_RANGE, alpha: 0.35 });
      // Dashed border ring
      for (let i = 0; i < dashCount; i++) {
        const start = i * dashAngle;
        const end = start + dashAngle - gapAngle;
        this.skillGfx.moveTo(
          pos.x + Math.cos(start) * r,
          pos.y + Math.sin(start) * r,
        );
        this.skillGfx.arc(pos.x, pos.y, r, start, end);
      }
      this.skillGfx.stroke({ width: 3, color: 0xff8833, alpha: 0.95 });
    }
    // Flash animation（有限次数：技能圈在放置后常驻到确认，无限 tween 会让
    // gsap ticker 全程不睡眠）
    if (this.pointRefCount.size > 0) {
      this.flashTween = gsap.to(this.skillGfx, {
        alpha: 0.55,
        duration: 0.5,
        yoyo: true,
        repeat: 5,
        ease: 'sine.inOut',
      });
    }
    this.skillGfx.alpha = 1;
  }

  // ── Forbidden zones (red dots) ────────────────────────────────

  showForbiddenZones(points: Point[]): void {
    this.forbiddenGfx.clear();
    const r = Layout.pieceRadius - 1;
    for (const p of points) {
      const pos = logicalToScreen(p.col, p.row);
      this.forbiddenGfx.circle(pos.x, pos.y, r)
        .fill({ color: CONFIG.COLORS.ENEMY_FILL, alpha: 0.12 });
      this.forbiddenGfx.circle(pos.x, pos.y, r)
        .stroke({ width: 1, color: CONFIG.COLORS.ENEMY_STROKE, alpha: 0.7 });
    }
  }

  // ── Eliminating flash animation ───────────────────────────────

  playEliminating(col: number, row: number): gsap.core.Timeline {
    const pos = logicalToScreen(col, row);
    const flash = new Graphics();
    flash.circle(0, 0, 8).fill({ color: 0xff0000, alpha: 0.9 });
    flash.x = pos.x;
    flash.y = pos.y;
    this.eliminatingLayer.addChild(flash);

    const tl = gsap.timeline({
      onComplete: () => {
        flash.removeFromParent();
        flash.destroy();
      },
    });
    tl.to(flash.scale, { x: 3.5, y: 3.5, duration: 0.5, ease: 'power2.out' }, 0);
    tl.to(flash, { alpha: 0, duration: 0.5, ease: 'power2.out' }, 0);
    return tl;
  }

  // ── Clear ─────────────────────────────────────────────────────

  /** Clear transient overlays (forbidden, valid, hover, eliminating).
   *  Does NOT clear persistent skill ranges — use clearAllSkillRanges() for that. */
  clear(): void {
    this.forbiddenGfx.clear();
    this.validGfx.clear();
    this.hoverGfx.clear();
    this.clearReticle();
    this.validGfx.alpha = 1;

    this.clearEliminatingLayer();

    if (this.pulseTween) { this.pulseTween.kill(); this.pulseTween = null; }
  }

  /** Clear everything including persistent skill ranges. */
  clearAll(): void {
    this.clear();
    this.clearAllSkillRanges();
  }

  private clearEliminatingLayer(): void {
    while (this.eliminatingLayer.children.length > 0) {
      const child = this.eliminatingLayer.children[0];
      child.removeFromParent();
      child.destroy({ children: true });
    }
  }

  destroy(): void {
    if (this.pulseTween) { this.pulseTween.kill(); this.pulseTween = null; }
    if (this.flashTween) { this.flashTween.kill(); this.flashTween = null; }
    this.idleGfx.destroy();
    this.forbiddenGfx.destroy();
    this.validGfx.destroy();
    this.skillGfx.destroy();
    this.hoverGfx.destroy();
    this.reticleGfx.destroy();
    this.clearEliminatingLayer();
    this.eliminatingLayer.destroy();
    this.skillRangeMap.clear();
    this.pointRefCount.clear();
    this.container.destroy({ children: true });
    this.belowContainer.destroy({ children: true });
  }
}
