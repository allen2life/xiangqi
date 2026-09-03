import { Container, Graphics } from 'pixi.js';
import {
  PARTICLE, RING, TRAVEL,
  KINGS_MEETING, PALACE, DECREE,
} from './EffectConstants';

/**
 * 纯函数式墨迹图元工厂。无状态，每次调用创建独立 Graphics / Container。
 * 与旧实现的区别：把 Container + N 个子 Graphics 合并为单个 Graphics 多次
 * 绘制，减少 Pixi 节点数与 draw call。所有位置参数为屏幕像素坐标。
 */
export class EffectRenderer {
  /** 墨点爆开：中心圆 + 随机方向散落的小点（单 Graphics 多 draw） */
  createInkBurst(x: number, y: number, primary: number, accent: number, count = PARTICLE.DEFAULT_COUNT): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    g.circle(0, 0, PARTICLE.DEFAULT_BURST_INNER_RADIUS).fill({ color: primary, alpha: 0.7 });
    g.circle(0, 0, PARTICLE.DEFAULT_BURST_HALO_RADIUS).fill({ color: primary, alpha: 0.25 });
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 25 + Math.random() * 30;
      const r = 3 + Math.random() * 4;
      g.circle(Math.cos(angle) * dist, Math.sin(angle) * dist, r)
        .fill({ color: i % 2 === 0 ? primary : accent, alpha: 0.5 + Math.random() * 0.3 });
    }
    return g;
  }

  /** 墨环：从内到外扩散的圆环 */
  createInkRing(x: number, y: number, radius: number, color: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    g.circle(0, 0, radius).fill({ color, alpha: 0.15 });
    g.circle(0, 0, radius * 0.6).fill({ color, alpha: 0.3 });
    g.circle(0, 0, radius * 0.25).fill({ color, alpha: 0.5 });
    return g;
  }

  /** 墨线拖尾：起点到终点的粗线条 */
  createInkTrail(x1: number, y1: number, x2: number, y2: number, color: number): Graphics {
    const g = new Graphics();
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    g.moveTo(0, 0);
    g.lineTo(len, 0);
    g.stroke({ width: TRAVEL.STROKE_WIDTH, color, alpha: 0.5 });
    g.x = x1; g.y = y1;
    g.rotation = angle;
    return g;
  }

  /** 墨刃：斜线切割效果 */
  createInkSlash(x: number, y: number, angle: number, color: number): Graphics {
    const g = new Graphics();
    g.moveTo(-TRAVEL.SLASH_HALF_LEN, 0); g.lineTo(TRAVEL.SLASH_HALF_LEN, 0);
    g.stroke({ width: TRAVEL.SLASH_WIDTH, color, alpha: 0.7 });
    g.x = x; g.y = y;
    g.rotation = angle;
    return g;
  }

  /** 十字墨柱冲击 */
  createInkCross(x: number, y: number, size: number, color: number, accent: number): Graphics {
    const g = new Graphics();
    g.moveTo(-size, 0); g.lineTo(size, 0);
    g.stroke({ width: TRAVEL.CROSS_WIDTH, color, alpha: 0.6 });
    g.moveTo(0, -size); g.lineTo(0, size);
    g.stroke({ width: TRAVEL.CROSS_WIDTH, color, alpha: 0.6 });
    g.circle(0, 0, 6).fill({ color: accent, alpha: 0.9 });
    g.x = x; g.y = y;
    return g;
  }

  /** 墨花绽放 */
  createInkBloom(x: number, y: number, primary: number, secondary: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = 15 + Math.random() * 20;
      g.circle(Math.cos(angle) * r, Math.sin(angle) * r, 4 + Math.random() * 6)
        .fill({ color: i % 3 === 0 ? secondary : primary, alpha: 0.3 + Math.random() * 0.3 });
    }
    g.circle(0, 0, 8).fill({ color: primary, alpha: 0.7 });
    return g;
  }

  /** 墨块消散碎片（单 Graphics 多 draw） */
  createShatterPieces(x: number, y: number, color: number, count = 6): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    for (let i = 0; i < count; i++) {
      const w = PARTICLE.SHATTER_MIN_SIZE + Math.random() * (PARTICLE.SHATTER_MAX_SIZE - PARTICLE.SHATTER_MIN_SIZE);
      const h = PARTICLE.SHATTER_MIN_SIZE + Math.random() * (PARTICLE.SHATTER_MAX_SIZE - PARTICLE.SHATTER_MIN_SIZE);
      const px = (Math.random() - 0.5) * 20;
      const py = (Math.random() - 0.5) * 20;
      g.rect(px - w / 2, py - h / 2, w, h).fill({ color, alpha: 0.7 });
    }
    return g;
  }

  /** 墨点，用于溅射效果（单 Graphics 多 draw） */
  createInkDots(x: number, y: number, primary: number, count = 5): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 15;
      const r = PARTICLE.DOT_MIN_RADIUS + Math.random() * (PARTICLE.DOT_MAX_RADIUS - PARTICLE.DOT_MIN_RADIUS);
      g.circle(Math.cos(angle) * dist, Math.sin(angle) * dist, r)
        .fill({ color: primary, alpha: 0.6 });
    }
    return g;
  }

  /** 随机矩形碎屑（char_explode 兜底填充） */
  createDebris(x: number, y: number, color: number, count: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    for (let i = 0; i < count; i++) {
      const w = PARTICLE.DEBRIS_MIN_SIZE + Math.random() * (PARTICLE.DEBRIS_MAX_SIZE - PARTICLE.DEBRIS_MIN_SIZE);
      const h = PARTICLE.DEBRIS_MIN_SIZE + Math.random() * (PARTICLE.DEBRIS_MAX_SIZE - PARTICLE.DEBRIS_MIN_SIZE);
      const px = (Math.random() - 0.5) * 20;
      const py = (Math.random() - 0.5) * 20;
      g.rect(px - w / 2, py - h / 2, w, h).fill({ color, alpha: 0.5 + Math.random() * 0.3 });
    }
    return g;
  }

  /** impact frame 全屏白闪图层（命中瞬间的 1 帧亮闪） */
  createImpactFlash(x: number, y: number, color: number, radius: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    g.circle(0, 0, radius).fill({ color, alpha: 1 });
    return g;
  }

  // ───────────────────────────────────────────────────────────────
  //  王见王 / 坐镇中宫 专属图元
  // ───────────────────────────────────────────────────────────────

  /**
   * 双王对峙光束（beam_clash）：从 from 到 to 的发光直棍。
   * 由调用方分阶段 tween scale.x 来实现"双向生长 → 中点相会"。
   * 返回的 Graphics 锚点在 from，已旋转到 to 方向，scale.x 初始为 0。
   */
  createBeamClash(fromX: number, fromY: number, toX: number, toY: number, color: number): Graphics {
    const g = new Graphics();
    const dx = toX - fromX, dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // 单位长度的光束：从 0 到 1 的渐变带 + 中心高光
    g.rect(0, -KINGS_MEETING.BEAM_WIDTH / 2, 1, KINGS_MEETING.BEAM_WIDTH)
      .fill({ color, alpha: 0.55 });
    g.rect(0, -KINGS_MEETING.BEAM_WIDTH / 4, 1, KINGS_MEETING.BEAM_WIDTH / 2)
      .fill({ color: 0xffffff, alpha: 0.6 });
    g.x = fromX; g.y = fromY;
    g.rotation = Math.atan2(dy, dx);
    g.scale.x = 0;  // 由调用方生长到 len
    (g as Graphics & { __targetLen?: number }).__targetLen = len;
    return g;
  }

  /** 光束中点相会爆发（beam_clash 第二阶段） */
  createBeamClashFlash(x: number, y: number, color: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    g.circle(0, 0, KINGS_MEETING.BEAM_CLASH_FLASH_RADIUS).fill({ color: 0xffffff, alpha: 0.9 });
    g.circle(0, 0, KINGS_MEETING.BEAM_CLASH_FLASH_RADIUS * 0.6).fill({ color, alpha: 0.7 });
    g.circle(0, 0, KINGS_MEETING.BEAM_CLASH_FLASH_RADIUS * 0.3).fill({ color: 0xffffff, alpha: 1 });
    g.blendMode = 'add';
    g.scale.set(0);
    return g;
  }

  /**
   * 三线扫荡的单条扫线（triple_sweep）：单位长度（1px）水平光带，锚点在起点。
   * 由调用方 rotation 定方向、scale.x 拉伸到自适应长度（见 playKingsMeeting 中 sweepLen）。
   */
  createSweepLine(color: number, accent: number): Graphics {
    const g = new Graphics();
    const w = KINGS_MEETING.SWEEP_LINE_WIDTH;
    g.rect(0, -w / 2, 1, w).fill({ color, alpha: KINGS_MEETING.SWEEP_LINE_ALPHA });
    g.rect(0, -w / 4, 1, w / 2).fill({ color: accent, alpha: 0.7 });
    g.rect(0, -1, 1, 2).fill({ color: 0xffffff, alpha: 0.85 });
    g.blendMode = 'add';
    g.scale.x = 0;
    return g;
  }

  /**
   * 王见王扫荡光柱（triple_sweep pillar）：从中央射线向两侧扩散成笼罩三条线的光柱。
   * 单位长度（1px 沿光束方向）的多层渐变光带，垂直方向总宽 3*cellSize（对称居中）。
   * 调用方通过 rotation 定方向、scale.x 拉伸长度、scale.y 从 0→1 实现垂直扩散。
   * scale.y=0 时坍缩为一条亮线（原 beam_clash 射线），scale.y=1 时展开为完整 3 线宽光柱。
   */
  createSweepPillar(color: number, accent: number, cellSize: number): Graphics {
    const g = new Graphics();
    const halfWidth = cellSize * 1.5; // 半宽 1.5 格 → 全宽 3 格（笼罩三条线）
    // 外层光晕（3 线宽，最暗）
    g.rect(0, -halfWidth, 1, halfWidth * 2)
      .fill({ color, alpha: KINGS_MEETING.SWEEP_LINE_ALPHA * 0.4 });
    // 中层光带（2 线宽）
    g.rect(0, -halfWidth * 0.5, 1, halfWidth)
      .fill({ color, alpha: KINGS_MEETING.SWEEP_LINE_ALPHA * 0.75 });
    // 内层光带（约 1 线宽，accent 色）
    g.rect(0, -halfWidth * 0.2, 1, halfWidth * 0.4)
      .fill({ color: accent, alpha: 0.7 });
    // 核心亮线（原 beam_clash 射线，白色最亮）
    g.rect(0, -halfWidth * 0.06, 1, halfWidth * 0.12)
      .fill({ color: 0xffffff, alpha: 0.9 });
    g.blendMode = 'add';
    g.scale.x = 0; // 沿光束方向生长（扫荡）
    g.scale.y = 0; // 垂直扩散（从中央射线向两侧展开）
    return g;
  }

  /**
   * 九宫格印章纹（palace_grid ripple）：以 (x,y) 为中心的 3×3 描边方框。
   * cellSize 为单格像素边长。
   */
  createPalaceGrid(x: number, y: number, cellSize: number, color: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    const totalSize = cellSize * 3;
    // 外框
    g.rect(-totalSize / 2, -totalSize / 2, totalSize, totalSize)
      .stroke({ width: PALACE.GRID_STROKE_WIDTH, color, alpha: PALACE.GRID_ALPHA });
    // 内十字格线
    g.moveTo(-cellSize / 2, -totalSize / 2).lineTo(-cellSize / 2, totalSize / 2)
      .stroke({ width: PALACE.GRID_STROKE_WIDTH * 0.6, color, alpha: PALACE.GRID_ALPHA * 0.6 });
    g.moveTo(cellSize / 2, -totalSize / 2).lineTo(cellSize / 2, totalSize / 2)
      .stroke({ width: PALACE.GRID_STROKE_WIDTH * 0.6, color, alpha: PALACE.GRID_ALPHA * 0.6 });
    g.moveTo(-totalSize / 2, -cellSize / 2).lineTo(totalSize / 2, -cellSize / 2)
      .stroke({ width: PALACE.GRID_STROKE_WIDTH * 0.6, color, alpha: PALACE.GRID_ALPHA * 0.6 });
    g.moveTo(-totalSize / 2, cellSize / 2).lineTo(totalSize / 2, cellSize / 2)
      .stroke({ width: PALACE.GRID_STROKE_WIDTH * 0.6, color, alpha: PALACE.GRID_ALPHA * 0.6 });
    return g;
  }

  /** 印章下压（seal_press / palace_seal cast）：方形印章纹 + 中心实心圆 */
  createPalaceSeal(x: number, y: number, cellSize: number, color: number, accent: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    const half = cellSize * 1.5;
    // 印章方框
    g.rect(-half, -half, half * 2, half * 2).stroke({ width: 3, color: accent, alpha: 0.85 });
    g.rect(-half * 0.7, -half * 0.7, half * 1.4, half * 1.4).fill({ color, alpha: 0.25 });
    g.circle(0, 0, PALACE.SEAL_INNER_RADIUS).fill({ color: accent, alpha: 0.9 });
    g.circle(0, 0, PALACE.SEAL_INNER_RADIUS * 0.5).fill({ color: 0xffffff, alpha: 0.7 });
    g.scale.set(0);
    return g;
  }

  /**
   * 金令符（decree_wave）：从 (x,y) 沿 4 个正交方向延伸的令符拖尾。
   * 单 Graphics 多 draw，锚点在 (x,y)，初始 scale=0。
   */
  createDecreeWave(x: number, y: number, color: number, accent: number): Graphics {
    const g = new Graphics();
    g.x = x; g.y = y;
    const reach = DECREE.REACH;
    for (const dir of [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    ]) {
      const ex = dir.dx * reach, ey = dir.dy * reach;
      g.moveTo(0, 0).lineTo(ex, ey)
        .stroke({ width: DECREE.STROKE_WIDTH, color, alpha: DECREE.ALPHA * 0.6 });
      g.rect(ex - 5, ey - 5, 10, 10)
        .fill({ color: accent, alpha: 0.85 });
      g.circle(ex, ey, 3).fill({ color: 0xffffff, alpha: 0.9 });
    }
    g.scale.set(0);
    return g;
  }
}

// 保留 Container 类型导出给调用方按需使用
export type { Container };
export const RING_BASE_RADIUS = RING.BASE_RADIUS;
