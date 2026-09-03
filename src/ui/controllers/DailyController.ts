/**
 * Daily retention hooks: sign-in (7-day cycle) + daily tasks + failure consolation.
 * State persisted in localStorage (daily_state_v1).
 */
import { t } from '../../i18n';
import { engineBridge } from '../../wasm/EngineBridge';
import { itemName } from '../utils/pieceIcons';
import { ITEM_DEFS } from '../../config';
import { showToast } from '../utils/domHelpers';
import { walletGrant } from '../../cloud/api';
import { SaveManager } from '../../core/SaveManager';

const DAILY_KEY = 'daily_state_v1';

// 7-day sign-in rewards: [gold, itemId?, itemQty?]
const SIGN_IN_REWARDS: { gold: number; item?: string; qty?: number }[] = [
  { gold: 50 },
  { gold: 100 },
  { gold: 150, item: 'undo', qty: 1 },
  { gold: 200 },
  { gold: 300, item: 'redraw', qty: 1 },
  { gold: 500 },
  { gold: 1000, item: 'loong_soul', qty: 1 },
];

interface DailyTask {
  id: string;
  target: number;
  progress: number;
  claimed: boolean;
  reward: { gold?: number; item?: string; qty?: number };
}

interface DailyState {
  date: string;           // YYYY-MM-DD of last activity
  signInDay: number;      // 0-6, current position in 7-day cycle
  signedInToday: boolean;
  tasks: DailyTask[];
  winStreak: number;                  // consecutive wins (reset on defeat)
  claimedStreakMilestones: number[];  // milestone thresholds already claimed this cycle
}

// 连胜奖励梯度：达到 threshold 连胜时发放，每个里程碑每轮只领一次
const STREAK_MILESTONES: { threshold: number; reward: { gold?: number; item?: string; qty?: number } }[] = [
  { threshold: 3,  reward: { gold: 100 } },
  { threshold: 5,  reward: { item: 'redraw', qty: 1 } },
  { threshold: 7,  reward: { item: 'loong_soul', qty: 2 } },
  { threshold: 10, reward: { gold: 500 } },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function defaultTasks(): DailyTask[] {
  return [
    { id: 'play', target: 3, progress: 0, claimed: false, reward: { item: 'provision_wagon', qty: 1 } },
    { id: 'useItem', target: 2, progress: 0, claimed: false, reward: { gold: 100 } },
    { id: 'stars', target: 5, progress: 0, claimed: false, reward: { item: 'loong_soul', qty: 2 } },
  ];
}

function readState(): DailyState {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const s = JSON.parse(raw) as DailyState;
      if (s.date !== todayStr()) {
        // New day: reset tasks, keep sign-in cycle position + win streak
        s.date = todayStr();
        s.signedInToday = false;
        s.tasks = defaultTasks();
        writeState(s);
      }
      // Backward compat: ensure new fields exist
      if (s.winStreak === undefined) s.winStreak = 0;
      if (!Array.isArray(s.claimedStreakMilestones)) s.claimedStreakMilestones = [];
      return s;
    }
  } catch { /* ignore */ }
  const fresh: DailyState = { date: todayStr(), signInDay: 0, signedInToday: false, tasks: defaultTasks(), winStreak: 0, claimedStreakMilestones: [] };
  writeState(fresh);
  return fresh;
}

function writeState(s: DailyState): void {
  try { localStorage.setItem(DAILY_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function generateOpId(prefix: string): string {
  const today = todayStr();
  const hashShort = SaveManager.getHash().slice(0, 12);
  return `${prefix}_${today}_${hashShort}`;
}

async function deliverReward(r: { gold?: number; item?: string; qty?: number }, opIdPrefix: string): Promise<void> {
  const hash = SaveManager.getHash();
  if (!hash) {
    // 离线兜底
    if (r.gold) engineBridge.grantGold(r.gold);
    if (r.item && r.qty) engineBridge.addPlatformItem(r.item, r.qty);
    engineBridge.platformSave();
    return;
  }
  const opId = generateOpId(opIdPrefix);
  try {
    const res = await walletGrant(hash, opId, r.gold ?? 0, r.item ?? '', r.qty ?? 0, opIdPrefix);
    if (res.code === 0 && res.data) {
      engineBridge.platformSetBalance(res.data.balance, 0);
      if (r.item && r.qty) {
        const newQty = res.data.inventory[r.item] ?? r.qty;
        const current = engineBridge.getPlatformItemCount(r.item);
        const delta = newQty - current;
        if (delta > 0) engineBridge.addPlatformItem(r.item, delta);
      }
      engineBridge.platformSave();
      return;
    }
  } catch { /* fall through to local */ }
  // 降级：本地发放
  if (r.gold) engineBridge.grantGold(r.gold);
  if (r.item && r.qty) engineBridge.addPlatformItem(r.item, r.qty);
  engineBridge.platformSave();
}

function taskName(id: string): string {
  if (id === 'play') return t('daily.taskPlay');
  if (id === 'useItem') return t('daily.taskUseItem');
  return t('daily.taskStars');
}

function rewardText(r: { gold?: number; item?: string; qty?: number }): string {
  const parts: string[] = [];
  if (r.gold) parts.push(t('chest.rewardGold', { amount: r.gold }));
  if (r.item && r.qty) {
    const def = ITEM_DEFS[r.item];
    parts.push(t('chest.rewardItem', { name: def ? itemName(def) : r.item, qty: r.qty }));
  }
  return parts.join(' + ');
}

export class DailyController {
  /** Check-in: track level completion for daily task */
  static trackLevelComplete(): void {
    const s = readState();
    const task = s.tasks.find(t => t.id === 'play');
    if (task && !task.claimed && task.progress < task.target) {
      task.progress++;
      writeState(s);
    }
  }

  /** Track item usage for daily task */
  static trackItemUse(): void {
    const s = readState();
    const task = s.tasks.find(t => t.id === 'useItem');
    if (task && !task.claimed && task.progress < task.target) {
      task.progress++;
      writeState(s);
    }
  }

  /** Track stars earned for daily task */
  static trackStarsEarned(count: number): void {
    const s = readState();
    const task = s.tasks.find(t => t.id === 'stars');
    if (task && !task.claimed && task.progress < task.target) {
      task.progress = Math.min(task.target, task.progress + count);
      writeState(s);
    }
  }

  /** 连胜追踪：胜利时累加，达到里程碑发放奖励（幂等） */
  static async trackWinStreak(): Promise<void> {
    const s = readState();
    s.winStreak = (s.winStreak || 0) + 1;
    writeState(s);
    for (const m of STREAK_MILESTONES) {
      if (s.winStreak >= m.threshold && !s.claimedStreakMilestones.includes(m.threshold)) {
        s.claimedStreakMilestones.push(m.threshold);
        writeState(s);
        await deliverReward(m.reward, `streak_${m.threshold}`);
        showToast(t('daily.streakMilestone', { n: String(s.winStreak), reward: rewardText(m.reward) }), 3);
      }
    }
  }

  /** 连胜中断：失败时重置计数与已领里程碑 */
  static resetWinStreak(): void {
    const s = readState();
    if (s.winStreak > 0) {
      s.winStreak = 0;
      s.claimedStreakMilestones = [];
      writeState(s);
    }
  }

  /** Failure consolation: grant small gold on defeat */
  static async grantConsolationGold(level: number): Promise<void> {
    const amount = Math.min(30, 10 + level * 2);
    await deliverReward({ gold: amount }, 'consolation');
    showToast(t('daily.consolation', { amount }), 2);
  }

  /** Show sign-in panel if not signed in today */
  showSignInIfPending(): boolean {
    const s = readState();
    if (s.signedInToday) return false;
    this.showSignInPanel();
    return true;
  }

  private showSignInPanel(): void {
    const s = readState();
    const day = s.signInDay % 7;
    const existing = document.getElementById('signin-overlay');
    if (existing) existing.remove();

    const daysHtml = SIGN_IN_REWARDS.map((r, i) => {
      const isToday = i === day;
      const isPast = i < day || (s.signInDay >= 7 && i < 7);
      const cls = isToday ? 'signin-day today' : isPast ? 'signin-day past' : 'signin-day';
      return `<div class="${cls}">
        <div class="signin-day-num">D${i + 1}</div>
        <div class="signin-day-reward">${rewardText(r)}</div>
        <div class="signin-day-check">${isPast ? '✓' : ''}</div>
      </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay signin-overlay';
    overlay.id = 'signin-overlay';
    overlay.innerHTML = `
      <div class="signin-card">
        <div class="signin-title">${t('daily.signInTitle')}</div>
        <div class="signin-subtitle">${t('daily.signInSubtitle', { day: day + 1 })}</div>
        <div class="signin-grid">${daysHtml}</div>
        <button class="signin-claim-btn" id="signin-claim">${t('daily.claim')}</button>
        <button class="signin-skip" id="signin-skip">${t('daily.later')}</button>
      </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#signin-skip')!.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('#signin-claim')!.addEventListener('click', () => {
      const reward = SIGN_IN_REWARDS[day];
      void deliverReward(reward, 'daily_signin');
      const state = readState();
      state.signedInToday = true;
      state.signInDay = (state.signInDay + 1) % 7;
      writeState(state);
      showToast(t('daily.signInDone', { reward: rewardText(reward) }), 2.5);
      close();
    });
  }

  /** Show daily tasks panel */
  showTaskPanel(): void {
    const s = readState();
    const existing = document.getElementById('daily-task-overlay');
    if (existing) existing.remove();

    const tasksHtml = s.tasks.map(task => {
      const complete = task.progress >= task.target;
      return `<div class="daily-task-row ${task.claimed ? 'claimed' : complete ? 'complete' : ''}">
        <div class="daily-task-info">
          <div class="daily-task-name">${taskName(task.id)}</div>
          <div class="daily-task-progress">${task.progress}/${task.target}</div>
        </div>
        <div class="daily-task-reward">${rewardText(task.reward)}</div>
        <button class="daily-task-btn" data-task-id="${task.id}" ${task.claimed || !complete ? 'disabled' : ''}>
          ${task.claimed ? '✓' : t('daily.claim')}
        </button>
      </div>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay daily-task-overlay';
    overlay.id = 'daily-task-overlay';
    overlay.innerHTML = `
      <div class="daily-task-card">
        <div class="daily-task-title">${t('daily.taskTitle')}</div>
        ${tasksHtml}
        <button class="daily-task-close" id="daily-task-close">${t('publish.done')}</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#daily-task-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.daily-task-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const taskId = (btn as HTMLElement).dataset.taskId!;
        const state = readState();
        const task = state.tasks.find(t => t.id === taskId);
        if (!task || task.claimed || task.progress < task.target) return;
        void deliverReward(task.reward, 'daily_task');
        task.claimed = true;
        writeState(state);
        showToast(t('daily.taskClaimed', { reward: rewardText(task.reward) }), 2);
        overlay.remove();
        this.showTaskPanel(); // Refresh
      });
    });
  }
}
