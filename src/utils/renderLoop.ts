/**
 * 渲染按需化：静止时零渲染，有动画时 60fps。
 *
 * Pixi ticker 默认无条件 60fps 重绘整个舞台（回合制游戏中绝大多数帧无变化，
 * 手机 GPU 常驻高频导致发热）。这里改为挂在 gsap ticker 上，但**仅当有活跃
 * gsap tween/timeline 时才渲染**。
 *
 * 关键认知（修正历史误解）：gsap.ticker 本身不会因为没有活动动画就睡眠——它自带
 * rAF 循环每帧都调用 add 进来的回调。因此不能依赖"gsap 自动睡"，必须显式判断
 * globalTimeline 的顶层子项是否有 isActive()。
 *
 * 顶层子项包含 timeline（其 targets() 为空，但内含嵌套 Pixi tween）——时间轴活跃
 * 即代表有动画在跑，必须渲染。
 *
 * 静止期零渲染的成立前提：没有常驻 gsap tween（龙灯微风摇摆已移除；剩余 DOM 动画
 * 如 toast/lamp-pulse 均 <0.3s 瞬态，不影响）。
 *
 * 命令式状态变更（不经过 gsap 的路径，如 refreshUI 重建棋盘）由调用方手动 renderNow() 补帧。
 */

import gsap from 'gsap';
import type { Application } from 'pixi.js';

let app: Application | null = null;

/** 是否有活跃的 gsap tween/timeline（含嵌套 Pixi tween 的时间轴）。 */
function needsPixiRender(): boolean {
  for (const child of gsap.globalTimeline.getChildren(false)) {
    if (child.isActive()) return true;
  }
  return false;
}

export function initRenderLoop(a: Application): void {
  app = a;
  gsap.ticker.add(() => {
    if (needsPixiRender()) app!.renderer.render(app!.stage);
  });
}

export function renderNow(): void {
  if (app) app.renderer.render(app.stage);
}

// ── 分辨率运行时控制（设置面板"画质"开关）──────────────────────────
// localStorage 持久化玩家选择；main.ts 的 resolveResolution 会读取。
const RES_KEY = 'xq_resolution';
const RES_OPTIONS = [2, 1.5, 1];

export function getResolution(): number {
  return app ? app.renderer.resolution : 1;
}

/** 运行时切换分辨率并持久化。Pixi v8：set resolution + resize 重建 backing store。 */
export function setResolution(res: number): void {
  if (!app) return;
  app.renderer.resolution = res;
  app.renderer.resize(window.innerWidth, window.innerHeight);
  try { localStorage.setItem(RES_KEY, String(res)); } catch { /* ignore */ }
  renderNow();
}

export { RES_KEY, RES_OPTIONS };
