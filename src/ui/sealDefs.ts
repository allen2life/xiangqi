// 印章模板定义 — V1.0: 3星胜场计数驱动解锁（前8枚）
// 解锁条件：累计 3 星胜场数（胜利且 totalStars >= 3）
// 奖励公式：金币 min(20000, 1000 + 800*(n-1))；龙魂 5 + 2*floor(n/3)
// 解锁瞬间一次性领奖，localStorage `seal_claimed_tiers` 记录已领取层级

export interface SealTierDef {
  tier: number;        // 0-7
  id: string;          // i18n key suffix (e.g. "chushi")
  threshold: number;   // 3星胜场门槛
}

export const SEAL_TIERS: SealTierDef[] = [
  { tier: 0, id: 'chushi',     threshold: 1  },
  { tier: 1, id: 'pozhen',     threshold: 3  },
  { tier: 2, id: 'dengtan',    threshold: 6  },
  { tier: 3, id: 'changsheng', threshold: 10 },
  { tier: 4, id: 'fenghou',    threshold: 16 },
  { tier: 5, id: 'wushuang',   threshold: 25 },
  { tier: 6, id: 'zhengdao',   threshold: 40 },
  { tier: 7, id: 'tiandi',     threshold: 60 },
];

/** C++ addPlatformWin 返回的升级结果 */
export interface SealUpdate {
  prevWins: number;
  newWins: number;
  prevTier: number;
  newTier: number;
  promoted: boolean;
}

/** 根据累计 3 星胜场返回当前印级 */
export function getCurrentSealTier(star3Wins: number): SealTierDef {
  let current = SEAL_TIERS[0];
  for (const tier of SEAL_TIERS) {
    if (star3Wins >= tier.threshold) current = tier;
  }
  return current;
}

/** 下一级印级，若已满则返回 null */
export function getNextSealTier(star3Wins: number): SealTierDef | null {
  for (const tier of SEAL_TIERS) {
    if (star3Wins < tier.threshold) return tier;
  }
  return null;
}

// ── 奖励公式 ──

/** 金币奖励：min(20000, 1000 + 800*(n-1))，n 为层级（1-based） */
export function sealGoldReward(tier: number): number {
  return Math.min(20000, 1000 + 800 * tier);
}

/** 龙魂奖励：5 + 2*floor(n/3)，n 为层级（1-based） */
export function sealSoulReward(tier: number): number {
  return 5 + 2 * Math.floor((tier + 1) / 3);
}

// ── 3 星胜场计数（localStorage 客户端兜底，V1-012 后端权威后服务端为准）──

const STAR3_WINS_KEY = 'seal_3star_wins';
const CLAIMED_TIERS_KEY = 'seal_claimed_tiers';

/** 服务端权威 star3 wins 缓存（null 表示尚未同步，回退 localStorage） */
let serverStar3Wins: number | null = null;

/** 写入服务端权威 star3 wins 缓存（来自 /seal/wins 或 /wallet/sync） */
export function setServerStar3Wins(n: number): void {
  serverStar3Wins = n;
  // 同步刷新 localStorage 兜底值，避免 UI 抖动
  try { localStorage.setItem(STAR3_WINS_KEY, String(n)); } catch { /* ignore */ }
}

/** 返回权威 star3 wins：优先服务端缓存，否则回退 localStorage */
export function getAuthoritativeStar3Wins(): number {
  if (serverStar3Wins !== null) return serverStar3Wins;
  return getStar3Wins();
}

/** 读取累计 3 星胜场数（localStorage 离线兜底） */
export function getStar3Wins(): number {
  try {
    const raw = localStorage.getItem(STAR3_WINS_KEY);
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch { return 0; }
}

/** 累加 3 星胜场数，返回新值（localStorage 离线兜底；服务端在 publish 时自动累加） */
export function addStar3Wins(delta: number): number {
  const newVal = getStar3Wins() + delta;
  try { localStorage.setItem(STAR3_WINS_KEY, String(newVal)); } catch { /* ignore */ }
  return newVal;
}

/** 读取已领取奖励的层级列表 */
export function getClaimedTiers(): Set<number> {
  try {
    const raw = localStorage.getItem(CLAIMED_TIERS_KEY);
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch { return new Set(); }
}

/** 标记某层级奖励已领取 */
export function markTierClaimed(tier: number): void {
  const claimed = getClaimedTiers();
  claimed.add(tier);
  try { localStorage.setItem(CLAIMED_TIERS_KEY, JSON.stringify([...claimed])); } catch { /* ignore */ }
}
