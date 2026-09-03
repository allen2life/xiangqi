/**
 * DomUI — UIBridge implementation using HTML/DOM rendering.
 *
 * Facade: wires controllers together via DomUIContext.
 * GameScene creates a single DomUI instance and sets callbacks.
 * Controllers receive DomUIContext (state + host interface), never import DomUI.
 *
 * This file also re-exports utility functions for backward compat.
 */

import { t } from '../i18n';
import { PieceType } from '../core/types';
import { AudioManager } from '../audio/AudioManager';
import type { UIBridge, HUDData, PieceInfo, SettlementData, RankDisplayItem, RankPersonalInfo } from './UIBridge';
import { DomUIState } from './DomUIContext';
import type { DomUIContext } from './DomUIContext';
import { showToast as toast } from './utils/domHelpers';
// Controllers
import { StartMenuController } from './controllers/StartMenuController';
import { HudController } from './controllers/HudController';
import { LeaderboardController } from './controllers/LeaderboardController';
import { BackpackController } from './controllers/BackpackController';
import { SettlementController } from './controllers/SettlementController';
import { PublishController } from './controllers/PublishController';
import { SettingsController } from './controllers/SettingsController';
import { DebugController } from './controllers/DebugController';
import { SealBookController } from './controllers/SealBookController';

// ── Re-exports for backward compat (DomUI.contract.test.ts, etc.) ──
export { PIECE_LABELS, PIECE_ICON_FILES, pieceIconTag, itemName, itemIcon } from './utils/pieceIcons';
export { projectInventoryWithSessionSouls, getItemDetailAction } from './utils/inventory';
export type { ItemDetailAction } from './utils/inventory';

// ── Constants (still used by other files that import from DomUI) ──
export const ITEM_IDS = ['undo','redraw','unseal','handSet','loong_soul','loong'] as const;

export class DomUI implements UIBridge {
  // ═══════════════════════════════════════════════════════════════
  // Callback fields — set by GameScene, read by controllers via DomUIHost
  // ═══════════════════════════════════════════════════════════════
  onHandSelect: ((index: number) => void) | null = null;
  onPreviewClick: ((index: number) => void) | null = null;
  onConfirm: (() => void) | null = null;
  onRestart: (() => void) | null = null;
  onMenu: (() => void) | null = null;
  onCloudSync: (() => void) | null = null;
  onLeaderboard: (() => void) | null = null;
  onLeaderboardPublish: (() => void) | null = null;
  onLeaderboardTabChange: ((tab: 'total' | 'level') => void) | null = null;
  onLeaderboardLevelChange: ((level: number) => void) | null = null;
  onLeaderboardFilterChange: ((gameType: string, period: string) => void) | null = null;
  onLeaderboardCurrentLevel: (() => void) | null = null;
  onChallengePlayer: ((userHash: string, level: number) => void) | null = null;
  onBackpackUseItem: ((itemId: string) => boolean | Promise<boolean>) | null = null;
  onBackpackItemsChanged: ((loongSoulCount?: number) => void) | null = null;
  onRunPublished: (() => void) | null = null;
  onBackpackOpen: (() => void) | null = null;
  onShareInvite: (() => void) | null = null;
  onShowPublishHint: (() => void) | null = null;
  onShowPublishPanel: (() => void) | null = null;
  onSealBookOpen: (() => void) | null = null;
  onShareReplay: (() => void) | null = null;

  // ═══════════════════════════════════════════════════════════════
  // State & Controllers
  // ═══════════════════════════════════════════════════════════════
  private readonly state: DomUIState;
  private readonly ctx: DomUIContext;
  private readonly startMenu: StartMenuController;
  private readonly hud: HudController;
  private readonly leaderboard: LeaderboardController;
  private readonly backpack: BackpackController;
  private readonly settlement: SettlementController;
  private readonly publish: PublishController;
  private readonly settings: SettingsController;
  private readonly debugCtrl: DebugController;
  private readonly sealBook: SealBookController;
  /** R4: 全局 UI 点击音委托监听只注册一次（DomUI 可能随 GameScene 重建） */
  private static clickSoundWired = false;

  constructor() {
    this.state = new DomUIState();
    // Build DomUIHost — wraps the callback fields so controllers read via host interface
    const host: DomUIContext['host'] = {
      get onHandSelect() { return this.onHandSelect; },
      get onPreviewClick() { return this.onPreviewClick; },
      get onConfirm() { return this.onConfirm; },
      get onRestart() { return this.onRestart; },
      get onMenu() { return this.onMenu; },
      get onCloudSync() { return this.onCloudSync; },
      get onLeaderboard() { return this.onLeaderboard; },
      get onLeaderboardPublish() { return this.onLeaderboardPublish; },
      get onLeaderboardTabChange() { return this.onLeaderboardTabChange; },
      get onLeaderboardLevelChange() { return this.onLeaderboardLevelChange; },
      get onLeaderboardFilterChange() { return this.onLeaderboardFilterChange; },
      get onLeaderboardCurrentLevel() { return this.onLeaderboardCurrentLevel; },
      get onChallengePlayer() { return this.onChallengePlayer; },
      get onBackpackUseItem() { return this.onBackpackUseItem; },
      get onBackpackItemsChanged() { return this.onBackpackItemsChanged; },
      get onRunPublished() { return this.onRunPublished; },
      get onBackpackOpen() { return this.onBackpackOpen; },
      get onShareInvite() { return this.onShareInvite; },
      get onShowPublishHint() { return this.onShowPublishHint; },
      get onShowPublishPanel() { return this.onShowPublishPanel; },
      get onSealBookOpen() { return this.onSealBookOpen; },
      get onShareReplay() { return this.onShareReplay; },
    };
    // Bind host getters to `this` (the DomUI instance that has the properties)
    for (const key of Object.keys(host) as (keyof typeof host)[]) {
      const desc = Object.getOwnPropertyDescriptor(host, key)!;
      desc.get = desc.get!.bind(this);
      Object.defineProperty(host, key, desc);
    }
    this.ctx = { state: this.state, host };
    this.startMenu = new StartMenuController(this.ctx);
    this.hud = new HudController(this.ctx);
    this.leaderboard = new LeaderboardController(this.ctx);
    this.backpack = new BackpackController(this.ctx);
    this.settlement = new SettlementController(this.ctx);
    this.publish = new PublishController(this.ctx);
    this.settings = new SettingsController(this.ctx);
    this.debugCtrl = new DebugController(this.ctx);
    this.sealBook = new SealBookController(this.ctx);
    // R4: 委托式 UI 点击音——覆盖所有控制器的主按钮，无需逐个接入
    if (!DomUI.clickSoundWired) {
      DomUI.clickSoundWired = true;
      document.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, [role="button"]')) AudioManager.getInstance().playClick();
      }, true);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════

  init(): void {
    this.hud.buildHUD();
    this.hud.buildQuickBar();

    // destroy() 给 ui-hand/ui-buttons 加了 hidden 类，重新进入战斗时必须移除，
    // 否则第二局起手牌区 display:none 不显示
    for (const id of ['ui-hand', 'ui-buttons']) {
      document.getElementById(id)?.classList.remove('hidden');
    }

    if (!document.getElementById('ui-bottom-area')) {
      const wrap = document.createElement('div');
      wrap.id = 'ui-bottom-area';
      document.body.appendChild(wrap);
    }
    if (!document.getElementById('quick-bar-tip')) {
      const tip = document.createElement('div');
      tip.id = 'quick-bar-tip';
      tip.className = 'quick-bar-tip hidden';
      document.body.appendChild(tip);
    }

    // Wire gear button → settings modal
    document.getElementById('gear-btn')!.addEventListener('click', () => this.settings.showSettingsModal());

    this.hud.initHUD();
  }

  destroy(): void {
    this.hud.clearQuickBarConfirm();
    this.state.turnPieceOrder = [];
    for (const id of ['ui-hud', 'ui-hand', 'ui-buttons', 'ui-toast',
      'ui-start-menu', 'ui-victory', 'ui-debug-modal']) {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ''; el.classList.add('hidden'); }
    }
    const quickBar = document.getElementById('ui-quick-bar');
    if (quickBar) quickBar.remove();
    const bottomArea = document.getElementById('ui-bottom-area');
    if (bottomArea) bottomArea.remove();
  }

  // ═══════════════════════════════════════════════════════════════
  // HUD
  // ═══════════════════════════════════════════════════════════════

  updateHUD(data: HUDData): void { this.hud.updateHUD(data); }
  setConfirmVisible(v: boolean): void { this.hud.setConfirmVisible(v); }
  setDebugMode(enabled: boolean, onDice?: () => void): void { this.hud.setDebugMode(enabled, onDice); }

  // ═══════════════════════════════════════════════════════════════
  // Toast
  // ═══════════════════════════════════════════════════════════════

  showToast(message: string, durationSec: number): void { toast(message, durationSec); }

  // ═══════════════════════════════════════════════════════════════
  // Hand Panel
  // ═══════════════════════════════════════════════════════════════

  updateHand(hand: PieceInfo[], selectedIndex: number, placed: PieceInfo[], summonedThisTurn?: boolean): void {
    this.hud.updateHand(hand, selectedIndex, placed, summonedThisTurn);
  }

  // ═══════════════════════════════════════════════════════════════
  // Start Menu
  // ═══════════════════════════════════════════════════════════════

  showStartMenu(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void {
    this.startMenu.showStartMenu(onStart);
  }
  hideStartMenu(): void { this.startMenu.hideStartMenu(); }

  // ═══════════════════════════════════════════════════════════════
  // Victory / Defeat
  // ═══════════════════════════════════════════════════════════════

  showVictory(data: SettlementData, onNext: () => void, onRestart: () => void, onMenu: () => void, replayMode?: boolean): void {
    this.settlement.showVictory(data, onNext, onRestart, onMenu, replayMode);
  }
  showDefeat(onRestart: () => void, onMenu: () => void, reason?: string): void {
    this.settlement.showDefeat(onRestart, onMenu, reason);
  }
  showTreasureChest(level: number, combatScore: number, onClose: () => void): void {
    this.settlement.showTreasureChest(level, combatScore, onClose);
  }
  hideVictory(): void { this.settlement.hideVictory(); }

  // ═══════════════════════════════════════════════════════════════
  // Debug Modal
  // ═══════════════════════════════════════════════════════════════

  showDebugModal(currentHand: PieceType[], onConfirm: (types: PieceType[]) => void, onCancel?: () => void): void {
    this.debugCtrl.showDebugModal(currentHand, onConfirm, onCancel);
  }
  hideDebugModal(): void { this.debugCtrl.hideDebugModal(); }

  // ═══════════════════════════════════════════════════════════════
  // Leaderboard
  // ═══════════════════════════════════════════════════════════════

  showLeaderboard(entries: RankDisplayItem[], personalRank: RankPersonalInfo | null, nextSortAt: number,
    currentTab: 'total' | 'level', currentLevel: number, gameType: string, period: string, loading: boolean): void {
    this.leaderboard.showLeaderboard(entries, personalRank, nextSortAt, currentTab, currentLevel, gameType, period, loading);
  }
  hideLeaderboard(): void { this.leaderboard.hideLeaderboard(); }

  // ═══════════════════════════════════════════════════════════════
  // Backpack / Items
  // ═══════════════════════════════════════════════════════════════

  showBackpack(): void { void this.backpack.showBackpack(); }
  hideBackpack(): void { this.backpack.hideBackpack(); }
  refreshQuickBar(): void { this.hud.refreshQuickBar(); }
  setPendingItemUsage(items: Readonly<Record<string, number>>): void { this.hud.setPendingItemUsage(items); }
  setSessionEarnedLoongSouls(count: number): void { this.hud.setSessionEarnedLoongSouls(count); }

  // ═══════════════════════════════════════════════════════════════
  // Publish
  // ═══════════════════════════════════════════════════════════════

  showPublishPanel(): void { this.publish.showPublishPanel(); }
  showPublishHint(): void { this.publish.showPublishHint(); }

  // ═══════════════════════════════════════════════════════════════
  // Seal Book
  // ═══════════════════════════════════════════════════════════════

  showSealBook(): void { this.sealBook.showSealBook(); }
  hideSealBook(): void { this.sealBook.hideSealBook(); }
}
