import { Application, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { screenToLogical, logicalToScreen, setBoardParams, screenToLogicalMagnetic } from '../utils/coord';
import { Camp, GamePhase, GameResult, PieceType } from '../core/types';
import type { ResolveStep, Point } from '../core/types';
import { SkillEffectPlayer } from '../effects/SkillEffectPlayer';
import { INK_THEME } from '../effects/themes/InkTheme';
import { GOLD_THEME } from '../effects/themes/GoldTheme';
import { SHATTER_THEME } from '../effects/themes/ShatterTheme';
import { CharacterShatterPool } from '../effects/CharacterShatterPool';
import { KINGS_MEETING } from '../effects/EffectConstants';
import { playTransientShockwave } from '../effects/ShockwaveHelper';
import { WasmTurnManager, wasmToTsPiece, TS_PIECE_TO_WASM } from '../wasm/WasmTurnManager';
import type { PieceObj } from '../wasm/WasmTurnManager';
import { PieceType as WasmPieceType, PIECE_NAMES as WasmPieceNames } from '../wasm/types';
import type { RecruitSpawn } from '../wasm/types';
import { SaveManager } from '../core/SaveManager';
import { engineBridge, loadEngine } from '../wasm/EngineBridge';
import { getCurrentSealTier, getAuthoritativeStar3Wins, setServerStar3Wins, sealGoldReward, sealSoulReward, getClaimedTiers, markTierClaimed } from '../ui/sealDefs';
import { preloadPieceIcons } from '../renderers/PieceRenderer';
import { renderNow } from '../utils/renderLoop';
import { TurnStatsRecorder, installTurnStats } from '../utils/turnStats';
// Platform state queried from C++ via engineBridge
import { AudioManager, PIECE_HIT_SOUNDS, getPentatonicRate } from '../audio/AudioManager';
import { t, serverErrorMessage } from '../i18n';
import { BoardRenderer } from '../renderers/BoardRenderer';
import { PieceRenderer, getPieceIconTexture } from '../renderers/PieceRenderer';
import { IntersectionRenderer } from '../renderers/IntersectionRenderer';
import type { PreviewTargetMarker } from '../renderers/IntersectionRenderer';
import { CloudSyncUI } from '../cloud/CloudSyncUI';
import { queryRank, getCoinBalance, walletGrant, getSealWins, getReplayByUser } from '../cloud/api';
import { createLocalRecordBinding, type RecordBinding } from '../core/runBinding';
import { persistGameRecord } from '../core/gameRecord';
import { SUMMON_ITEM_TO_PIECE } from '../core/itemCatalog';
import { DomUI } from '../ui/DomUI';
import type { UIBridge, PieceInfo, SettlementData } from '../ui/UIBridge';
import { Layout } from '../ui/Layout';
import { EngineItemType } from '../wasm/types';
import { LoongLamp } from './LoongLamp';
import { DailyController, getTodayDateStr, dailyDateToSeed } from '../ui/controllers/DailyController';
import { CAMPAIGN_LEVEL_COUNT, getFormationName, getFormationTip } from '../config/levelMeta';
import { copyToClipboard } from '../ui/utils/domHelpers';
import { PIECE_LABELS } from '../ui/utils/pieceIcons';
import { FtueController } from '../ui/controllers/FtueController';
import { ReplayController, parseXqbrRecord } from '../ui/controllers/ReplayController';
import type { XqbrRecord } from '../ui/controllers/ReplayController';
import { ReplayPlaybackRunner } from '../ui/controllers/ReplayPlaybackRunner';

// 调试开关：URL 带 debug=1 时点击棋子打印其参数（与 versionWatermark 的 ?debug 约定一致）
const DEBUG_PIECE_CLICK = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');

export class GameScene {
  private app: Application;
  private turnManager!: WasmTurnManager;

  private boardLayer = new Container();
  private forbiddenLayer = new Container();
  private pieceLayer = new Container();
  private intersectionLayer = new Container();
  private previewLayer = new Container();
  private loongFlameLayer = new Container();
  private loongLamp!: LoongLamp;

  private boardRenderer = new BoardRenderer();
  private intersectionRenderer = new IntersectionRenderer();
  private pieceRenderer = new PieceRenderer();
  private shatterPool: CharacterShatterPool | null = null;
  private effectPlayer!: SkillEffectPlayer;
  private boundOnKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundOnResize: (() => void) | null = null;
  private boundOnPieceStyleChange: (() => void) | null = null;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private currentThemeId: 'ink' | 'gold' | 'shatter' = 'shatter';
  private removeTl: gsap.core.Timeline | null = null;

  private ui: UIBridge = new DomUI();

  private isAnimating = false;
  private currentLevel = 1;
  private debugMode = false;
  /** V1-016: Challenge mode target score (null = normal mode) */
  private challengeTargetScore: number | null = null;
  /** 每日全球同盘挑战日期 (YYYY-MM-DD)，普通局为 null */
  private dailyChallengeDate: string | null = null;
  /** 本局起始种子（用于免后端同局挑战链接） */
  private currentRunSeed = 0;
  /** 本回合已打出击杀的棋子类型与高光绝杀称号 */
  private turnKillTypes: PieceType[] = [];
  private turnTriggeredClassicCallout = false;
  private lastVictoryCallout = '';
  /** 最近一次结算数据（用于分享回放） */
  private lastSettlementData: SettlementData | null = null;
  /** 是否为闯关模式（true=加载 JSON 手工布局, false=无尽程序生成） */
  private campaignMode = true;
  /** V1-015/V1-016: Replay/challenge seed (undefined = normal deterministic seed) */
  private replaySeed: number | undefined = undefined;
  private replayConfig: string | undefined = undefined;
  /** V1-015: Replay playback runner */
  private replayRunner: ReplayPlaybackRunner | null = null;
  private pendingReplayRecord: XqbrRecord | null = null;
  /** 保存 ReplayController 实例，用于关闭回放时 reshow() 分享面板 */
  private replayCtrl: ReplayController | null = null;
  /** Mobile touch-up placement state */
  private isTouchPlacing = false;
  private activeTouchTarget: Point | null = null;
  private activeLockedTarget: Point | null = null;
  private handDragCleanup: (() => void) | null = null;
  private settledLoongSouls = 0;
  private animScore = 0;
  /** 当前回合内已发生的击杀步数，用于连击音高递增 */
  private comboStep = 0;
  /** 风暴槽动画值：resolve 动画期间逐步增长，afterResolve 后清空回退到引擎值 */
  private animatingStormCharge: number | null = null;
  /** R2：本回合 confirm 前的引擎分（animScore 起步值） */
  private prevTurnScore = 0;
  /** R2：confirm 后引擎权威总分（回合末 snap 目标，保证累计分 == 结算分） */
  private turnNewScore = 0;
  /** R2：本回合每个击杀目标的引擎类别增量（targetId → 分数），替代硬编码 150/200/100/-30 */
  private perKillScore = new Map<string, number>();
  /** 调试模式回合耗时统计（URL 带 debug=1 时启用，window.turnStats() 查看） */
  private turnStats = new TurnStatsRecorder();

  constructor(app: Application) {
    this.app = app;
    this.shatterPool = new CharacterShatterPool();
    this.effectPlayer = new SkillEffectPlayer(SHATTER_THEME, this.shatterPool);
    installTurnStats();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  /** V1-016: Start a specific level directly (used by challenge mode). */
  private beginLevel(level: number, seed?: number, configJson?: string, forceCampaign?: boolean): void {
    this.dailyChallengeDate = null;
    this.debugMode = false;
    this.currentLevel = level;
    this.replaySeed = seed;
    this.replayConfig = configJson;
    // 清空回放状态：挑战模式不是回放，init() 不应进入 replayPlay 分支
    this.replayRunner?.destroy();
    this.replayRunner = null;
    this.pendingReplayRecord = null;
    this.campaignMode = forceCampaign ?? !!configJson;
    SaveManager.clearGameState();
    this.ui.hideStartMenu();
    void loadEngine();
    this.showEnterBattle();
  }

  /** 启动每日全球同盘挑战（按日期固定确定性种子，全局玩家同一局） */
  private beginDailyChallenge(dateStr: string): void {
    this.dailyChallengeDate = dateStr;
    this.challengeTargetScore = null;
    this.debugMode = false;
    this.currentLevel = 10;
    this.replaySeed = dailyDateToSeed(dateStr);
    this.replayConfig = undefined;
    this.replayRunner?.destroy();
    this.replayRunner = null;
    this.pendingReplayRecord = null;
    this.campaignMode = false;
    SaveManager.clearGameState();
    this.ui.hideStartMenu();
    void loadEngine();
    this.showEnterBattle();
  }

  /** V1-015: Start replay playback mode — init engine with record's seed and auto-play actions. */
  private beginReplay(record: XqbrRecord): void {
    this.dailyChallengeDate = null;
    this.pendingReplayRecord = record;
    // 直接进入回放，不显示"进入战斗"动画；同时清空结算页状态，避免引擎状态变更后误用
    this.debugMode = false;
    this.currentLevel = record.levelId;
    this.replaySeed = record.rngSeed;
    this.replayConfig = record.configJson || undefined;
    // 回放模式根据 record 是否有 configJson 决定是否加载 JSON 关卡配置：
    // 有 configJson → CAMPAIGN 模式（但 levelConfig 已有值，不会重新加载 JSON）
    // 无 configJson → ENDLESS 模式（campaignMode=false，避免错误加载 JSON 导致手牌不匹配）
    this.campaignMode = !!record.configJson;
    this.isAnimating = false;  // 重置动画状态，避免上一局残留阻塞 tick
    SaveManager.clearGameState();
    this.ui.hideStartMenu();
    this.ui.hideVictory();
    this.lastSettlementData = null;
    void loadEngine();
    void this.init();
  }

  /** V1-015: Replay a PLACE action — find matching hand piece, place on board with drop animation. */
  private replayPlace(wasmCode: number, col: number, row: number): void {
    const tsPiece = wasmToTsPiece(wasmCode as any);
    const handIndex = this.turnManager.hand.findIndex(p => p.pieceType === tsPiece);
    if (handIndex < 0) return;
    this.turnManager.selectHand(handIndex);
    this.doPlacePiece(col, row);
  }

  /** 统一放置棋子逻辑（含落子动画、技能指示圈展示、粮草告警） */
  private doPlacePiece(col: number, row: number, originX?: number, originY?: number): boolean {
    const placeRet = this.turnManager.placeOnBoard(col, row);
    // 引擎兜底：选牌校验后的残余粮草不足（正常流程由选牌拦截，此处防御）
    if (placeRet === -7) this.ui.showToast(t('toast.noProvisions'), 1.5);
    if (placeRet === 0) {
      this.clearEnemyInspect();
      this.intersectionRenderer.clearSkillPreview();
      this.refreshUI();
      const lastPlaced = this.turnManager.placed[this.turnManager.placed.length - 1];
      if (lastPlaced && lastPlaced.position) {
        this.intersectionRenderer.addSkillRange(lastPlaced.id, lastPlaced.skill.getAttackRange(lastPlaced.position!));
        const wrapper = this.pieceRenderer.getContainer(lastPlaced.id);
        if (wrapper) {
          const targetPos = logicalToScreen(col, row);
          // 真正的磁吸落子：棋子从玩家点击/松手的屏幕原点斜向磁吸吸入目标交叉点
          const startX = originX !== undefined ? originX : targetPos.x;
          const startY = originY !== undefined ? originY - 45 : targetPos.y - 70;
          wrapper.x = startX;
          wrapper.y = startY;
          wrapper.scale.set(0.8, 1.25);
          gsap.timeline()
            .to(wrapper, { x: targetPos.x, y: targetPos.y, duration: CONFIG.ANIM.PLACE, ease: 'power2.in' })
            .to(wrapper.scale, { x: 1.35, y: 0.65, duration: 0.08, ease: 'power1.out' })
            .to(wrapper.scale, { x: 1.0, y: 1.0, duration: 0.28, ease: 'back.out(3)' });
        }
      }
      this.checkStalemate();
      return true;
    }
    return false;
  }

  start(): void {
    const fullSave = SaveManager.loadGameState();
    const hasCheckpoint = fullSave !== null && fullSave.phase !== GamePhase.GAME_OVER;

    // 自动为首次访客生成持久身份，免口令弹窗直接可发榜/分享/挑战
    SaveManager.ensureGuestIdentity();

    // 初始化平台存档（含游客本地钱包/道具），确保主菜单能正确显示金币与龙魂
    const hash = SaveManager.getHash();
    engineBridge.platformInit(hash, '1');

    // V1-012: 从服务端同步权威 star3 wins 计数（不阻塞主流程）
    if (hash) {
      getSealWins(hash)
        .then(res => {
          if (res.code === 0 && res.data) {
            setServerStar3Wins(res.data.star3Wins);
          }
        })
        .catch(() => { /* 离线兜底用 localStorage */ });

      // 页面加载时同步服务端金币余额（仅本地为 0 时，避免覆盖宝箱等本地奖励）
      if (engineBridge.getPlatformGold() === 0) {
        getCoinBalance(hash)
          .then(res => {
            if (res.code === 0 && res.data && res.data.balance > 0) {
              engineBridge.platformSetBalance(res.data.balance, 0);
              engineBridge.platformSave();
            }
          })
          .catch(() => { /* 离线时沿用本地 */ });
      }
    }

    // V1-015: Check URL for replay code (?replay=XXXXXX) or daily board (?daily=YYYY-MM-DD)
    const urlParams = new URLSearchParams(window.location.search);
    const replayCode = urlParams.get('replay');
    if (replayCode) {
      window.history.replaceState({}, '', window.location.pathname);
      const replayCtrl = this.replayCtrl = new ReplayController();
      replayCtrl.showViewer(
        replayCode,
        // V1-016: Challenge — pass parsed record so seed can be extracted
        (level, targetScore, record) => {
          if (!SaveManager.hasHash()) {
            this.ui.showToast(t('toast.syncFirst'), 3);
            return;
          }
          const seed = record?.rngSeed;
          const config = record?.configJson || undefined;
          replayCtrl.showChallengeIntro(level, targetScore,
            () => { this.challengeTargetScore = targetScore; this.beginLevel(level, seed, config); },
            () => { this.start(); },
          );
        },
        // V1-015: Watch Replay — frame-by-frame playback
        (record) => { this.beginReplay(record); },
      );
      return;
    }

    const dailyParam = urlParams.get('daily');
    if (dailyParam && /^\d{4}-\d{2}-\d{2}$/.test(dailyParam)) {
      window.history.replaceState({}, '', window.location.pathname);
      this.beginDailyChallenge(dailyParam);
      return;
    }

    // 免后端同局挑战链接 (?challenge=1&lv=N&seed=S&target=T&mode=c)
    if (urlParams.get('challenge') === '1') {
      const lv = parseInt(urlParams.get('lv') || '0', 10);
      const seed = parseInt(urlParams.get('seed') || '0', 10);
      const target = parseInt(urlParams.get('target') || '0', 10);
      const isCamp = urlParams.get('mode') === 'c';
      window.history.replaceState({}, '', window.location.pathname);
      if (lv >= 1 && seed > 0) {
        const ctrl = new ReplayController();
        ctrl.showChallengeIntro(lv, target,
          () => { this.challengeTargetScore = target > 0 ? target : null; this.beginLevel(lv, seed, undefined, isCamp); },
          () => { this.start(); },
        );
        return;
      }
    }

    this.ui.onDailyChallenge = () => {
      this.beginDailyChallenge(getTodayDateStr());
    };

    this.ui.onCopyChallengeLink = async () => {
      const d = this.lastSettlementData;
      const base = `${window.location.origin}${window.location.pathname}`;
      const inviteUrl = this.dailyChallengeDate
        ? `${base}?daily=${this.dailyChallengeDate}`
        : `${base}?challenge=1&lv=${this.currentLevel}&seed=${this.currentRunSeed || ((this.currentLevel * 73856093 + 1) >>> 0)}&target=${d?.finalScore ?? 0}${this.campaignMode ? '&mode=c' : ''}`;
      const title = d?.formationName ? `${d.level}·${d.formationName}` : `${this.currentLevel}`;
      const text = this.dailyChallengeDate
        ? DailyController.formatDailyShareText(this.dailyChallengeDate, d?.finalScore ?? 0, d?.totalStars ?? 0, d?.turnCount ?? 1)
        : `🐉 ${t('game.name')} [${title}] ${d?.finalScore ?? 0} pts\n${inviteUrl}`;
      const ok = await copyToClipboard(text);
      this.ui.showToast(ok ? t('invite.copied') : t('replay.copyFail'), 2.2);
    };

    this.ui.onCloudSync = () => {
      const syncUI = new CloudSyncUI(() => this.start());
      syncUI.show();
    };
    this.ui.onBackpackOpen = () => {
      this.syncServerGold();
      this.ui.showBackpack();
    };
    this.ui.onSealBookOpen = () => {
      this.ui.showSealBook();
    };
    // ── Leaderboard state ──
    let lbTab: 'total' | 'level' = 'total';
    let lbLevel = 1;
    let lbGameType = 'main';
    let lbPeriod = 'total';

    this.ui.onLeaderboard = async () => {
      lbTab = 'total'; lbLevel = 1; lbGameType = 'main'; lbPeriod = 'total';
      this.refreshLeaderboard(lbTab, lbLevel, lbGameType, lbPeriod, true);
    };

    this.ui.onLeaderboardTabChange = (tab) => {
      lbTab = tab; lbLevel = tab === 'level' ? 1 : 0;
      this.refreshLeaderboard(lbTab, lbLevel, lbGameType, lbPeriod, !(tab === 'total'));
    };

    this.ui.onLeaderboardLevelChange = (level) => {
      lbLevel = level;
      this.refreshLeaderboard(lbTab, lbLevel, lbGameType, lbPeriod, true);
    };

    this.ui.onLeaderboardFilterChange = (gameType, period) => {
      lbGameType = gameType; lbPeriod = period;
      this.refreshLeaderboard(lbTab, lbLevel, lbGameType, lbPeriod, true);
    };

    this.ui.onLeaderboardCurrentLevel = () => {
      lbTab = 'level'; lbLevel = this.currentLevel;
      this.refreshLeaderboard('level', this.currentLevel, lbGameType, lbPeriod, true);
    };

    this.ui.onChallengePlayer = async (userHash: string, level: number) => {
      this.ui.showToast(t('replay.loading'), 1.5);
      const resp = await getReplayByUser(userHash, level);
      if (resp.code !== 0 || !resp.data) {
        this.ui.showToast(t('replay.notFound'), 2);
        return;
      }
      const replayCtrl = this.replayCtrl = new ReplayController();
      replayCtrl.showViewer(resp.data.code,
        (lv, targetScore, record) => {
          if (!SaveManager.hasHash()) { this.ui.showToast(t('toast.syncFirst'), 3); return; }
          const seed = record?.rngSeed;
          const config = record?.configJson || undefined;
          replayCtrl.showChallengeIntro(lv, targetScore,
            () => { this.challengeTargetScore = targetScore; this.beginLevel(lv, seed, config); },
            () => { this.start(); },
          );
        },
        (record) => { this.beginReplay(record); },
      );
    };

    this.ui.onShareReplay = async () => {
      const data = this.lastSettlementData;
      if (!data) { this.ui.showToast(t('replay.shareFail'), 2); return; }
      const replayCtrl = this.replayCtrl = new ReplayController();
      // showLocalShare 内部先显示 loading 面板，再上传，再用本地数据渲染（不重复请求 getReplay）
      await replayCtrl.showLocalShare(
        this.currentLevel,
        data.finalScore,
        data.totalStars,
        (lv, targetScore, record) => {
          const seed = record?.rngSeed;
          const config = record?.configJson || undefined;
          replayCtrl.showChallengeIntro(lv, targetScore,
            () => { this.challengeTargetScore = targetScore; this.beginLevel(lv, seed, config); },
            () => { this.start(); },
          );
        },
        (record) => { this.beginReplay(record); },
      );
    };

    this.ui.onLeaderboardPublish = () => {
      this.ui.showPublishPanel();
    };
    this.ui.onShowPublishHint = () => { this.ui.showPublishHint(); };
    this.ui.onShowPublishPanel = () => { this.ui.showPublishPanel(); };
    this.ui.showStartMenu((debugMode: boolean, startLevel: number, isCampaign?: boolean) => {
      this.dailyChallengeDate = null;
      this.debugMode = debugMode;
      this.currentLevel = startLevel;
      this.campaignMode = isCampaign ?? true;
      // Reset replay/challenge state for normal game start
      this.replaySeed = undefined;
      this.replayConfig = undefined;
      this.replayRunner?.destroy();
      this.replayRunner = null;
      this.pendingReplayRecord = null;
      if (!(hasCheckpoint && startLevel === fullSave!.level)) {
        SaveManager.clearGameState();
      }
      this.ui.hideStartMenu();
      void loadEngine(); // pre-load WASM in background
      this.showEnterBattle();
    },);
  }

  private showEnterBattle(): void {
    const el = document.createElement('div');
    el.className = 'enter-battle';
    const formation = !this.dailyChallengeDate ? getFormationName(this.currentLevel) : '';
    const tip = !this.dailyChallengeDate ? getFormationTip(this.currentLevel) : '';
    const subHtml = this.dailyChallengeDate
      ? `<div class="enter-battle-meta">${t('daily.levelTag', { date: this.dailyChallengeDate })}</div>`
      : formation
        ? `<div class="enter-battle-meta">「${formation}」</div>${tip ? `<div class="enter-battle-tip">${tip}</div>` : ''}`
        : '';
    el.innerHTML = `<div class="glass-panel" style="width:min(300px,88vw);padding:28px 24px;text-align:center;border-radius:16px;"><div class="level-text">${t('battle.level', { level: this.currentLevel })}</div>${subHtml}<div class="battle-text">${t('battle.enter')}</div></div>`;
    document.body.appendChild(el);
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (reducedMotion) {
      el.remove();
      void this.init();
      return;
    }
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => { el.remove(); void this.init(); }, 300); }, 800);
  }

  private async init(): Promise<void> {
    const cw = window.innerWidth, ch = window.innerHeight;
    this.settledLoongSouls = 0;
    this.lastVictoryCallout = '';
    this.ui.init();

    // 回放模式下禁用所有交互回调（手牌选择/预览点击/确认/重开），
    // 防止用户在回放过程中操作手牌、落子
    const isReplay = !!this.pendingReplayRecord || !!this.replayRunner?.isReplay;
    this.ui.onHandSelect = isReplay ? null : (i) => this.onHandSelect(i);
    this.ui.onHandDragStart = isReplay ? null : (i, x, y, pt) => this.handleHandDragStart(i, x, y, pt);
    this.ui.onUndoPlacement = isReplay ? null : () => this.onUndo();
    this.ui.onPreviewClick = isReplay ? null : (i) => {
      const p = this.turnManager.placed[i];
      if (!p) return;
      this.intersectionRenderer.removeSkillRange(p.id);
      this.turnManager.removePlaced(p.id);
      // Select the piece that was just returned to hand
      const idx = this.turnManager.hand.findIndex(h => h.id === p.id);
      if (idx >= 0) this.turnManager.selectHand(idx);
      this.refreshUI();
    };
    this.ui.onConfirm = isReplay ? null : () => this.onConfirm();
    this.ui.onSkipTurn = isReplay ? null : () => this.onSkipTurn();
    this.ui.onRestart = isReplay ? null : () => { this.restart(); };
    this.ui.onMenu = () => { this.cleanupScene(); this.start(); };

    this.ui.onBackpackItemsChanged = (loongSoulCount) => {
      this.loongLamp?.setCount(loongSoulCount ?? this.getDisplayedLoongSoulCount());
      this.ui.refreshQuickBar();  // 购买/锻造后即时刷新快捷栏（引擎库存已同步落盘）
    };
    this.ui.onRunPublished = () => {
      this.settledLoongSouls = this.turnManager.loongSoulsCollectedThisGame;
      this.ui.setSessionEarnedLoongSouls(0);
      this.loongLamp?.setCount(this.getDisplayedLoongSoulCount());
    };
    this.ui.onBackpackUseItem = async (itemId) => {
      DailyController.trackItemUse();
      if (itemId === 'undo') {
        const snapshot = SaveManager.loadPreviousTurnSnapshot();
        if (!snapshot) { this.ui.showToast(t('toast.undoNoPrev'), 1.5); return false; }
        if (this.turnManager.phase === GamePhase.GAME_OVER) { this.ui.showToast(t('toast.gameOver'), 1.5); return false; }
        let restored: WasmTurnManager;
        try {
          restored = WasmTurnManager.fromSaveData(snapshot, SaveManager.getHash());
        } catch {
          this.ui.showToast(t('toast.undoInvalid'), 1.5);
          return false;
        }
        if (restored.useItem(EngineItemType.UNDO) !== 0) {
          this.ui.showToast(t('toast.cannotUndo'), 1.5);
          return false;
        }
        const finalState = restored.exportState();
        if (!SaveManager.commitPaidUndo(finalState)) {
          try {
            const current = SaveManager.loadTurnSnapshot();
            if (current) this.turnManager = WasmTurnManager.fromSaveData(current, SaveManager.getHash());
          } catch { /* the durable current snapshot remains the refresh recovery source */ }
          this.ui.showToast(t('toast.undoSaveFailed'), 2);
          return false;
        }
        this.turnManager = restored;
        this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
        this.intersectionRenderer.renderAllIntersections(this.turnManager.board.cols, this.turnManager.board.rows);
        this.intersectionRenderer.showForbiddenZones(this.turnManager.forbiddenZone.getAllZonePoints());
        this.refreshUI();
        this.ui.showToast(t('toast.undoDone'), 1.5);
        return true;
      } else if (itemId === 'redraw') {
        if (this.turnManager.useItem(EngineItemType.REDRAW) === 0) {
          this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
          this.intersectionRenderer.clear();
          this.refreshUI();
          this.saveCheckpoint();
          this.ui.showToast(t('toast.redrawDone'), 1.5);
          return true;
        }
        this.ui.showToast(t('toast.cannotRedraw'), 1.5);
        return false;
      } else if (itemId === 'unseal') {
        if (this.turnManager.useItem(EngineItemType.UNSEAL) === 0) {
          this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
          this.intersectionRenderer.showForbiddenZones([]);
          this.refreshUI();
          this.saveCheckpoint();
          this.ui.showToast(t('toast.unsealDone'), 1.5);
          return true;
        }
        this.ui.showToast(t('toast.cannotUse'), 1.5);
        return false;
      } else if (itemId === 'handSet') {
        if (this.turnManager.phase !== GamePhase.SELECT_HAND && this.turnManager.phase !== GamePhase.PLACE_PIECE) {
          this.ui.showToast(t('toast.cannotUse'), 1.5);
          return false;
        }
        return new Promise<boolean>((resolve) => {
          this.ui.showDebugModal([], (types) => {
            if (types.length !== 3) { this.ui.showToast(t('toast.select3'), 1.5); resolve(false); return; }
            if (this.turnManager.useItem(EngineItemType.HAND_SET, types) !== 0) {
              this.ui.showToast(t('toast.handSetFailed'), 1.5);
              resolve(false);
              return;
            }
            this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
            this.intersectionRenderer.clear();
            this.refreshUI();
            this.saveCheckpoint();
            this.ui.showToast(t('toast.handSetDone'), 1.5);
            resolve(true);
          }, () => resolve(false));
        });
      } else if (itemId === 'provision_wagon') {
        // 木牛流马：+5 粮草上限（叠加；用过即失 ★2）
        if (this.turnManager.useItem(EngineItemType.PROVISION_WAGON) === 0) {
          this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
          this.refreshUI();
          this.saveCheckpoint();
          this.ui.showToast(t('toast.provisionWagonDone'), 1.5);
          return true;
        }
        this.ui.showToast(t('toast.cannotUse'), 1.5);
        return false;
      } else if (SUMMON_ITEM_TO_PIECE[itemId]) {
        // 英雄棋子召唤令：消耗 1 枚，召唤英雄棋子到手牌区
        const pt = SUMMON_ITEM_TO_PIECE[itemId];
        if (this.turnManager.summonHero(pt) === 0) {
          this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
          this.intersectionRenderer.clear();
          this.refreshUI();
          this.saveCheckpoint();
          this.ui.showToast(t('toast.summoned'), 1.5);
          return true;
        }
        this.ui.showToast(t('toast.cannotUse'), 1.5);
        return false;
      }
      this.ui.showToast(t('toast.unknownItem'), 1.5);
      return false;
    };

    this.app.stage.addChild(this.boardLayer, this.forbiddenLayer, this.loongFlameLayer, this.pieceLayer, this.intersectionLayer, this.previewLayer);
    this.boardLayer.addChild(this.boardRenderer.container);
    this.forbiddenLayer.addChild(this.intersectionRenderer.belowContainer);
    this.intersectionLayer.addChild(this.intersectionRenderer.container);
    this.pieceLayer.addChild(this.pieceRenderer.container);

    const fullSave = SaveManager.loadGameState();
    // Ensure engine and piece icons are ready before either restoring or creating a game.
    await Promise.all([loadEngine(), preloadPieceIcons()]);
    // Initialize shatter pool (needs web font loaded for Chinese char extraction)
    if (this.shatterPool) await this.shatterPool.init(this.app.renderer);
    let restoredSave = false;
    if (fullSave && fullSave.level === this.currentLevel) {
      try {
      // Restore from full save
      Layout.update(cw, ch, fullSave.boardCols, fullSave.boardRows);
      setBoardParams(Layout.boardOrigin.x, Layout.boardOrigin.y, Layout.cellSize, fullSave.boardCols, fullSave.boardRows);
      this.boardRenderer.draw(fullSave.boardCols, fullSave.boardRows);
      this.intersectionRenderer.renderAllIntersections(fullSave.boardCols, fullSave.boardRows);
      this.turnManager = WasmTurnManager.fromSaveData(fullSave, SaveManager.getHash());
      // Edge case: all enemies dead but win not registered in C++
      const aliveEnemies = this.turnManager.enemyUnits.filter(u => u.alive && !u.isStatue).length;
      if (aliveEnemies === 0 && this.turnManager.gameResult === GameResult.NONE) {
        console.warn('[GameScene] restored save with 0 enemies but no win — forcing victory');
        engineBridge.forceVictory();
        this.turnManager.syncState();
      }
      // Initialize platform state (gold, inventory, item definitions)
      engineBridge.platformInit(SaveManager.getHash(), '1');
      restoredSave = true;
      } catch (error) {
        console.warn('[GameScene] discarded incompatible save', error);
        SaveManager.clearGameState();
        this.ui.showToast(t('toast.engineCompat'), 3);
      }
    }
    if (!restoredSave) {
      // Clear stale save and start fresh
      SaveManager.clearGameState();
      // Initialize platform state (gold, inventory, item definitions)
      const hash = SaveManager.getHash();
      engineBridge.platformInit(hash, '1');
      // 无身份（未绑定口令）时单机可玩：使用 local guest binding 让引擎 record_builder_
      // 能正常记录与 export_state 序列化（使得刷新/返回首页可恢复对局），同时标记 unpublishable 阻止发布到排行榜
      const guestHash = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
      const effectiveHash = hash || guestHash;
      let binding: RecordBinding | undefined;
      try {
        binding = createLocalRecordBinding(effectiveHash, this.currentLevel);
      } catch { /* 保留 undefined */ }
      // 挑战/回放模式优先使用 record 中的 config；否则闯关模式加载 1~20 关手工名局
      let levelConfig: string | undefined = this.replayConfig;
      if (!levelConfig && this.campaignMode && this.currentLevel >= 1 && this.currentLevel <= CAMPAIGN_LEVEL_COUNT) {
        try {
          const resp = await fetch(`${import.meta.env.BASE_URL}levels/level_${1000 + this.currentLevel}.json`);
          if (resp.ok) {
            const text = await resp.text();
            if (text.startsWith('CB_ENC') || text.startsWith('{')) {
              levelConfig = text;
            }
          }
        } catch { /* 无对应 JSON 文件时使用程序生成 */ }
      }
      this.currentRunSeed = this.replaySeed ?? ((this.currentLevel * 73856093 + 1) >>> 0);
      this.turnManager = new WasmTurnManager(this.currentLevel, this.replaySeed, levelConfig);
      if (binding) {
        this.turnManager.setRecordBinding(binding);
      }
      if (!hash) {
        this.turnManager.markRecordUnpublishable('err.identity_invalid');
      } else if (!binding || this.turnManager.recordPublishError) {
        this.turnManager.markRecordUnpublishable(this.turnManager.recordPublishError ?? 'toast.engineCompat');
      }
      const bs = this.turnManager.board;
      Layout.update(cw, ch, bs.cols, bs.rows);
      setBoardParams(Layout.boardOrigin.x, Layout.boardOrigin.y, Layout.cellSize, bs.cols, bs.rows);
      this.boardRenderer.draw(bs.cols, bs.rows);
      this.intersectionRenderer.renderAllIntersections(bs.cols, bs.rows);
    }
    // LoongLamp — injected into HUD left slot
    this.loongLamp = new LoongLamp();
    const lampSlot = document.getElementById('hud-lamp-slot');
    if (lampSlot) lampSlot.appendChild(this.loongLamp.container);
    this.loongLamp.show();
    this.ui.setSessionEarnedLoongSouls(this.getUnsettledLoongSoulCount());
    this.loongLamp.setCount(this.getDisplayedLoongSoulCount());
    this.pieceRenderer.renderAll([...this.turnManager.enemyUnits, ...this.turnManager.hand]);
    this.intersectionRenderer.showForbiddenZones(this.turnManager.forbiddenZone.getAllZonePoints());
    this.refreshUI();
    // If restored game is already won/lost, show settlement immediately
    if (this.turnManager.gameResult !== GameResult.NONE) {
      setTimeout(() => this.checkGameOver(), 500);
    } else {
      setTimeout(() => this.checkStalemate(), 600);
    }
    this.ui.setPendingItemUsage(this.turnManager.pendingItemUsage.pendingUsage);
    if (restoredSave) {
      if (!SaveManager.loadTurnSnapshot()) SaveManager.initializeTurnSnapshots(this.turnManager.exportState());
    } else {
      SaveManager.initializeTurnSnapshots(this.turnManager.exportState());
      this.saveCheckpoint();
    }

    this.ui.refreshQuickBar();

    // 调试统计：新一局/换关重置计时并开启第一回合；回放模式不记录
    this.turnStats.onSceneInit(!isReplay, this.currentLevel);

    // V1-015: If in replay mode, show playback controls and auto-start playback
    if (this.pendingReplayRecord) {
      const record = this.pendingReplayRecord;
      this.pendingReplayRecord = null;
      this.replayRunner?.destroy();
      this.replayRunner = new ReplayPlaybackRunner({
        onPlace: (wasmCode, col, row) => this.replayPlace(wasmCode, col, row),
        onUndo: () => this.onUndo(),
        onSkip: () => this.onSkipTurn(),
        onConfirm: () => this.onConfirm(),
        onUseItem: (code) => {
          this.turnManager.useItem(code as EngineItemType);
          this.refreshUI();
        },
        onComplete: () => {
          this.checkGameOver();
        },
        onClose: () => {
          this.cleanupScene();
          const onQuit = () => { this.start(); };
          if (this.replayCtrl?.reshow(onQuit)) {
            // 分享面板已重新显示，等用户关闭后再回主菜单
          } else {
            this.start();
          }
        },
        isAnimating: () => this.isAnimating,
        isGameOver: () => this.turnManager.gameResult !== GameResult.NONE,
        showToast: (msg, dur) => this.ui.showToast(msg, dur ?? 2),
      });
      this.replayRunner.start(record);
    }

    // Synchronous re-measure now that ui-hand and quick bar are populated.
    // The initial Layout.update (line ~306/352) ran before fromSaveData, so
    // ui-hand was still empty (height≈16px) and handTop was too high — cellSize
    // and boardOrigin were computed against a stale hand panel. refreshUI →
    // refreshHUD → updateHand has now filled ui-hand, so re-measure immediately
    // to avoid rendering pieces at the wrong positions during the rAF gap.
    this.onResize();
    // Re-measure board layout now that UI elements are visible.
    // Use double-rAF: first frame schedules measurement after the browser has
    // had a chance to lay out the freshly-built DOM (CSS/fonts may still be
    // settling when init() runs synchronously after ui.init()). Second rAF
    // catches late layout shifts after the first paint. setTimeout fallback
    // covers inactive-tab case where rAF is throttled.
    requestAnimationFrame(() => {
      this.onResize();
      requestAnimationFrame(() => this.onResize());
    });
    setTimeout(() => this.onResize(), 200);
    // Font loading is the last common cause of late layout shifts: ui-hand
    // height depends on the rendered font metrics of hand pieces, so when
    // @font-face resolves after the 200ms fallback, handTop changes silently
    // and the board keeps the stale cellSize/boardOrigin — pieces then appear
    // off their grid intersections. Re-measure once fonts are ready, plus a
    // longer 1s fallback for slow networks where fonts.ready is delayed.
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => this.onResize());
    }
    setTimeout(() => this.onResize(), 1000);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.removeAllListeners();
    this.app.stage.on('pointerdown', (e) => this.onPointerDown(e));
    this.app.stage.on('pointermove', (e) => this.onPointerMove(e));
    this.app.stage.on('pointerup', (e) => this.onPointerUp(e));
    this.app.stage.on('pointerupoutside', (e) => this.onPointerUp(e));
    if (this.boundOnResize) window.removeEventListener('resize', this.boundOnResize);
    this.boundOnResize = () => {
      if (this._resizeTimer) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.onResize(), 100);
    };
    window.addEventListener('resize', this.boundOnResize);
    if (this.boundOnKeyDown) window.removeEventListener('keydown', this.boundOnKeyDown);
    this.boundOnKeyDown = (e) => this.onKeyDown(e);
    window.addEventListener('keydown', this.boundOnKeyDown);
    if (this.boundOnPieceStyleChange) window.removeEventListener('piecestylechange', this.boundOnPieceStyleChange);
    this.boundOnPieceStyleChange = () => this.refreshUI();
    window.addEventListener('piecestylechange', this.boundOnPieceStyleChange);

    // 接入屏幕震动目标 + reduced-motion 偏好
    this.effectPlayer.setShakeTarget(this.app.stage);

    const enemyAlive = this.turnManager.enemyUnits.filter(u => u.alive && !u.isStatue).length;
    if (this.turnManager.recordPublishError) this.ui.showToast(t(this.turnManager.recordPublishError), 5);
    else this.ui.showToast(t('toast.levelStart', { level: this.currentLevel, count: enemyAlive }), 3);
    if (AudioManager.getInstance().getBgmVolume() > 0) AudioManager.getInstance().playBgm();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  UI State
  // ═══════════════════════════════════════════════════════════════════

  private refreshUI(): void {
    const aliveGuards = this.turnManager.enemyUnits.filter(u => this.isRoyalGuardUnit(u)).length;
    const annotatedEnemies = this.turnManager.enemyUnits
      .filter(u => u.alive)
      .map(u => {
        (u as any).isRoyalGuard = this.isRoyalGuardUnit(u);
        (u as any).isShielded = u.pieceType === PieceType.GENERAL && aliveGuards > 0;
        return u;
      });
    const units = [
      ...annotatedEnemies,
      ...this.turnManager.hand.filter(u => u.alive),
      ...this.turnManager.placed,
      ...this.turnManager.boardPieces,
    ];
    this.pieceRenderer.renderAll(units);
    // Add order badges to placed pieces on board (gold circle + black digit)
    this.turnManager.placed.forEach((p, i) => {
      if (!p.position) return;
      const wrapper = this.pieceRenderer.getContainer(p.id);
      if (!wrapper) return;
      // Remove old badge if exists
      const old = wrapper.getChildByLabel?.('order-badge');
      if (old) { old.removeFromParent(); old.destroy(); }
      // Badge container
      const badge = new Container();
      badge.label = 'order-badge';
      const gfx = new Graphics();
      gfx.circle(0, 0, 9).fill({ color: 0xffd700 }).stroke({ width: 1, color: 0xffffff, alpha: 0.5 });
      badge.addChild(gfx);
      const txt = new Text({
        text: `${i + 1}`,
        style: { fontSize: 10, fill: 0x000000, fontFamily: 'Arial', fontWeight: '700' },
      });
      txt.anchor.set(0.5);
      badge.addChild(txt);
      badge.x = 14; badge.y = -14;
      wrapper.addChild(badge);
    });
    if (!this.turnManager.unsealed) {
      this.intersectionRenderer.showForbiddenZones(this.turnManager.forbiddenZone.getAllZonePoints());
    } else {
      this.intersectionRenderer.showForbiddenZones([]);
    }
    this.ui.setConfirmVisible(this.turnManager.canConfirm());
    this.ui.setDebugMode(this.debugMode, () => {
      this.ui.showDebugModal(this.turnManager.hand.map(p => p.pieceType as PieceType), (types) => {
        engineBridge.clearHand();
        for (const t of types) this.turnManager.addHandPiece(t);
        this.refreshUI();
        this.ui.showToast(t('toast.handSetDone'), 1.5);
      });
    });
    this.refreshHUD();
    if (this.turnManager.phase !== GamePhase.PLACE_PIECE) {
      this.intersectionRenderer.clearSkillPreview();
      this.intersectionRenderer.clear();
    } else if (this.turnManager.selectedHandIndex >= 0) {
      // Bug 2 fix: 选中的手牌落子阶段必须显示可落子黄点
      const validPoints = this.turnManager.getValidPlacements();
      this.intersectionRenderer.showValidPlacements(validPoints);
    }
    this.drawLoongFlames();
    // 命令式重建棋子/指示层不经过 gsap，手动补帧（渲染按需化后不再每帧重绘）
    renderNow();
    // FTUE: contextual hints during level 1
    if (FtueController.isActiveForLevel(this.currentLevel)) {
      if (this.turnManager.phase === GamePhase.SELECT_HAND) FtueController.hintSelectHand();
      else if (this.turnManager.phase === GamePhase.PLACE_PIECE) FtueController.hintPlacePiece();
    }
  }

  /** Animate soul orbs flying from consumed flame positions to the LoongLamp. */
  private playSoulFlight(flamePositions: { col: number; row: number }[], onComplete: () => void): void {
    const rect = this.loongLamp.container.getBoundingClientRect();
    const lampX = rect.left + rect.width / 2;
    const lampY = rect.top + rect.height / 2;
    let completed = 0;
    let finished = false;
    const orbTimelines: gsap.core.Timeline[] = [];
    const total = flamePositions.length;
    const perFlame = 3; // soul orbs per flame
    if (total === 0) { onComplete(); return; }
    let safetyTimer: ReturnType<typeof setTimeout>;
    const safeComplete = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimer);
      onComplete();
    };
    // Safety: stop pending animations and finish cleanly after 4 seconds.
    safetyTimer = setTimeout(() => {
      console.warn('[soulFlight] safety timeout — forcing onComplete');
      for (const timeline of orbTimelines) timeline.kill();
      for (const child of [...this.previewLayer.children]) {
        if (child.label === 'soul-orb') { child.removeFromParent(); child.destroy(); }
      }
      safeComplete();
    }, 4000);

    // Fade out sacrifice pieces and flame effects concurrently with soul flight
    for (const fp of flamePositions) {
      const key = `${fp.col},${fp.row}`;
      const wrapper = this._sacrificeWrappers.get(key);
      if (wrapper) {
        gsap.to(wrapper, { alpha: 0, duration: 0.45, ease: 'power2.in' });
      }
      const flameGfx = this._flameGraphics.get(key);
      if (flameGfx) {
        gsap.to(flameGfx, { alpha: 0, duration: 0.45, ease: 'power2.in' });
      }
    }
    this._sacrificeWrappers.clear();

    for (let fi = 0; fi < total; fi++) {
      const from = logicalToScreen(flamePositions[fi].col, flamePositions[fi].row);
      const stagger = fi * 0.1;

      for (let i = 0; i < perFlame; i++) {
        // Create a glowing soul orb with 3 layers
        const orb = new Graphics();
        orb.label = 'soul-orb';
        // Outer purple glow
        orb.circle(0, 0, 9).fill({ color: 0xb388ff, alpha: 0.18 });
        // Mid soft ring
        orb.circle(0, 0, 5).fill({ color: 0xc9a8ff, alpha: 0.45 });
        // Inner bright core
        orb.circle(0, 0, 2.5).fill({ color: 0xffffff, alpha: 0.85 });
        orb.x = from.x + (Math.random() - 0.5) * 8;
        orb.y = from.y;
        this.previewLayer.addChild(orb);

        // Arc path: brisk curve toward lamp
        const midX = (orb.x + lampX) / 2 + (Math.random() - 0.5) * 30;
        const midY = (orb.y + lampY) / 2 - 18 - Math.random() * 20;
        const dur = 0.65 + Math.random() * 0.25;

        const ot = gsap.timeline({
          delay: stagger + i * 0.05,
          onComplete: () => {
            orb.removeFromParent();
            orb.destroy();
            completed++;
            if (completed >= total * perFlame) {
              safeComplete();
            }
          },
        });
        orbTimelines.push(ot);
        // Gentle rise toward midpoint
        ot.to(orb, {
          x: midX, y: midY, alpha: 0.95,
          duration: dur * 0.4, ease: 'sine.out',
        }, 0);
        // Descend to lamp + shrink
        ot.to(orb, {
          x: lampX, y: lampY, alpha: 0,
          duration: dur * 0.6, ease: 'power2.in',
        });
        ot.to(orb.scale, {
          x: 0.15, y: 0.15,
          duration: dur * 0.55, ease: 'power3.in',
        });
      }
    }
  }

  // Active flame particle timelines for cleanup
  private _flameTweens: gsap.core.Timeline[] = [];
  /** Cached flame position signature — skip rebuild if unchanged (prevents particle reset on every refreshUI) */
  private _flamePositionsKey: string = '';
  // Sacrifice piece wrappers keyed by "col,row", captured before resolve, faded during soul flight
  private _sacrificeWrappers: Map<string, Container> = new Map();
  // Flame base+glow graphics keyed by "col,row", faded alongside sacrifice pieces
  private _flameGraphics: Map<string, Container> = new Map();

  private drawLoongFlames(): void {
    // Skip rebuild if flame positions haven't changed — prevents particle
    // system reset on every refreshUI (hand select, place piece, etc.)
    const positionsKey = this.turnManager.loongFlamePositions
      .map(p => `${p.col},${p.row}`).join('|');
    if (positionsKey === this._flamePositionsKey && this._flameTweens.length > 0) {
      return;  // positions unchanged, existing particles still running
    }
    this._flamePositionsKey = positionsKey;

    // Kill all active flame particle timelines
    for (const t of this._flameTweens) t.kill();
    this._flameTweens = [];
    this.loongFlameLayer.removeChildren();
    this._flameGraphics.clear();

    // No flames — nothing to draw
    if (this.turnManager.loongFlamePositions.length === 0) return;

    for (const pos of this.turnManager.loongFlamePositions) {
      const screenPos = logicalToScreen(pos.col, pos.row);
      const key = `${pos.col},${pos.row}`;

      // Wrap base+glow in a container so we can fade them as a unit
      const flameContainer = new Container();
      flameContainer.x = screenPos.x;
      flameContainer.y = screenPos.y;

      // Base glow — warm amber ring on the ground
      const base = new Graphics();
      base.circle(0, 0, 16).fill({ color: 0xff6600, alpha: 0.12 });
      base.circle(0, 0, 10).fill({ color: 0xffaa00, alpha: 0.18 });
      flameContainer.addChild(base);

      // ── Fire ember particles ──
      const spawnEmber = (): void => {
          const ember = new Graphics();
          // Outer glow — orange/amber, semi-transparent
          const outerSize = 4 + Math.random() * 5;
          const outerColor = [0xff4400, 0xff6600, 0xff8c00, 0xffaa00][
            Math.floor(Math.random() * 4)];
          ember.circle(0, 0, outerSize).fill({ color: outerColor, alpha: 0.5 });
          // Inner core — yellow/white, brighter
          ember.circle(0, 0, outerSize * 0.45).fill({
            color: 0xffffff, alpha: 0.7 + Math.random() * 0.3,
          });
          ember.x = screenPos.x + (Math.random() - 0.5) * 16;
          ember.y = screenPos.y - Math.random() * 6;
          // Z-order: newer embers on top
          this.loongFlameLayer.addChild(ember);

          const driftX = (Math.random() - 0.5) * 24;
          const riseY = -24 - Math.random() * 40;
          const dur = 1.7 + Math.random() * 2.6;  // slow rise (-30%)
          const wobble = (Math.random() - 0.5) * 8;

          const et = gsap.timeline({
            onComplete: () => { ember.removeFromParent(); ember.destroy(); },
          });
          // Rise + drift with wobble
          et.to(ember, {
            x: ember.x + driftX + wobble,
            duration: dur * 0.5, ease: 'sine.inOut',
          }, 0);
          et.to(ember, {
            x: ember.x + driftX - wobble,
            duration: dur * 0.5, ease: 'sine.inOut',
          }, dur * 0.5);
          // Slow rise and fade
          et.to(ember, {
            y: ember.y + riseY,
            alpha: 0,
            duration: dur, ease: 'power2.out',
          }, 0);
          // Shrink via scale (PixiJS ObservablePoint, GSAP-safe)
          et.to(ember.scale, {
            x: 0.2, y: 0.2,
            duration: dur, ease: 'power2.out',
          }, 0);
        };

        // Initial burst + continuous spawning. Infinite repeat is safe now:
        // cleanupScene() kills all flame tweens on scene exit, and the
        // position-key guard above prevents redundant rebuilds on refreshUI.
        for (let i = 0; i < 4; i++) spawnEmber();
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.35 });
        tl.call(() => spawnEmber());
        this._flameTweens.push(tl);

      this.loongFlameLayer.addChild(flameContainer);
      this._flameGraphics.set(key, flameContainer);
    }
  }

  private getUnsettledLoongSoulCount(): number {
    return Math.max(0, this.turnManager.loongSoulsCollectedThisGame - this.settledLoongSouls);
  }

  private getDisplayedLoongSoulCount(): number {
    return engineBridge.getPlatformItemCount('loong_soul') + this.getUnsettledLoongSoulCount();
  }

  private refreshHUD(): void {
    const stormCharge = this.animatingStormCharge !== null ? this.animatingStormCharge : this.turnManager.stormCharge;
    const stormFrac = this.turnManager.MAX_STORM_CHARGE > 0 ? Math.min(1, stormCharge / this.turnManager.MAX_STORM_CHARGE) : 0;
    const enemyCount = this.turnManager.enemyUnits.filter(u => u.alive && !u.isStatue).length;
    this.ui.updateHUD({ level: this.currentLevel, score: this.turnManager.score, enemyCount, stormProgress: stormFrac, stormActive: true, provisionsRemaining: this.turnManager.provisionsRemaining, provisionsLimit: this.turnManager.provisionsLimit, provisionsBonus: this.turnManager.provisionsBonus });
    this.ui.setSessionEarnedLoongSouls(this.getUnsettledLoongSoulCount());
    this.loongLamp?.setCount(this.getDisplayedLoongSoulCount());
    // 粮草成本随棋子属性从引擎查（引擎唯一来源），供手牌左下角角标显示
    const toInfo = (p: any): PieceInfo => {
      const wasmPt = TS_PIECE_TO_WASM[p.pieceType as PieceType] ?? WasmPieceType.PAWN;
      return {
        id: p.id, pieceType: p.pieceType, skillName: p.skill.name ?? '',
        provisionCost: engineBridge.getUnitSpec(wasmPt)?.provisionCost ?? 0,
      };
    };
    this.ui.updateHand(this.turnManager.hand.map(toInfo), this.turnManager.selectedHandIndex,
      this.turnManager.placed.map(toInfo), this.turnManager.summonedThisTurn);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Input
  // ═══════════════════════════════════════════════════════════════════

  private saveCheckpoint(): void {
    // 回放模式不写入存档（避免覆盖用户真实进度）
    if (this.replayRunner?.isReplay || this.pendingReplayRecord) return;
    if (this.turnManager.gameResult === GameResult.NONE) {
      SaveManager.saveGameState(this.turnManager.exportState());
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 't' || e.key === 'T') { if (this.isAnimating) return; if (this.currentThemeId === 'ink') void this.switchTheme('gold'); else if (this.currentThemeId === 'gold') void this.switchTheme('shatter'); else void this.switchTheme('ink'); return; }
    // Space / Esc: 跳过当前技能动效
    if (e.key === ' ' || e.key === 'Escape') { this.effectPlayer.skip(); return; }
    if (DEBUG_PIECE_CLICK && (e.key === 'g' || e.key === 'G')) { this.dumpEngineState(); return; }
    if (!this.debugMode) return;
    if (e.key === 'd' || e.key === 'D') { const types = [PieceType.PAWN, PieceType.CHARIOT, PieceType.CANNON, PieceType.HORSE, PieceType.ELEPHANT, PieceType.ADVISOR, PieceType.GENERAL]; this.turnManager.addHandPiece(types[Math.floor(Math.random() * types.length)]); this.refreshUI(); this.ui.showToast('Debug: ' + t('toast.handSetDone'), 1.5); }
    if (e.key === 'v' || e.key === 'V') { this.turnManager.forceVictory(); this.refreshUI(); this.checkGameOver(); }
  }

  /** 调试：dump 引擎侧真相（敌人/禁区/龙息/棋盘 camp），定位前后端不同步 */
  private dumpEngineState(): void {
    const enemies = engineBridge.getEnemies();
    const forbidden = engineBridge.getForbidden();
    const flames = engineBridge.getLoongFlamePositions();
    const { cols, rows } = engineBridge.getBoardSize();
    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      for (let c = 0; c < cols; c++) {
        const camp = engineBridge.getCellCamp(c, r);  // C++: 0=NONE 1=PLAYER 2=ENEMY
        grid[r][c] = camp === 2 ? 'E' : camp === 1 ? 'P' : '.';
      }
    }
    console.log('[debug] engine dump', {
      enemies, forbidden, flames, grid,
      forbiddenCount: forbidden.length,
      placed: this.turnManager.placed.map(p => ({ type: p.pieceType, at: p.position })),
      boardPieces: this.turnManager.boardPieces.map(p => ({ type: p.pieceType, at: p.position })),
    });
  }

  /** 触屏瞄准上移约 0.85 格，避免手指遮挡真实落子交叉点与预判标记 */
  private getAimCoords(x: number, y: number, isTouch: boolean): { x: number; y: number } {
    if (!isTouch) return { x, y };
    return { x, y: y - Math.round((Layout.cellSize || 48) * 0.85) };
  }

  private inEnemyPalace(col: number, row: number): boolean {
    const cc = Math.floor(this.turnManager.board.cols / 2);
    const minC = Math.max(0, cc - 1);
    const maxC = Math.min(this.turnManager.board.cols - 1, cc + 1);
    return col >= minC && col <= maxC && row >= 0 && row <= 2;
  }

  /** 与 C++ TurnManager::is_royal_guard 保持一致 */
  private isRoyalGuardUnit(u: PieceObj): boolean {
    if (!u.alive || u.camp !== Camp.ENEMY || u.isCity || u.isStatue || u.pieceType === PieceType.GENERAL) {
      return false;
    }
    if (u.pieceType === PieceType.ADVISOR || u.pieceType === PieceType.ELEPHANT) return true;
    return u.position !== null && this.inEnemyPalace(u.position.col, u.position.row);
  }

  /** 拖拽/悬停实时预览：计入同回合先手已放棋子的破盾连携效果 */
  private updatePlacementPreview(col: number, row: number, isValid: boolean): void {
    const idx = this.turnManager.selectedHandIndex;
    const piece = idx >= 0 ? this.turnManager.hand[idx] : undefined;
    if (!piece || !isValid) {
      this.intersectionRenderer.clearSkillPreview();
      return;
    }

    const range = piece.skill.getAttackRange({ col, row });
    this.intersectionRenderer.showSkillRange(range);

    // 推演先序已放置棋子的击杀，实时反映“第1步破盾 -> 第2步斩首”
    let remainingGuards = this.turnManager.enemyUnits.filter(u => this.isRoyalGuardUnit(u)).length;
    const preKilledIds = new Set<string>();
    for (const prev of this.turnManager.placed) {
      if (!prev.position) continue;
      const pWasm = TS_PIECE_TO_WASM[prev.pieceType as PieceType] ?? WasmPieceType.PAWN;
      const pSpec = engineBridge.getUnitSpec(pWasm);
      if (!pSpec) continue;
      const pRange = prev.skill.getAttackRange(prev.position);
      for (const pt of pRange) {
        const target = this.turnManager.enemyUnits.find(
          u => u.alive && !preKilledIds.has(u.id) && u.position?.col === pt.col && u.position?.row === pt.row
        );
        if (!target) continue;
        const tWasm = target.isStatue ? WasmPieceType.STATUE : target.isCity ? WasmPieceType.CITY : (TS_PIECE_TO_WASM[target.pieceType as PieceType] ?? WasmPieceType.PAWN);
        const tSpec = engineBridge.getUnitSpec(tWasm);
        const guardBlocked = target.pieceType === PieceType.GENERAL && remainingGuards > 0;
        if (!guardBlocked && tSpec && pSpec.attack >= tSpec.defense) {
          preKilledIds.add(target.id);
          if (this.isRoyalGuardUnit(target)) remainingGuards = Math.max(0, remainingGuards - 1);
        }
      }
    }

    const attackerWasm = TS_PIECE_TO_WASM[piece.pieceType as PieceType] ?? WasmPieceType.PAWN;
    const attackerSpec = engineBridge.getUnitSpec(attackerWasm);

    const markers: PreviewTargetMarker[] = [];
    let kills = 0;
    let shields = 0;
    let allies = 0;
    let willDecapitate = false;

    for (const p of range) {
      const enemy = this.turnManager.enemyUnits.find(
        u => u.alive && !preKilledIds.has(u.id) && u.position?.col === p.col && u.position?.row === p.row
      );
      if (enemy) {
        const targetWasm = enemy.isStatue
          ? WasmPieceType.STATUE
          : enemy.isCity
            ? WasmPieceType.CITY
            : (TS_PIECE_TO_WASM[enemy.pieceType as PieceType] ?? WasmPieceType.PAWN);
        const targetSpec = engineBridge.getUnitSpec(targetWasm);
        const blockedByGuard = enemy.pieceType === PieceType.GENERAL && remainingGuards > 0;
        const canKill = !blockedByGuard && !!attackerSpec && !!targetSpec && attackerSpec.attack >= targetSpec.defense;
        if (canKill) {
          kills++;
          if (enemy.pieceType === PieceType.GENERAL) willDecapitate = true;
          markers.push({ col: p.col, row: p.row, kind: 'kill' });
        } else {
          shields++;
          markers.push({ col: p.col, row: p.row, kind: 'shield' });
        }
      }

      const ally = this.turnManager.boardPieces.find(
        u => u.alive && u.position?.col === p.col && u.position?.row === p.row && u.pieceType !== PieceType.GENERAL
      );
      if (ally) {
        allies++;
        markers.push({ col: p.col, row: p.row, kind: 'ally' });
      }
    }

    let summary = '';
    let badgeColor = 0xffd700;
    if (willDecapitate) {
      summary = t('preview.decapitate');
      badgeColor = 0xffd700;
    } else if (kills > 0 && allies > 0) {
      summary = `${t('preview.kills', { n: kills })} · ${t('preview.allyRisk', { n: allies })}`;
      badgeColor = 0xff6b35;
    } else if (kills > 0) {
      const mult = kills >= 2 ? ` ×${(1 + 0.1 * kills).toFixed(1)}` : '';
      summary = `${t('preview.kills', { n: kills })}${mult}`;
      badgeColor = kills >= 3 ? 0xffd700 : 0xff4757;
    } else if (allies > 0) {
      summary = t('preview.allyRisk', { n: allies });
      badgeColor = 0xff6b35;
    } else if (shields > 0) {
      summary = t('preview.immune');
      badgeColor = 0x00d2d3;
    }

    this.intersectionRenderer.showPreviewMarkers(col, row, markers, summary, badgeColor);
  }

  private clearEnemyInspect(): void {
    document.getElementById('enemy-inspect-tip')?.remove();
    this.intersectionRenderer.clearEnemyThreat();
    renderNow();
  }

  /** 点击敌方棋子/城池/石像时单独高亮它的禁区并弹出克制说明 */
  private inspectEnemyAt(col: number, row: number): boolean {
    const enemy = this.turnManager.enemyUnits.find(
      u => u.alive && u.position?.col === col && u.position?.row === row
    );
    if (!enemy) {
      this.clearEnemyInspect();
      return false;
    }

    const aliveGuards = this.turnManager.enemyUnits.filter(u => this.isRoyalGuardUnit(u)).length;
    const wasmPt = enemy.isStatue
      ? WasmPieceType.STATUE
      : enemy.isCity
        ? WasmPieceType.CITY
        : (TS_PIECE_TO_WASM[enemy.pieceType as PieceType] ?? WasmPieceType.PAWN);
    const threatRange = (enemy.isCity || enemy.isStatue)
      ? []
      : engineBridge.getSkillRange(wasmPt, col, row, 1);

    this.intersectionRenderer.showEnemyThreat(col, row, threatRange);
    renderNow();

    let desc = '';
    if (enemy.isStatue) {
      desc = t('inspect.statue');
    } else if (enemy.isCity) {
      desc = t('inspect.city');
    } else if (enemy.pieceType === PieceType.GENERAL) {
      desc = aliveGuards > 0
        ? t('inspect.generalShielded', { n: aliveGuards })
        : t('inspect.generalExposed');
    } else if (this.isRoyalGuardUnit(enemy)) {
      desc = `${PIECE_LABELS[enemy.pieceType] ?? ''} · ${t('inspect.royalGuard')}`;
    } else {
      desc = `${PIECE_LABELS[enemy.pieceType] ?? ''} · ${t('inspect.regular')}`;
    }

    document.getElementById('enemy-inspect-tip')?.remove();
    const tip = document.createElement('div');
    tip.id = 'enemy-inspect-tip';
    tip.className = 'enemy-inspect-tip';
    tip.textContent = desc;
    tip.addEventListener('click', () => this.clearEnemyInspect());
    document.body.appendChild(tip);
    return true;
  }

  private cleanupHandDrag(): void {
    if (this.handDragCleanup) {
      this.handDragCleanup();
      this.handDragCleanup = null;
    }
    this.isTouchPlacing = false;
    this.activeTouchTarget = null;
    this.activeLockedTarget = null;
    this.intersectionRenderer.clearReticle();
    this.intersectionRenderer.clearSkillPreview();
  }

  /** 从手牌区直接按下并拖入棋盘瞄准，抬手即落子 */
  private handleHandDragStart(handIdx: number, startX: number, startY: number, pointerType: string): void {
    if (this.isAnimating) return;
    this.cleanupHandDrag();

    const isTouch = pointerType !== 'mouse';
    let dragStartedBoard = false;

    const onMove = (ev: PointerEvent) => {
      if (this.isAnimating) {
        this.cleanupHandDrag();
        renderNow();
        return;
      }
      const aim = this.getAimCoords(ev.clientX, ev.clientY, isTouch);
      if (!dragStartedBoard) {
        const moved = Math.hypot(ev.clientX - startX, ev.clientY - startY);
        if (moved < 10 || aim.y >= Layout.boardBottom) return;
        this.onHandSelect(handIdx);
        if (this.turnManager.phase !== GamePhase.PLACE_PIECE) {
          this.cleanupHandDrag();
          return;
        }
        dragStartedBoard = true;
        this.isTouchPlacing = true;
      }

      if (aim.y >= Layout.boardBottom) {
        this.activeTouchTarget = null;
        this.activeLockedTarget = null;
        this.intersectionRenderer.clearReticle();
        this.intersectionRenderer.clearSkillPreview();
        renderNow();
        return;
      }

      const mag = screenToLogicalMagnetic(aim.x, aim.y, this.activeLockedTarget);
      if (mag) {
        this.activeTouchTarget = mag.point;
        this.activeLockedTarget = mag.isLocked ? mag.point : null;
        const validPoints = this.turnManager.getValidPlacements();
        const isValid = validPoints.some(vp => vp.col === mag.point.col && vp.row === mag.point.row);
        this.intersectionRenderer.showReticle(mag.point.col, mag.point.row, aim.x, aim.y, isValid, mag.isLocked, isTouch);
        this.updatePlacementPreview(mag.point.col, mag.point.row, isValid);
      } else {
        this.activeTouchTarget = null;
        this.activeLockedTarget = null;
        this.intersectionRenderer.clearReticle();
        this.intersectionRenderer.clearSkillPreview();
      }
      renderNow();
    };

    const onEnd = (ev: PointerEvent) => {
      const target = this.activeTouchTarget;
      const aim = this.getAimCoords(ev.clientX, ev.clientY, isTouch);
      const shouldPlace = ev.type === 'pointerup' && dragStartedBoard && !!target && aim.y < Layout.boardBottom;
      this.cleanupHandDrag();
      renderNow();
      if (shouldPlace && target) {
        this.doPlacePiece(target.col, target.row, aim.x, aim.y);
      }
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    this.handDragCleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }

  private onPointerDown(event: any): void {
    if (this.isAnimating) return;
    // Reject clicks in the hand/quick-bar area
    if (event.global.y >= Layout.boardBottom) return;

    // 优先采用磁吸计算（支持 39px 范围内的磁吸吸附落子）
    const mag = screenToLogicalMagnetic(event.global.x, event.global.y, this.activeLockedTarget);
    const point = mag ? mag.point : screenToLogical(event.global.x, event.global.y);
    if (!point) return;
    // 调试：URL 带 debug=1 时，点击棋子打印其完整参数（unit + 引擎 UnitSpec 属性）
    if (DEBUG_PIECE_CLICK) {
      // getUnitAt 对敌方格返回 PAWN 占位——真实类型须从 enemyUnits/placed/boardPieces 取
      const enemy = this.turnManager.enemyUnits.find(e =>
        e.alive && e.position?.col === point.col && e.position?.row === point.row);
      const dbgUnit = enemy ?? this.turnManager.board.getUnitAt(point.col, point.row);
      if (dbgUnit && dbgUnit.position) {
        const wasmPt = TS_PIECE_TO_WASM[dbgUnit.pieceType as PieceType] ?? WasmPieceType.PAWN;
        const spec = engineBridge.getUnitSpec(wasmPt);
        const specView = spec ? { name: WasmPieceNames[spec.type] ?? spec.type, ...spec } : null;
        console.log(`[debug] piece @(${dbgUnit.position.col},${dbgUnit.position.row}) camp=${dbgUnit.camp} phase=${this.turnManager.phase}`, { unit: dbgUnit, spec: specView });
      }
    }
    if (this.turnManager.phase === GamePhase.PLACE_PIECE || this.turnManager.phase === GamePhase.CONFIRMING || this.turnManager.phase === GamePhase.SELECT_HAND) {
      const u = this.turnManager.board.getUnitAt(point.col, point.row);
      if (u && u.camp === Camp.PLAYER) {
        const removedId = u.id;
        this.clearEnemyInspect();
        this.intersectionRenderer.removeSkillRange(removedId);
        this.turnManager.removePlaced(removedId);
        const idx = this.turnManager.hand.findIndex(h => h.id === removedId);
        if (idx >= 0) this.turnManager.selectHand(idx);
        this.refreshUI(); return;
      }
      if (this.inspectEnemyAt(point.col, point.row)) {
        return;
      }
    }
    if (this.turnManager.phase === GamePhase.PLACE_PIECE) {
      if (event.pointerType === 'touch') {
        const aim = this.getAimCoords(event.global.x, event.global.y, true);
        if (aim.y >= Layout.boardBottom) return;
        const mag = screenToLogicalMagnetic(aim.x, aim.y, this.activeLockedTarget);
        if (mag) {
          this.isTouchPlacing = true;
          this.activeTouchTarget = mag.point;
          this.activeLockedTarget = mag.isLocked ? mag.point : null;
          const validPoints = this.turnManager.getValidPlacements();
          const isValid = validPoints.some(vp => vp.col === mag.point.col && vp.row === mag.point.row);
          this.intersectionRenderer.showReticle(mag.point.col, mag.point.row, aim.x, aim.y, isValid, mag.isLocked, true);
          this.updatePlacementPreview(mag.point.col, mag.point.row, isValid);
          renderNow();
        }
      } else {
        const mag = screenToLogicalMagnetic(event.global.x, event.global.y, this.activeLockedTarget);
        const target = mag ? mag.point : point;
        if (target) {
          this.intersectionRenderer.clearReticle();
          this.intersectionRenderer.clearSkillPreview();
          this.intersectionRenderer.clearHover();
          this.doPlacePiece(target.col, target.row, event.global.x, event.global.y);
        }
      }
    }
  }

  private onPointerMove(event: any): void {
    if (this.isAnimating) return;
    if (this.isTouchPlacing) {
      const aim = this.getAimCoords(event.global.x, event.global.y, true);
      if (aim.y >= Layout.boardBottom) {
        this.activeTouchTarget = null;
        this.activeLockedTarget = null;
        this.intersectionRenderer.clearReticle();
        this.intersectionRenderer.clearSkillPreview();
        renderNow();
        return;
      }
      const mag = screenToLogicalMagnetic(aim.x, aim.y, this.activeLockedTarget);
      if (mag) {
        this.activeTouchTarget = mag.point;
        this.activeLockedTarget = mag.isLocked ? mag.point : null;
        const validPoints = this.turnManager.getValidPlacements();
        const isValid = validPoints.some(vp => vp.col === mag.point.col && vp.row === mag.point.row);
        this.intersectionRenderer.showReticle(mag.point.col, mag.point.row, aim.x, aim.y, isValid, mag.isLocked, true);
        this.updatePlacementPreview(mag.point.col, mag.point.row, isValid);
      } else {
        this.activeTouchTarget = null;
        this.activeLockedTarget = null;
        this.intersectionRenderer.clearReticle();
        this.intersectionRenderer.clearSkillPreview();
      }
      renderNow();
      return;
    }
    // Reject hover below board area
    if (event.global.y >= Layout.boardBottom) {
      this.intersectionRenderer.clearHover();
      this.intersectionRenderer.clearReticle();
      this.intersectionRenderer.clearSkillPreview();
      renderNow();
      return;
    }

    // 桌面端鼠标在落子阶段（已选手牌）移入棋盘时，同样触发磁吸对齐瞄准框与实时击杀预览
    if (this.turnManager.phase === GamePhase.PLACE_PIECE) {
      const mag = screenToLogicalMagnetic(event.global.x, event.global.y, this.activeLockedTarget);
      if (mag) {
        this.activeLockedTarget = mag.isLocked ? mag.point : null;
        this.activeTouchTarget = mag.point;
        const validPoints = this.turnManager.getValidPlacements();
        const isValid = validPoints.some(vp => vp.col === mag.point.col && vp.row === mag.point.row);
        this.intersectionRenderer.clearHover();
        this.intersectionRenderer.showReticle(mag.point.col, mag.point.row, event.global.x, event.global.y, isValid, mag.isLocked, false);
        this.updatePlacementPreview(mag.point.col, mag.point.row, isValid);
      } else {
        this.activeLockedTarget = null;
        this.activeTouchTarget = null;
        this.intersectionRenderer.clearReticle();
        this.intersectionRenderer.clearSkillPreview();
        this.intersectionRenderer.clearHover();
      }
      renderNow();
      return;
    }

    const point = screenToLogical(event.global.x, event.global.y);
    if (point) this.intersectionRenderer.showHover(point.col, point.row);
    else this.intersectionRenderer.clearHover();
    // hover 指示是纯命令式 Graphics 更新，需手动补帧
    renderNow();
  }

  private onPointerUp(event: any): void {
    if (this.isAnimating) return;
    if (!this.isTouchPlacing) return;
    const isTouch = event.pointerType === 'touch';
    const aim = this.getAimCoords(event.global.x, event.global.y, isTouch);
    this.isTouchPlacing = false;
    this.activeLockedTarget = null;
    this.intersectionRenderer.clearReticle();
    this.intersectionRenderer.clearSkillPreview();
    renderNow();

    if (this.activeTouchTarget && aim.y < Layout.boardBottom) {
      const target = this.activeTouchTarget;
      this.activeTouchTarget = null;
      this.doPlacePiece(target.col, target.row, aim.x, aim.y);
    } else {
      this.activeTouchTarget = null;
    }
  }

  private onHandSelect(index: number): void {
    if (this.isAnimating) return;
    // Allow switching selection even when another piece is already selected
    if (this.turnManager.phase === GamePhase.PLACE_PIECE) {
      this.turnManager.selectedHandIndex = -1;
      (this.turnManager as any).phase = GamePhase.SELECT_HAND;
    }
    if (this.turnManager.phase !== GamePhase.SELECT_HAND) return;
    if (!this.turnManager.selectHand(index)) {
      // 选牌失败：粮草耗尽 → 弹尽粮绝弹窗（木牛流马 / 投降）；
      // 剩余不足但未耗尽 → toast（selectHand 失败路径已实时刷新 provisionsRemaining）
      if (this.turnManager.provisionsRemaining <= 0) {
        this.showProvisionsExhaustedDialog();
      } else {
        this.ui.showToast(t('toast.noProvisions'), 1.5);
      }
      return;
    }
    this.refreshUI();
    const validPoints = this.turnManager.getValidPlacements();
    this.intersectionRenderer.showValidPlacements(validPoints);
    this.checkStalemate();
  }

  /** 弹尽粮绝：要么用木牛流马加粮草，要么投降认输（引擎 force_defeat 走正常 LOSE 结算） */
  private showProvisionsExhaustedDialog(): void {
    document.getElementById('provisions-dialog')?.remove();
    const hasWagon = engineBridge.getPlatformItemCount('provision_wagon') > 0;
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay provisions-dialog';
    overlay.id = 'provisions-dialog';
    overlay.innerHTML = `
      <div class="provisions-dialog-card">
        <div class="provisions-dialog-title">${t('provisions.exhaustedTitle')}</div>
        <div class="provisions-dialog-body">${t('provisions.exhaustedBody')}</div>
        <div class="provisions-dialog-actions">
          ${hasWagon ? `<button class="btn-wagon" id="btn-provisions-wagon">${t('provisions.useWagon')}</button>` : ''}
          <button class="btn-surrender" id="btn-provisions-surrender">${t('provisions.surrender')}</button>
          <button class="btn-dialog-cancel" id="btn-provisions-cancel">${t('confirm.cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-provisions-wagon')?.addEventListener('click', async () => {
      overlay.remove();
      // 复用背包使用路径（含 pendingItemUsage/存档/toast）
      await this.ui.onBackpackUseItem?.('provision_wagon');
      this.refreshUI();
    });
    overlay.querySelector('#btn-provisions-surrender')!.addEventListener('click', () => {
      overlay.remove();
      this.turnManager.forceDefeat();
      this.refreshUI();
      this.checkGameOver();
    });
    overlay.querySelector('#btn-provisions-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  /** 检查是否陷入困毙（已落子为 0 且无任何合法空位可出牌） */
  private checkStalemate(): boolean {
    if (this.turnManager.gameResult !== GameResult.NONE || this.isAnimating) return false;
    if (this.pendingReplayRecord || this.replayRunner?.isReplay) return false;
    if (this.turnManager.phase !== GamePhase.SELECT_HAND && this.turnManager.phase !== GamePhase.PLACE_PIECE) return false;

    // 只要已落子 >= 1，即可直接确认出牌，不会困毙
    if (this.turnManager.placed.length >= 1) return false;

    const validPoints = this.turnManager.getBoardValidPlacements();
    if (validPoints.length >= 1) return false;

    // 若已解禁，但全盘可用空位依然为 0，则无药可救
    const hasUnseal = !this.turnManager.unsealed && engineBridge.getPlatformItemCount('unseal') > 0;
    this.showStalemateDialog(hasUnseal, validPoints.length, 1);
    return true;
  }

  private showStalemateDialog(hasUnseal: boolean, validCount: number, neededCount: number): void {
    if (document.getElementById('stalemate-dialog')) return;
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay provisions-dialog';
    overlay.id = 'stalemate-dialog';
    const bodyText = hasUnseal
      ? t('stalemate.exhaustedBody', { valid: validCount, need: neededCount })
      : t('stalemate.noItemBody', { valid: validCount, need: neededCount });
    overlay.innerHTML = `
      <div class="provisions-dialog-card">
        <div class="provisions-dialog-title">⚠️ ${t('stalemate.title')}</div>
        <div class="provisions-dialog-body">${bodyText}</div>
        <div class="provisions-dialog-actions">
          ${hasUnseal ? `<button class="btn-wagon" id="btn-stalemate-unseal">${t('stalemate.useUnseal')}</button>` : ''}
          <button class="btn-surrender" id="btn-stalemate-defeat">${t('stalemate.defeat')}</button>
          <button class="btn-dialog-cancel" id="btn-stalemate-cancel">${t('confirm.cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    if (hasUnseal) {
      overlay.querySelector('#btn-stalemate-unseal')?.addEventListener('click', async () => {
        overlay.remove();
        await this.ui.onBackpackUseItem?.('unseal');
        this.refreshUI();
        this.checkStalemate();
      });
    }

    overlay.querySelector('#btn-stalemate-defeat')!.addEventListener('click', () => {
      overlay.remove();
      this.turnManager.forceDefeat('err.no_valid_moves');
      this.refreshUI();
      this.checkGameOver();
    });

    overlay.querySelector('#btn-stalemate-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  private onUndo(): void {
    if (this.isAnimating) return;
    const last = this.turnManager.placed[this.turnManager.placed.length - 1];
    if (last) this.intersectionRenderer.removeSkillRange(last.id);
    if (this.turnManager.undoLastPlacement()) { this.refreshUI(); this.ui.showToast(t('toast.undoLast'), 1.5); }
  }
  private onSkipTurn(): void {
    if (this.isAnimating) return;
    this.turnStats.endTurn();
    this.turnManager.skipTurn();
    this.intersectionRenderer.clearAll();
    this.refreshUI();
    SaveManager.rotateTurnSnapshots(this.turnManager.exportState());
    this.turnStats.startTurn(this.currentLevel);
    this.ui.showToast(t('toast.skipTurn'), 1.5);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Confirm & Resolve
  // ═══════════════════════════════════════════════════════════════════

  private onConfirm(): void {
    if (this.isAnimating || !this.turnManager.canConfirm()) return;
    this.clearEnemyInspect();
    this.turnKillTypes = [];
    this.turnTriggeredClassicCallout = false;
    this.turnStats.endTurn();
    // R2：confirm 前 snapshot 引擎聚合分，用于按类别拆分本回合每步得分（引擎权威）
    const prevDetails = {
      pieces: this.turnManager.piecesScore,
      city: this.turnManager.cityScore,
      statue: this.turnManager.statueScore,
      ally: this.turnManager.allyLostPenalty,
    };
    const prevStorm = this.turnManager.stormCharge;
    const prevScore = this.turnManager.score;
    const steps = this.turnManager.confirm();
    const enemyKillsThisTurn = steps.reduce((acc, s) => acc + s.targets.filter(t => t.eid).length, 0);
    this.isAnimating = true;
    // 引擎已结算本回合：turnManager.score 为权威新值；animScore 从旧值起步，飘分按类别增量累加
    this.prevTurnScore = prevScore;
    this.turnNewScore = this.turnManager.score;
    this.animScore = prevScore;
    this.perKillScore = this.turnManager.buildPerKillScores(prevDetails, steps);
    this.comboStep = 0;
    this.intersectionRenderer.clearAll();
    // 落子确认音 + 触觉反馈
    AudioManager.getInstance().play('place');
    this.haptic(8);

    const finishTurn = () => {
      this.isAnimating = false;
      // R2：引擎权威对齐。飘分仅覆盖类别基础分（pieces/city/statue/ally），
      // 连击/星/额外奖励在回合末一次性补齐，保证累计分 == 引擎结算分。
      const drift = this.turnNewScore - this.animScore;
      if (drift !== 0) {
        // drift 应为 combo/star/bonus（>= 0）；负 drift 说明类别拆分与引擎不符，需排查
        console.assert(drift >= 0, '[R2] unexpected score drift:', { animScore: this.animScore, turnNewScore: this.turnNewScore, drift });
        this.animScore = this.turnNewScore;
        this.turnManager.score = this.turnNewScore;
        this.refreshHUD();
      }
      this.perKillScore.clear();
      // 恢复 BGM（终局击杀高潮可能已压低）
      AudioManager.getInstance().restoreBgm();
      this.intersectionRenderer.showForbiddenZones(this.turnManager.forbiddenZone.getAllZonePoints());
      this.refreshUI();
      this.saveCheckpoint();
      SaveManager.rotateTurnSnapshots(this.turnManager.exportState());
      // Delay settlement so the battle climax (shake/flash/vignette/slow-mo) has room to breathe
      setTimeout(() => this.checkGameOver(), 350);
      setTimeout(() => this.checkStalemate(), 450);
      // 本回合结算完成：下一回合计时开始（游戏若已结束则计时器空跑，无记录）
      this.turnStats.startTurn(this.currentLevel);
    };

    // Cache wrappers of placed pieces on flame positions BEFORE resolve clears them
    this._sacrificeWrappers.clear();
    for (const fp of this.turnManager.loongFlamePositions) {
      const piece = this.turnManager.placed.find(
        p => p.position?.col === fp.col && p.position?.row === fp.row
      );
      if (piece) {
        const w = this.pieceRenderer.getContainer(piece.id);
        if (w) this._sacrificeWrappers.set(`${fp.col},${fp.row}`, w);
      }
    }

    this.playResolveSteps(steps, () => {
      this.intersectionRenderer.clearAll();
      const spawns = this.turnManager.afterResolve();
      this.animatingStormCharge = null;  // 回退到引擎权威值（消耗后的剩余）
      const stormRewarded = this.turnManager.gameResult === GameResult.NONE
        && (prevStorm + enemyKillsThisTurn >= this.turnManager.MAX_STORM_CHARGE)
        && (this.turnManager.stormCharge < prevStorm + enemyKillsThisTurn);
      const flames = [...this.turnManager.consumedFlames];
      const soulCount = this.turnManager.loongSoulsCollectedThisGame;
      // 结算后顺序（与引擎 after_resolve 一致）：招兵买马 → 龙魂（非阻塞飞行） → 风暴
      const afterRecruit = () => {
        if (stormRewarded) {
          this.ui.showToast(t('toast.stormHero'), 2.5);
        }
        if (flames.length > 0) {
          // 龙魂飞行不阻塞下一回合操控，光球飞抵后刷新灯笼
          this.playSoulFlight(flames, () => {
            this.ui.setSessionEarnedLoongSouls(soulCount);
            this.loongLamp.setCount(this.getDisplayedLoongSoulCount());
            this.loongLamp.pulseArrival();
          });
        }
        if (spawns.length > 0) {
          this.playStormSpawnEffects(spawns, finishTurn);
        } else {
          finishTurn();
        }
      };
      const recruits = this.turnManager.recruitSpawns;
      if (recruits.length > 0) {
        this.playRecruitSpawnEffects(recruits, afterRecruit);
      } else {
        afterRecruit();
      }
    });
  }

  private playResolveSteps(steps: ResolveStep[], onComplete: () => void): void {
    // 风暴槽从当前值开始，随每个 step 的击杀动效逐步增长
    this.animatingStormCharge = this.turnManager.stormCharge;
    this.playStepResolve(0, steps, onComplete);
  }

  private playStepResolve(idx: number, steps: ResolveStep[], onComplete: () => void): void {
    // All steps done — defer to onComplete callback which handles storm spawns
    if (idx >= steps.length) {
      onComplete();
      return;
    }

    const step = steps[idx];
    const isKingsMeeting = step.playerPieceIndex === -1;
    const isLoongPiece = step.playerPieceIndex === -2;

    // common handler for kills in a step (enemy + ally)
    const animateKills = () => {
      // 击杀确认音（defeat 动画结束后、棋子移除时）
      if (step.targets.some(t => t.eid)) {
        AudioManager.getInstance().play('eliminate');
      }
      for (const t of step.targets) {
        const eid = t.eid, aid = t.aid;
        if (eid) {
          this.intersectionRenderer.playEliminating(t.col, t.row);
          this.showScorePop(t.col, t.row, eid);
          let wrapper = this.pieceRenderer.getContainer(eid);
          // Fallback: ID-based lookup can fail if syncState rebuilt _enemies with new IDs.
          // Try position-based lookup as safety net.
          if (!wrapper) wrapper = this.pieceRenderer.getContainerAt(t.col, t.row);
          if (wrapper) {
            this.fadeOutKilledPiece(wrapper, eid);
          }
        }
        if (aid) {
          this.showScorePop(t.col, t.row, aid);
          let wrapper = this.pieceRenderer.getContainer(aid);
          if (!wrapper) wrapper = this.pieceRenderer.getContainerAt(t.col, t.row);
          if (wrapper) {
            this.fadeOutKilledPiece(wrapper, aid);
          }
        }
      }
      // 风暴槽实时增长：本 step 击杀动效完结时累加消除数（敌方+己方）
      if (this.animatingStormCharge !== null) {
        this.animatingStormCharge += step.targets.filter(t => t.eid || t.aid).length;
        this.refreshHUD();
      }
    };

    if (isLoongPiece) {
      // Capture the sacrifice/self-destruct piece wrapper before it's removed from state
      const sacKey = `${step.origin.col},${step.origin.row}`;
      const sacPiece = this.turnManager.placed.find(
        p => p.position?.col === step.origin.col && p.position?.row === step.origin.row
      );
      if (sacPiece) {
        const w = this.pieceRenderer.getContainer(sacPiece.id);
        if (w) this._sacrificeWrappers.set(sacKey, w);
      }
      this.playLoongDescent(step, () => {
        // Fade out the loong piece's own container (self-destruction)
        const lw = this._sacrificeWrappers.get(sacKey);
        if (lw && sacPiece) {
          this.fadeOutKilledPiece(lw, sacPiece.id);
        }
        animateKills();
        this.playStepResolve(idx + 1, steps, onComplete);
      });
      return;
    }

    if (isKingsMeeting) {
      // 王见王·破阵：双王对峙光束 → 3 线扫荡 → 命中爆发 → 帅的舍身 → 九宫格印章纹
      this.playKingsMeetingStep(step, animateKills, () => {
        this.playStepResolve(idx + 1, steps, onComplete);
      });
      return;
    }

    if (step.playerPieceIndex >= 0) {
      const piece = this.turnManager.placed[step.playerPieceIndex];
      if (piece) {
        const wrapper = this.pieceRenderer.getContainer(piece.id);
        if (wrapper) {
          const badge = wrapper.getChildByLabel?.('order-badge');
          if (badge) { badge.removeFromParent(); badge.destroy(); }
        }
      }
    }

    // 空击步（0 目标）：不浪费前摇/空挥时长，直接跳过到下一步
    if (!isKingsMeeting && !isLoongPiece && step.targets.length === 0) {
      this.playStepResolve(idx + 1, steps, onComplete);
      return;
    }

    const pieceType = (step.playerPieceIndex >= 0 && step.playerPieceIndex < this.turnManager.placed.length) ? this.turnManager.placed[step.playerPieceIndex].pieceType : PieceType.PAWN;
    // 棋子发射音在 cast 时刻（炮车开火等）
    const audio = AudioManager.getInstance();
    if (pieceType === PieceType.CANNON) audio.play('cannonFire');

    const targetContainers: (Container | null)[] = step.targets.map(t =>
      t.eid ? (this.pieceRenderer.getContainer(t.eid) ?? this.pieceRenderer.getContainerAt(t.col, t.row) ?? null) : null,
    );
    // 终局判定：本步击杀敌人 + 之后无更多击杀 + (杀将帅 或 清场)
    // 注：WasmTurnManager.resolve 生成所有 step 时已把被击杀敌人 alive=false，
    //     所以 enemyAliveAfter 是整回合终态，必须用 hasMoreKills 区分「本步是否是最后一击」
    const killedGeneral = step.targets.some(t => {
      if (!t.eid) return false;
      const u = this.turnManager.enemyUnits.find(u => u.id === t.eid);
      return u?.pieceType === PieceType.GENERAL;
    });
    const thisStepKills = step.targets.some(t => t.eid);
    const hasMoreKills = steps.slice(idx + 1).some(s => s.targets.some(t => t.eid));
    const enemyAliveAfter = this.turnManager.enemyUnits.filter(u => u.alive && !u.isStatue).length;
    const isFinalKill = thisStepKills && !hasMoreKills && (killedGeneral || enemyAliveAfter === 0);
    // 连击五音阶（宫商角徵羽）递增：当前步为第 comboStep 次击杀
    const hitSound = PIECE_HIT_SOUNDS[pieceType];
    const comboRate = getPentatonicRate(this.comboStep);
    if (thisStepKills) this.comboStep++;
    // 命中音/称号/触觉/BGM 压低 均在首个命中瞬间（climax）触发，与屏震同步
    this.effectPlayer.onStepClimax = () => {
      if (hitSound) audio.play(hitSound, { rate: comboRate });
      this.haptic(isFinalKill ? 18 : 8);
      if (isFinalKill) audio.duckBgm();
      this.showBonusTitle(step, pieceType);
      if (thisStepKills) {
        this.turnKillTypes.push(pieceType);
        if (!this.turnTriggeredClassicCallout) {
          const hasCannon = this.turnKillTypes.includes(PieceType.CANNON);
          const hasHorse = this.turnKillTypes.some(pt => pt === PieceType.HORSE || pt === PieceType.HORSE_IRON);
          const cannonCount = this.turnKillTypes.filter(pt => pt === PieceType.CANNON).length;
          const chariotCount = this.turnKillTypes.filter(pt => pt === PieceType.CHARIOT || pt === PieceType.CHARIOT_TANK).length;
          let classicKey = '';
          if (hasCannon && hasHorse) classicKey = 'callout.horseCannon';
          else if (cannonCount >= 2) classicKey = 'callout.doubleCannon';
          else if (chariotCount >= 2) classicKey = 'callout.twinChariots';
          if (classicKey) {
            this.turnTriggeredClassicCallout = true;
            this.lastVictoryCallout = t(classicKey);
            this.showTitleDirectly(classicKey, -1, 1400);
          }
        }
      }
      if (killedGeneral) {
        this.lastVictoryCallout = t('bonusKingslayer');
        this.showTitleDirectly('bonus_kingslayer', 1500);
      }
    };
    this.effectPlayer.playSteps(this.previewLayer, [step], [pieceType], () => {
      this.effectPlayer.onStepClimax = null;
      if (this.removeTl) { this.removeTl.kill(); this.removeTl = null; }
      animateKills();
      this.playStepResolve(idx + 1, steps, onComplete);
    }, targetContainers, { isFinalKill });
  }

  /** 移动端触觉反馈（无声环境/无振动设备自动忽略） */
  private haptic(ms: number): void {
    try { navigator.vibrate?.(ms); } catch { /* ignore */ }
  }

  /**
   * 击杀棋子淡出并移除。
   * 若目标已被 effectPlayer 在命中阶段淡出（如碎墨主题 char_explode 把 alpha 降到 0），
   * 则跳过重复 tween 直接移除，避免双重动画冲突/冗余。
   */
  private fadeOutKilledPiece(wrapper: Container, pieceId: string): void {
    if (wrapper.alpha < 0.1) {
      this.pieceRenderer.removePiece(pieceId);
      return;
    }
    gsap.to(wrapper, { scale: 0, alpha: 0, duration: 0.3, ease: 'power2.in',
      onComplete: () => { this.pieceRenderer.removePiece(pieceId); } });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Bonus Title (大字称号)
  // ═══════════════════════════════════════════════════════════════════

  /** Detect whether this step triggered a bonus, mirroring C++ resolve_all logic */
  private detectBonusForStep(step: ResolveStep, pieceType: PieceType): { bonusKey: string; score: number } | null {
    // Only regular player piece steps can trigger combat bonuses
    if (step.playerPieceIndex < 0) return null;

    const enemyKills = step.targets.filter(t => t.eid).length;

    switch (pieceType) {
      case PieceType.CANNON:
        if (enemyKills >= 5) return { bonusKey: 'bonus_cannon_t2', score: 200 };
        if (enemyKills >= 3) return { bonusKey: 'bonus_cannon', score: 100 };
        break;
      case PieceType.HORSE:
      case PieceType.HORSE_IRON:
        if (enemyKills >= 7) return { bonusKey: 'bonus_horse_t3', score: 500 };
        if (enemyKills >= 4) return { bonusKey: 'bonus_horse_t2', score: 300 };
        if (enemyKills >= 2) return { bonusKey: 'bonus_horse', score: 150 };
        break;
      case PieceType.CHARIOT:
      case PieceType.CHARIOT_TANK:
        if (enemyKills >= 4) return { bonusKey: 'bonus_chariot_t2', score: 300 };
        if (enemyKills >= 2) return { bonusKey: 'bonus_chariot_t1', score: 150 };
        break;
      case PieceType.ELEPHANT:
      case PieceType.ELEPHANT_MENMA:
        if (enemyKills >= 1) return { bonusKey: 'bonus_elephant', score: 80 };
        break;
      case PieceType.GENERAL:
        if (enemyKills > 0) return { bonusKey: 'bonus_general', score: 150 };
        break;
    }
    return null;
  }

  /** Map internal bonus key to i18n key */
  private bonusKeyToI18n(bonusKey: string): string {
    const map: Record<string, string> = {
      bonus_cannon: 'bonusCannon',
      bonus_cannon_t2: 'bonusCannonT2',
      bonus_horse: 'bonusHorse',
      bonus_horse_t2: 'bonusHorseT2',
      bonus_horse_t3: 'bonusHorseT3',
      bonus_chariot_t1: 'bonusChariotT1',
      bonus_chariot_t2: 'bonusChariotT2',
      bonus_elephant: 'bonusElephant',
      bonus_general: 'bonusGeneral',
      bonus_kingslayer: 'bonusKingslayer',
      bonus_kings_meeting: 'bonusKingsMeeting',
      victory_kings_meeting: 'victoryKingsMeeting',
      victory_normal: 'victoryNormal',
      skill_recruit: 'skillRecruit',
    };
    return map[bonusKey] ?? bonusKey;
  }

  /** Show a golden title overlay by bonus key directly (for non-piece bonuses); score < 0 时不显示分数 */
  private showTitleDirectly(bonusKey: string, score: number, displayMs = 1800): void {
    const name = t(this.bonusKeyToI18n(bonusKey));
    const scoreText = score >= 0 ? `+${score}` : '';
    const titleEl = document.createElement('div');
    titleEl.className = 'bonus-title-overlay';
    titleEl.innerHTML = `
      <div class="bonus-title-card">
        <div class="bonus-title-name">${name}</div>
        ${score >= 0 ? `<div class="bonus-title-score">${scoreText}</div>` : ''}
      </div>
    `;
    document.body.appendChild(titleEl);
    requestAnimationFrame(() => titleEl.classList.add('show'));
    setTimeout(() => {
      titleEl.classList.remove('show');
      titleEl.classList.add('hide');
      setTimeout(() => titleEl.remove(), 500);
    }, displayMs);
  }

  /**
   * 王见王双标题分时段：
   * - 触发扫荡但未破城：仅显示 bonus_kings_meeting（1.0s）
   * - 触发且破城：先 bonus_kings_meeting（1.0s），间隔 0.3s 后 victory_kings_meeting（1.5s）
   */
  private showKingsMeetingTitles(isFinalKill: boolean): void {
    this.showTitleDirectly('bonus_kings_meeting', 500, KINGS_MEETING.TITLE_BONUS_DUR);
    if (isFinalKill) {
      setTimeout(() => {
        this.showTitleDirectly('victory_kings_meeting', 1000, KINGS_MEETING.TITLE_VICTORY_DUR);
      }, KINGS_MEETING.TITLE_BONUS_DUR + KINGS_MEETING.TITLE_GAP);
    }
  }

  /**
   * 帅的舍身编排：先微放大（顶上去）→ 强光过曝 → 碎裂飞散。
   * 完成后直接 removePiece，避免 animateKills 重复处理。
   */
  private animateGeneralSacrifice(aid: string): void {
    const wrapper = this.pieceRenderer.getContainer(aid);
    if (!wrapper) return;
    const origScale = wrapper.scale.x;
    const pos = { x: wrapper.x, y: wrapper.y };

    // Phase 1: 微放大（顶上去）
    gsap.to(wrapper.scale, {
      x: origScale * KINGS_MEETING.SACRIFICE_SCALE_UP,
      y: origScale * KINGS_MEETING.SACRIFICE_SCALE_UP,
      duration: KINGS_MEETING.SACRIFICE_SCALE_UP_DUR,
      ease: 'back.out',
    });

    // Phase 2: 强光过曝（白色圆闪）
    const flash = new Graphics();
    flash.circle(0, 0, 30).fill({ color: 0xffffff, alpha: 0.9 });
    flash.x = pos.x; flash.y = pos.y;
    flash.blendMode = 'add';
    this.previewLayer.addChild(flash);
    gsap.to(flash, {
      alpha: 0, scale: 2,
      duration: KINGS_MEETING.SACRIFICE_FLASH_DUR,
      ease: 'power2.out',
      delay: KINGS_MEETING.SACRIFICE_SCALE_UP_DUR,
      onComplete: () => { this.previewLayer.removeChild(flash); flash.destroy(); },
    });

    // Phase 3: 碎裂飞散（旋转 + 缩放为 0）
    const shatterDelay = KINGS_MEETING.SACRIFICE_SCALE_UP_DUR + KINGS_MEETING.SACRIFICE_FLASH_DUR;
    gsap.to(wrapper, {
      rotation: Math.PI * 2,
      alpha: 0,
      duration: KINGS_MEETING.SACRIFICE_SHATTER_DUR,
      ease: 'power2.in',
      delay: shatterDelay,
      onComplete: () => { this.pieceRenderer.removePiece(aid); },
    });
    gsap.to(wrapper.scale, {
      x: 0, y: 0,
      duration: KINGS_MEETING.SACRIFICE_SHATTER_DUR,
      ease: 'power2.in',
      delay: shatterDelay,
    });

    // 碎裂瞬间的粒子爆
    const burst = new Graphics();
    burst.circle(0, 0, 6).fill({ color: 0xffd700, alpha: 0.8 });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const r = 4 + Math.random() * 4;
      burst.circle(Math.cos(angle) * 20, Math.sin(angle) * 20, r)
        .fill({ color: 0xffd700, alpha: 0.6 });
    }
    burst.x = pos.x; burst.y = pos.y;
    burst.blendMode = 'add';
    this.previewLayer.addChild(burst);
    gsap.to(burst, {
      alpha: 0, scale: 2,
      duration: 0.4,
      ease: 'power2.out',
      delay: shatterDelay,
      onComplete: () => { this.previewLayer.removeChild(burst); burst.destroy(); },
    });
  }

  /** Show a golden title overlay for a triggered bonus */
  private showBonusTitle(step: ResolveStep, pieceType: PieceType): void {
    const bonus = this.detectBonusForStep(step, pieceType);
    if (!bonus) return;

    const titleEl = document.createElement('div');
    titleEl.className = 'bonus-title-overlay';
    const name = t(this.bonusKeyToI18n(bonus.bonusKey));
    const scoreText = bonus.score >= 0 ? `+${bonus.score}` : `${bonus.score}`;
    titleEl.innerHTML = `
      <div class="bonus-title-card">
        <div class="bonus-title-name">${name}</div>
        <div class="bonus-title-score">${scoreText}</div>
      </div>
    `;
    document.body.appendChild(titleEl);

    // Trigger CSS animation
    requestAnimationFrame(() => titleEl.classList.add('show'));

    // Auto-remove after animation
    setTimeout(() => {
      titleEl.classList.remove('show');
      titleEl.classList.add('hide');
      setTimeout(() => titleEl.remove(), 500);
    }, 1800);
  }

  private playStormSpawnEffects(spawns: { col: number; row: number }[], onComplete: () => void): void {
    // Get storm bar position from DOM
    let originX = window.innerWidth / 2;
    let originY = 60;
    const stormEl = document.querySelector('.storm-bar-outer');
    if (stormEl) {
      const r = stormEl.getBoundingClientRect();
      originX = r.left + r.width / 2;
      originY = r.top;
    }

    const C_RED = 0xe74c3c;
    const audio = AudioManager.getInstance();
    const tl = gsap.timeline({
      onComplete: () => {
        // Render all units so newly spawned obstacles have containers
        this.pieceRenderer.renderAll([
          ...this.turnManager.enemyUnits,
          ...this.turnManager.hand,
          ...this.turnManager.boardPieces,
          ...this.turnManager.placed,
        ]);
        // Fire breathing animation on each obstacle (non-blocking)
        // for (const sp of spawns) {
        //   const unit = this.turnManager.enemyUnits.find(
        //     u => u.position?.col === sp.col && u.position?.row === sp.row
        //   );
        //   if (unit) {
        //     console.log(unit.id,'11111');
        //     const w = this.pieceRenderer.getContainer(unit.id);
        //     if (w) {
        //     console.log(unit.id,'2222');

        //       w.scale.set(0.95);
        //       gsap.to(w.scale, {
        //         x: 1.04, y: 1.04,
        //         duration: 2.2,
        //         ease: 'sine.inOut',
        //         yoyo: true,
        //         repeat: -1,
        //       });
        //     }
        //   }
        // }
        // Finish turn immediately — breathing does not block gameplay
        onComplete();
      },
    });

    for (const spawn of spawns) {
      const pos = logicalToScreen(spawn.col, spawn.row);
      audio.play('storm-spawn');

      // Phase 1 — particle beam from storm bar to spawn point
      const beamCount = 20;
      for (let i = 0; i < beamCount; i++) {
        const size = 2 + Math.floor(Math.random() * 3);
        const color = Math.random() > 0.4 ? C_RED : 0xff6600;
        const p = new Graphics().circle(0, 0, size).fill({ color, alpha: 0.8 });
        p.x = originX; p.y = originY; p.alpha = 0;
        this.previewLayer.addChild(p);
        const delay = (i / beamCount) * 0.35;
        const midX = (originX + pos.x) / 2 + (Math.random() - 0.5) * 50;
        const midY = (originY + pos.y) / 2 + (Math.random() - 0.5) * 30;
        const pTl = gsap.timeline({
          onComplete: () => { p.removeFromParent(); p.destroy(); },
        });
        pTl.set(p, { alpha: 0 }, 0);
        pTl.to(p, { alpha: 0.9, scale: 1.5, duration: 0.06 }, 0);
        pTl.to(p, { x: midX, y: midY, alpha: 0.8, scale: 1, duration: 0.2, ease: 'sine.out' });
        pTl.to(p, { x: pos.x, y: pos.y, alpha: 0, scale: 0.3, duration: 0.2, ease: 'power2.in' });
        tl.add(pTl, delay);
      }

      // Phase 2 — eruption
      const eStart = 0.5;
      // Ground ring
      const ring = new Graphics();
      ring.circle(0, 0, 4).fill({ color: C_RED, alpha: 0.9 });
      ring.circle(0, 0, 10).stroke({ width: 3, color: C_RED, alpha: 0.5 });
      ring.x = pos.x; ring.y = pos.y; ring.scale.set(0);
      this.previewLayer.addChild(ring);
      tl.to(ring, { scale: 4, alpha: 0, duration: 0.35, ease: 'power2.out',
        onComplete: () => { ring.removeFromParent(); ring.destroy(); } }, eStart);
      // Ground afterglow
      const glow = new Graphics().circle(0, 0, 8).fill({ color: 0xff6600, alpha: 0.3 });
      glow.x = pos.x; glow.y = pos.y; glow.scale.set(0);
      this.previewLayer.addChild(glow);
      tl.to(glow, { scale: 2.5, alpha: 0, duration: 0.5, ease: 'power1.out',
        onComplete: () => { glow.removeFromParent(); glow.destroy(); } }, eStart);

      // Energy pillar
      const pillar = new Graphics();
      pillar.rect(-12, -40, 24, 40).fill({ color: 0xff4400, alpha: 0.6 });
      pillar.rect(-8, -50, 16, 50).fill({ color: C_RED, alpha: 0.4 });
      pillar.x = pos.x; pillar.y = pos.y; pillar.scale.y = 0;
      this.previewLayer.addChild(pillar);
      tl.to(pillar.scale, { y: 1, duration: 0.15, ease: 'back.out' }, eStart + 0.05);
      tl.to(pillar, { alpha: 0, duration: 0.25, ease: 'power2.in',
        onComplete: () => { pillar.removeFromParent(); pillar.destroy(); } }, eStart + 0.2);

      // Debris particles
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
        const dist = 25 + Math.random() * 25;
        const sz = 2 + Math.floor(Math.random() * 3);
        const dot = new Graphics().circle(0, 0, sz).fill({ color: Math.random() > 0.5 ? C_RED : 0xff8800, alpha: 0.9 });
        dot.x = pos.x; dot.y = pos.y;
        this.previewLayer.addChild(dot);
        tl.to(dot, {
          x: pos.x + Math.cos(angle) * dist,
          y: pos.y + Math.sin(angle) * dist - 5,
          alpha: 0, scale: 0.2, duration: 0.35, ease: 'power2.out',
          onComplete: () => { dot.removeFromParent(); dot.destroy(); },
        }, eStart + 0.08);
      }
      // Flash
      const flash = new Graphics().circle(0, 0, 24).fill({ color: 0xffffff, alpha: 0.5 });
      flash.x = pos.x; flash.y = pos.y; flash.scale.set(0);
      this.previewLayer.addChild(flash);
      tl.to(flash, { scale: 2, alpha: 0, duration: 0.15, ease: 'power2.out',
        onComplete: () => { flash.removeFromParent(); flash.destroy(); } }, eStart + 0.1);

      tl.set({}, {}, '+=0.15');
    }
  }

  /**
   * 敌将被动"招兵买马"动效编排：
   * 1) 技能提示"招兵买马"（金色标题，无分数）
   * 2) 敌将前摇：原地晃动
   * 3) 分射光线：从敌将同时射向每个被选中的源单位，命中处闪光
   * 4) 源单位再执行复制动效："字"上浮 → 飞向落点 → 落定
   * 引擎已将新单位放入 enemies_（afterResolve 已 syncState）；"字"落定的同时
   * 立即渲染落点真实棋子（不等风暴/龙魂动画后的全量 renderAll，避免空窗断裂感）。
   */
  private playRecruitSpawnEffects(spawns: RecruitSpawn[], onComplete: () => void): void {
    const audio = AudioManager.getInstance();
    // 与 PieceRenderer.addPiece 精灵同尺寸，保证"字"落定变棋子时大小无突变
    const pieceScale = (Layout.pieceRadius * 2 - 3) / 64;
    const tl = gsap.timeline({ onComplete });

    // 技能提示（压缩至 1.2s）
    this.showTitleDirectly('skill_recruit', -1, 1200);

    // 敌将前摇：快速晃动 (~0.18s)
    const gen = this.turnManager.enemyUnits.find(u => u.pieceType === PieceType.GENERAL);
    const genWrapper = gen ? this.pieceRenderer.getContainer(gen.id) : undefined;
    const genPos = genWrapper
      ? { x: genWrapper.x, y: genWrapper.y }
      : gen?.position
        ? logicalToScreen(gen.position.col, gen.position.row)
        : { x: 0, y: 0 };
    if (genWrapper) {
      const origRot = genWrapper.rotation;
      tl.to(genWrapper, { rotation: -0.07, duration: 0.05, ease: 'sine.inOut' }, 0);
      tl.to(genWrapper, { rotation: 0.07, duration: 0.06, ease: 'sine.inOut' }, 0.05);
      tl.to(genWrapper, { rotation: origRot, duration: 0.06, ease: 'sine.inOut' }, 0.11);
    }

    // 分射光线：同时射向源单位（0.12s 到达）
    const BEAM_START = 0.16;
    const BEAM_DUR = 0.12;
    const BEAM_MAX_LEN = 46;
    for (let i = 0; i < spawns.length; i++) {
      const src = logicalToScreen(spawns[i].srcCol, spawns[i].srcRow);
      const dx = src.x - genPos.x;
      const dy = src.y - genPos.y;
      const beam = new Container();
      const line = new Graphics();
      line.alpha = 0.9;
      beam.addChild(line);
      beam.rotation = Math.atan2(dy, dx);
      this.previewLayer.addChild(beam);
      const beamAt = BEAM_START + i * 0.03;
      const state = { t: 0 };
      tl.to(state, {
        t: 1, duration: BEAM_DUR, ease: 'power2.in',
        onUpdate: () => {
          const headX = genPos.x + dx * state.t;
          const headY = genPos.y + dy * state.t;
          const dist = Math.hypot(headX - genPos.x, headY - genPos.y);
          const l = Math.min(dist, BEAM_MAX_LEN);
          beam.x = headX;
          beam.y = headY;
          line.clear()
            .moveTo(-l, 0)
            .lineTo(0, 0)
            .stroke({ width: 3.5, color: 0xffd700, alpha: 0.95 });
        },
      }, beamAt);
      tl.to(beam, {
        alpha: 0, duration: 0.06, ease: 'power1.out',
        onComplete: () => { beam.removeFromParent(); beam.destroy(); },
      }, beamAt + BEAM_DUR);

      // 命中闪光（源单位）
      const hit = new Graphics().circle(0, 0, 7).fill({ color: 0xffd700, alpha: 0.65 });
      hit.x = src.x;
      hit.y = src.y;
      hit.scale.set(0);
      this.previewLayer.addChild(hit);
      tl.to(hit, { scale: 1.7, alpha: 0, duration: 0.16, ease: 'power2.out',
        onComplete: () => { hit.removeFromParent(); hit.destroy(); } },
        beamAt + BEAM_DUR - 0.01);
    }

    // 并行同步飞行 (~0.75s 总耗时)：多个复制棋子近乎同时起飞落定
    const FLY_START = BEAM_START + BEAM_DUR;
    for (let i = 0; i < spawns.length; i++) {
      const sp = spawns[i];
      const offset = FLY_START + i * 0.06;
      const src = logicalToScreen(sp.srcCol, sp.srcRow);
      const dst = logicalToScreen(sp.col, sp.row);
      const tex = getPieceIconTexture(wasmToTsPiece(sp.type as WasmPieceType), false);
      const ghost: Sprite | Text = tex
        ? new Sprite(tex)
        : new Text({
            text: '棋',
            style: {
              fontSize: Math.round(Layout.pieceRadius * 1.25),
              fill: 0xefe4d0, fontFamily: 'STKaiti, KaiTi, serif', fontWeight: '700',
            },
          });
      ghost.anchor.set(0.5);
      ghost.scale.set(tex ? pieceScale : pieceScale * 0.8);
      ghost.x = src.x;
      ghost.y = src.y;
      ghost.alpha = 0;
      this.previewLayer.addChild(ghost);
      if (i === 0) audio.play('storm-spawn');

      // 上浮 (0.12s) → 飞向落点 (0.28s) → 落定消散 (0.10s)
      tl.to(ghost, { alpha: 1, y: src.y - 26, duration: 0.12, ease: 'power2.out' }, offset);
      tl.to(ghost, { x: dst.x, y: dst.y, duration: 0.28, ease: 'power2.inOut' }, offset + 0.12);
      tl.to(ghost, { alpha: 0, scale: pieceScale * 0.8, duration: 0.10, ease: 'power1.in',
        onComplete: () => { ghost.removeFromParent(); ghost.destroy(); } }, offset + 0.40);
      tl.add(() => {
        const unit = this.turnManager.enemyUnits.find(
          u => u.position?.col === sp.col && u.position?.row === sp.row);
        if (!unit) return;
        const w = this.pieceRenderer.addPiece(unit);
        if (w) {
          w.scale.set(0.5);
          gsap.to(w.scale, { x: 1, y: 1, duration: 0.14, ease: 'back.out' });
        }
      }, offset + 0.40);

      // 落点金色闪光
      const flash = new Graphics().circle(0, 0, 8).fill({ color: 0xffd700, alpha: 0.55 });
      flash.x = dst.x;
      flash.y = dst.y;
      flash.scale.set(0);
      this.previewLayer.addChild(flash);
      tl.to(flash, { scale: 2.0, alpha: 0, duration: 0.20, ease: 'power2.out',
        onComplete: () => { flash.removeFromParent(); flash.destroy(); } }, offset + 0.36);
    }
  }

  /**
   * 王见王步骤编排：定位双王几何 → 判定终局 → 双标题分时段 → playKingsMeeting → 帅的舍身 → 收尾。
   * onKillsComplete 用于在动效结束后清理所有目标 wrapper（enemy + ally）。
   */
  private playKingsMeetingStep(
    step: ResolveStep,
    onKillsComplete: () => void,
    onComplete: () => void,
  ): void {
    // 1. 定位双王位置
    // 玩家帅：在 step.targets 中找 aid（ally kill 标记）
    const playerGenTarget = step.targets.find(t => t.aid);
    // 敌方将：从 enemyUnits 中按 pieceType 查找（无论 alive 状态）
    const enemyGen = this.turnManager.enemyUnits.find(u => u.pieceType === PieceType.GENERAL);

    if (!playerGenTarget || !enemyGen || !enemyGen.position) {
      // 兜底：几何信息缺失，退化为旧逻辑
      this.ui.showToast(t('toast.kingsMeeting'), 1.5);
      this.showTitleDirectly('bonus_kings_meeting', 500);
      setTimeout(() => {
        onKillsComplete();
        onComplete();
      }, 400);
      return;
    }

    const playerGen = { col: playerGenTarget.col, row: playerGenTarget.row };
    const enemyGenPos = { col: enemyGen.position.col, row: enemyGen.position.row };
    const isVertical = playerGen.col === enemyGenPos.col;

    // 2. 判定终局：敌将是否在击杀列表中（KM 触发最终一击）
    const isKMFinalKill = step.targets.some(t =>
      t.col === enemyGenPos.col && t.row === enemyGenPos.row && t.eid);

    // 3. 准备敌目标列表（排除玩家帅的 ally kill）
    const enemyTargets = step.targets.filter(t => t.eid);
    const enemyTargetContainers: (Container | null)[] = enemyTargets.map(t =>
      this.pieceRenderer.getContainer(t.eid!) ?? this.pieceRenderer.getContainerAt(t.col, t.row) ?? null);

    // 4. toast 作为开头提示（与 climax 标题错开，不抢戏）
    this.ui.showToast(t('toast.kingsMeeting'), 1.0);

    // 5. climax 回调：在首命中时刻触发双标题分时段 + 命中音/触觉/BGM 压低
    const audio = AudioManager.getInstance();
    this.effectPlayer.onStepClimax = () => {
      audio.play('hit-gong');           // 双王对峙用锣声，语义贴合
      this.haptic(isKMFinalKill ? 20 : 12);
      if (isKMFinalKill) audio.duckBgm();
      this.showKingsMeetingTitles(isKMFinalKill);
    };

    // 6. 播放 KM 动效

    this.effectPlayer.playKingsMeeting(
      this.previewLayer,
      {
        playerGen,
        enemyGen: enemyGenPos,
        isVertical,
        enemyTargets: enemyTargets.map(t => ({ col: t.col, row: t.row })),
        enemyTargetContainers,
        isFinalKill: isKMFinalKill,
        onSacrifice: () => {
          if (playerGenTarget.aid) this.animateGeneralSacrifice(playerGenTarget.aid);
        },
      },
      () => {
        this.effectPlayer.onStepClimax = null;
        onKillsComplete();
        this.refreshHUD();
        onComplete();
      },
    );
  }

  private playLoongDescent(step: ResolveStep, onComplete: () => void): void {
    const pos = logicalToScreen(step.origin.col, step.origin.row);
    AudioManager.getInstance().play('loong-roar');
    const tl = gsap.timeline({ onComplete });

    // Full-screen gold flash
    const flash = new Graphics();
    flash.rect(0, 0, this.app.screen.width, this.app.screen.height)
      .fill({ color: 0xffd700, alpha: 0.25 });
    this.app.stage.addChild(flash);
    tl.to(flash, { alpha: 0, duration: 0.15, ease: 'power2.out',
      onComplete: () => { this.app.stage.removeChild(flash); flash.destroy(); }
    }, 0);

    // Loong column of light
    const column = new Graphics();
    column.rect(-6, -80, 12, 160).fill({ color: 0xffd700, alpha: 0.7 });
    column.x = pos.x; column.y = pos.y;
    this.loongFlameLayer.addChild(column);
    column.scale.y = 1;
    tl.to(column.scale, { y: 0, duration: 0.5, ease: 'power2.in' }, 0.1);
    tl.to(column, { alpha: 0, duration: 0.5, ease: 'power2.in',
      onComplete: () => { this.loongFlameLayer.removeChild(column); column.destroy(); }
    }, 0.1);

    // Expanding golden ring
    const ring = new Graphics();
    ring.circle(0, 0, 10).stroke({ width: 3, color: 0xffd700 });
    ring.x = pos.x; ring.y = pos.y;
    this.loongFlameLayer.addChild(ring);
    tl.to(ring, { width: 200, height: 200, alpha: 0, duration: 0.6, ease: 'power3.out',
      onComplete: () => { this.loongFlameLayer.removeChild(ring); ring.destroy(); }
    }, 0.2);
    // 瞬态局部冲击波（若环境不支持则静默降级为零效果）
    playTransientShockwave(this.loongFlameLayer, this.boardLayer, pos.x, pos.y, 0.25);
  }

  private showScorePop(col: number, row: number, eid: string): void {
    const pos = logicalToScreen(col, row);
    // R2：飘分取引擎类别增量（buildPerKillScores），不再硬编码 150/200/100/-30
    const score = this.perKillScore.get(eid) ?? 0;
    if (score === 0) return; // 无分数变化（如纯位移目标）不弹飘分
    const txt = new Text({
      text: `${score > 0 ? '+' : ''}${Math.round(score)}`,
      style: { fontSize: 20, fill: score < 0 ? 0xe74c3c : 0xffd700, fontFamily: 'Arial', fontWeight: 'bold' },
    });
    txt.anchor.set(0.5); txt.x = pos.x; txt.y = pos.y - 10;
    this.pieceLayer.addChild(txt);
    gsap.to(txt, { y: pos.y - 50, alpha: 0, duration: 1.2, ease: 'power2.out', onComplete: () => { txt.removeFromParent(); txt.destroy(); } });
    // 累计分按引擎类别增量推进；连击/星/额外奖励在回合末对齐（见 finishTurn）
    this.animScore += score;
    this.turnManager.score = this.animScore;
    this.refreshHUD();
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Theme
  // ═══════════════════════════════════════════════════════════════════

  async switchTheme(themeName: 'ink' | 'gold' | 'shatter'): Promise<void> {
    this.currentThemeId = themeName;
    if (themeName === 'shatter') {
      if (!this.shatterPool) this.shatterPool = new CharacterShatterPool();
      if (!this.shatterPool.isReady()) await this.shatterPool.init(this.app.renderer);
      this.effectPlayer.setShatterPool(this.shatterPool);
    } else this.effectPlayer.setShatterPool(null);
    if (themeName === 'ink') this.effectPlayer.setTheme(INK_THEME);
    else if (themeName === 'gold') this.effectPlayer.setTheme(GOLD_THEME);
    else this.effectPlayer.setTheme(SHATTER_THEME);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Game Over
  // ═══════════════════════════════════════════════════════════════════

  private checkGameOver(): void {
    if (this.turnManager.gameResult === GameResult.NONE) return;
    const win = this.turnManager.gameResult === GameResult.WIN;
    const isReplay = !!this.pendingReplayRecord || !!this.replayRunner?.isReplay;
    // 回放/debug 模式跳过所有存档与奖励副作用，仅显示结算页
    const skipRewards = win && (this.debugMode || isReplay);
    if (win && !skipRewards) { AudioManager.getInstance().play('victory'); SaveManager.save(this.currentLevel + 1, this.turnManager.score); SaveManager.saveMaxLevel(this.currentLevel); }
    const tm = this.turnManager;
    // ── 星星判据与最终分：引擎是唯一来源（含星奖励），TS 不再本地计算 ──
    const stars: [boolean, boolean, boolean] = [
      (tm.starMask & 1) !== 0,
      (tm.starMask & 2) !== 0,
      (tm.starMask & 4) !== 0,
    ];
    const totalStars = tm.totalStars;
    const finalScore = tm.finalScore;
    const totalScore = win && !skipRewards ? SaveManager.addRecord(this.currentLevel, finalScore) : SaveManager.getTotalScore();
    let sealData: SettlementData['seal'];
    if (win && !skipRewards) {
      SaveManager.saveLevelStars(this.currentLevel, totalStars);
      DailyController.trackLevelComplete();
      DailyController.trackStarsEarned(totalStars);
      void DailyController.trackWinStreak();
      engineBridge.addPlatformWin(1);
      // V1-010: 3星胜场计数驱动印章解锁（服务端权威，本地兜底显示）
      let sealPromoted = false;
      if (totalStars >= 3) {
        const prevTier = getCurrentSealTier(getAuthoritativeStar3Wins()).tier;
        // 乐观更新本地缓存（服务端在 publish 时已累加；这里仅 UI 即时反馈）
        const optimisticWins = getAuthoritativeStar3Wins() + 1;
        setServerStar3Wins(optimisticWins);
        const newTier = getCurrentSealTier(optimisticWins).tier;
        sealPromoted = newTier > prevTier;
        if (sealPromoted) {
          const claimed = getClaimedTiers();
          if (!claimed.has(newTier)) {
            const gold = sealGoldReward(newTier);
            const soul = sealSoulReward(newTier);
            // V1-013: 服务端幂等发放（失败则回退本地发放，保证玩家不丢奖）
            const opId = `seal_tier_${newTier}_${SaveManager.getHash().slice(0, 16)}`;
            walletGrant(SaveManager.getHash(), opId, gold, 'loong_soul', soul, 'seal_tier')
              .then(res => {
                if (res.code === 0 && res.data) {
                  // 服务端已扣账，同步本地
                  engineBridge.platformSetBalance(res.data.balance, 0);
                  // 直接覆盖本地 loong_soul 数量
                  const soulCount = res.data.inventory.loong_soul ?? soul;
                  engineBridge.addPlatformItem('loong_soul', Math.max(0, soulCount - engineBridge.getPlatformItemCount('loong_soul')));
                  engineBridge.platformSave();
                  markTierClaimed(newTier);
                  const rewardText = `${t('seal.rewardGold', { amount: String(gold) })} + ${t('seal.rewardSoul', { amount: String(soul) })}`;
                  this.ui.showToast(t('seal.promoted', { reward: rewardText }), 3);
                } else {
                  // 降级：本地发放（兜底）
                  engineBridge.grantGold(gold);
                  engineBridge.addPlatformItem('loong_soul', soul);
                  engineBridge.platformSave();
                  markTierClaimed(newTier);
                  const rewardText = `${t('seal.rewardGold', { amount: String(gold) })} + ${t('seal.rewardSoul', { amount: String(soul) })}`;
                  this.ui.showToast(t('seal.promoted', { reward: rewardText }), 3);
                }
              })
              .catch(() => {
                // 网络失败：本地兜底发放
                engineBridge.grantGold(gold);
                engineBridge.addPlatformItem('loong_soul', soul);
                engineBridge.platformSave();
                markTierClaimed(newTier);
                const rewardText = `${t('seal.rewardGold', { amount: String(gold) })} + ${t('seal.rewardSoul', { amount: String(soul) })}`;
                this.ui.showToast(t('seal.promoted', { reward: rewardText }), 3);
              });
          }
        }
      }
      sealData = { tier: getCurrentSealTier(getAuthoritativeStar3Wins()).tier, promoted: sealPromoted };
    }
    const data: SettlementData = {
      level: this.currentLevel, piecesScore: tm.piecesScore, cityScore: tm.cityScore, statueScore: tm.statueScore, allyLostPenalty: tm.allyLostPenalty, comboGain: tm.comboGain, starBonus: tm.starBonus, maxKillsPerStep: tm.maxKillsPerStep, bonusScores: [...tm.bonusScores], levelMultiplier: tm.levelMultiplier, finalScore, totalScore, turnCount: tm.turnCount + (win ? 1 : 0), wagonCount: Math.floor(tm.provisionsBonus / 5), win, stars, totalStars, seal: sealData,
      dailyDate: this.dailyChallengeDate ?? undefined,
      formationName: this.dailyChallengeDate ? undefined : (getFormationName(this.currentLevel) || undefined),
      callout: this.lastVictoryCallout || undefined,
    };
    if (win) {
      if (!isReplay && this.dailyChallengeDate) {
        DailyController.saveDailyChallengeResult(this.dailyChallengeDate, finalScore, totalStars, data.turnCount);
      }
      if (!isReplay) {
        persistGameRecord(
          tm.recordPublishError,
          () => engineBridge.exportRecord(),
          record => engineBridge.verifyRecord(record),
          record => SaveManager.saveGameRecord(record),
          () => SaveManager.clearGameRecord(),
        );
        this.lastSettlementData = data;
      }
      // 回放模式：onNext=重播, onRestart=挑战这局, onMenu=回主页
      const onQuit = () => { this.cleanupScene(); this.start(); };
      if (isReplay) {
        const replayRecord = this.replayRunner?.currentRecord ?? this.pendingReplayRecord;
        const onReplayAgain = () => {
          this.replayRunner?.destroy();
          if (replayRecord) this.beginReplay(replayRecord);
          else { this.cleanupScene(); this.start(); }
        };
        const onChallenge = () => {
          const seed = replayRecord?.rngSeed;
          const config = replayRecord?.configJson || undefined;
          new ReplayController().showChallengeIntro(data.level, data.finalScore,
            () => { this.challengeTargetScore = data.finalScore; this.beginLevel(data.level, seed, config); },
            onQuit,
          );
        };
        this.ui.showVictory(data, onReplayAgain, onChallenge, onQuit, true);
      } else {
        const showVictoryNow = () => {
          this.ui.showVictory(data, () => this.nextLevel(), () => this.restart(), onQuit);
          if (FtueController.isActiveForLevel(this.currentLevel)) FtueController.hintVictory();
          if (this.challengeTargetScore !== null) {
            const target = this.challengeTargetScore;
            this.challengeTargetScore = null;
            setTimeout(() => {
              new ReplayController().showChallengeResult(finalScore, target, () => { this.cleanupScene(); this.start(); });
            }, 600);
          }
        };
        // 先弹宝箱三选一，领完奖励再展示完整结算成绩单（避免结算卡刚弹 1.2s 就被打断）
        setTimeout(() => {
          this.ui.showTreasureChest(this.currentLevel, data.finalScore, showVictoryNow);
        }, 350);
      }
    } else {
      // Engine LOSE triggers: force_defeat（弹尽粮绝投降）或无可落子位置
      AudioManager.getInstance().playDefeat();
      const defeatReason = tm.recordPublishError === 'err.surrendered'
        ? t('defeat.reasonSurrendered')
        : t('defeat.reasonNoMove');
      if (!isReplay) {
        void DailyController.grantConsolationGold(this.currentLevel);
        DailyController.resetWinStreak();
      }
      const onQuit = () => { this.cleanupScene(); this.start(); };
      this.ui.showDefeat(isReplay ? onQuit : () => this.restart(), onQuit, defeatReason);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Leaderboard
  // ═══════════════════════════════════════════════════════════════════

  private async refreshLeaderboard(tab: 'total' | 'level', level: number, gameType: string, period: string, showLoading: boolean): Promise<void> {
    if (showLoading) {
      this.ui.showLeaderboard([], null, 0, tab, level, gameType, period, true);
    }
    try {
      const userHash = SaveManager.getHash();
      const res = await queryRank(gameType, tab === 'total' ? 0 : level, period, userHash);
      if (res.code === 0 && res.data) {
        this.ui.showLeaderboard(res.data.list, res.data.userRank ?? null, res.data.nextSortAt, tab, level, gameType, period, false);
      } else {
        this.ui.showToast(serverErrorMessage(res.errCode, 'toast.networkError'), 2);
        this.ui.hideLeaderboard();
      }
    } catch {
      this.ui.showToast(t('toast.networkError'), 2);
      this.ui.hideLeaderboard();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Navigation
  // ═══════════════════════════════════════════════════════════════════

  restart(): void { SaveManager.clearGameState(); this.cleanupScene(); void this.init(); }
  private nextLevel(): void { this.dailyChallengeDate = null; SaveManager.clearGameState(); this.cleanupScene(); this.currentLevel++; SaveManager.save(this.currentLevel, this.turnManager.score); void this.init(); }

  private syncServerGold(): void {
    const hash = SaveManager.getHash();
    if (!hash) return;
    getCoinBalance(hash).then(d => {
      if (d.code === 0 && d.data && d.data.balance !== undefined) {
        engineBridge.platformSetBalance(d.data.balance, 0);
      }
    }).catch(() => {});
  }

  private cleanupScene(): void {
    this.clearEnemyInspect();
    this.cleanupHandDrag();
    // V1-015: Clean up replay state
    this.replayRunner?.destroy();
    this.replayRunner = null;
    this.pendingReplayRecord = null;
    // Collect any unsettled loong souls into platform inventory before
    // destroying the scene. Without this, souls collected during the game
    // but never "settled" (via backpack open or run publish) are lost.
    const unsettled = this.getUnsettledLoongSoulCount();
    if (unsettled > 0) {
      engineBridge.collectLoongSouls(unsettled);
      this.settledLoongSouls = this.turnManager?.loongSoulsCollectedThisGame ?? 0;
      engineBridge.platformSave();
    }
    this.effectPlayer.destroy();
    if (this.removeTl) { this.removeTl.kill(); this.removeTl = null; }
    for (const t of this._flameTweens) t.kill();
    this._flameTweens = [];
    this._sacrificeWrappers.clear();
    this._flameGraphics.clear();
    this._flamePositionsKey = '';  // reset so next scene rebuilds flames from scratch
    this.loongLamp?.destroy();
    this.boardRenderer.destroy(); this.intersectionRenderer.destroy(); this.pieceRenderer.destroy();
    this.ui.destroy();
    while (this.app.stage.children.length > 0) this.app.stage.removeChild(this.app.stage.children[0]);
    // 清扫跨局孤儿 tween：上面只 kill 了已追踪的 removeTl/_flameTweens，
    // 散落的短 tween（飘字、棋子缩放、灵魂飞行等）若仍在飞行不会被回收，跨局堆积推高每帧渲染成本。
    gsap.globalTimeline.getChildren(false).forEach(c => c.kill());
    renderNow(); // 清空舞台后立即补帧，避免主菜单下残留最后一帧棋盘
    this.intersectionRenderer = new IntersectionRenderer(); this.pieceRenderer = new PieceRenderer(); this.boardRenderer = new BoardRenderer();
    this.boardLayer = new Container(); this.forbiddenLayer = new Container(); this.loongFlameLayer = new Container(); this.pieceLayer = new Container(); this.intersectionLayer = new Container(); this.previewLayer = new Container();
    this.isAnimating = false;
    if (this.boundOnResize) { window.removeEventListener('resize', this.boundOnResize); this.boundOnResize = null; }
    if (this._resizeTimer) { clearTimeout(this._resizeTimer); this._resizeTimer = null; }
    if (this.boundOnKeyDown) { window.removeEventListener('keydown', this.boundOnKeyDown); this.boundOnKeyDown = null; }
    if (this.boundOnPieceStyleChange) { window.removeEventListener('piecestylechange', this.boundOnPieceStyleChange); this.boundOnPieceStyleChange = null; }
    this.currentThemeId = 'shatter';
    // Character textures are renderer-scoped immutable resources. Reuse the
    // original pool across level restarts instead of extracting/allocating a
    // fresh full/stroke texture set on every scene reset.
    this.effectPlayer = new SkillEffectPlayer(SHATTER_THEME, this.shatterPool ?? undefined);
    this.effectPlayer.setShakeTarget(this.app.stage);
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Resize
  // ═══════════════════════════════════════════════════════════════════

  private onResize(): void {
    const cw = window.innerWidth, ch = window.innerHeight;
    this.app.stage.hitArea = this.app.screen;
    if (this.turnManager) {
      Layout.update(cw, ch, this.turnManager.board.cols, this.turnManager.board.rows);
      setBoardParams(Layout.boardOrigin.x, Layout.boardOrigin.y, Layout.cellSize, Layout.boardCols, Layout.boardRows);
      this.boardRenderer.draw(this.turnManager.board.cols, this.turnManager.board.rows);
      this.intersectionRenderer.renderAllIntersections(this.turnManager.board.cols, this.turnManager.board.rows);
    } else {
      Layout.update(cw, ch, CONFIG.BOARD_COLS, CONFIG.BOARD_ROWS);
      setBoardParams(Layout.boardOrigin.x, Layout.boardOrigin.y, Layout.cellSize, Layout.boardCols, Layout.boardRows);
      this.boardRenderer.draw(); this.intersectionRenderer.renderAllIntersections(CONFIG.BOARD_COLS, CONFIG.BOARD_ROWS);
    }
    this.refreshUI();
    if (this.turnManager && this.turnManager.phase === GamePhase.PLACE_PIECE) {
      const validPoints = this.turnManager.getValidPlacements(); this.intersectionRenderer.showValidPlacements(validPoints);
      for (const p of this.turnManager.placed) { if (p.position) this.intersectionRenderer.addSkillRange(p.id, p.skill.getAttackRange(p.position!)); }
    }
    renderNow();
  }
}
