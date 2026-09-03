/**
 * 印章分享卡片 — canvas 绘制战印 + 邀请二维码。
 * 复用 src/cloud/api.ts 的 getInviteCode 获取邀请链接。
 *
 * 视觉：棋盘背景图（icons/seal/seal_bg.jpg）+ 朱砂印池 + 游戏 logo + 6 档差异化。
 * 字体随语言切换，英文模式零中文残留。
 */

import QRCode from 'qrcode';
import { t, getLang } from '../i18n';
import { SEAL_TIERS } from '../ui/sealDefs';
import { engineBridge } from '../wasm/EngineBridge';
import { getInviteCode } from '../cloud/api';
import { SaveManager } from '../core/SaveManager';

const CARD_W = 400;
const CARD_H = 680;
const PADDING = 12;

// ── 调色板：棋盘木色 + 主题点缀读取 CSS 变量 ──────────────────────
interface Palette {
  woodLight: string;   // QR 纸条
  boardInk: string;    // 正文墨色
  border: string;      // 边框
  gold: string;
  goldBright: string;
  vermilion: string;
  vermilionDark: string;
  textSoft: string;
  textMuted: string;
}

function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb;
  return {
    woodLight: '#e0cfa0',
    boardInk: '#3a2a1a',
    border: '#5d4037',
    gold: v('--lc-gold', '#c9a050'),
    goldBright: v('--lc-gold-bright', '#ddbd72'),
    vermilion: v('--lc-vermilion', '#b83a2a'),
    vermilionDark: v('--lc-vermilion-dark', '#7f291f'),
    textSoft: '#5d4037',
    textMuted: '#6a5a3a',
  };
}

/** 字体栈随语言切换：中文衬线 / 英文衬线，保证英文模式不出现中文字形 */
function fontStack(): string {
  return getLang() === 'zh'
    ? '"Noto Serif SC","Songti SC","Microsoft YaHei",serif'
    : '"Georgia","Noto Serif SC",serif';
}

// ── canvas 路径工具 ──────────────────────────────────────────────
function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img load fail: ' + src));
    img.src = src;
  });
}

// ── 背景图 ───────────────────────────────────────────────────────

/** 以 cover 方式绘制图片（等比缩放填满，居中裁剪） */
function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const ir = img.width / img.height;
  const cr = w / h;
  let dw: number, dh: number, dx: number, dy: number;
  if (ir > cr) {
    dh = h; dw = h * ir; dx = x - (dw - w) / 2; dy = y;
  } else {
    dw = w; dh = w / ir; dx = x; dy = y - (dh - h) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

/** 墨线 + 中央朱砂菱形分隔符 */
function drawSeparator(ctx: CanvasRenderingContext2D, cx: number, y: number, halfW: number, _p: Palette): void {
  ctx.strokeStyle = 'rgba(106,90,58,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, y);
  ctx.lineTo(cx - 8, y);
  ctx.moveTo(cx + 8, y);
  ctx.lineTo(cx + halfW, y);
  ctx.stroke();
  ctx.fillStyle = '#b83a2a';
  ctx.beginPath();
  ctx.moveTo(cx, y - 3.5);
  ctx.lineTo(cx + 3.5, y);
  ctx.lineTo(cx, y + 3.5);
  ctx.lineTo(cx - 3.5, y);
  ctx.closePath();
  ctx.fill();
}

/** 绘制印章 share 卡片，返回 canvas。若邀请码获取失败则 QR 区域显示提示文字 */
export async function drawSealShareCard(tierIndex: number): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const p = readPalette();
  const ff = fontStack();
  const isZh = getLang() === 'zh';
  const tierDef = SEAL_TIERS[tierIndex] ?? SEAL_TIERS[0];
  const sealName = t('seal.tier.' + tierDef.id + '.name');
  const sealDesc = t('seal.tier.' + tierDef.id + '.desc');

  // 取 C++ 与 localStorage 独立键的最大值
  let wins = engineBridge.getPlatformWins();
  try {
    const raw = localStorage.getItem('loong_seal_wins');
    if (raw) {
      const buf = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
      const sealWins = new DataView(buf.buffer).getUint32(0, true);
      if (sealWins > wins) wins = sealWins;
    }
  } catch { /* ignore */ }

  // ── 棋盘背景图（半透明：先铺木色底，再以 0.3 透明度叠加，让内容更突出） ──
  ctx.fillStyle = '#b8956a';
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  try {
    const bg = await loadImage('icons/seal/seal_bg.jpg');
    ctx.globalAlpha = 0.3;
    drawImageCover(ctx, bg, 0, 0, CARD_W, CARD_H);
    ctx.globalAlpha = 1;
  } catch { /* 图片加载失败则保留纯木色底 */ }

  // ── 顶部品牌：logo（左上角 1.5 倍）+ 游戏名（紧邻右侧，垂直居中） ──
  try {
    const logo = await loadImage('logos/logo.jpg');
    const logoSize = 66; // 44 * 1.5
    ctx.drawImage(logo, 16, 16, logoSize, logoSize);
  } catch { /* logo 加载失败则忽略 */ }

  ctx.fillStyle = p.boardInk;
  ctx.font = `bold 24px ${ff}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('game.name'), 94, 49); // 94 = 16+66+12；49 = 16+66/2
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  // ── 印章中心（落在棋盘背景上） ──
  const poolCx = CARD_W / 2;
  const poolCy = 220;

  // 印章图案
  const sealSize = 116;
  try {
    const sealImg = await loadImage(`icons/seal/seal_${tierDef.id}.png`);
    ctx.save();
    ctx.translate(poolCx, poolCy);
    ctx.rotate(-0.06);
    ctx.drawImage(sealImg, -sealSize / 2, -sealSize / 2, sealSize, sealSize);
    ctx.restore();
  } catch {
    ctx.save();
    ctx.translate(poolCx, poolCy);
    ctx.rotate(-0.08);
    ctx.fillStyle = p.vermilionDark;
    ctx.font = `bold 22px ${ff}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(sealName, 0, 0);
    ctx.restore();
  }

  // ── 印级名：描边 + 朱砂发光，突出 ──
  ctx.font = `bold 26px ${ff}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(184,58,42,0.6)';
  ctx.shadowBlur = 14;
  drawSpacedText(ctx, sealName, CARD_W / 2, 302, isZh ? 6 : 2, {
    fill: '#b83a2a', stroke: '#f0e0c0', strokeWidth: 3,
  });
  ctx.shadowBlur = 0;

  // ── 印级典故 ──
  ctx.fillStyle = p.boardInk;
  ctx.font = `15px ${ff}`;
  ctx.fillText(sealDesc, CARD_W / 2, 326);

  // ── 分隔符 ──
  drawSeparator(ctx, CARD_W / 2, 354, 120, p);

  // ── 胜场 + 邀请语 ──
  ctx.fillStyle = p.boardInk;
  ctx.font = `bold 20px ${ff}`;
  ctx.fillText(t('seal.share.subtitle', { n: String(wins) }), CARD_W / 2, 384);

  // ── QR 码（浅木色纸条上的深墨码，扫描可靠） ──
  const qrSize = 140;
  const qrX = (CARD_W - qrSize) / 2;
  const qrY = 440;
  const platePad = 5;
  ctx.fillStyle = p.woodLight;
  roundRectPath(ctx, qrX - platePad, qrY - platePad, qrSize + platePad * 2, qrSize + platePad * 2, 6);
  ctx.fill();
  ctx.strokeStyle = p.border;
  ctx.lineWidth = 0.8;
  roundRectPath(ctx, qrX - platePad, qrY - platePad, qrSize + platePad * 2, qrSize + platePad * 2, 6);
  ctx.stroke();

  try {
    const hash = SaveManager.getHash();
    if (hash) {
      const res = await getInviteCode(hash);
      if (res.code === 0 && res.data) {
        const url = `${window.location.origin}/?xq=${res.data.code}`;
        const qrDataUrl = await QRCode.toDataURL(url, {
          width: qrSize,
          margin: 1,
          color: { dark: '#1a1410', light: '#e0cfa0' },
        });
        const img = await loadImage(qrDataUrl);
        ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
      } else {
        drawQRFallback(ctx, qrX, qrY, qrSize);
      }
    } else {
      drawQRFallback(ctx, qrX, qrY, qrSize);
    }
  } catch {
    drawQRFallback(ctx, qrX, qrY, qrSize);
  }

  // ── 扫码提示 ──
  ctx.fillStyle = p.textSoft;
  ctx.font = `13px ${ff}`;
  ctx.textAlign = 'center';
  ctx.fillText(t('seal.share.qrHint'), CARD_W / 2, 605);

  // ── 底部游戏名 + 日期 ──
  const date = new Date();
  const dateStr = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  ctx.fillStyle = p.textSoft;
  ctx.font = `12px ${ff}`;
  ctx.fillText(`${t('game.name')}  ·  ${dateStr}`, CARD_W / 2, 650);

  return canvas;
}

/** 手动字间距文本（canvas 无原生 letter-spacing）；opts 可加描边 */
function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  baselineY: number,
  spacing: number,
  opts?: { fill?: string; stroke?: string; strokeWidth?: number },
): void {
  let total = 0;
  const widths: number[] = [];
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w;
  }
  total += spacing * (text.length - 1);
  let x = centerX - total / 2;
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  for (let i = 0; i < text.length; i++) {
    if (opts?.stroke && opts.strokeWidth) {
      ctx.lineWidth = opts.strokeWidth;
      ctx.strokeStyle = opts.stroke;
      ctx.strokeText(text[i], x, baselineY);
    }
    if (opts?.fill) ctx.fillStyle = opts.fill;
    ctx.fillText(text[i], x, baselineY);
    x += widths[i] + spacing;
  }
  ctx.textAlign = 'center';
}

function drawQRFallback(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const p = readPalette();
  ctx.fillStyle = p.textMuted;
  ctx.font = `12px ${fontStack()}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(t('seal.share.qrFallback'), x + size / 2, y + size / 2);
  ctx.textBaseline = 'alphabetic';
}

/** 触发保存图片（桌面端 download / 移动端长按保存） */
export function saveSealShareImage(canvas: HTMLCanvasElement): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seal-share.png';
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/**
 * 打开印章分享卡片 overlay
 * @param tierIndex 印级 (0-5)
 */
export async function showSealShare(tierIndex: number): Promise<void> {
  const existing = document.getElementById('seal-share-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ui-panel overlay seal-share-overlay';
  overlay.id = 'seal-share-overlay';
  overlay.innerHTML = `
    <div class="seal-share-card lc-card lc-modal">
      <h3 class="seal-share-title">${t('seal.share.title')}</h3>
      <div class="seal-share-canvas-wrap" id="seal-share-canvas-wrap">
        <div class="seal-share-skeleton"></div>
      </div>
      <div class="seal-share-btns">
        <button class="cs-btn seal-share-save-btn" id="seal-share-save">${t('seal.share.saveImg')}</button>
        <button class="cs-btn seal-share-close-btn" id="seal-share-close">${t('publish.done')}</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#seal-share-close')!.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // 异步绘制卡片
  const canvas = await drawSealShareCard(tierIndex);
  if (canvas) {
    const wrap = document.getElementById('seal-share-canvas-wrap')!;
    wrap.innerHTML = '';
    canvas.style.width = '100%';
    canvas.style.maxWidth = '400px';
    canvas.style.borderRadius = '8px';
    wrap.appendChild(canvas);
    overlay.querySelector('#seal-share-save')!.addEventListener('click', () => saveSealShareImage(canvas));
  }
}
