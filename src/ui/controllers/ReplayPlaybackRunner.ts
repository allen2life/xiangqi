import { t } from '../../i18n';
import type { XqbrRecord } from './ReplayController';

export interface ReplayPlaybackHost {
  onPlace: (wasmCode: number, col: number, row: number) => void;
  onUndo: () => void;
  onSkip: () => void;
  onConfirm: () => void;
  onUseItem: (code: number) => void;
  onComplete: () => void;
  onClose: () => void;
  isAnimating: () => boolean;
  isGameOver: () => boolean;
  showToast: (msg: string, duration?: number) => void;
}

/**
 * Manages automated playback, step-by-step stepping, playback speed,
 * and HUD overlay controls for game replays.
 */
export class ReplayPlaybackRunner {
  private record: XqbrRecord | null = null;
  private actionIndex: number = 0;
  private isPlaying: boolean = false;
  private speed: number = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private host: ReplayPlaybackHost;

  constructor(host: ReplayPlaybackHost) {
    this.host = host;
  }

  get isReplay(): boolean {
    return this.record !== null;
  }

  get currentRecord(): XqbrRecord | null {
    return this.record;
  }

  get currentActionIndex(): number {
    return this.actionIndex;
  }

  get running(): boolean {
    return this.isPlaying;
  }

  get currentSpeed(): number {
    return this.speed;
  }

  start(record: XqbrRecord): void {
    this.record = record;
    this.actionIndex = 0;
    this.isPlaying = false;
    this.speed = 1;
    this.showControls();
    this.play();
  }

  step(): void {
    if (!this.record || this.actionIndex >= this.record.actions.length) {
      this.pause();
      this.host.showToast(t('replay.done'), 3);
      this.host.onComplete();
      return;
    }
    const action = this.record.actions[this.actionIndex++];
    switch (action.type) {
      case 1: // PLACE
        this.host.onPlace(action.code, action.arg0, action.arg1);
        break;
      case 2: // UNDO_PLACEMENT
        this.host.onUndo();
        break;
      case 3: // SKIP
        this.host.onSkip();
        break;
      case 4: // CONFIRM
        this.host.onConfirm();
        break;
      case 8: // USE_ITEM
        this.host.onUseItem(action.code);
        break;
      default:
        break;
    }
    this.updateControls();
  }

  play(): void {
    if (!this.record) return;
    const record = this.record;
    this.isPlaying = true;
    this.updateControls();

    const tick = () => {
      if (!this.isPlaying || !this.record) return;
      if (this.host.isAnimating()) {
        this.timer = setTimeout(tick, 200 / this.speed);
        return;
      }
      if (this.host.isGameOver()) {
        this.pause();
        return;
      }
      this.step();
      if (this.isPlaying && this.actionIndex < record.actions.length) {
        const lastAction = record.actions[this.actionIndex - 1];
        const delay = lastAction?.type === 4 ? 1000 / this.speed : 800 / this.speed;
        this.timer = setTimeout(tick, delay);
      }
    };
    tick();
  }

  pause(): void {
    this.isPlaying = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.updateControls();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.updateControls();
  }

  private removeControlsDom(): void {
    if (typeof document === 'undefined') return;
    const panel = document.getElementById('replay-controls');
    if (panel) {
      const handler = (panel as any)._outsideHandler as ((e: MouseEvent) => void) | undefined;
      if (handler) document.removeEventListener('click', handler);
      panel.remove();
    }
    document.getElementById('rc-trigger')?.remove();
    const gear = document.getElementById('gear-btn');
    if (gear) gear.style.display = '';
  }

  showControls(): void {
    this.removeControlsDom();
    if (typeof document === 'undefined') return;

    const gearBtn = document.getElementById('gear-btn');
    if (gearBtn) {
      gearBtn.style.display = 'none';
      const trigger = document.createElement('button');
      trigger.id = 'rc-trigger';
      trigger.className = 'rc-trigger';
      trigger.type = 'button';
      gearBtn.parentNode!.insertBefore(trigger, gearBtn);
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('replay-controls')?.classList.toggle('hidden');
        this.updateControls();
      });
    }

    const panel = document.createElement('div');
    panel.id = 'replay-controls';
    panel.className = 'rc-panel hidden';
    panel.innerHTML = `
      <button class="rc-btn rc-play-pause" id="rc-play-pause">${t('replay.play')}</button>
      <div class="rc-speed-group">
        <button class="rc-btn rc-speed" data-speed="0.5">0.5×</button>
        <button class="rc-btn rc-speed" data-speed="1">1×</button>
        <button class="rc-btn rc-speed" data-speed="2">2×</button>
      </div>
      <button class="rc-btn rc-close" id="rc-close">✕</button>`;
    document.body.appendChild(panel);

    panel.querySelector('#rc-play-pause')!.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isPlaying) this.pause(); else this.play();
      panel.classList.add('hidden');
    });

    panel.querySelectorAll('.rc-speed').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setSpeed(parseFloat((btn as HTMLElement).dataset.speed!));
        panel.classList.add('hidden');
      });
    });

    panel.querySelector('#rc-close')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideControls();
      this.host.onClose();
    });

    const onOutsideClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target && !panel.contains(target) && target.id !== 'rc-trigger') {
        panel.classList.add('hidden');
      }
    };
    document.addEventListener('click', onOutsideClick);
    (panel as any)._outsideHandler = onOutsideClick;

    this.updateControls();
  }

  updateControls(): void {
    if (typeof document === 'undefined') return;
    const trigger = document.getElementById('rc-trigger');
    if (!trigger) return;
    trigger.textContent = `${this.isPlaying ? '⏸' : '▶'}${this.speed}×`;
    const panel = document.getElementById('replay-controls');
    if (panel) {
      const playPauseBtn = panel.querySelector('#rc-play-pause') as HTMLButtonElement;
      if (playPauseBtn) playPauseBtn.textContent = this.isPlaying ? t('replay.pause') : t('replay.play');
      panel.querySelectorAll('.rc-speed').forEach((btn) => {
        const spd = parseFloat((btn as HTMLElement).dataset.speed!);
        (btn as HTMLElement).classList.toggle('active', Math.abs(spd - this.speed) < 0.01);
      });
    }
  }

  hideControls(): void {
    this.pause();
    this.record = null;
    this.removeControlsDom();
  }

  destroy(): void {
    this.hideControls();
  }
}
