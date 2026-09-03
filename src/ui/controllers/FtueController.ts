/**
 * First-Time User Experience: guides new players through level 1.
 * Shows a welcome overlay, then contextual hints during gameplay.
 * State persisted in localStorage (ftue_done).
 */
import { t } from '../../i18n';
import { SaveManager } from '../../core/SaveManager';
import { showToast } from '../utils/domHelpers';

const FTUE_KEY = 'ftue_done';

export class FtueController {
  /** Returns true if FTUE should be shown (new player, not yet completed). */
  static isNeeded(): boolean {
    if (localStorage.getItem(FTUE_KEY)) return false;
    return SaveManager.getMaxLevel() === 0 && SaveManager.loadRecords().length === 0;
  }

  /** Mark FTUE as complete so it never re-triggers. */
  static markDone(): void {
    try { localStorage.setItem(FTUE_KEY, '1'); } catch { /* ignore */ }
  }

  /** Returns true if level 1 is being played and FTUE is still active. */
  static isActiveForLevel(level: number): boolean {
    return level === 1 && !localStorage.getItem(FTUE_KEY);
  }

  /**
   * Show the FTUE welcome overlay. Calls onStart(true, 1) to begin level 1,
   * or onSkip() to dismiss without playing.
   */
  showWelcome(onStart: (debug: boolean, level: number, isCampaign?: boolean) => void, onSkip: () => void): void {
    const existing = document.getElementById('ftue-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay ftue-overlay';
    overlay.id = 'ftue-overlay';
    overlay.innerHTML = `
      <div class="ftue-card">
        <img class="ftue-logo" src="${import.meta.env.BASE_URL}logos/logo.jpg" alt="${t('game.name')}" width="56" height="56">
        <h2 class="ftue-title">${t('ftue.welcome')}</h2>
        <div class="ftue-steps">
          <div class="ftue-step">${t('ftue.step1')}</div>
          <div class="ftue-step">${t('ftue.step2')}</div>
          <div class="ftue-step">${t('ftue.step3')}</div>
        </div>
        <button class="ftue-start-btn" id="ftue-start">${t('ftue.start')}</button>
        <button class="ftue-skip-btn" id="ftue-skip">${t('ftue.skip')}</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#ftue-start')!.addEventListener('click', () => {
      close();
      onStart(false, 1, true);
    });
    overlay.querySelector('#ftue-skip')!.addEventListener('click', () => {
      FtueController.markDone();
      close();
      onSkip();
    });
  }

  // ── In-game contextual hints (called by GameScene during level 1) ──

  private static hintShown = { select: false, place: false, elim: false, victory: false };

  static resetHints(): void {
    FtueController.hintShown = { select: false, place: false, elim: false, victory: false };
  }

  /** Show hint when entering SELECT_HAND phase for the first time. */
  static hintSelectHand(): void {
    if (FtueController.hintShown.select) return;
    FtueController.hintShown.select = true;
    showToast(t('ftue.hintSelect'), 3);
  }

  /** Show hint when entering PLACE_PIECE phase for the first time. */
  static hintPlacePiece(): void {
    if (FtueController.hintShown.place) return;
    FtueController.hintShown.place = true;
    showToast(t('ftue.hintPlace'), 3);
  }

  /** Show hint after the first enemy elimination. */
  static hintFirstElimination(): void {
    if (FtueController.hintShown.elim) return;
    FtueController.hintShown.elim = true;
    showToast(t('ftue.hintElim'), 3);
  }

  /** Show hint on first victory, then mark FTUE done. */
  static hintVictory(): void {
    if (FtueController.hintShown.victory) return;
    FtueController.hintShown.victory = true;
    FtueController.markDone();
    showToast(t('ftue.hintVictory'), 4);
  }
}
