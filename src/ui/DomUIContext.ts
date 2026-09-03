/**
 * Shared state + Host interface for DomUI Controller delegation.
 *
 * DomUIState — mutable shared state, passed by reference so controllers
 *   read/write directly (no setter events).
 * DomUIHost — interface for controllers to read callbacks that DomUI
 *   owns (GameScene assigns them). Controllers import the interface only,
 *   avoiding circular dependency on DomUI class.
 */

import type { SettlementData } from './UIBridge';
import { PendingItemUsage } from '../core/itemTransaction';

export class DomUIState {
  inventory = new PendingItemUsage();
  sessionEarnedLoongSouls = 0;
  lastSettlementData: SettlementData | null = null;
  debugMode = false;
  onDiceClick: (() => void) | null = null;
  turnPieceOrder: string[] = [];
  confirmCallback: (() => void) | null = null;
  uncertainOperations = new Set<string>();
}

export interface DomUIHost {
  readonly onHandSelect: ((index: number) => void) | null;
  readonly onPreviewClick: ((index: number) => void) | null;
  readonly onConfirm: (() => void) | null;
  readonly onRestart: (() => void) | null;
  readonly onMenu: (() => void) | null;
  readonly onCloudSync: (() => void) | null;
  readonly onLeaderboard: (() => void) | null;
  readonly onLeaderboardPublish: (() => void) | null;
  readonly onLeaderboardTabChange: ((tab: 'total' | 'level') => void) | null;
  readonly onLeaderboardLevelChange: ((level: number) => void) | null;
  readonly onLeaderboardFilterChange: ((gameType: string, period: string) => void) | null;
  readonly onLeaderboardCurrentLevel: (() => void) | null;
  readonly onChallengePlayer: ((userHash: string, level: number) => void) | null;
  readonly onBackpackUseItem: ((itemId: string) => boolean | Promise<boolean>) | null;
  readonly onBackpackItemsChanged: ((loongSoulCount?: number) => void) | null;
  readonly onRunPublished: (() => void) | null;
  readonly onBackpackOpen: (() => void) | null;
  readonly onShareInvite: (() => void) | null;
  readonly onShowPublishHint: (() => void) | null;
  readonly onShowPublishPanel: (() => void) | null;
  readonly onSealBookOpen: (() => void) | null;
  readonly onShareReplay: (() => void) | null;
}

export interface DomUIContext {
  state: DomUIState;
  host: DomUIHost;
}
