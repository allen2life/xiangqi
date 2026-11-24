import { Container, Graphics, DisplacementFilter } from 'pixi.js';
import gsap from 'gsap';

let isDisplacementAvailable: boolean | null = null;

/**
 * 检查当前环境是否支持置换滤镜。
 * 若在非浏览器环境（如 Node/无 DOM/不支持 Shader）或发生异常，静默返回 false。
 */
export function canUseDisplacementFilter(): boolean {
  if (isDisplacementAvailable !== null) return isDisplacementAvailable;
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      isDisplacementAvailable = false;
      return false;
    }
    isDisplacementAvailable = typeof DisplacementFilter === 'function';
    return isDisplacementAvailable;
  } catch {
    isDisplacementAvailable = false;
    return false;
  }
}

/**
 * 供测试或手动开关使用的降级设置接口
 */
export function setDisplacementFilterAvailable(available: boolean | null): void {
  isDisplacementAvailable = available;
}

/**
 * 局部冲击波特效（0.25 秒瞬态）。
 * 遇到兼容不良或报错时静默降级为“无效果”，完全等同于没有这次修改。
 */
export function playTransientShockwave(
  parentLayer: Container,
  targetContainer: Container,
  centerX: number,
  centerY: number,
  duration = 0.25
): void {
  // 核心降级策略：不支持或报错时，直接退出，不产生任何画面和内存副作用
  if (!canUseDisplacementFilter()) {
    return;
  }

  let filter: DisplacementFilter | null = null;
  let waveGfx: Graphics | null = null;

  const cleanup = () => {
    try {
      if (filter && targetContainer) {
        const filters = Array.isArray(targetContainer.filters) ? targetContainer.filters : [];
        targetContainer.filters = filters.filter((f) => f !== filter);
        try { (filter as any).destroy?.(); } catch { /* ignore */ }
      }
      if (waveGfx) {
        waveGfx.removeFromParent();
        waveGfx.destroy();
      }
    } catch {
      // 容错兜底
    }
  };

  try {
    waveGfx = new Graphics();
    waveGfx.circle(0, 0, 15).stroke({ width: 8, color: 0x808080 });
    waveGfx.x = centerX;
    waveGfx.y = centerY;
    parentLayer.addChild(waveGfx);

    filter = new DisplacementFilter({ sprite: waveGfx as any, scale: 12 });

    const currentFilters = Array.isArray(targetContainer.filters)
      ? [...targetContainer.filters]
      : [];
    targetContainer.filters = [...currentFilters, filter];

    gsap.timeline({
      onComplete: cleanup,
    })
      .to(waveGfx.scale, { x: 4.5, y: 4.5, duration, ease: 'power2.out' })
      .to((filter as any).scale, { x: 0, y: 0, duration, ease: 'power2.out' }, 0);
  } catch {
    // 运行时一旦捕获到任何错误，立即禁用特性并恢复原状，不产生任何副作用
    isDisplacementAvailable = false;
    cleanup();
  }
}
