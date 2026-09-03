/**
 * Backpack (item shop/inventory) controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t, getLang, serverErrorMessage } from '../../i18n';
import { SaveManager } from '../../core/SaveManager';
import { ITEM_DEFS } from '../../config';
import { engineBridge } from '../../wasm/EngineBridge';
import { createKeyedInFlightGuard } from '../../core/itemTransaction';
import { itemOperationCoordinator } from '../../core/itemOperation';
import { showToast } from '../utils/domHelpers';
import { itemName, itemIcon } from '../utils/pieceIcons';
import { readLocalInventory, projectInventoryWithSessionSouls, getItemDetailAction } from '../utils/inventory';
import type { DomUIContext } from '../DomUIContext';

export class BackpackController {
  private readonly runItemOp = createKeyedInFlightGuard();

  constructor(private ctx: DomUIContext) {}

  async showBackpack(): Promise<void> {
    const existing = document.getElementById('bp-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay bp-overlay';
    overlay.id = 'bp-overlay';

    if (this.ctx.state.sessionEarnedLoongSouls > 0) {
      engineBridge.collectLoongSouls(this.ctx.state.sessionEarnedLoongSouls);
      this.ctx.state.sessionEarnedLoongSouls = 0;
    }
    this.ctx.state.inventory.updateAuthoritative(readLocalInventory());
    const items = projectInventoryWithSessionSouls(this.ctx.state.inventory.items, this.ctx.state.sessionEarnedLoongSouls);
    const balance = engineBridge.getPlatformGold();

    const tabKeys = ['all', 'consumable', 'ultimate'];
    let tabsHtml = '<div class="bp-tabs" id="bp-tabs">';
    for (const cat of tabKeys) {
      const active = cat === 'all' ? ' active' : '';
      const label = cat === 'all' ? t('bp.categoryAll') : cat === 'consumable' ? t('bp.categoryConsumable') : t('bp.categoryUltimate');
      tabsHtml += `<button class="bp-tab${active}" data-category="${cat}">${label}</button>`;
    }
    tabsHtml += '</div>';

    const itemIds = ['undo', 'redraw', 'unseal', 'handSet', 'provision_wagon', 'loong_soul', 'loong',
      'horse_iron', 'elephant_mengma', 'chariot_tank', 'pawn_engineer'];
    let cardsHtml = '<div class="bp-grid" id="bp-grid">';
    for (const id of itemIds) {
      const def = ITEM_DEFS[id];
      if (!def) continue;
      const qty = items[id] ?? 0;
      cardsHtml += `
        <button class="bp-cell" type="button" aria-label="${itemName(def)}" data-item-id="${id}" data-category="${def.category}">
          <div class="bp-cell-icon">${itemIcon(def)}<span class="bp-cell-badge${qty === 0 ? ' zero' : ''}">${qty}</span></div>
          <div class="bp-cell-footer"><span class="bp-cell-name">${itemName(def)}</span></div>
        </button>`;
    }
    cardsHtml += '</div>';

    const isOnline = navigator.onLine;
    const statusIcon = isOnline ? '🟢' : '🔴';
    const statusText = isOnline ? t('bp.online') : t('bp.offline');

    overlay.innerHTML = `
      <div class="bp-card">
        <div class="bp-header">
          <h2 class="bp-title">${t('bp.title')}</h2>
          <span class="bp-balance">${t('bp.balance', { gold: balance })}</span>
          <span class="bp-network-status">${statusIcon} ${statusText}</span>
        </div>
        ${tabsHtml}
        ${cardsHtml}
        <div class="bp-footer">
          <button class="bp-footer-btn close" id="bp-footer-close">${t('bp.close')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#bp-footer-close')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelectorAll('.bp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const cat = (tab as HTMLElement).dataset.category!;
        overlay.querySelectorAll('.bp-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        overlay.querySelectorAll('.bp-cell').forEach(cell => {
          const el = cell as HTMLElement;
          el.style.display = (cat === 'all' || el.dataset.category === cat) ? '' : 'none';
        });
      });
    });

    const itemsRef = items;
    overlay.querySelectorAll('.bp-cell').forEach(cell => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = (cell as HTMLElement).dataset.itemId!;
        this.showItemDetail(itemId, itemsRef[itemId] ?? 0, () => {});
      });
    });
  }

  hideBackpack(): void {
    const el = document.getElementById('bp-overlay');
    if (el) el.remove();
  }

  private showItemDetail(itemId: string, qty: number, onBack: () => void): void {
    const def = ITEM_DEFS[itemId];
    const existing = document.getElementById('bp-detail');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay bp-detail-overlay';
    overlay.id = 'bp-detail';

    const descText = getLang() === 'en' && def.descEn ? def.descEn : def.desc;

    const topHtml = `
      <div class="bp-detail-top">
        <div class="bp-detail-icon-col">
          <div class="bp-detail-icon">${itemIcon(def)}</div>
          <div class="bp-detail-qty">×${qty}</div>
        </div>
        <div class="bp-detail-desc-col">
          <div class="bp-detail-name">${itemName(def)}</div>
          <div class="bp-detail-desc-label">${t('item.usageGuide')}</div>
          <div class="bp-detail-desc">${descText}</div>
        </div>
      </div>`;

    const detailAction = getItemDetailAction(itemId, qty);
    const goldCost = engineBridge.getItemPrice(itemId);
    const soulCost = engineBridge.getItemSoulCost(itemId);
    // 魂以引擎本地库存为权威（与 forgeHero 扣减同一账；session 已在打开背包时 collect 入账）
    const soulCount = engineBridge.getPlatformItemCount('loong_soul');
    // 龙魂预检须按所选数量 ×单价 判断；soulCost=0 时恒真（无魂道具）
    const canForge = (n: number) => soulCount >= n * soulCost;
    let bottomHtml: string;
    if (detailAction === 'info') {
      // 龙魂：不可购买/锻造，仅查看
      bottomHtml = `<div class="bp-detail-info">${t('item.loongInfo')}</div>`;
    } else {
      // 统一锻造页：数量选择器 + 代价（金币+龙魂，龙魂为0时不显示）+ 主按钮
      bottomHtml = `
        <div class="bp-detail-price">${soulCost > 0
          ? t('item.forgeCost', { gold: goldCost, soul: soulCost })
          : t('item.forgeCostGold', { gold: goldCost })}</div>
        ${soulCost > 0 ? `<div class="bp-detail-soul-count">${t('item.soulCount', { count: soulCount })}${canForge(1) ? '' : t('item.soulShort')}</div>` : ''}
        <div class="bp-buy-input-row">
          <button class="bp-buy-stepper" id="bp-buy-dec">−</button>
          <input class="bp-buy-input" id="bp-buy-qty" type="number" min="1" max="99" value="1">
          <button class="bp-buy-stepper" id="bp-buy-inc">+</button>
        </div>
        <div class="bp-buy-total" id="bp-buy-total">${soulCost > 0
          ? t('item.totalForgeCost', { total: goldCost, soul: soulCost })
          : t('item.totalForgeCostGold', { total: goldCost })}</div>
        <div class="bp-buy-btns">
          <button class="bp-buy-btn cancel" id="bp-buy-cancel">${t('item.cancel')}</button>
          <button class="bp-buy-btn confirm" id="bp-buy-confirm"${canForge(1) ? '' : ' disabled'}>${t('item.forge')}</button>
        </div>`;
    }

    overlay.innerHTML = `
      <div class="bp-detail-card">
        <div class="bp-detail-header">
          <button class="bp-detail-back" id="bp-detail-back">${t('item.back')}</button>
          <span class="bp-detail-header-title">${t('item.detail')}</span>
        </div>
        ${topHtml}
        <div class="bp-detail-bottom">${bottomHtml}</div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#bp-detail-back')!.addEventListener('click', () => { overlay.remove(); onBack(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); onBack(); } });

    if (detailAction === 'info') return;

    overlay.querySelector('#bp-buy-cancel')!.addEventListener('click', () => { overlay.remove(); onBack(); });

    // 统一锻造：数量选择器
    const qtyInput = overlay.querySelector('#bp-buy-qty') as HTMLInputElement;
    const updateCost = () => {
      const v = Math.max(1, Math.min(99, parseInt(qtyInput.value) || 1));
      qtyInput.value = String(v);
      const totalEl = overlay.querySelector('#bp-buy-total') as HTMLElement;
      if (totalEl) {
        const sc = engineBridge.getItemSoulCost(itemId);
        totalEl.textContent = sc > 0
          ? t('item.totalForgeCost', { total: v * engineBridge.getItemPrice(itemId), soul: v * sc })
          : t('item.totalForgeCostGold', { total: v * engineBridge.getItemPrice(itemId) });
      }
      const confirmEl = overlay.querySelector('#bp-buy-confirm') as HTMLButtonElement | null;
      if (confirmEl) confirmEl.disabled = !canForge(v);
    };
    overlay.querySelector('#bp-buy-dec')!.addEventListener('click', () => { qtyInput.value = String(Math.max(1, (parseInt(qtyInput.value) || 1) - 1)); updateCost(); });
    overlay.querySelector('#bp-buy-inc')!.addEventListener('click', () => { qtyInput.value = String(Math.min(99, (parseInt(qtyInput.value) || 1) + 1)); updateCost(); });
    qtyInput.addEventListener('input', updateCost);
    qtyInput.addEventListener('change', updateCost);

    const confirmBtn = overlay.querySelector('#bp-buy-confirm') as HTMLButtonElement;
    if (!confirmBtn.disabled) {
      confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        const qty = Math.max(1, Math.min(99, parseInt(qtyInput.value) || 1));
        if (!canForge(qty)) {
          showToast(t('item.soulShortage'), 2);
          return;
        }
        const hash = SaveManager.getHash();
        if (!hash) { showToast(t('item.syncFirst'), 2); return; }
        const operationKey = `forge:${hash}:${itemId}:${qty}`;
        confirmBtn.disabled = true;
        await this.runItemOp(operationKey, async () => {
          const result = await itemOperationCoordinator.execute({ hash, itemId, quantity: qty });
          if (!result.definitive) {
            showToast(t('item.buyLostResponse'), 2);
            return false;
          }
          if (result.response.code !== 0 || !result.response.data || !('balance' in result.response.data)) {
            showToast(serverErrorMessage(result.response.errCode, 'item.buyFailed'), 2);
            return false;
          }
          // 统一锻造：服务端金币已扣，客户端 forgeHero 扣龙魂(若>0) + 道具入库 ×qty
          if (engineBridge.forgeHero(itemId, qty) !== 0) {
            showToast(t('item.soulShortage'), 2);
            return false;
          }
          // 金币余额以服务端为准（锻造扣款后返回）
          engineBridge.platformSetBalance(result.response.data.balance, 0);
          engineBridge.platformSave();
          overlay.remove();
          this.hideBackpack();
          void this.showBackpack();
          this.ctx.host.onBackpackItemsChanged?.(projectInventoryWithSessionSouls(this.ctx.state.inventory.items, this.ctx.state.sessionEarnedLoongSouls).loong_soul ?? 0);
          showToast(t('item.forgeOk', { name: itemName(def) }), 1.5);
          return true;
        });
        if (overlay.isConnected) confirmBtn.disabled = false;
      });
    }
  }
}
