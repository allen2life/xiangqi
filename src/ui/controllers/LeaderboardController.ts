/**
 * Leaderboard controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { SaveManager } from '../../core/SaveManager';
import { showToast } from '../utils/domHelpers';
import type { DomUIContext } from '../DomUIContext';
import type { RankDisplayItem, RankPersonalInfo } from '../UIBridge';

export class LeaderboardController {
  constructor(private ctx: DomUIContext) {}

  showLeaderboard(entries: RankDisplayItem[], personalRank: RankPersonalInfo | null, nextSortAt: number,
    currentTab: 'total' | 'level', currentLevel: number, gameType: string, period: string, loading: boolean): void {
    const existing = document.getElementById('lb-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay lb-overlay';
    overlay.id = 'lb-overlay';

    const myHash = SaveManager.getHash();
    const nextSortStr = nextSortAt > Date.now()
      ? t('lb.refreshIn', { sec: Math.ceil((nextSortAt - Date.now()) / 1000) })
      : '';

    let html = `<div class="lb-card">
      <div class="lb-content"><div class="lb-header">
        <h2 class="lb-title">${t('lb.title')}</h2>
        <button class="lb-publish-btn" id="btn-lb-publish" title="${t('btn.publish')}">📤</button>
      </div>
      <div class="lb-tabs">
        <button class="lb-tab${currentTab === 'total' ? ' active' : ''}" id="btn-lb-tab-total">${t('lb.tabTotal')}</button>
        <button class="lb-tab${currentTab === 'level' ? ' active' : ''}" id="btn-lb-tab-level">${t('lb.tabLevel')}</button>
      </div>
      <div class="lb-filter-row">
        <select class="lb-filter-select" id="lb-filter-gametype">
          <option value="main"${gameType === 'main' ? ' selected' : ''}>${t('lb.filterMain')}</option>
        </select>
        <select class="lb-filter-select" id="lb-filter-period">
          <option value="total"${period === 'total' ? ' selected' : ''}>${t('lb.filterTotal')}</option>
          <option value="week"${period === 'week' ? ' selected' : ''}>${t('lb.filterWeek')}</option>
          <option value="month"${period === 'month' ? ' selected' : ''}>${t('lb.filterMonth')}</option>
        </select>
        <input class="lb-level-input${currentTab === 'level' ? '' : ' hidden'}" id="lb-level-input" type="number" min="1" max="999" value="${currentLevel}" placeholder="${t('lb.filterMain')}">
        <button class="lb-level-btn${currentTab === 'level' ? '' : ' hidden'}" id="btn-lb-level-go">Go</button>
      </div>`;

    html += '<div class="lb-list">';
    if (loading) {
      // 骨架屏：用占位行替代纯文字呼吸，慢网下提供结构化反馈
      html += `<div class="sr-only" aria-live="polite">${t('lb.loading')}</div>`;
      html += '<div class="lb-skeleton-list">';
      for (let i = 0; i < 7; i++) {
        html += '<div class="lb-skeleton-row">'
          + '<span class="lb-sk lb-sk-pos"></span>'
          + '<span class="lb-sk lb-sk-name"></span>'
          + '<span class="lb-sk lb-sk-score"></span>'
          + '<span class="lb-sk lb-sk-btn"></span>'
          + '</div>';
      }
      html += '</div>';
    } else if (entries.length === 0) {
      html += `<div class="lb-empty">${t('lb.empty')}</div>`;
    } else {
      html += '<table class="cs-rank-table"><thead><tr><th>#</th><th>Name</th><th>Score</th><th></th></tr></thead><tbody>';
      entries.forEach(entry => {
        const isMe = entry.userHash === myHash;
        const cls = (entry.rank <= 3 ? ` rank-top${entry.rank}` : '') + (isMe ? ' rank-me' : '');
        const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : '';
        const canChallenge = entry.defenseLevel > 0;
        const challengeBtn = canChallenge
          ? `<button class="lb-challenge-btn" data-hash="${this.escapeAttr(entry.userHash)}" title="${t('lb.challenge')}">⚔</button>`
          : `<span class="lb-no-challenge" title="${t('lb.noChallenge')}">—</span>`;
        const starsArr = Array.from({ length: 5 }, (_, i) => (entry.stars & (1 << i)) ? '★' : '☆');
        const starsHtml = '<span class="lb-stars' + (entry.stars === 0 ? ' lb-stars-empty' : '') + '">'
          + starsArr.join('') + '</span> ';
        html += `<tr class="cs-rank-row${cls}">
          <td class="cs-rank-pos">${medal || entry.rank}</td>
          <td>${this.escapeHtml(entry.nickname || t('lb.anonymous'))}${isMe ? ` <span class="rank-me-tag">${t('lb.me')}</span>` : ''}</td>
          <td>${starsHtml}${entry.score}</td>
          <td>${challengeBtn}</td>
        </tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    if (personalRank) {
      html += `<div class="lb-my-rank">${t('lb.myRank', { rank: personalRank.rank, score: personalRank.score })}</div>`;
    }
    if (nextSortStr) {
      html += `<div class="lb-next-sort">${nextSortStr}</div>`;
    }
    html += `<button class="lb-close-btn" id="btn-lb-close">${t('lb.close')}</button></div></div>`;
    overlay.innerHTML = html;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.hideLeaderboard(); });
    overlay.querySelector('#btn-lb-close')!.addEventListener('click', () => this.hideLeaderboard());
    overlay.querySelector('#btn-lb-publish')!.addEventListener('click', () => { this.ctx.host.onLeaderboardPublish?.(); this.hideLeaderboard(); });
    overlay.querySelector('#btn-lb-tab-total')!.addEventListener('click', () => { this.ctx.host.onLeaderboardTabChange?.('total'); });
    overlay.querySelector('#btn-lb-tab-level')!.addEventListener('click', () => { this.ctx.host.onLeaderboardTabChange?.('level'); });

    const onFilter = () => {
      const gt = (overlay.querySelector('#lb-filter-gametype') as HTMLSelectElement).value;
      const pr = (overlay.querySelector('#lb-filter-period') as HTMLSelectElement).value;
      this.ctx.host.onLeaderboardFilterChange?.(gt, pr);
    };
    overlay.querySelector('#lb-filter-gametype')!.addEventListener('change', onFilter);
    overlay.querySelector('#lb-filter-period')!.addEventListener('change', onFilter);
    overlay.querySelector('#btn-lb-level-go')!.addEventListener('click', () => {
      const val = parseInt((overlay.querySelector('#lb-level-input') as HTMLInputElement).value);
      if (val > 0) this.ctx.host.onLeaderboardLevelChange?.(val);
    });
    const levelInput = overlay.querySelector('#lb-level-input') as HTMLInputElement;
    levelInput.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        const val = parseInt(levelInput.value);
        if (val > 0) this.ctx.host.onLeaderboardLevelChange?.(val);
      }
    });
    overlay.querySelectorAll('.lb-challenge-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const hash = (btn as HTMLElement).dataset.hash!;
        const level = currentTab === 'level' ? currentLevel : 0;
        this.ctx.host.onChallengePlayer?.(hash, level);
      });
    });
  }

  hideLeaderboard(): void {
    const el = document.getElementById('lb-overlay');
    if (el) el.remove();
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
