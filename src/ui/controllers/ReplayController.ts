/**
 * Replay viewer + Challenge mode controller.
 * V1-015: Fetch and display game replay, with frame-by-frame playback.
 * V1-016: Challenge the same layout (deterministic seed extracted from record).
 */
import { t } from '../../i18n';
import { getReplay, shareReplay } from '../../cloud/api';
import { SaveManager } from '../../core/SaveManager';
import { engineBridge } from '../../wasm/EngineBridge';
import { showToast } from '../utils/domHelpers';

// ── XQBR record parser ──
// Header layout (offset/size): magic(4) version(2) headerSize(2) mode(1) result(1)
// reserved(2) levelId(4) rngSeed(4) configLen(4) actionCount(4) finalScore(4) ...
// Action: type(1) code(1) count(1) flags(1) arg0(4) arg1(4) arg2(4) = 16 bytes

const XQBR_HEADER_SIZE = 192;
const XQBR_ACTION_SIZE = 16;

export interface XqbrAction {
  type: number;  // RecordActionType: 1=PLACE 2=UNDO 3=SKIP 4=CONFIRM 8=USE_ITEM
  code: number;
  count: number;
  arg0: number;
  arg1: number;
  arg2: number;
}

export interface XqbrRecord {
  mode: number;
  levelId: number;
  rngSeed: number;
  configJson: string;
  actions: XqbrAction[];
}

/** Copy text to clipboard with fallback for non-secure contexts (HTTP). */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to legacy API */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** Parse a base64-encoded XQBR record blob. Returns null on malformed data. */
export function parseXqbrRecord(base64Record: string): XqbrRecord | null {
  let binary: string;
  try { binary = atob(base64Record); } catch { return null; }
  const data = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);

  if (data.length < XQBR_HEADER_SIZE + 32) return null;
  if (data[0] !== 0x58 || data[1] !== 0x51 || data[2] !== 0x42 || data[3] !== 0x52) return null;

  const dv = new DataView(data.buffer);
  const headerSize = dv.getUint16(6, true);
  const hdr = headerSize || XQBR_HEADER_SIZE;
  const mode = data[8];
  const levelId = dv.getUint32(12, true);
  const rngSeed = dv.getUint32(16, true);
  const configLen = dv.getUint32(20, true);
  const actionCount = dv.getUint32(24, true);

  let configJson = '';
  if (configLen > 0 && hdr + configLen <= data.length) {
    configJson = new TextDecoder().decode(data.slice(hdr, hdr + configLen));
  }

  const actionOffset = hdr + configLen;
  const actions: XqbrAction[] = [];
  for (let i = 0; i < actionCount; i++) {
    const off = actionOffset + i * XQBR_ACTION_SIZE;
    if (off + XQBR_ACTION_SIZE > data.length) break;
    actions.push({
      type: data[off],
      code: data[off + 1],
      count: data[off + 2],
      arg0: dv.getInt32(off + 4, true),
      arg1: dv.getInt32(off + 8, true),
      arg2: dv.getInt32(off + 12, true),
    });
  }

  return { mode, levelId, rngSeed, configJson, actions };
}

export interface ShareResult {
  code: string;
  level: number;
  score: number;
  stars: number;
  nickname: string;
  record: string; // base64-encoded XQBR record
}

export class ReplayController {
  /** 保存最后一次渲染的数据，用于 reshow() 重新显示分享面板 */
  private lastRenderData: {
    data: { code: string; level: number; score: number; stars: number; nickname: string; record: string };
    onChallenge?: (level: number, targetScore: number, record: XqbrRecord | null) => void;
    onWatchReplay?: (record: XqbrRecord) => void;
  } | null = null;

  /** Share current game record to backend, return full share data (no extra fetch needed). */
  static async shareCurrent(level: number, score: number, stars: number): Promise<ShareResult | null> {
    const hash = SaveManager.getHash();
    const nickname = SaveManager.getNickname() || 'Player';
    if (!hash) { showToast(t('replay.shareFail'), 2); return null; }

    let record: string;
    try {
      const recordData = engineBridge.exportRecord();
      record = btoa(String.fromCharCode(...recordData));
    } catch {
      showToast(t('replay.shareFail'), 2);
      return null;
    }

    const resp = await shareReplay(hash, record, level, score, stars, nickname);
    if (resp.code !== 0 || !resp.data?.code) {
      showToast(t('replay.shareFail'), 2);
      return null;
    }
    showToast(t('replay.shareSuccess', { code: resp.data.code }), 3);
    return { code: resp.data.code, level, score, stars, nickname, record };
  }

  /** Show loading overlay (used while uploading or fetching). */
  private showLoading(): HTMLElement {
    const existing = document.getElementById('replay-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay replay-overlay';
    overlay.id = 'replay-overlay';
    overlay.innerHTML = `<div class="replay-card"><div class="replay-loading">${t('replay.loading')}</div></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  /** Render the share panel with given data (no backend fetch). */
  private renderPanel(
    overlay: HTMLElement,
    data: { code: string; level: number; score: number; stars: number; nickname: string; record: string },
    onChallenge?: (level: number, targetScore: number, record: XqbrRecord | null) => void,
    onWatchReplay?: (record: XqbrRecord) => void,
  ): void {
    // 保存数据，用于 reshow() 重新显示分享面板
    this.lastRenderData = { data, onChallenge, onWatchReplay };
    const shareUrl = `${window.location.origin}${import.meta.env.BASE_URL}?replay=${data.code}`;
    const starsHtml = '★'.repeat(data.stars) + '☆'.repeat(Math.max(0, 5 - data.stars));
    const record = parseXqbrRecord(data.record);
    const canWatch = !!onWatchReplay && !!record;

    overlay.querySelector('.replay-card')!.innerHTML = `
      <div class="replay-title">${t('replay.title')}</div>
      <div class="replay-info">
        <div class="replay-info-row"><span>${t('replay.player')}</span><span>${data.nickname}</span></div>
        <div class="replay-info-row"><span>${t('replay.level')}</span><span>${data.level}</span></div>
        <div class="replay-info-row"><span>${t('replay.score')}</span><span class="replay-score-val">${data.score}</span></div>
        <div class="replay-info-row"><span>${t('replay.stars')}</span><span class="replay-stars">${starsHtml}</span></div>
      </div>
      <div class="replay-share-area">
        <div class="replay-share-link" id="replay-link-text">${shareUrl}</div>
        <button class="replay-copy-btn" id="replay-copy">${t('replay.copy')}</button>
      </div>
      ${canWatch ? `<button class="replay-watch-btn" id="replay-watch">${t('replay.watchBtn')}</button>` : ''}
      ${onChallenge ? `<button class="replay-challenge-btn" id="replay-challenge">${t('replay.challenge')}</button>` : ''}
      <button class="replay-close-btn" id="replay-close">${t('replay.close')}</button>`;

    this.bindClose(overlay);
    overlay.querySelector('#replay-copy')!.addEventListener('click', async () => {
      const ok = await copyToClipboard(shareUrl);
      showToast(ok ? t('replay.copied') : t('replay.copyFail'), 1.5);
    });
    // 点击链接文字自动全选，便于手动复制
    overlay.querySelector('#replay-link-text')!.addEventListener('click', (e) => {
      const range = document.createRange();
      range.selectNodeContents(e.currentTarget as HTMLElement);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    });
    if (canWatch) {
      overlay.querySelector('#replay-watch')!.addEventListener('click', () => {
        overlay.remove();
        onWatchReplay!(record!);
      });
    }
    if (onChallenge) {
      overlay.querySelector('#replay-challenge')!.addEventListener('click', () => {
        overlay.remove();
        onChallenge(data.level, data.score, record);
      });
    }
  }

  /** Show share panel for the current game: shows loading first, uploads, then renders with local data.
   *  Avoids the redundant GET /api/replay/{code} call after upload. */
  async showLocalShare(
    level: number,
    score: number,
    stars: number,
    onChallenge?: (level: number, targetScore: number, record: XqbrRecord | null) => void,
    onWatchReplay?: (record: XqbrRecord) => void,
  ): Promise<void> {
    // 先显示 loading 面板，给用户即时反馈
    const overlay = this.showLoading();
    // 上传战斗记录
    const result = await ReplayController.shareCurrent(level, score, stars);
    if (!result) {
      overlay.remove();
      return;
    }
    // 直接用本地数据渲染面板（不再请求 getReplay）
    this.renderPanel(overlay, result, onChallenge, onWatchReplay);
  }

  /** Show replay viewer overlay by fetching replay code from backend.
   *  Used when opening a share link or challenging from leaderboard (code only, no local data). */
  async showViewer(
    code: string,
    onChallenge?: (level: number, targetScore: number, record: XqbrRecord | null) => void,
    onWatchReplay?: (record: XqbrRecord) => void,
  ): Promise<void> {
    const overlay = this.showLoading();

    const resp = await getReplay(code);
    if (resp.code !== 0 || !resp.data) {
      overlay.querySelector('.replay-card')!.innerHTML = `
        <div class="replay-title">${t('replay.title')}</div>
        <div class="replay-error">${t('replay.notFound')}</div>
        <button class="replay-close-btn" id="replay-close">${t('replay.close')}</button>`;
      this.bindClose(overlay);
      return;
    }

    this.renderPanel(overlay, resp.data, onChallenge, onWatchReplay);
  }

  private bindClose(overlay: HTMLElement): void {
    overlay.querySelector('#replay-close')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  /** 重新显示最后一次渲染的分享面板（关闭回放后回到分享面板）。
   *  onClose: 用户关闭分享面板时的回调（通常回到主菜单）。
   *  返回 true 表示成功重新显示，false 表示没有保存的数据。 */
  reshow(onClose?: () => void): boolean {
    if (!this.lastRenderData) return false;
    const existing = document.getElementById('replay-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay replay-overlay';
    overlay.id = 'replay-overlay';
    // renderPanel 需要 overlay 内已有 .replay-card 子元素
    overlay.innerHTML = '<div class="replay-card"></div>';
    document.body.appendChild(overlay);
    const { data, onChallenge, onWatchReplay } = this.lastRenderData;
    this.renderPanel(overlay, data, onChallenge, onWatchReplay);
    // 覆盖 bindClose 的关闭行为：关闭面板后执行 onClose 回调
    const closeBtn = overlay.querySelector('#replay-close');
    if (closeBtn) {
      closeBtn.replaceWith(closeBtn.cloneNode(true));
      overlay.querySelector('#replay-close')!.addEventListener('click', () => { overlay.remove(); onClose?.(); });
    }
    return true;
  }

  /** Show challenge intro overlay before starting a challenge game. */
  showChallengeIntro(level: number, targetScore: number, onStart: () => void, onCancel: () => void): void {
    const existing = document.getElementById('challenge-intro-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay challenge-intro-overlay';
    overlay.id = 'challenge-intro-overlay';
    overlay.innerHTML = `
      <div class="challenge-card">
        <div class="challenge-title">${t('challenge.title')}</div>
        <div class="challenge-subtitle">${t('challenge.subtitle', { score: String(targetScore) })}</div>
        <div class="challenge-target">
          <span>${t('replay.level')}: ${level}</span>
          <span>${t('challenge.targetScore')}: ${targetScore}</span>
        </div>
        <button class="challenge-start-btn" id="challenge-start">${t('challenge.start')}</button>
        <button class="challenge-cancel-btn" id="challenge-cancel">${t('challenge.cancel')}</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#challenge-start')!.addEventListener('click', () => {
      overlay.remove();
      onStart();
    });
    overlay.querySelector('#challenge-cancel')!.addEventListener('click', () => {
      overlay.remove();
      onCancel();
    });
  }

  /** Show challenge result overlay after game ends. */
  showChallengeResult(yourScore: number, targetScore: number, onDone: () => void): void {
    const existing = document.getElementById('challenge-result-overlay');
    if (existing) existing.remove();

    const won = yourScore >= targetScore;
    const diff = yourScore - targetScore;

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay challenge-result-overlay';
    overlay.id = 'challenge-result-overlay';
    overlay.innerHTML = `
      <div class="challenge-card">
        <div class="challenge-title">${t('challenge.result')}</div>
        <div class="challenge-result-banner ${won ? 'win' : 'lose'}">
          ${won ? t('challenge.win') : t('challenge.lose')}
        </div>
        <div class="challenge-scores">
          <div class="challenge-score-row">
            <span>${t('challenge.yourScore')}</span>
            <span class="${won ? 'win' : 'lose'}">${yourScore}</span>
          </div>
          <div class="challenge-score-row">
            <span>${t('challenge.targetScore')}</span>
            <span>${targetScore}</span>
          </div>
        </div>
        ${!won ? `<div class="challenge-diff">${t('challenge.diff', { diff: String(Math.abs(diff)) })}</div>` : ''}
        <button class="challenge-done-btn" id="challenge-done">${t('replay.close')}</button>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#challenge-done')!.addEventListener('click', () => {
      overlay.remove();
      onDone();
    });
  }
}
