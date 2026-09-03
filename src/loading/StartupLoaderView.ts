import type { LoadingState } from './LoadingCoordinator';

export class StartupLoaderView {
  private readonly root: HTMLDivElement;
  private readonly progress: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly retryButton: HTMLButtonElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'startup-loader';
    this.root.innerHTML = `
      <div class="startup-loader__mist" aria-hidden="true"></div>
      <main class="startup-loader__panel" aria-live="polite">
        <img class="startup-loader__logo" src="${import.meta.env.BASE_URL}logos/logo.jpg" alt="ChessBlast">
        <p class="startup-loader__brand" id="startup-brand">LoongClan · ChessBlast</p>
        <div class="startup-loader__rule"><span>◆</span></div>
        <div class="startup-loader__track" role="progressbar" aria-label="Loading progress" aria-valuemin="0" aria-valuemax="100">
          <div class="startup-loader__progress"></div>
        </div>
        <div class="startup-loader__status" id="startup-status">Preparing board</div>
        <div class="startup-loader__detail"></div>
        <button class="startup-loader__retry" type="button" id="startup-retry" hidden>Retry</button>
      </main>`;
    this.progress = this.root.querySelector('.startup-loader__progress')!;
    this.status = this.root.querySelector('.startup-loader__status')!;
    this.detail = this.root.querySelector('.startup-loader__detail')!;
    this.retryButton = this.root.querySelector('.startup-loader__retry')!;
    document.body.appendChild(this.root);
  }

  onRetry(handler: () => void): void {
    this.retryButton.addEventListener('click', handler);
  }

  render(state: LoadingState): void {
    const percent = Math.round(state.progress * 100);
    this.progress.style.width = `${percent}%`;
    this.root.querySelector<HTMLElement>('[role="progressbar"]')?.setAttribute('aria-valuenow', String(percent));

    const active = state.tasks.find((task) => task.status === 'running');
    this.status.textContent = active ? active.label : `Loading ${percent}%`;
    this.retryButton.hidden = state.canContinue || !state.canRetry;
    this.retryButton.disabled = state.running;

    if (state.requiredFailures.length > 0) {
      this.status.textContent = 'Failed to start';
      this.detail.textContent = state.requiredFailures.map((task) => `${task.label}: ${task.error}`).join('; ');
    } else if (state.optionalFailures.length > 0 && state.canContinue) {
      this.detail.textContent = 'Audio unavailable, continuing in silent mode';
    } else {
      this.detail.textContent = '';
    }
  }

  async dismiss(): Promise<void> {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      this.root.remove();
      return;
    }
    this.root.classList.add('startup-loader--leaving');
    await new Promise((resolve) => setTimeout(resolve, 320));
    this.root.remove();
  }
}
