/**
 * Start menu + help modal + level select + endless ladder.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { SaveManager } from '../../core/SaveManager';
import { DailyController } from './DailyController';
import { FtueController } from './FtueController';
import { formatBuildLabel } from '../../utils/buildInfo';
import { SEAL_TIERS, getCurrentSealTier, getAuthoritativeStar3Wins } from '../sealDefs';
import { engineBridge } from '../../wasm/EngineBridge';
import type { DomUIContext } from '../DomUIContext';

export class StartMenuController {
  private debugRevealed = false;
  private titleClickCount = 0;
  private titleClickTimer: ReturnType<typeof setTimeout> | null = null;
  private daily = new DailyController();
  private ftue = new FtueController();

  constructor(private ctx: DomUIContext) {}

  showStartMenu(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void {
    // FTUE: first-time players see welcome overlay, auto-start level 1
    if (FtueController.isNeeded()) {
      this.ftue.showWelcome(onStart, () => { this.renderStartMenu(onStart); });
      return;
    }
    this.renderStartMenu(onStart);
  }

  private renderStartMenu(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void {
    const el = document.getElementById('ui-start-menu')!;
    const rules = [
      t('help.rule0'), t('help.rule1'), t('help.rule2'),
      t('help.rule3'), t('help.rule4'), t('help.rule5'),
    ];
    this.debugRevealed = false;
    this.titleClickCount = 0;

    // Profile & currencies state
    const nickname = SaveManager.getNickname() || t('lb.anonymous');
    const maxLevel = SaveManager.getMaxLevel();
    const currentChallenge = Math.max(maxLevel + 1, 1);
    const totalStars = Object.values(SaveManager.getAllLevelStars()).reduce((acc, s) => acc + s, 0);

    const star3Wins = getAuthoritativeStar3Wins();
    const currentSeal = getCurrentSealTier(star3Wins);
    const hasUnlockedSeal = star3Wins >= SEAL_TIERS[0].threshold;
    const sealName = hasUnlockedSeal ? t('seal.tier.' + currentSeal.id + '.name') : t('seal.tier.chushi.name');
    const sealIconSrc = hasUnlockedSeal
      ? `${import.meta.env.BASE_URL}icons/seal/seal_${currentSeal.id}.png`
      : `${import.meta.env.BASE_URL}icons/seal/seal_locked.png`;

    let gold = 0;
    let loongSouls = 0;
    try {
      gold = engineBridge.getPlatformGold();
      loongSouls = engineBridge.getPlatformItemCount('loong_soul');
    } catch {
      // Offline fallback / engine not ready in tests
    }

    const hasDailyNotice = this.daily.hasPendingNotification();

    el.innerHTML = `
      <div class="start-menu-card lobby-card">
        <!-- Top Profile & Currencies Bar -->
        <div class="lobby-profile-bar">
          <div class="lobby-profile-user" id="lobby-profile-user" role="button" tabindex="0" title="${t('seal.bookTitle')}">
            <div class="lobby-seal-avatar-wrap">
              <img class="lobby-seal-avatar" src="${sealIconSrc}" alt="${sealName}" onerror="this.src='${import.meta.env.BASE_URL}icons/seal/seal_locked.png'">
              <span class="lobby-seal-ring"></span>
            </div>
            <div class="lobby-user-meta">
              <div class="lobby-nickname">${nickname}</div>
              <div class="lobby-seal-tag">${sealName}</div>
            </div>
          </div>
          <div class="lobby-currencies">
            <div class="currency-pill gold" id="currency-gold" role="button" tabindex="0" title="${t('seal.rewardGold', { amount: '' }).trim()}">
              <span class="currency-icon">💰</span>
              <span class="currency-val">${gold.toLocaleString()}</span>
            </div>
            <div class="currency-pill soul" id="currency-soul" role="button" tabindex="0" title="${t('seal.rewardSoul', { amount: '' }).trim()}">
              <span class="currency-icon">🔮</span>
              <span class="currency-val">${loongSouls}</span>
            </div>
            <div class="currency-pill stars" title="${t('hud.stars')}">
              <span class="currency-icon">⭐</span>
              <span class="currency-val">${totalStars}</span>
            </div>
          </div>
        </div>

        <!-- Hero Battle Action Zone -->
        <div class="lobby-hero-zone">
          <div class="lobby-brand-row">
            <img class="start-menu-logo" id="start-logo" src="${import.meta.env.BASE_URL}logos/logo.jpg" alt="${t('game.name')}" width="52" height="52">
            <div class="lobby-brand-text">
              <h1 class="start-title" id="start-title">${t('game.name')}</h1>
              <p class="start-subtitle">${t('start.subtitle')}</p>
            </div>
          </div>

          <div class="lobby-hero-actions">
            <button class="lobby-hero-btn start-btn new-game" id="btn-new-game">
              <div class="hero-btn-content">
                <span class="hero-btn-icon">⚔️</span>
                <div class="hero-btn-text-group">
                  <span class="hero-btn-title">${t('start.btnNewGame')}</span>
                  <span class="hero-btn-badge">${t('start.btnChallengeLevel', { level: String(currentChallenge) })}</span>
                </div>
              </div>
              <span class="hero-btn-glow"></span>
            </button>

            <div class="lobby-sub-actions">
              <button class="lobby-sub-btn" id="btn-endless-ladder">
                <span class="sub-btn-icon">📜</span>
                <span class="sub-btn-text">${t('start.btnLadder')}</span>
              </button>
              <button class="lobby-sub-btn start-btn level-select" id="btn-level-select">
                <span class="sub-btn-icon">🗺️</span>
                <span class="sub-btn-text">${t('start.btnLevelSelect')}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 2x2 Utility Dock -->
        <div class="lobby-dock">
          <button class="dock-tile start-btn leaderboard" id="btn-leaderboard">
            <div class="dock-tile-icon">🏆</div>
            <div class="dock-tile-info">
              <div class="dock-tile-title">${t('start.dockLeaderboard')}</div>
              <div class="dock-tile-sub">${t('start.dockLeaderboardSub')}</div>
            </div>
          </button>
          <button class="dock-tile start-btn seal-book" id="btn-seal-book">
            <div class="dock-tile-icon">📜</div>
            <div class="dock-tile-info">
              <div class="dock-tile-title">${t('start.dockSeal')}</div>
              <div class="dock-tile-sub">${sealName}</div>
            </div>
          </button>
          <button class="dock-tile start-btn daily-tasks" id="btn-daily-tasks">
            <div class="dock-tile-icon">🎁</div>
            <div class="dock-tile-info">
              <div class="dock-tile-title">${t('start.dockDaily')}</div>
              <div class="dock-tile-sub">${hasDailyNotice ? t('daily.claim') : t('start.dockDailySub')}</div>
            </div>
            ${hasDailyNotice ? '<span class="dock-badge pulse"></span>' : ''}
          </button>
          <button class="dock-tile start-btn cloud-sync" id="btn-cloud-sync">
            <div class="dock-tile-icon">☁️</div>
            <div class="dock-tile-info">
              <div class="dock-tile-title">${t('start.btnCloudSync')}</div>
              <div class="dock-tile-sub">${t('start.dockSyncSub')}</div>
            </div>
          </button>
        </div>

        <div class="debug-toggle hidden" id="debug-toggle">
          <label><input type="checkbox" id="chk-debug"> ${t('start.debugMode')}</label>
        </div>

        <!-- Footer / Rules / Version -->
        <div class="lobby-footer">
          <button class="lobby-rules-btn" id="btn-rules">
            <span>📜</span> <span>${t('start.btnRules')}</span>
          </button>
          <div class="start-version">v${formatBuildLabel()}</div>
        </div>
      </div>
    `;
    el.classList.remove('hidden');

    // Easter egg: rapid click title 5 times to reveal debug mode
    document.getElementById('start-title')!.addEventListener('click', () => {
      this.titleClickCount++;
      if (this.titleClickTimer) clearTimeout(this.titleClickTimer);
      this.titleClickTimer = setTimeout(() => { this.titleClickCount = 0; }, 1000);
      if (this.titleClickCount >= 5) {
        this.titleClickCount = 0;
        this.debugRevealed = true;
        const debugToggleEl = document.getElementById('debug-toggle');
        if (debugToggleEl) debugToggleEl.classList.remove('hidden');
      }
    });

    const debug = () => {
      if (!this.debugRevealed) return false;
      return (document.getElementById('chk-debug') as HTMLInputElement)?.checked ?? false;
    };

    document.getElementById('btn-new-game')!.addEventListener('click', () => {
      onStart(debug(), currentChallenge, false);
    });
    document.getElementById('btn-endless-ladder')!.addEventListener('click', () => this.showEndlessLadder(onStart));
    document.getElementById('btn-level-select')!.addEventListener('click', () => this.showLevelSelect(onStart));
    document.getElementById('btn-cloud-sync')!.addEventListener('click', () => { this.ctx.host.onCloudSync?.(); });
    document.getElementById('btn-leaderboard')!.addEventListener('click', () => { this.ctx.host.onLeaderboard?.(); });
    document.getElementById('btn-seal-book')!.addEventListener('click', () => { this.ctx.host.onSealBookOpen?.(); });
    document.getElementById('lobby-profile-user')?.addEventListener('click', () => { this.ctx.host.onSealBookOpen?.(); });
    document.getElementById('currency-gold')?.addEventListener('click', () => { this.ctx.host.onBackpackOpen?.(); });
    document.getElementById('currency-soul')?.addEventListener('click', () => { this.ctx.host.onBackpackOpen?.(); });
    document.getElementById('btn-daily-tasks')!.addEventListener('click', () => { this.daily.showTaskPanel(); });

    const showHelp = () => this.showHelpModal(rules);
    document.getElementById('btn-rules')!.addEventListener('click', showHelp);
    document.getElementById('start-logo')!.addEventListener('click', showHelp);

    // 签到弹窗：进入主菜单时若未签到则延迟弹出
    setTimeout(() => { this.daily.showSignInIfPending(); }, 600);
  }

  hideStartMenu(): void {
    document.getElementById('ui-start-menu')!.classList.add('hidden');
  }

  private showLevelSelect(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void {
    const maxLevel = Math.max(SaveManager.getMaxLevel(), 1);
    const totalLevels = Math.min(maxLevel + 9, 60);
    const allStars = SaveManager.getAllLevelStars();
    const cols = 6;
    const rows = Math.ceil(totalLevels / cols);
    let gridHtml = '';
    for (let r = 0; r < rows; r++) {
      let rowHtml = '<div class="level-row">';
      for (let c = 0; c < cols; c++) {
        const level = r * cols + c + 1;
        if (level > totalLevels) break;
        const unlocked = level <= maxLevel + 1;
        const cls = unlocked ? 'level-cell' : 'level-cell locked';
        const starCount = allStars[level] ?? 0;
        const starHtml = starCount > 0
          ? `<span class="level-cell-stars">${'★'.repeat(starCount)}</span>`
          : '';
        rowHtml += `<button class="${cls}" data-level="${level}">${level}${starHtml}</button>`;
      }
      rowHtml += '</div>';
      gridHtml += rowHtml;
    }
    const el = document.getElementById('ui-start-menu')!;
    const existing = document.getElementById('level-select-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'level-select-overlay';
    overlay.className = 'ui-panel overlay level-select-overlay';
    overlay.innerHTML = `
      <div class="level-select-card lc-card lc-modal">
        <h3 class="level-select-title lc-title">${t('levelSelect.title')}</h3>
        <div class="level-grid lc-grid">${gridHtml}</div>
        <button class="start-btn lc-btn lc-btn-quiet level-close-btn" id="btn-level-close">${t('levelSelect.close')}</button>
      </div>
    `;
    el.appendChild(overlay);
    overlay.querySelectorAll('.level-cell:not(.locked)').forEach(btn => {
      btn.addEventListener('click', () => {
        const level = parseInt((btn as HTMLElement).dataset.level || '1', 10);
        overlay.remove();
        onStart(false, level, true);
      });
    });
    document.getElementById('btn-level-close')!.addEventListener('click', () => overlay.remove());
  }

  private showEndlessLadder(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void {
    const debug = () => {
      if (!this.debugRevealed) return false;
      return (document.getElementById('chk-debug') as HTMLInputElement)?.checked ?? false;
    };
    const maxLevel = SaveManager.getMaxLevel();
    const currentChallenge = maxLevel + 1;
    const previewLocked = 3;
    const totalToShow = currentChallenge + previewLocked;
    const allStars = SaveManager.getAllLevelStars();
    const records = SaveManager.loadRecords();

    const scoreMap: Record<number, number> = {};
    for (const r of records) {
      if (!scoreMap[r.level] || r.score > scoreMap[r.level]) {
        scoreMap[r.level] = r.score;
      }
    }

    let rowsHtml = '';
    for (let level = totalToShow; level >= 1; level--) {
      const isCurrent = level === currentChallenge;
      const isLocked = level > currentChallenge;
      const starCount = allStars[level] ?? 0;
      const bestScore = scoreMap[level];

      let cls = 'level-ladder-row';
      if (isLocked) cls += ' locked';
      else if (isCurrent) cls += ' current';
      else if (starCount > 0 || bestScore != null) cls += ' completed';

      const starHtml = starCount > 0
        ? `<span class="ll-stars">${'★'.repeat(starCount)}</span>`
        : '';

      let statusHtml: string;
      if (isLocked) {
        statusHtml = '<span class="ll-status">🔒</span>';
      } else if (isCurrent) {
        statusHtml = `<span class="ll-status">▶ ${t('levelLadder.challenge')}</span>`;
      } else {
        statusHtml = bestScore != null
          ? `<span class="ll-score">${bestScore} ${t('levelLadder.pts')}</span>`
          : `<span class="ll-score">${t('levelLadder.noScore')}</span>`;
      }

      const dataAttr = !isLocked ? ` data-level="${level}"` : '';
      rowsHtml += `<div class="${cls}"${dataAttr}><span class="ll-level">${level}</span>${starHtml}<span class="ll-filler"></span>${statusHtml}</div>`;
    }

    const el = document.getElementById('ui-start-menu')!;
    const existing = document.getElementById('endless-ladder-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'endless-ladder-overlay';
    overlay.className = 'ui-panel overlay level-select-overlay';
    overlay.innerHTML = `
      <div class="level-select-card lc-card lc-modal">
        <h3 class="level-select-title lc-title">${t('start.btnNewGame')}</h3>
        <div class="level-ladder lc-grid">${rowsHtml}</div>
        <button class="start-btn lc-btn lc-btn-quiet" id="btn-ladder-top">${t('levelLadder.scrollTop')}</button>
        <button class="start-btn lc-btn lc-btn-quiet level-close-btn" id="btn-ladder-close">${t('levelSelect.close')}</button>
      </div>
    `;
    el.appendChild(overlay);
    overlay.querySelectorAll('.level-ladder-row:not(.locked)').forEach(btn => {
      btn.addEventListener('click', () => {
        const level = parseInt((btn as HTMLElement).dataset.level || '1', 10);
        overlay.remove();
        onStart(debug(), level, false);
      });
    });
    document.getElementById('btn-ladder-close')!.addEventListener('click', () => overlay.remove());
    document.getElementById('btn-ladder-top')!.addEventListener('click', () => {
      const ladder = overlay.querySelector('.level-ladder')!;
      ladder.scrollTop = 0;
    });
  }

  private showHelpModal(rules: string[]): void {
    const existing = document.getElementById('help-modal');
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay help-modal-overlay';
    overlay.id = 'help-modal';
    overlay.innerHTML = `
      <div class="help-modal-card">
        <h3 class="help-modal-title">${t('help.title')}</h3>
        <ul class="help-modal-list">${rules.map(r => `<li>${r}</li>`).join('')}</ul>
        <button class="help-modal-close" id="btn-help-close">${t('help.close')}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('btn-help-close')!.addEventListener('click', () => this.hideHelpModal());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideHelpModal(); });
  }

  private hideHelpModal(): void {
    const el = document.getElementById('help-modal');
    if (el) el.remove();
  }
}
