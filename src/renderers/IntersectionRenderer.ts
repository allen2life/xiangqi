import { Container, Graphics, Text } from 'pixi.js';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { logicalToScreen } from '../utils/coord';
import { Layout } from '../ui/Layout';
import type { Point } from '../core/types';
import { renderNow } from '../utils/renderLoop';

export enum IntersectionState {
  NONE,
  IDLE_DOT,
  FORBIDDEN,
  VALID_PLACEMENT,
  SKILL_TARGET,
  HOVER,
  ELIMINATING,
}

export interface PreviewTargetMarker {
  col: number;
  row: number;
  kind: 'kill' | 'shield' | 'ally';
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
  private enemyThreatGfx = new Graphics();
  private skillGfx = new Graphics();
  private previewMarkerGfx = new Graphics();
  private hoverGfx = new Graphics();
  private reticleGfx = new Graphics();
  private previewBadge = new Container();
  private eliminatingLayer = new Container();

  private pulseTween: gsap.core.Tween | null = null;
  private flashTween: gsap.core.Tween | null = null;

  // ── 咬合锁定与磁吸动效状态 ──────────────────────────────────────
  private wasLocked = false;
  private snapScale = { value: 1.0 };
  private snapFlash = { alpha: 0, r: 0 };
  private lastReticleKey: string | null = null;

  // ── Skill range accumulation (reference-counted) ──────────────

  private skillRangeMap = new Map<string, Point[]>();
  private pointRefCount = new Map<string, number>();

  constructor() {
    // Below-piece layer (forbidden zones rendered under enemy pieces)
    this.belowContainer.addChild(this.idleGfx, this.forbiddenGfx);
    // Above-piece layer
    this.container.addChild(
      this.validGfx,
      this.enemyThreatGfx,
      this.skillGfx,
      this.previewMarkerGfx,
      this.hoverGfx,
      this.eliminatingLayer,
      this.reticleGfx,
      this.previewBadge,
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
  showReticle(
    col: number,
    row: number,
    touchX: number,
    touchY: number,
    isValid: boolean,
    isLocked: boolean = true,
    isTouch: boolean = false
  ): void {
    const pos = logicalToScreen(col, row);
    this.reticleGfx.clear();

    const color = isValid ? 0xffea55 : 0xef5350;
    const r = Layout.pieceRadius || 24;
    const targetKey = `${col},${row}`;

    // ── 咬合锁定瞬间的猛烈收缩动效 ──
    if (isLocked && (!this.wasLocked || this.lastReticleKey !== targetKey)) {
      this.snapScale.value = 1.55;
      gsap.killTweensOf(this.snapScale);
      gsap.to(this.snapScale, {
        value: 1.0,
        duration: 0.15,
        ease: 'back.out(3.5)',
        onUpdate: () => renderNow(),
      });

      this.snapFlash.alpha = 0.9;
      this.snapFlash.r = r * 0.7;
      gsap.killTweensOf(this.snapFlash);
      gsap.to(this.snapFlash, {
        alpha: 0,
        r: r * 1.5,
        duration: 0.22,
        ease: 'power2.out',
        onUpdate: () => renderNow(),
      });
    }
    this.wasLocked = isLocked;
    this.lastReticleKey = targetKey;

    // ── 1. 磁吸拉扯感：在吸附预备区（未强锁）绘制强烈的牵引光线与拉伸位移 ──
    const distToCenter = Math.hypot(touchX - pos.x, touchY - pos.y);
    let cx = pos.x;
    let cy = pos.y;

    if (!isLocked) {
      // 明显向鼠标/手指拉扯（最大拉出 10px）
      const pullFactor = Math.min(10, distToCenter * 0.28);
      const angle = Math.atan2(touchY - pos.y, touchX - pos.x);
      cx = pos.x + Math.cos(angle) * pullFactor;
      cy = pos.y + Math.sin(angle) * pullFactor;

      // 磁吸牵引光线：连接光标与交叉点，营造吸力线
      this.reticleGfx.moveTo(touchX, touchY).lineTo(pos.x, pos.y);
      this.reticleGfx.stroke({ width: 2.5, color: 0xffd700, alpha: 0.55 });
      // 光标处的磁力光环
      this.reticleGfx.circle(touchX, touchY, 6)
        .stroke({ width: 2.0, color: 0xffd700, alpha: 0.85 });
    }

    // ── 2. 四角直角瞄准框（高对比度，确保一眼看清） ──
    const baseOffset = isLocked ? r + 2 : r + 10;
    const offset = baseOffset * this.snapScale.value;
    const bracketSize = Math.max(14, r * 0.55) * this.snapScale.value;

    const drawCorners = () => {
      // Top-Left
      this.reticleGfx.moveTo(cx - offset, cy - offset + bracketSize)
        .lineTo(cx - offset, cy - offset)
        .lineTo(cx - offset + bracketSize, cy - offset);
      // Top-Right
      this.reticleGfx.moveTo(cx + offset - bracketSize, cy - offset)
        .lineTo(cx + offset, cy - offset)
        .lineTo(cx + offset, cy - offset + bracketSize);
      // Bottom-Left
      this.reticleGfx.moveTo(cx - offset, cy + offset - bracketSize)
        .lineTo(cx - offset, cy + offset)
        .lineTo(cx - offset + bracketSize, cy + offset);
      // Bottom-Right
      this.reticleGfx.moveTo(cx + offset - bracketSize, cy + offset)
        .lineTo(cx + offset, cy + offset)
        .lineTo(cx + offset, cy + offset - bracketSize);
    };

    // 底层深色轮廓（抗背景底色干扰）
    drawCorners();
    this.reticleGfx.stroke({ width: isLocked ? 5.5 : 4.0, color: 0x0a101d, alpha: 0.85 });

    // 顶层鲜明亮色
    drawCorners();
    this.reticleGfx.stroke({
      width: isLocked ? 3.5 : 2.2,
      color: isLocked ? color : 0xffaa00,
      alpha: isLocked ? 1.0 : 0.7,
    });

    // 咬合锁定瞬间的炸裂高亮冲击环
    if (this.snapFlash.alpha > 0.02) {
      this.reticleGfx.circle(pos.x, pos.y, this.snapFlash.r)
        .stroke({ width: 3.0, color: 0xffffff, alpha: this.snapFlash.alpha });
    }

    // 中心微光环
    this.reticleGfx.circle(pos.x, pos.y, r)
      .fill({ color, alpha: isLocked ? (isValid ? 0.3 : 0.2) : 0.1 });
    this.reticleGfx.circle(pos.x, pos.y, isLocked ? 5 : 3.5)
      .fill({ color: isLocked ? 0xffffff : color, alpha: isLocked ? 1.0 : 0.7 });

    // ── 3. 触屏拖拽模式：放大镜气泡 ──
    if (isTouch) {
      const bubbleY = touchY - 48;
      const bubbleR = 20;

      this.reticleGfx.moveTo(touchX, bubbleY + bubbleR)
        .lineTo(cx, cy - offset);
      this.reticleGfx.stroke({ width: isLocked ? 2.0 : 1.2, color, alpha: isLocked ? 0.7 : 0.3 });

      this.reticleGfx.circle(touchX, bubbleY, bubbleR)
        .fill({ color: 0x1a2130, alpha: 0.94 })
        .stroke({ width: isLocked ? 2.5 : 1.8, color, alpha: isLocked ? 1.0 : 0.6 });

      this.reticleGfx.circle(touchX, bubbleY, isLocked ? 5 : 3.5)
        .fill({ color, alpha: isLocked ? 1.0 : 0.6 });
    }
  }

  clearReticle(): void {
    this.wasLocked = false;
    this.lastReticleKey = null;
    this.reticleGfx.clear();
    this.clearPreviewMarkers();
  }

  /** 绘制实时预览标记（必杀红准星 / 免疫青盾 / 误伤橙叉）与落点顶部悬浮总结徽章 */
  showPreviewMarkers(
    originCol: number,
    originRow: number,
    markers: PreviewTargetMarker[],
    summaryText: string,
    badgeColor: number,
  ): void {
    this.clearPreviewMarkers();
    const r = Math.max(16, (Layout.pieceRadius || 22) + 2);

    for (const m of markers) {
      const pos = logicalToScreen(m.col, m.row);
      if (m.kind === 'kill') {
        this.previewMarkerGfx.circle(pos.x, pos.y, r + 2)
          .stroke({ width: 3, color: 0xff4757, alpha: 0.95 });
        this.previewMarkerGfx.circle(pos.x, pos.y, r - 4)
          .fill({ color: 0xff4757, alpha: 0.22 });
        const arm = 7;
        const tick = r + 5;
        this.previewMarkerGfx
          .moveTo(pos.x - tick, pos.y).lineTo(pos.x - tick + arm, pos.y)
          .moveTo(pos.x + tick - arm, pos.y).lineTo(pos.x + tick, pos.y)
          .moveTo(pos.x, pos.y - tick).lineTo(pos.x, pos.y - tick + arm)
          .moveTo(pos.x, pos.y + tick - arm).lineTo(pos.x, pos.y + tick)
          .stroke({ width: 2.5, color: 0xffe28a, alpha: 0.95 });
      } else if (m.kind === 'shield') {
        this.previewMarkerGfx.circle(pos.x, pos.y, r + 2)
          .stroke({ width: 2.5, color: 0x00d2d3, alpha: 0.9 });
        this.previewMarkerGfx.circle(pos.x, pos.y, r - 3)
          .stroke({ width: 1.5, color: 0x9ef7f7, alpha: 0.7 });
      } else {
        // ally risk
        const d = r * 0.55;
        this.previewMarkerGfx.circle(pos.x, pos.y, r + 2)
          .stroke({ width: 2.5, color: 0xff6b35, alpha: 0.9 });
        this.previewMarkerGfx
          .moveTo(pos.x - d, pos.y - d).lineTo(pos.x + d, pos.y + d)
          .moveTo(pos.x + d, pos.y - d).lineTo(pos.x - d, pos.y + d)
          .stroke({ width: 3, color: 0xff6b35, alpha: 0.95 });
      }
    }

    if (summaryText) {
      const originPos = logicalToScreen(originCol, originRow);
      const txt = new Text({
        text: summaryText,
        style: {
          fontSize: 12,
          fontWeight: '700',
          fill: 0xffffff,
          fontFamily: 'Arial, sans-serif',
        },
      });
      txt.anchor.set(0.5);
      const padX = 10;
      const w = Math.max(54, txt.width + padX * 2);
      const h = 24;
      const pill = new Graphics();
      pill.roundRect(-w / 2, -h / 2, w, h, 12)
        .fill({ color: 0x0f1624, alpha: 0.92 })
        .stroke({ width: 1.8, color: badgeColor, alpha: 0.95 });
      this.previewBadge.addChild(pill, txt);
      const clampedX = Math.max(w / 2 + 8, Math.min((Layout.screenWidth || 400) - w / 2 - 8, originPos.x));
      const clampedY = Math.max(66, originPos.y - (Layout.pieceRadius || 22) - 24);
      this.previewBadge.x = clampedX;
      this.previewBadge.y = clampedY;
    }
  }

  clearPreviewMarkers(): void {
    this.previewMarkerGfx.clear();
    while (this.previewBadge.children.length > 0) {
      const child = this.previewBadge.children[0];
      child.removeFromParent();
      child.destroy();
    }
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
    this.clearPreviewMarkers();
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

  clearEnemyThreat(): void {
    this.enemyThreatGfx.clear();
  }

  /** 高亮单个被点击敌方单位的选中圈与自身威胁（禁区）范围 */
  showEnemyThreat(col: number, row: number, range: Point[]): void {
    this.enemyThreatGfx.clear();
    const origin = logicalToScreen(col, row);
    const r = Layout.pieceRadius || 20;
    this.enemyThreatGfx.circle(origin.x, origin.y, r + 5)
      .stroke({ width: 3, color: 0xffd700, alpha: 0.95 });

    for (const p of range) {
      const pos = logicalToScreen(p.col, p.row);
      const d = 8;
      this.enemyThreatGfx
        .moveTo(pos.x, pos.y - d)
        .lineTo(pos.x + d, pos.y)
        .lineTo(pos.x, pos.y + d)
        .lineTo(pos.x - d, pos.y)
        .closePath()
        .fill({ color: 0xff4757, alpha: 0.32 })
        .stroke({ width: 1.5, color: 0xff6b81, alpha: 0.9 });
    }
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
    this.enemyThreatGfx.clear();
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
    this.enemyThreatGfx.destroy();
    this.skillGfx.destroy();
    this.previewMarkerGfx.destroy();
    this.hoverGfx.destroy();
    this.reticleGfx.destroy();
    this.clearPreviewMarkers();
    this.previewBadge.destroy();
    this.clearEliminatingLayer();
    this.eliminatingLayer.destroy();
    this.skillRangeMap.clear();
    this.pointRefCount.clear();
    this.container.destroy({ children: true });
    this.belowContainer.destroy({ children: true });
  }
}
