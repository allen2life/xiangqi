/**
 * Victory/Defeat settlement controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { BONUS_NAMES } from '../utils/inventory';
import { SEAL_TIERS } from '../sealDefs';
import { ITEM_DEFS } from '../../config';
import { engineBridge } from '../../wasm/EngineBridge';
import { itemName } from '../utils/pieceIcons';
import { showToast } from '../utils/domHelpers';
import type { DomUIContext } from '../DomUIContext';
import type { SettlementData } from '../UIBridge';

// ── 宝箱三选一奖励配置 ──
type ChestReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'item'; itemId: string; qty: number }
  | { kind: 'soul'; qty: number }
  | { kind: 'multiplier'; value: number; bonusGold: number };

const CHEST_ITEM_POOL = ['undo', 'redraw', 'unseal', 'provision_wagon'];

function rollChestReward(level: number, combatScore: number): ChestReward {
  const r = Math.random();
  if (r < 0.05) {
    // 5% 概率：战斗积分 ×2（额外发放等额金币）
    return { kind: 'multiplier', value: 2, bonusGold: combatScore };
  } else if (r < 0.50) {
    // 金币：50 + level*10，封顶 200
    return { kind: 'gold', amount: Math.min(200, 50 + level * 10) };
  } else if (r < 0.85) {
    // 道具：随机消耗品 ×1
    return { kind: 'item', itemId: CHEST_ITEM_POOL[Math.floor(Math.random() * CHEST_ITEM_POOL.length)], qty: 1 };
  }
  // 龙魂碎片 ×1-2
  return { kind: 'soul', qty: 1 + Math.floor(Math.random() * 2) };
}

function rewardLabel(r: ChestReward): string {
  if (r.kind === 'gold') return t('chest.rewardGold', { amount: r.amount });
  if (r.kind === 'soul') return t('chest.rewardSoul', { qty: r.qty });
  if (r.kind === 'multiplier') return t('chest.rewardMultiplier', { mult: r.value, gold: r.bonusGold });
  const def = ITEM_DEFS[r.itemId];
  return t('chest.rewardItem', { name: def ? itemName(def) : r.itemId, qty: r.qty });
}

function deliverReward(r: ChestReward): void {
  if (r.kind === 'gold') {
    engineBridge.grantGold(r.amount);
  } else if (r.kind === 'soul') {
    engineBridge.addPlatformItem('loong_soul', r.qty);
  } else if (r.kind === 'multiplier') {
    engineBridge.grantGold(r.bonusGold);
  } else {
    engineBridge.addPlatformItem(r.itemId, r.qty);
  }
  engineBridge.platformSave();
  showToast(rewardLabel(r), 2.5);
}

/** 星奖励阶梯（与引擎 ScoreConst::STAR_SCORES 一致） */
const STAR_REWARDS = [500, 1000, 2000, 4000, 5000];

export class SettlementController {
  constructor(private ctx: DomUIContext) {}

  private clearBonusTitles(): void {
    document.querySelectorAll('.bonus-title-overlay').forEach(el => el.remove());
  }

  showVictory(data: SettlementData, onNext: () => void, onRestart: () => void, onMenu: () => void, replayMode?: boolean): void {
    this.clearBonusTitles();
    if (!replayMode) this.ctx.state.lastSettlementData = data;
    const el = document.getElementById('ui-victory')!;

    const makeRow = (l: string, v: string, cls: string) =>
      `<div class="settlement-row"><span>${l}</span><span class="val ${cls}">${v}</span></div>`;

    // ── Combat section: base scores + combo + combat perks ──
    const combatBonuses = data.bonusScores.filter(
      b => b.name !== 'bonus_stars' && !b.name.startsWith('victory_'),
    );
    let combatTotal = data.piecesScore + data.cityScore + data.statueScore + data.allyLostPenalty + data.comboGain;
    for (const b of combatBonuses) combatTotal += b.score;

    let combatHtml = '';
    if (data.piecesScore > 0) combatHtml += makeRow(t('settlement.pieces'), `+${data.piecesScore}`, 'green');
    if (data.cityScore > 0) combatHtml += makeRow(t('settlement.city'), `+${data.cityScore}`, 'green');
    if (data.statueScore > 0) combatHtml += makeRow(t('settlement.statue'), `+${data.statueScore}`, 'green');
    if (data.allyLostPenalty < 0) combatHtml += makeRow(t('settlement.friendlyFire'), `${data.allyLostPenalty}`, 'red');
    else combatHtml += makeRow(t('settlement.noLoss'), '0', 'green');
    if (data.comboGain > 0) combatHtml += makeRow(t('settlement.combo'), `+${data.comboGain}`, 'green');
    for (const b of combatBonuses) {
      combatHtml += makeRow(BONUS_NAMES[b.name] || b.name, `+${b.score}`, 'orange');
    }

    // ── Star section ──
    const starBonus = data.starBonus;

    // ── Multiplier row: only shown when ≠ 1.0 (reserved for lucky wheel etc.) ──
    let multHtml = '';
    if (Math.abs(data.levelMultiplier - 1.0) > 0.001) {
      multHtml = `<div class="settlement-row"><span>${t('settlement.multiplier')}</span><span class="val orange">× ${data.levelMultiplier.toFixed(1)}</span></div>`;
    }

    // ── Star rating: merged into condition cells (★ replaces ✓/✗) ──
    const STAR_NAMES = [t('star.name1'), t('star.name2'), t('star.name3'), t('star.name4'), t('star.name5')];
    const STAR_CONDS = [t('star.cond1'), t('star.cond2'), t('star.cond3'), t('star.cond4'), t('star.cond5')];
    const fullStars = data.totalStars === 5;
    // Each cell pops in with its star; stagger 180ms per star, starting after card entrance
    const starConditions = data.stars.map((s, i) => {
      const delay = (0.3 + i * 0.18).toFixed(2);
      return `<div class="star-cond-cell ${s ? 'achieved' : 'missed'}" data-star-index="${i}" style="animation-delay:${delay}s" title="${STAR_NAMES[i]} · ${STAR_CONDS[i]}">
        <span class="star-cond-star ${s ? 'star-filled' : 'star-empty'}" style="animation-delay:${delay}s">★</span>
        <span class="star-cond-name">${STAR_NAMES[i]}</span>
        <span class="star-cond-desc">${STAR_CONDS[i]}</span>
      </div>`;
    }).join('');

    const cardCls = `victory-card victory-card-enter${fullStars ? ' victory-card-fullstars' : ''}`;
    el.innerHTML = `
      <div class="${cardCls}">
        ${fullStars ? '<div class="star-rays" aria-hidden="true"></div><div class="star-burst" aria-hidden="true"></div>' : ''}
        <div class="victory-header stagger-item" style="animation-delay:0.05s">
          <div class="victory-level-tag">${t('victory.levelTag', { level: data.level })}</div>
          <div class="victory-score-block">
            <span class="victory-score-label">${t('settlement.levelScore')}</span>
            <span class="victory-title victory-score">${data.finalScore}</span>
          </div>
        </div>
        <div class="star-conditions stagger-item" style="animation-delay:0.12s">${starConditions}</div>
        <div class="settlement-card stagger-item" style="animation-delay:0.2s">
          <div class="section-title">${t('settlement.combat')}</div>${combatHtml}
          <div class="settlement-row total"><span>${t('settlement.combatTotal')}</span><span class="val green">${combatTotal}</span></div>
          <div class="section-title section-title-spaced">${t('settlement.starSection')}</div>
          <div class="settlement-row"><span>${t('bonusStars')}</span><span class="val orange">+${starBonus}</span></div>
          <div class="section-title section-title-spaced">${t('settlement.final')}</div>
          ${multHtml}
          <div class="settlement-row final"><span>${t('settlement.levelScore')}</span><span class="val gold">${data.finalScore}</span></div>
          <div class="settlement-row total-score"><span>${t('settlement.totalScore')}</span><span class="val gold">${data.totalScore}</span></div>
        </div>
        <div class="victory-btns stagger-item" style="animation-delay:0.28s">
          ${replayMode
            ? `<button class="victory-btn-text replay-again" id="btn-replay-again">${t('replay.again')}</button>
               <button class="victory-btn-text challenge-this" id="btn-challenge-this">${t('replay.challenge')}</button>
               <button class="victory-btn-icon menu" id="btn-menu" title="${t('btn.menu')}">⌂</button>`
            : `<button class="victory-btn-icon retry" id="btn-retry" title="${t('btn.retry')}">↻</button>
               <button class="victory-btn-text next" id="btn-next">${t('btn.nextLevel')}</button>
               <button class="victory-btn-icon menu" id="btn-menu" title="${t('btn.menu')}">⌂</button>`
          }
        </div>
        ${replayMode ? '' : `<div class="victory-publish-row stagger-item" style="animation-delay:0.34s">
          <button class="victory-btn-text share" id="btn-victory-share">${t('victory.btnShare')}</button>
          <button class="victory-btn-text rank" id="btn-victory-rank">${t('victory.btnRank')}</button>
          <button class="victory-btn-text publish" id="btn-victory-publish">${t('victory.btnPublish')}</button>
        </div>`}
        ${data.seal ? `<div class="seal-stamp seal-tier-${data.seal.tier}${data.seal.promoted ? ' promoted' : ''}" id="victory-seal" title="${t('seal.bookTitle')}"><img class="seal-img" src="icons/seal/seal_${SEAL_TIERS[data.seal.tier].id}.png" alt="${t('seal.tier.' + SEAL_TIERS[data.seal.tier].id + '.name')}"></div>` : ''}
      </div>`;
    el.classList.remove('hidden');
    if (data.seal) {
      const sealEl = document.getElementById('victory-seal');
      if (sealEl) {
        requestAnimationFrame(() => sealEl.classList.add('active'));
        sealEl.addEventListener('click', (e) => { e.stopPropagation(); this.ctx.host.onSealBookOpen?.(); });
      }
    }
    el.querySelectorAll('.star-cond-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number((cell as HTMLElement).dataset.starIndex);
        if (Number.isInteger(idx)) this.showStarDetail(idx, data);
      });
    });
    document.getElementById('btn-menu')!.addEventListener('click', () => { this.hideVictory(); onMenu(); });
    if (replayMode) {
      document.getElementById('btn-replay-again')!.addEventListener('click', () => { this.hideVictory(); onNext(); });
      document.getElementById('btn-challenge-this')!.addEventListener('click', () => { this.hideVictory(); onRestart(); });
    } else {
      document.getElementById('btn-next')!.addEventListener('click', () => { this.hideVictory(); onNext(); });
      document.getElementById('btn-retry')!.addEventListener('click', () => { this.hideVictory(); onRestart(); });
      document.getElementById('btn-victory-publish')!.addEventListener('click', () => {
        if (data.level <= 3) {
          this.ctx.host.onShowPublishHint?.();
        } else {
          this.ctx.host.onShowPublishPanel?.();
        }
      });
      document.getElementById('btn-victory-rank')!.addEventListener('click', () => { this.hideVictory(); this.ctx.host.onLeaderboardCurrentLevel?.(); });
      document.getElementById('btn-victory-share')!.addEventListener('click', () => { this.ctx.host.onShareReplay?.(); });
    }
  }

  showDefeat(onRestart: () => void, onMenu: () => void, reason?: string): void {
    this.clearBonusTitles();
    const el = document.getElementById('ui-victory')!;
    const reasonText = reason || t('defeat.reasonDefault');
    el.innerHTML = `
      <div class="victory-card victory-card-defeat victory-card-enter">
        <div class="defeat-red-vignette" aria-hidden="true"></div>
        <div class="defeat-title stagger-item-defeat" style="animation-delay:0.05s">${t('defeat.title')}</div>
        <div class="defeat-reason stagger-item-defeat" style="animation-delay:0.15s">${reasonText}</div>
        <div class="victory-btns victory-btns-spaced stagger-item-defeat" style="animation-delay:0.25s">
          <button class="victory-btn-icon retry retry-pulse" id="btn-retry-d" title="${t('defeat.retryHint')}">↻</button>
          <button class="victory-btn-icon rank" id="btn-defeat-rank" title="${t('btn.levelRank')}">📊</button>
          <button class="victory-btn-icon menu" id="btn-menu-d" title="${t('btn.menu')}">⌂</button>
        </div>
      </div>`;
    el.classList.remove('hidden');
    document.getElementById('btn-retry-d')!.addEventListener('click', () => { this.hideVictory(); onRestart(); });
    document.getElementById('btn-menu-d')!.addEventListener('click', () => { this.hideVictory(); onMenu(); });
    document.getElementById('btn-defeat-rank')!.addEventListener('click', () => { this.hideVictory(); this.ctx.host.onLeaderboardCurrentLevel?.(); });
  }

  /** 宝箱三选一：胜利后弹出 3 个宝箱，玩家选 1 个获得随机奖励 */
  showTreasureChest(level: number, combatScore: number, onClose: () => void): void {
    const existing = document.getElementById('chest-overlay');
    if (existing) existing.remove();

    const rewards: ChestReward[] = [
      rollChestReward(level, combatScore),
      rollChestReward(level, combatScore),
      rollChestReward(level, combatScore),
    ];

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay chest-overlay';
    overlay.id = 'chest-overlay';
    overlay.innerHTML = `
      <div class="chest-card">
        <div class="chest-title">${t('chest.title')}</div>
        <div class="chest-subtitle">${t('chest.subtitle')}</div>
        <div class="chest-row">
          ${rewards.map((_, i) => `<button class="chest-box" type="button" data-chest-index="${i}" aria-label="${t('chest.open')} ${i + 1}"><span class="chest-icon">📦</span></button>`).join('')}
        </div>
        <div class="chest-reveal-area" id="chest-reveal-area"></div>
        <button class="chest-skip" id="chest-skip">${t('chest.skip')}</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); onClose(); };

    overlay.querySelector('#chest-skip')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelectorAll('.chest-box').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number((el as HTMLElement).dataset.chestIndex);
        const reward = rewards[idx];
        const openedBox = el as HTMLButtonElement;

        // Phase 1: 摇晃动画
        openedBox.classList.add('shaking');
        openedBox.disabled = true;

        // Phase 2: 延迟后揭晓（仪式感）
        setTimeout(() => {
          deliverReward(reward);

          // 揭晓所有宝箱
          overlay.querySelectorAll('.chest-box').forEach((box, i) => {
            const b = box as HTMLButtonElement;
            b.disabled = true;
            b.classList.remove('shaking');
            b.classList.add(i === idx ? 'opened' : 'revealed');
            const icon = rewards[i].kind === 'multiplier' ? '✨' : i === idx ? '🎁' : '📦';
            b.innerHTML = `<span class="chest-icon">${icon}</span><span class="chest-reward-text">${rewardLabel(rewards[i])}</span>`;
          });

          // 大字弹跳展示中奖奖励
          const revealArea = overlay.querySelector('#chest-reveal-area') as HTMLElement;
          if (revealArea) {
            const isBig = reward.kind === 'multiplier';
            revealArea.innerHTML = `<div class="chest-reveal-text${isBig ? ' chest-reveal-big' : ''}">${rewardLabel(reward)}</div>`;
          }

          // Phase 3: 爆裂动效（500ms）结束后，选中箱子放大 1.5× 突出
          setTimeout(() => {
            openedBox.classList.add('highlighted');
          }, 500);

          const skipBtn = overlay.querySelector('.chest-skip') as HTMLButtonElement;
          skipBtn.textContent = t('chest.continue');
        }, 600);
      });
    });
  }

  /** 点击星星块：展示该星的获得状态、条件与本局实际达成数据 */
  private showStarDetail(index: number, data: SettlementData): void {
    document.getElementById('star-detail-overlay')?.remove();
    const achieved = data.stars[index] ?? false;
    const name = t(`star.name${index + 1}`);
    const cond = t(`star.cond${index + 1}`);
    let valueRow = '';
    if (index === 1) {
      valueRow = `<div class="star-detail-value">${t('star.curWagon', { cur: data.wagonCount })}</div>`;
    } else if (index === 2) {
      // 与引擎 finalize_result 口径一致：排除 victory_ 与 bonus_stars
      const combatCount = data.bonusScores.filter(b => !b.name.startsWith('victory_') && b.name !== 'bonus_stars').length;
      valueRow = `<div class="star-detail-value">${t('star.curBonus', { cur: combatCount, need: 5 })}</div>`; // 阈值与引擎 COMBO_BONUS_THRESHOLD 一致
    } else if (index === 4) {
      valueRow = `<div class="star-detail-value">${t('star.curKills', { cur: data.maxKillsPerStep, need: 8 })}</div>`; // 阈值与引擎 MASS_KILL_THRESHOLD 一致
    }

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay star-detail-overlay';
    overlay.id = 'star-detail-overlay';
    overlay.innerHTML = `
      <div class="star-detail-card ${achieved ? 'achieved' : 'missed'}">
        <div class="star-detail-title">${achieved ? '★' : '☆'} ${name}</div>
        <div class="star-detail-status ${achieved ? 'earned' : 'missed'}">${achieved ? t('star.earned') : t('star.missed')}</div>
        <div class="star-detail-cond">${cond}</div>
        <div class="star-detail-reward">${t('star.reward', { score: STAR_REWARDS[index] })}</div>
        ${valueRow}
        <button class="star-detail-close" id="btn-star-detail-close">${t('publish.done')}</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-star-detail-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  hideVictory(): void {
    document.getElementById('ui-victory')!.classList.add('hidden');
    document.getElementById('star-detail-overlay')?.remove();
  }
}
