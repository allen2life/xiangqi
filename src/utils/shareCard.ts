import QRCode from 'qrcode';
import { t, getLang } from '../i18n';

export interface BattleCardOptions {
  level: number;
  score: number;
  stars: number;
  nickname: string;
  replayCode: string;
  shareUrl: string;
}

export async function showBattleShareCard(options: BattleCardOptions): Promise<void> {
  const existing = document.getElementById('battle-share-card-modal');
  if (existing) existing.remove();

  const loadingToast = document.createElement('div');
  loadingToast.className = 'ui-toast';
  loadingToast.textContent = t('replay.loading') || '正在生成战报...';
  document.body.appendChild(loadingToast);

  try {
    const dataUrl = await renderBattleCardCanvas(options);
    loadingToast.remove();

    const overlay = document.createElement('div');
    overlay.id = 'battle-share-card-modal';
    overlay.className = 'ui-panel overlay battle-card-overlay';
    overlay.innerHTML = `
      <div class="battle-card-wrapper" style="max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1000;">
        <div style="background: rgba(26, 31, 44, 0.95); border: 1px solid rgba(212, 175, 55, 0.35); border-radius: 16px; padding: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); display: flex; flex-direction: column; align-items: center; max-width: 380px;">
          <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; margin-bottom: 10px;">
            <span style="color: #ffd700; font-weight: bold; font-size: 16px; font-family: 'STKaiti', serif;">📜 ${t('share.cardTitle') || '凯旋战报'}</span>
            <button id="battle-card-close" style="background: none; border: none; color: #fff; font-size: 20px; cursor: pointer; padding: 4px 8px;">✕</button>
          </div>
          <img src="${dataUrl}" alt="Battle Report" style="width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(212, 175, 55, 0.2); display: block;" />
          <div style="margin-top: 12px; color: rgba(255,255,255,0.7); font-size: 12px; text-align: center;">
            ${t('share.cardHint') || '长按或右键保存图片，发给好友一决高下！'}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const closeBtn = overlay.querySelector('#battle-card-close');
    const close = () => overlay.remove();
    closeBtn?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  } catch (err) {
    loadingToast.remove();
    console.error('Failed to generate battle card', err);
  }
}

async function renderBattleCardCanvas(options: BattleCardOptions): Promise<string> {
  const width = 750;
  const height = 1200;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. 背景渐变（古典朱雀墨玉漆器）
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, '#1a1f2e');
  bgGrad.addColorStop(0.5, '#121622');
  bgGrad.addColorStop(1, '#0b0e17');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. 装饰边框（双金线 + 祥云回纹四角）
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, width - 60, height - 60);

  ctx.strokeStyle = 'rgba(212, 175, 55, 0.2)';
  ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, width - 80, height - 80);

  // 3. 顶部游戏 Logo / 标题
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = 'bold 44px "STKaiti", "KaiTi", "Noto Serif SC", serif';
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = 'rgba(255, 215, 0, 0.5)';
  ctx.shadowBlur = 12;
  ctx.fillText('象 棋 风 暴', width / 2, 110);

  ctx.font = '20px sans-serif';
  ctx.fillStyle = 'rgba(212, 175, 55, 0.7)';
  ctx.shadowBlur = 0;
  ctx.fillText('XIANGQI BLAST · BATTLE REPORT', width / 2, 150);

  // 4. 分割饰线
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.3)';
  ctx.beginPath();
  ctx.moveTo(120, 180);
  ctx.lineTo(width - 120, 180);
  ctx.stroke();

  // 5. 玩家身份与战报头衔
  ctx.font = 'bold 32px "STKaiti", "Noto Serif SC", serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(options.nickname, width / 2, 230);

  ctx.font = '22px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fillText(`破阵大捷 · 第 ${options.level} 关`, width / 2, 275);

  // 6. 星级展示
  ctx.font = '54px sans-serif';
  const starStr = '★'.repeat(Math.min(5, Math.max(0, options.stars))) + '☆'.repeat(Math.max(0, 5 - options.stars));
  ctx.fillStyle = '#ffd700';
  ctx.shadowColor = 'rgba(255, 215, 0, 0.6)';
  ctx.shadowBlur = 16;
  ctx.fillText(starStr, width / 2, 360);
  ctx.shadowBlur = 0;

  // 7. 得分大字中央徽章
  const badgeY = 530;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.beginPath();
  ctx.arc(width / 2, badgeY, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(212, 175, 55, 0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.font = '24px "STKaiti", serif';
  ctx.fillStyle = 'rgba(212, 175, 55, 0.8)';
  ctx.fillText('本 局 得 分', width / 2, badgeY - 50);

  ctx.font = 'bold 64px "STKaiti", sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255, 215, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.fillText(String(options.score), width / 2, badgeY + 15);
  ctx.shadowBlur = 0;

  // 8. 战局战果印章（朱砂印章红）
  ctx.save();
  ctx.translate(width / 2 + 180, badgeY - 90);
  ctx.rotate((12 * Math.PI) / 180);
  ctx.strokeStyle = 'rgba(184, 58, 42, 0.85)';
  ctx.lineWidth = 4;
  ctx.strokeRect(-45, -45, 90, 90);
  ctx.font = 'bold 28px "STKaiti", "KaiTi", serif';
  ctx.fillStyle = 'rgba(184, 58, 42, 0.9)';
  ctx.fillText('大', -20, -16);
  ctx.fillText('捷', 20, -16);
  ctx.fillText('无', -20, 20);
  ctx.fillText('双', 20, 20);
  ctx.restore();

  // 9. 下方二维码区
  const qrBoxY = 770;
  const qrSize = 220;
  const qrCanvas = document.createElement('canvas');
  await QRCode.toCanvas(qrCanvas, options.shareUrl, {
    width: qrSize,
    margin: 1,
    color: {
      dark: '#1a1f2e',
      light: '#ffffff',
    },
  });

  // 绘制二维码白底圆角卡片
  const qrX = (width - qrSize) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(qrX - 10, qrBoxY - 10, qrSize + 20, qrSize + 20, 12);
  ctx.fill();
  ctx.drawImage(qrCanvas, qrX, qrBoxY, qrSize, qrSize);

  // 10. 底部提示语与口令
  ctx.font = '22px "STKaiti", sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText('扫码或访问链接挑战该战局', width / 2, 1060);

  if (options.replayCode) {
    ctx.font = '18px monospace';
    ctx.fillStyle = 'rgba(212, 175, 55, 0.8)';
    ctx.fillText(`挑战口令: ${options.replayCode}`, width / 2, 1100);
  }

  ctx.font = '16px sans-serif';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.fillText('suanxin.xyz/xiangqiblast', width / 2, 1135);

  ctx.restore();

  return canvas.toDataURL('image/png');
}
