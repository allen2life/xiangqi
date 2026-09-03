/**
 * 印谱 (Seal Book) controller — V1.0: 3星胜场驱动解锁 + 一次性奖励领取.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { SEAL_TIERS, getCurrentSealTier, getNextSealTier,
  sealGoldReward, sealSoulReward, getStar3Wins, getClaimedTiers, markTierClaimed } from '../sealDefs';
import { engineBridge } from '../../wasm/EngineBridge';
import { showToast } from '../utils/domHelpers';
import { walletGrant } from '../../cloud/api';
import { SaveManager } from '../../core/SaveManager';
import type { DomUIContext } from '../DomUIContext';

export class SealBookController {
  constructor(private ctx: DomUIContext) {}

  showSealBook(): void {
    const existing = document.getElementById('seal-book-overlay');
    if (existing) { existing.remove(); }

    const wins = getStar3Wins();
    const claimed = getClaimedTiers();
    const currentTier = getCurrentSealTier(wins);
    const nextTier = getNextSealTier(wins);

    let nextHint = '';
    if (nextTier) {
      const remaining = nextTier.threshold - wins;
      nextHint = `<div class="seal-next-hint">${t('seal.nextTier', { name: t('seal.tier.' + nextTier.id + '.name'), n: String(remaining) })}</div>`;
    } else {
      nextHint = `<div class="seal-next-hint seal-max">${t('seal.maxTier')}</div>`;
    }

    let cellsHtml = '';
    for (const tierDef of SEAL_TIERS) {
      const unlocked = wins >= tierDef.threshold;
      const isCurrent = unlocked && tierDef.tier === currentTier.tier;
      const isClaimed = claimed.has(tierDef.tier);
      const name = t('seal.tier.' + tierDef.id + '.name');
      const desc = t('seal.tier.' + tierDef.id + '.desc');
      const gold = sealGoldReward(tierDef.tier);
      const soul = sealSoulReward(tierDef.tier);
      const rewardHtml = `<div class="seal-cell-reward">
        <span class="seal-reward-gold">${t('seal.rewardGold', { amount: String(gold) })}</span>
        <span class="seal-reward-soul">${t('seal.rewardSoul', { amount: String(soul) })}</span>
      </div>`;

      if (unlocked) {
        const claimBtn = isClaimed
          ? `<span class="seal-claimed-tag">${t('seal.rewardClaimed')}</span>`
          : `<button class="seal-claim-btn" data-tier="${tierDef.tier}">${t('seal.rewardUnlock')}</button>`;
        cellsHtml += `
          <div class="seal-cell unlocked${isCurrent ? ' current' : ''}">
            <div class="seal-cell-stamp">
              <img class="seal-cell-img" src="icons/seal/seal_${tierDef.id}.png" alt="${name}" onerror="this.src='icons/seal/seal_locked.png'">
            </div>
            <div class="seal-cell-name">${name}</div>
            <div class="seal-cell-desc">${desc}</div>
            ${rewardHtml}
            <div class="seal-claim-area">${claimBtn}</div>
          </div>`;
      } else {
        cellsHtml += `
          <div class="seal-cell locked">
            <div class="seal-cell-stamp seal-cell-phantom">
              <img class="seal-cell-img" src="icons/seal/seal_locked.png" alt="${t('seal.locked')}">
            </div>
            <div class="seal-cell-name seal-cell-name-locked">${name}</div>
            <div class="seal-cell-unlock-hint">${t('seal.unlockAt', { n: String(tierDef.threshold) })}</div>
          </div>`;
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay seal-book-overlay';
    overlay.id = 'seal-book-overlay';
    overlay.innerHTML = `
      <div class="seal-book-card lc-card lc-modal">
        <div class="seal-book-header">
          <h2 class="seal-book-title">${t('seal.bookTitle')}</h2>
          <div class="seal-book-wins">${t('seal.wins', { n: String(wins) })}</div>
          ${nextHint}
        </div>
        <div class="seal-book-grid">${cellsHtml}</div>
        <div class="seal-book-footer">
          <button class="seal-book-close-btn cs-btn" id="seal-book-close">${t('bp.close')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#seal-book-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // 领取奖励按钮
    overlay.querySelectorAll('.seal-claim-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const tier = parseInt((btn as HTMLElement).dataset.tier!, 10);
        void this.claimTierReward(tier).then(() => this.showSealBook());
      });
    });
  }

  /** 领取某层级奖励（一次性，服务端幂等） */
  private async claimTierReward(tier: number): Promise<void> {
    const claimed = getClaimedTiers();
    if (claimed.has(tier)) return;

    const gold = sealGoldReward(tier);
    const soul = sealSoulReward(tier);
    const hash = SaveManager.getHash();

    if (hash) {
      // 服务端幂等发放：operation_id 绑定 user+tier，清 localStorage 也无法重复领取
      const opId = `seal_tier_${tier}_${hash.slice(0, 12)}`;
      try {
        const res = await walletGrant(hash, opId, gold, 'loong_soul', soul, `seal_tier_${tier}`);
        if (res.code === 0 && res.data) {
          engineBridge.platformSetBalance(res.data.balance, 0);
          const newQty = res.data.inventory['loong_soul'] ?? soul;
          const current = engineBridge.getPlatformItemCount('loong_soul');
          const delta = newQty - current;
          if (delta > 0) engineBridge.addPlatformItem('loong_soul', delta);
          engineBridge.platformSave();
          markTierClaimed(tier);
          const rewardText = `${t('seal.rewardGold', { amount: String(gold) })} + ${t('seal.rewardSoul', { amount: String(soul) })}`;
          showToast(t('seal.promoted', { reward: rewardText }), 3);
          return;
        }
      } catch { /* fall through to local */ }
    }

    // 离线降级：本地发放（localStorage 记录防重）
    engineBridge.grantGold(gold);
    engineBridge.addPlatformItem('loong_soul', soul);
    engineBridge.platformSave();
    markTierClaimed(tier);
    const rewardText = `${t('seal.rewardGold', { amount: String(gold) })} + ${t('seal.rewardSoul', { amount: String(soul) })}`;
    showToast(t('seal.promoted', { reward: rewardText }), 3);
  }

  hideSealBook(): void {
    const el = document.getElementById('seal-book-overlay');
    if (el) el.remove();
  }
}
