import { SaveManager } from '../core/SaveManager';

const BASE = import.meta.env.VITE_API_BASE || '/api';

const GAME_ID = 1; // xiangqiblast

export interface UploadBody {
  hash: string;
  kouling?: string;
  nickname: string;
  maxLevel: number;
  totalScore: number;
  scoreTime: number;
  recordData?: string;
  checkpointData?: string;
  gameRecordData?: string;
  runNonce?: string;
  recordProtocolVersion?: number;
  levelId?: number;
  rulesetId?: string;
  levelConfigHash?: string;
  platformData?: string;
  levelScores?: Record<number, number>;
  levelStars?: Record<number, number>;
  scoreDetail?: string; // 本局得分明细 JSON（与记录同源，服务端对照校验）
  inviter_code?: string;
  game_id?: number;
}

export interface DownloadBody {
  hash: string;
  kouling?: string;
  inviter_code?: string;
  game_id?: number;
}

export interface DownloadData {
  nickname: string;
  maxLevel: number;
  totalScore: number;
  scoreTime: number;
  recordData?: string;
  checkpointData?: string;
  platformData?: string;
}

// ── New Rank types (matching server model.RankItem / RankQueryResp) ──

export interface RankItem {
  rank: number;
  userHash: string;
  nickname: string;
  score: number;
  stars: number;
  publishTime: number;
  defenseLevel: number;
}

export interface UserRankInfo {
  rank: number;
  score: number;
}

export interface RankQueryResponse {
  list: RankItem[];
  nextSortAt: number;
  userRank?: UserRankInfo;
}

export interface PublishResponse {
  balance_remaining: number;
  inventory: Record<string, number>;
  rank: number;
  is_new_user: boolean;
}

export interface ApiResponse<T = unknown> {
  code: number;
  errCode?: string;
  message: string;
  data?: T;
  httpStatus: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json() as Omit<ApiResponse<T>, 'httpStatus'> & { err_code?: string };
  return { ...body, errCode: body.errCode ?? body.err_code, httpStatus: res.status };
}

function attachInviterCode<T extends UploadBody | DownloadBody>(body: T): T {
  const code = SaveManager.getInviteCode();
  if (code) {
    return { ...body, inviter_code: code };
  }
  return body;
}

export async function uploadData(body: UploadBody): Promise<ApiResponse> {
  return request('/sync/upload', {
    method: 'POST',
    body: JSON.stringify(attachInviterCode({ ...body, game_id: body.game_id ?? GAME_ID })),
  });
}

export async function downloadData(body: DownloadBody): Promise<ApiResponse<DownloadData>> {
  return request<DownloadData>('/sync/download', {
    method: 'POST',
    body: JSON.stringify(attachInviterCode({ ...body, game_id: body.game_id ?? GAME_ID })),
  });
}

export async function publishRank(body: UploadBody): Promise<ApiResponse<PublishResponse>> {
  return request('/rank/publish', {
    method: 'POST',
    body: JSON.stringify(attachInviterCode({ ...body, game_id: body.game_id ?? GAME_ID })),
  });
}

export async function queryRank(gameType: string, level: number, period: string, userHash?: string): Promise<ApiResponse<RankQueryResponse>> {
  const params = new URLSearchParams({ game_id: String(GAME_ID), level: String(level), period });
  if (userHash) params.set('userHash', userHash);
  return request<RankQueryResponse>(`/rank/query?${params.toString()}`);
}

// ── Invite / Coin types ──

export interface InviteCodeResponse {
  code: string;
  url: string;
}

export interface CoinBalanceResponse {
  balance: number;
}

export interface CoinFlowItem {
  amount: number;
  source_user_hash: string;
  source_nickname?: string;
  generation: number;
  created_at: number;
}

export interface CoinFlowResponse {
  flows: CoinFlowItem[];
  total: number;
}

export interface InviteStatsResponse {
  code: string;
  url: string;
  invite_count: number;
  total_reward: number;
  balance: number;
}

// ── Invite / Coin API functions ──

export async function getInviteCode(hash: string): Promise<ApiResponse<InviteCodeResponse>> {
  return request<InviteCodeResponse>('/invite/code', {
    method: 'POST',
    body: JSON.stringify({ hash, game_id: GAME_ID }),
  });
}

export async function getCoinBalance(hash: string): Promise<ApiResponse<CoinBalanceResponse>> {
  return request<CoinBalanceResponse>('/coin/balance', {
    method: 'POST',
    body: JSON.stringify({ hash }),
  });
}

export async function getCoinFlow(hash: string, page = 1, pageSize = 20): Promise<ApiResponse<CoinFlowResponse>> {
  return request<CoinFlowResponse>('/coin/flow', {
    method: 'POST',
    body: JSON.stringify({ hash, page, page_size: pageSize }),
  });
}

export async function getInviteStats(hash: string): Promise<ApiResponse<InviteStatsResponse>> {
  return request<InviteStatsResponse>('/invite/stats', {
    method: 'POST',
    body: JSON.stringify({ hash }),
  });
}

// ── Item types ──

export interface ItemBuyResponse {
  balance: number;
  item_id: string;
  quantity: number;
}

// ── Item API functions ──

export async function itemBuy(hash: string, itemId: string, quantity: number, operationId: string): Promise<ApiResponse<ItemBuyResponse>> {
  return request<ItemBuyResponse>('/item/buy', {
    method: 'POST',
    body: JSON.stringify({ hash, item_id: itemId, quantity, game_id: GAME_ID, operation_id: operationId }),
  });
}

// ── Replay API functions ──

export interface ReplayShareResponse {
  code: string;
}

export interface ReplayGetResponse {
  code: string;
  record: string;
  level: number;
  score: number;
  stars: number;
  nickname: string;
  createdAt: number;
}

export async function shareReplay(hash: string, record: string, level: number, score: number, stars: number, nickname: string): Promise<ApiResponse<ReplayShareResponse>> {
  return request<ReplayShareResponse>('/replay/share', {
    method: 'POST',
    body: JSON.stringify({ userHash: hash, record, level, score, stars, nickname }),
  });
}

export async function getReplay(code: string): Promise<ApiResponse<ReplayGetResponse>> {
  return request<ReplayGetResponse>(`/replay/${code}`, {
    method: 'GET',
  });
}

export async function getReplayByUser(hash: string, level: number): Promise<ApiResponse<ReplayGetResponse>> {
  return request<ReplayGetResponse>(`/replay/by_user?hash=${encodeURIComponent(hash)}&level=${level}`, {
    method: 'GET',
  });
}

// ── Wallet / Seal API functions (V1-012/V1-013) ──

export interface SealWinsResponse {
  star3Wins: number;
}

export async function getSealWins(hash: string): Promise<ApiResponse<SealWinsResponse>> {
  const params = new URLSearchParams({ hash });
  return request<SealWinsResponse>(`/seal/wins?${params.toString()}`);
}

export interface WalletGrantResponse {
  balance: number;
  inventory: Record<string, number>;
  is_replay: boolean;
}

export async function walletGrant(
  hash: string,
  operationId: string,
  gold: number,
  itemId: string,
  itemQty: number,
  reason: string,
): Promise<ApiResponse<WalletGrantResponse>> {
  return request<WalletGrantResponse>('/wallet/grant', {
    method: 'POST',
    body: JSON.stringify({ hash, operation_id: operationId, gold, item_id: itemId, item_qty: itemQty, reason }),
  });
}

export interface WalletSyncResponse {
  balance: number;
  inventory: Record<string, number>;
  star3_wins: number;
}

export async function walletSync(hash: string): Promise<ApiResponse<WalletSyncResponse>> {
  return request<WalletSyncResponse>('/wallet/sync', {
    method: 'POST',
    body: JSON.stringify({ hash, game_id: GAME_ID }),
  });
}

export interface RankRewardItem {
  bizKey: string;
  periodBucket: number;
  userHash: string;
  tier: number;
  rewardGold: number;
  rewardSoul: number;
  claimedAt: number;
}

export interface RankRewardsResponse {
  rewards: RankRewardItem[];
}

export async function getRankRewards(hash: string): Promise<ApiResponse<RankRewardsResponse>> {
  return request<RankRewardsResponse>('/rank/rewards', {
    method: 'POST',
    body: JSON.stringify({ hash }),
  });
}
