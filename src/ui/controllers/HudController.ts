/**
 * HUD + quick bar + hand panel controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { SaveManager } from '../../core/SaveManager';
import { ITEM_DEFS } from '../../config';
import { createKeyedInFlightGuard } from '../../core/itemTransaction';
import { showToast } from '../utils/domHelpers';
import { resolveIconSrc } from '../../utils/iconAssetCache';
import { itemName, itemIcon, PIECE_LABELS, pieceIconTag } from '../utils/pieceIcons';
import { readLocalInventory, projectInventoryWithSessionSouls } from '../utils/inventory';
import type { DomUIContext } from '../DomUIContext';
import type { HUDData, PieceInfo } from '../UIBridge';

export class HudController {
  private readonly runQuickBarItem = createKeyedInFlightGuard();
  private readonly runItemOperation = createKeyedInFlightGuard();
  private _quickBarSlotOrder: string[] = [];
  private _pendingConfirmItemId: string | null = null;
  private _pendingConfirmTimer: ReturnType<typeof setTimeout> | null = null;
  private _boundDocClick: ((e: MouseEvent) => void) | null = null;
  /** R5: 手牌 diff 更新——持久化每个棋子 DOM 元素，避免整块 innerHTML 重建 */
  private _handEls = new Map<string, HTMLButtonElement>();
  private _confirmBtn: HTMLButtonElement | null = null;
  private _handHeaderDebug = false;

  constructor(private ctx: DomUIContext) {}

  buildHUD(): void {
    const el = document.getElementById('ui-hud')!;
    el.className = 'ui-panel glass-panel lc-card lc-hud';
    el.innerHTML = `
      <div class="hud-lamp-slot" id="hud-lamp-slot"></div>
      <div class="hud-stat level-stat"><span class="hud-label">${t('hud.level')}</span><span class="hud-value level">1</span></div>
      <div class="hud-stat score-stat"><span class="hud-label">${t('hud.score')}</span><span class="hud-value score">0</span></div>
      <div class="hud-stat enemy-stat"><span class="hud-label">${t('hud.enemy')}</span><span class="hud-value enemy">0</span></div>
      <div class="hud-stat provisions-stat"><span class="hud-label">${t('hud.provisionsLabel')}</span><span class="hud-value provisions">0/0</span></div>
      <button class="gear-btn" id="gear-btn" title="${t('hud.settings')}">⚙</button>
      <div class="storm-bar-outer"><div class="storm-bar-inner" style="width:0%"></div></div>
    `;
  }

  buildQuickBar(): void {
    const existing = document.getElementById('ui-quick-bar');
    if (existing) return;
    const bar = document.createElement('div');
    bar.id = 'ui-quick-bar';
    bar.className = 'quick-bar hidden';
    bar.innerHTML = `<button class="quick-bar-shop" id="quick-bar-shop" type="button" aria-label="${t('quickbar.shopLabel')}"><img src="${resolveIconSrc(`${import.meta.env.BASE_URL}icons/box_64.png`)}" alt="${t('quickbar.shopAlt')}" width="28" height="28" style="display:block"></button><div class="quick-bar-scroll" id="quick-bar-scroll"></div>`;
    document.body.appendChild(bar);
    document.getElementById('quick-bar-shop')!.addEventListener('click', () => this.ctx.host.onBackpackOpen?.());
  }

  initHUD(): void {
    this.updateHUD({ level: 1, score: 0, enemyCount: 0, stormProgress: 0, stormActive: false, provisionsRemaining: 0, provisionsLimit: 0, provisionsBonus: 0 });
  }

  destroy(): void {
    this.clearQuickBarConfirm();
    this._quickBarSlotOrder = [];
    this.ctx.state.turnPieceOrder = [];
    this._handEls.clear();
    this._confirmBtn = null;
    this._handHeaderDebug = false;
  }

  updateHUD(data: HUDData): void {
    const el = document.getElementById('ui-hud');
    if (!el) return;
    const spans = el.querySelectorAll('.hud-value');
    if (spans[0]) spans[0].textContent = String(data.level);
    if (spans[1]) spans[1].textContent = String(data.score);
    if (spans[2]) spans[2].textContent = String(data.enemyCount);
    // 粮草 stat：只显示可用粮草（上限移入 tooltip）
    const provEl = spans[3] as HTMLElement | undefined;
    if (provEl) {
      const limit = data.provisionsLimit;
      const isLow = data.provisionsRemaining <= 0;
      provEl.innerHTML = `${data.provisionsRemaining}`;
      provEl.classList.toggle('low-provisions', isLow);
      provEl.title = isLow ? t('provisions.low') : t('provisions.tooltip', { remaining: data.provisionsRemaining, limit });
    }
    const bar = el.querySelector('.storm-bar-outer') as HTMLElement;
    if (bar) bar.style.display = data.stormActive ? '' : 'none';
    const inner = el.querySelector('.storm-bar-inner') as HTMLElement;
    if (inner) inner.style.width = `${Math.round(data.stormProgress * 100)}%`;
  }

  setConfirmVisible(_visible: boolean): void {}

  setDebugMode(enabled: boolean, onDice?: () => void): void {
    this.ctx.state.debugMode = enabled;
    if (onDice) this.ctx.state.onDiceClick = onDice;
  }

  updateHand(hand: PieceInfo[], selectedIndex: number, placed: PieceInfo[], summonedThisTurn = false): void {
    const el = document.getElementById('ui-hand');
    if (!el) return;
    // 全落子门控：3 张手牌全部放置才能确定出牌；召唤英雄后 3+1=4 张
    const required = 3 + (summonedThisTurn ? 1 : 0);
    const canConfirm = placed.length >= required;

    // ── Header（debug 骰子）：仅在 debugMode 切换时重建 ──
    this.ensureHandHeader(el);

    // ── 计算稳定排序（turnPieceOrder）：ID 集合变化时才更新 ──
    const allIds = [...hand.map(p => p.id), ...placed.map(p => p.id)];
    const idSet = new Set(allIds);
    const orderChanged = this.ctx.state.turnPieceOrder.length !== allIds.length
      || !this.ctx.state.turnPieceOrder.every(id => idSet.has(id));
    if (orderChanged) {
      this.ctx.state.turnPieceOrder = [...hand.map(p => p.id), ...placed.map(p => p.id)];
    }

    if (this.ctx.state.turnPieceOrder.length === 0) {
      // 无棋子：清掉残留元素
      this._handEls.forEach(node => node.remove());
      this._handEls.clear();
      if (this._confirmBtn) this._confirmBtn.classList.add('hidden');
      return;
    }

    const pieceById = new Map<string, PieceInfo & { isPlaced: boolean; placedIdx: number }>();
    hand.forEach(p => pieceById.set(p.id, { ...p, isPlaced: false, placedIdx: -1 }));
    placed.forEach((p, i) => pieceById.set(p.id, { ...p, isPlaced: true, placedIdx: i }));

    const container = this.ensureHandContainer(el);
    // 确认按钮始终位于末尾（作为隐式锚点）；先创建以保证棋子插在其前
    this.ensureConfirmBtn(container, canConfirm);

    // ── Diff：复用/创建/重排，仅状态变化时更新 class 与 data 属性 ──
    let prev: Element | null = null;
    for (const id of this.ctx.state.turnPieceOrder) {
      const p = pieceById.get(id);
      if (!p) continue;
      let node = this._handEls.get(id);
      if (!node) {
        node = this.createHandPieceEl(p, hand, selectedIndex);
        this._handEls.set(id, node);
      } else {
        this.applyHandPieceState(node, p, hand, selectedIndex);
      }
      // 节点应紧跟 prev 之后；新节点不在 DOM 中必须插入，已就位则跳过
      const ref: Node | null = prev ? prev.nextSibling : container.firstChild;
      if (node !== ref) container.insertBefore(node, ref);
      prev = node;
    }

    // ── 移除已不存在的棋子元素（回合切换时） ──
    for (const [id, node] of this._handEls) {
      if (!idSet.has(id)) { node.remove(); this._handEls.delete(id); }
    }
  }

  /** 确保 hand-header 存在，debugMode 变化时才重建骰子按钮 */
  private ensureHandHeader(el: HTMLElement): void {
    let header = el.querySelector('.hand-header') as HTMLElement | null;
    if (!header) {
      header = document.createElement('div');
      header.className = 'hand-header';
      el.appendChild(header);
    }
    const wantDebug = !!this.ctx.state.debugMode;
    if (wantDebug !== this._handHeaderDebug) {
      header.innerHTML = wantDebug
        ? `<button class="debug-dice-btn" id="dice-btn" title="${t('debug.title')}">🎲</button>`
        : '';
      this._handHeaderDebug = wantDebug;
      const diceBtn = header.querySelector('#dice-btn');
      if (diceBtn) diceBtn.addEventListener('click', (e) => { e.stopPropagation(); this.ctx.state.onDiceClick?.(); });
    }
  }

  /** 确保 .hand-pieces 容器存在；新建时清空失效的元素引用 */
  private ensureHandContainer(el: HTMLElement): HTMLElement {
    let container = el.querySelector('.hand-pieces') as HTMLElement | null;
    if (!container) {
      container = document.createElement('div');
      container.className = 'hand-pieces';
      el.appendChild(container);
      this._handEls.clear();
      this._confirmBtn = null;
    }
    return container;
  }

  /** 创建单个手牌按钮并绑定监听（监听在点击时读取 dataset，无需重绑） */
  private createHandPieceEl(
    p: PieceInfo & { isPlaced: boolean; placedIdx: number },
    hand: PieceInfo[],
    selectedIndex: number,
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'hand-piece';
    btn.type = 'button';
    btn.dataset.pieceId = p.id;
    this.applyHandPieceState(btn, p, hand, selectedIndex);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.classList.contains('placed')) {
        const idx = parseInt(btn.dataset.placedIdx || '0');
        this.ctx.host.onPreviewClick?.(idx);
      } else {
        const idx = parseInt(btn.dataset.handIdx || '0');
        this.ctx.host.onHandSelect?.(idx);
      }
    });
    return btn;
  }

  /** 仅在状态变化时更新 class / data / innerHTML（placed↔hand 切换或首次创建才重建内容） */
  private applyHandPieceState(
    btn: HTMLButtonElement,
    p: PieceInfo & { isPlaced: boolean; placedIdx: number },
    hand: PieceInfo[],
    selectedIndex: number,
  ): void {
    const label = PIECE_LABELS[p.pieceType] ?? p.skillName;
    const iconHtml = `<span class="piece-text">${pieceIconTag(p.pieceType, PIECE_LABELS[p.pieceType] ?? '?')}</span>`;
    if (p.isPlaced) {
      if (!btn.classList.contains('placed')) {
        // hand → placed：补 order-num
        btn.classList.add('placed');
        btn.classList.remove('selected');
        btn.setAttribute('aria-label', t('hand.undoPlace', { name: label }));
        btn.innerHTML = `${iconHtml}<span class="order-num">${p.placedIdx + 1}</span>`;
      } else {
        const orderNum = btn.querySelector('.order-num');
        if (orderNum) orderNum.textContent = String(p.placedIdx + 1);
      }
      btn.dataset.placedIdx = String(p.placedIdx);
      btn.removeAttribute('data-hand-idx');
    } else {
      const wasPlaced = btn.classList.contains('placed');
      const hasPieceText = !!btn.querySelector('.piece-text');
      if (wasPlaced || !hasPieceText) {
        // placed → hand（悔棋）或首次创建：重建为纯棋子内容
        btn.classList.remove('placed');
        // 左下角粮草成本角标（0 消耗棋子如英雄/龙棋不显示）
        const cost = p.provisionCost && p.provisionCost > 0 ? p.provisionCost : 0;
        btn.innerHTML = cost > 0 ? `${iconHtml}<span class="hand-cost">${cost}</span>` : iconHtml;
      }
      const handIdx = hand.findIndex(h => h.id === p.id);
      btn.classList.toggle('selected', handIdx === selectedIndex);
      btn.setAttribute('aria-label', t('hand.selectPiece', { name: label }));
      btn.dataset.handIdx = String(handIdx);
      btn.removeAttribute('data-placed-idx');
    }
  }

  /** 确认按钮复用同一元素，仅切换 hidden 类 */
  private ensureConfirmBtn(container: HTMLElement, canConfirm: boolean): HTMLButtonElement {
    if (!this._confirmBtn || !this._confirmBtn.isConnected) {
      const btn = document.createElement('button');
      btn.id = 'btn-confirm';
      btn.className = 'confirm-inline-btn hidden';
      btn.title = t('hand.confirm');
      btn.textContent = '✓';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.ctx.host.onConfirm?.(); });
      container.appendChild(btn);
      this._confirmBtn = btn;
    }
    this._confirmBtn.classList.toggle('hidden', !canConfirm);
    return this._confirmBtn;
  }

  syncLocalInventory(): void {
    this.ctx.state.inventory.updateAuthoritative(readLocalInventory());
  }

  setPendingItemUsage(items: Readonly<Record<string, number>>): void {
    this.ctx.state.inventory.replacePending({ ...items });
    this.refreshQuickBar();
  }

  setSessionEarnedLoongSouls(count: number): void {
    this.ctx.state.sessionEarnedLoongSouls = Math.max(0, count);
  }

  private projectInventory(items: Readonly<Record<string, number>>): Record<string, number> {
    return projectInventoryWithSessionSouls(items, this.ctx.state.sessionEarnedLoongSouls);
  }

  private async executeQuickBarItem(itemId: string, itemNameStr: string): Promise<void> {
    if (!this.ctx.host.onBackpackUseItem) return;
    const el = document.querySelector(`.quick-bar-item[data-item-id="${itemId}"]`);
    if (el) el.classList.add('processing');
    try {
      await this.runQuickBarItem(itemId, async () => {
        const used = await this.ctx.host.onBackpackUseItem!(itemId);
        if (used) {
          this.refreshQuickBar();
          this.ctx.host.onBackpackItemsChanged?.(this.projectInventory(this.ctx.state.inventory.items).loong_soul ?? 0);
          showToast(t('quickbar.itemUsed', { name: itemNameStr }), 1.5);
        }
        return used;
      });
    } finally {
      if (el) el.classList.remove('processing');
    }
  }

  private showQuickBarTip(message: string, durationSec: number): void {
    const tip = document.getElementById('quick-bar-tip');
    const hand = document.getElementById('ui-hand');
    if (!tip || !hand) return;
    const handRect = hand.getBoundingClientRect();
    tip.style.bottom = `${window.innerHeight - handRect.top + 6}px`;
    tip.textContent = message;
    tip.classList.remove('hidden');
    if ((this as any)._quickBarTipTimer) clearTimeout((this as any)._quickBarTipTimer);
    (this as any)._quickBarTipTimer = setTimeout(() => tip.classList.add('hidden'), durationSec * 1000);
  }

  private hideQuickBarTip(): void {
    const tip = document.getElementById('quick-bar-tip');
    if (tip) tip.classList.add('hidden');
    if ((this as any)._quickBarTipTimer) { clearTimeout((this as any)._quickBarTipTimer); (this as any)._quickBarTipTimer = null; }
  }

  clearQuickBarConfirm(): void {
    if (this._pendingConfirmTimer) { clearTimeout(this._pendingConfirmTimer); this._pendingConfirmTimer = null; }
    if (this._boundDocClick) { document.removeEventListener('click', this._boundDocClick, true); this._boundDocClick = null; }
    if (this._pendingConfirmItemId) {
      const prev = document.querySelector(`.quick-bar-item[data-item-id="${this._pendingConfirmItemId}"]`);
      if (prev) prev.classList.remove('confirming');
      this._pendingConfirmItemId = null;
    }
    this.hideQuickBarTip();
  }

  refreshQuickBar(): void {
    this.syncLocalInventory();
    const bar = document.getElementById('ui-quick-bar');
    if (!bar) return;
    const scrollEl = document.getElementById('quick-bar-scroll');
    if (!scrollEl) return;

    bar.classList.remove('hidden');
    const items = this.projectInventory(this.ctx.state.inventory.items);

    if (!SaveManager.getHash()) {
      scrollEl.innerHTML = '';
      return;
    }

    if (this._quickBarSlotOrder.length === 0) {
      this._quickBarSlotOrder = Object.keys(items).filter(id => id !== 'loong_soul' && (items[id] ?? 0) > 0);
    } else {
      for (const id of Object.keys(items)) {
        if (id === 'loong_soul') continue;
        if ((items[id] ?? 0) > 0 && !this._quickBarSlotOrder.includes(id)) {
          this._quickBarSlotOrder.push(id);
        }
      }
    }

    scrollEl.innerHTML = this._quickBarSlotOrder.map(id => {
      const qty = items[id] ?? 0;
      const def = ITEM_DEFS[id];
      if (!def) return '';
      const depleted = qty <= 0;
      return `<button class="quick-bar-item${depleted ? ' depleted' : ''}" type="button"
        aria-label="${depleted ? t('quickbar.depleted') : t('quickbar.slotLabel', { name: itemName(def), qty })}"
        data-item-id="${id}"${depleted ? ' disabled' : ''}>
        <span class="quick-bar-icon">${itemIcon(def)}</span>
        <span class="quick-bar-badge">×${qty}</span>
      </button>`;
    }).join('');

    bar.querySelectorAll('.quick-bar-item').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((el as HTMLButtonElement).disabled) return;
        const itemId = (el as HTMLElement).dataset.itemId!;
        const def = ITEM_DEFS[itemId];
        if (!def) return;

        if (this._pendingConfirmItemId === itemId) {
          this.clearQuickBarConfirm();
          void this.executeQuickBarItem(itemId, itemName(def));
          return;
        }

        this.clearQuickBarConfirm();
        this._pendingConfirmItemId = itemId;
        el.classList.add('confirming');
        this.showQuickBarTip(t('quickbar.confirmTip', { name: itemName(def) }), 3);
        this._pendingConfirmTimer = setTimeout(() => this.clearQuickBarConfirm(), 3000);

        this._boundDocClick = (docE: MouseEvent) => {
          const target = docE.target as HTMLElement;
          if (target.closest(`.quick-bar-item[data-item-id="${itemId}"]`)) return;
          this.clearQuickBarConfirm();
        };
        document.addEventListener('click', this._boundDocClick, true);
      });
    });
  }
}
