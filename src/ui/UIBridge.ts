import type { PieceType } from '../core/types';

export interface PieceInfo {
  id: string;
  pieceType: PieceType;
  skillName: string;
  provisionCost?: number;  // 出征粮草消耗（手牌角标显示；英雄召唤/龙棋为 0）
}

export interface HUDData {
  level: number;
  score: number;
  enemyCount: number;
  stormProgress: number; // 0..1
  stormActive: boolean;
  provisionsRemaining: number; // 粮草剩余（≤0 即弹尽粮绝，不能出牌）
  provisionsLimit: number;     // 粮草上限 = 初始上限 + 木牛流马累加
  provisionsBonus: number;     // 木牛流马累加的额外上限
}

export interface RankDisplayItem {
  rank: number;
  userHash: string;
  nickname: string;
  score: number;
  stars: number;
  publishTime: number;
  defenseLevel: number;
}

export interface RankPersonalInfo {
  rank: number;
  score: number;
}

export interface SettlementData {
  level: number;
  piecesScore: number;
  cityScore: number;
  statueScore: number;
  allyLostPenalty: number;
  comboGain: number;          // 连击加成（引擎唯一来源）
  starBonus: number;          // 星星直接得分奖励（引擎唯一来源）
  maxKillsPerStep: number;    // 单步击杀上限（★5 判据）
  bonusScores: { name: string; score: number }[];
  levelMultiplier: number;
  finalScore: number;
  totalScore: number; // cumulative total across all levels
  turnCount: number;
  wagonCount: number; // 本局使用木牛流马次数（★2 判据：0 即达成）
  win: boolean;
  // Star rating
  stars: [boolean, boolean, boolean, boolean, boolean]; // ★1~★5
  totalStars: number; // sum of achieved stars (0-5)
  // 印章（debug 胜利时不传，SettlementController 不渲染）
  seal?: {
    tier: number;
    promoted: boolean;
  };
}

export interface UIBridge {
  init(): void;
  destroy(): void;

  updateHUD(data: HUDData): void;
  updateHand(hand: PieceInfo[], selectedIndex: number, placed: PieceInfo[], summonedThisTurn?: boolean): void;

  setConfirmVisible(visible: boolean): void;
  setDebugMode(enabled: boolean, onDice?: () => void): void;

  showStartMenu(onStart: (debugMode: boolean, startLevel: number, isCampaign?: boolean) => void): void;
  hideStartMenu(): void;
  showVictory(data: SettlementData, onNext: () => void, onRestart: () => void, onMenu: () => void, replayMode?: boolean): void;
  showDefeat(onRestart: () => void, onMenu: () => void, reason?: string): void;
  showTreasureChest(level: number, combatScore: number, onClose: () => void): void;
  hideVictory(): void;
  showDebugModal(currentHand: PieceType[], onConfirm: (types: PieceType[]) => void, onCancel?: () => void): void;
  hideDebugModal(): void;

  showToast(message: string, durationSec: number): void;

  showLeaderboard(entries: RankDisplayItem[], personalRank: RankPersonalInfo | null, nextSortAt: number,
    currentTab: 'total' | 'level', currentLevel: number, gameType: string, period: string, loading: boolean): void;
  hideLeaderboard(): void;

  showBackpack(): void;
  hideBackpack(): void;
  refreshQuickBar(): void;
  setPendingItemUsage(items: Readonly<Record<string, number>>): void;
  setSessionEarnedLoongSouls(count: number): void;
  showPublishPanel(): void;
  showPublishHint(): void;

  onBackpackUseItem: ((itemId: string) => boolean | Promise<boolean>) | null;
  onBackpackItemsChanged: ((loongSoulCount?: number) => void) | null;
  onRunPublished: (() => void) | null;

  onHandSelect: ((index: number) => void) | null;
  onPreviewClick: ((index: number) => void) | null;
  onConfirm: (() => void) | null;
  onRestart: (() => void) | null;
  onMenu: (() => void) | null;
  onCloudSync: (() => void) | null;
  onLeaderboard: (() => void) | null;
  onLeaderboardPublish: (() => void) | null;
  onLeaderboardTabChange: ((tab: 'total' | 'level') => void) | null;
  onLeaderboardLevelChange: ((level: number) => void) | null;
  onLeaderboardFilterChange: ((gameType: string, period: string) => void) | null;
  onLeaderboardCurrentLevel: (() => void) | null;
  onChallengePlayer: ((userHash: string, level: number) => void) | null;
  onBackpackOpen: (() => void) | null;
  onShareInvite: (() => void) | null;
  onShowPublishHint: (() => void) | null;
  onShowPublishPanel: (() => void) | null;
  onSealBookOpen: (() => void) | null;
  onShareReplay: (() => void) | null;

  showSealBook(): void;
  hideSealBook(): void;
}
