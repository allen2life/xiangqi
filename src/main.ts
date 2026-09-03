import { Application, Sprite } from 'pixi.js';
import { GameScene } from './scenes/GameScene';
import { SaveManager } from './core/SaveManager';
import { createGradientTexture } from './utils/gradient';
import { CONFIG } from './config';
import { LoadingCoordinator, createOnceGuard } from './loading/LoadingCoordinator';
import { StartupLoaderView } from './loading/StartupLoaderView';
import { createStartupTasks, type StartupResources } from './loading/startupTasks';
import './ui/index.css';
import './ui/startup.css';
import { initVersionWatermark } from './utils/versionWatermark';
import { initRenderLoop, renderNow, RES_KEY } from './utils/renderLoop';

void start();

async function start(): Promise<void> {
  persistInviteCode();

  const resources = {} as StartupResources;
  const loader = new StartupLoaderView();
  const coordinator = new LoadingCoordinator(
    createStartupTasks(initializePixi, resources),
    (state) => loader.render(state),
  );
  const claimMount = createOnceGuard();
  loader.render(coordinator.snapshot);
  loader.onRetry(() => { void runStartup(coordinator, loader, resources, claimMount); });
  await runStartup(coordinator, loader, resources, claimMount);
}

async function runStartup(
  coordinator: LoadingCoordinator,
  loader: StartupLoaderView,
  resources: StartupResources,
  claimMount: () => boolean,
): Promise<void> {
  const state = coordinator.snapshot.tasks.some((task) => task.status === 'failed')
    ? await coordinator.retryFailed()
    : await coordinator.run();
  if (!state.canContinue || !claimMount()) return;

  await loader.dismiss();
  mountGame(resources.app);
}

function persistInviteCode(): void {
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('xq');
  if (!inviteCode) return;

  SaveManager.setInviteCode(inviteCode);
  const url = new URL(window.location.href);
  url.searchParams.delete('xq');
  window.history.replaceState({}, '', url.toString());
}

/** 移动端检测：UA 含手机/平板，或触屏 + 窄边。 */
function detectMobile(): boolean {
  const ua = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const touch = 'ontouchstart' in window && Math.min(window.innerWidth, window.innerHeight) < 768;
  return ua || touch;
}

/** 计算渲染分辨率：?res=N 强制覆盖（测试用）；否则读 localStorage 玩家选择；否则移动端 cap 1.5，桌面 cap 2。 */
function resolveResolution(isMobile: boolean): number {
  const deviceDpr = window.devicePixelRatio || 1;
  const clamp = (v: number) => (!Number.isNaN(v) && v >= 0.5 && v <= 3 ? v : NaN);
  // 1. URL ?res=N（测试覆盖，最高优先）
  const resParam = new URLSearchParams(location.search).get('res');
  if (resParam) {
    const v = clamp(parseFloat(resParam));
    if (!Number.isNaN(v)) return v;
  }
  // 2. localStorage 玩家选择（设置面板"画质"持久化）
  try {
    const stored = localStorage.getItem(RES_KEY);
    if (stored) {
      const v = clamp(parseFloat(stored));
      if (!Number.isNaN(v)) return v;
    }
  } catch { /* ignore */ }
  // 3. 默认：移动端 cap 1.5 削减发热，桌面 cap 2 保锐度
  return Math.min(deviceDpr, isMobile ? 1.5 : 2);
}

async function initializePixi(): Promise<Application> {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    // 关闭默认 60fps 无条件重绘，渲染改由 gsap ticker 按需驱动（见 renderLoop.ts）
    autoStart: false,
    // 移动端 cap 1.5 削减动画期 GPU 填充（发热优化）；桌面 cap 2 保锐度。
    // ?res=N 可强制覆盖，便于在任意设备测试不同分辨率。
    resolution: resolveResolution(detectMobile()),
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return app;
}

function mountGame(app: Application): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.canvas.id = 'pixi-canvas';
  app.canvas.style.width = `${w}px`;
  app.canvas.style.height = `${h}px`;
  document.body.appendChild(app.canvas);

  let bgSprite = createBackground(w, h);
  app.stage.addChildAt(bgSprite, 0);

  const game = new GameScene(app);
  game.start();
  renderNow(); // 首帧：背景渐变（棋盘由 init → refreshUI 补帧）

  initRenderLoop(app);

  initVersionWatermark();

  window.addEventListener('resize', () => {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    app.renderer.resize(cw, ch);
    app.canvas.style.width = `${cw}px`;
    app.canvas.style.height = `${ch}px`;

    bgSprite.removeFromParent();
    bgSprite.destroy();
    bgSprite = createBackground(cw, ch);
    app.stage.addChildAt(bgSprite, 0);
    renderNow();
  });
}

function createBackground(w: number, h: number): Sprite {
  const tex = createGradientTexture(w, h, [
    { offset: 0, color: CONFIG.GRADIENT.BG_TOP },
    { offset: 0.5, color: CONFIG.GRADIENT.BG_MID },
    { offset: 1, color: CONFIG.GRADIENT.BG_BOTTOM },
  ], 135);
  const sprite = Sprite.from(tex);
  sprite.width = w;
  sprite.height = h;
  return sprite;
}
