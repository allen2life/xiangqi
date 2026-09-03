/**
 * 调试模式回合耗时统计（URL 带 debug=1 时启用）。
 * 数据存 localStorage（客户端），dev tools 里调用 window.turnStats() 查看。
 */

const LS_KEY = 'xqblast:debug:turnTimes';

export interface TurnStatRecord {
  run: number;
  level: number;
  turn: number;
  ms: number;
  ts: number;
}

export function isDebugMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debug');
}

function load(): TurnStatRecord[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(records: TurnStatRecord[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(records));
  } catch {
    // 存储满/隐私模式：静默丢弃，不影响游戏
  }
}

/** 回合计时器：一局（run）内按回合号连续计时，重开/换关自动递增 runId */
export class TurnStatsRecorder {
  private readonly enabled = isDebugMode();
  private active = false;
  private runId = 0;
  private level = 0;
  private turnNo = 0;
  private startedAt = 0;

  /** 场景初始化（新一局/重开/换关）：激活并开启第一回合计时；回放模式停用 */
  onSceneInit(active: boolean, level: number): void {
    this.active = active;
    if (!this.enabled || !active) return;
    this.runId++;
    this.level = level;
    this.turnNo = 0;
    this.startedAt = 0;
    this.startTurn(level);
  }

  /** 新回合开始（首回合 / 上一回合结算完成 / 跳过回合后） */
  startTurn(level: number): void {
    if (!this.enabled || !this.active) return;
    this.level = level;
    this.turnNo++;
    this.startedAt = Date.now();
  }

  /** 回合结束（确认 / 跳过）：记录耗时并落盘 */
  endTurn(): void {
    if (!this.enabled || !this.active || !this.startedAt) return;
    const ms = Date.now() - this.startedAt;
    this.startedAt = 0;
    const records = load();
    records.push({ run: this.runId, level: this.level, turn: this.turnNo, ms, ts: Date.now() });
    save(records);
  }
}

/** dev tools 查看入口：window.turnStats() → 打印汇总 + 明细表格，返回明细数组 */
export function dumpTurnStats(): TurnStatRecord[] {
  const records = load();
  if (records.length === 0) {
    console.log('[turnStats] 暂无记录 — 调试模式下（URL 带 debug=1）游玩后产生');
    return [];
  }
  const byLevel = new Map<number, number[]>();
  for (const r of records) {
    const list = byLevel.get(r.level) ?? [];
    list.push(r.ms);
    byLevel.set(r.level, list);
  }
  const summary = [...byLevel.entries()]
    .map(([level, list]) => {
      const sum = list.reduce((a, b) => a + b, 0);
      return {
        关卡: level,
        回合数: list.length,
        平均ms: Math.round(sum / list.length),
        最快ms: Math.min(...list),
        最慢ms: Math.max(...list),
        合计ms: sum,
      };
    })
    .sort((a, b) => a.关卡 - b.关卡);
  console.table(summary);
  console.table(records);
  return records;
}

/** 调试模式下挂载 window.turnStats 查看入口 */
export function installTurnStats(): void {
  if (!isDebugMode()) return;
  (window as any).turnStats = dumpTurnStats;
}
