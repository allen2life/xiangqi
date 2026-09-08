/**
 * Settings modal controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t, getLang, setLang } from '../../i18n';
import { AudioManager } from '../../audio/AudioManager';
import { showConfirmDialog } from '../utils/domHelpers';
import { getResolution, setResolution, RES_OPTIONS } from '../../utils/renderLoop';
import { getBattleSpeed, setBattleSpeed, type BattleSpeed } from '../../utils/battleSpeed';
import type { DomUIContext } from '../DomUIContext';

const VOL_TABS = [t('settings.volOff'), t('settings.volLow'), t('settings.volMid'), t('settings.volHigh')];
const VOL_VALUES = [0, 0.2, 0.5, 0.8];

export class SettingsController {
  constructor(private ctx: DomUIContext) {}

  showSettingsModal(): void {
    const existing = document.getElementById('settings-modal');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay settings-overlay';
    overlay.id = 'settings-modal';
    overlay.innerHTML = this.buildSettingsHTML();
    document.body.appendChild(overlay);

    const audio = AudioManager.getInstance();
    this.wireSettingsEvents(overlay, audio);
  }

  private buildSettingsHTML(): string {
    const audio = AudioManager.getInstance();
    const bgmV = audio.getBgmVolume();
    const sfxV = audio.getSfxVolume();
    const bgmIdx = this.volToIdx(bgmV);
    const sfxIdx = this.volToIdx(sfxV);
    const curRes = getResolution();
    const resIdx = RES_OPTIONS.indexOf(curRes);
    const curSpeed = getBattleSpeed();
    // 回放模式下隐藏"重新开始"和"排行榜"按钮
    const isReplay = !!document.getElementById('replay-controls');

    const tabBtn = (label: string, idx: number, active: boolean) =>
      `<button class="vol-tab${active ? ' active' : ''}" data-idx="${idx}">${label}</button>`;

    return `
      <div class="settings-card">
        <div class="settings-header">
          <span class="settings-title">${t('settings.title')}</span>
          <button class="settings-close" id="settings-close">✕</button>
        </div>

        <div class="settings-section">
          <div class="vol-row">
            <span class="vol-label">${bgmV === 0 ? '🔇' : '🔊'} BGM</span>
            <div class="vol-tabs" id="bgm-tabs">
              ${VOL_TABS.map((l, i) => tabBtn(l, i, i === bgmIdx)).join('')}
            </div>
          </div>
          <div class="vol-row">
            <span class="vol-label">${sfxV === 0 ? '🔇' : '🔊'} SFX</span>
            <div class="vol-tabs" id="sfx-tabs">
              ${VOL_TABS.map((l, i) => tabBtn(l, i, i === sfxIdx)).join('')}
            </div>
          </div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-section">
          <div class="vol-row">
            <span class="vol-label">🌐 ${t('settings.lang')}</span>
            <div class="vol-tabs" id="lang-tabs">
              <button class="vol-tab${getLang() === 'en' ? ' active' : ''}" data-lang="en">${t('settings.langEn')}</button>
              <button class="vol-tab${getLang() === 'zh' ? ' active' : ''}" data-lang="zh">${t('settings.langZh')}</button>
            </div>
          </div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-section">
          <div class="vol-row">
            <span class="vol-label">🎨 ${t('settings.quality')}</span>
            <div class="vol-tabs" id="quality-tabs">
              <button class="vol-tab${resIdx === 0 ? ' active' : ''}" data-res="2">${t('settings.qualityHigh')}</button>
              <button class="vol-tab${resIdx === 1 ? ' active' : ''}" data-res="1.5">${t('settings.qualityMid')}</button>
              <button class="vol-tab${resIdx === 2 ? ' active' : ''}" data-res="1">${t('settings.qualityLow')}</button>
            </div>
          </div>
        </div>

        <div class="settings-divider"></div>

        <div class="settings-section">
          <div class="vol-row">
            <span class="vol-label">⚡ ${t('settings.speed')}</span>
            <div class="vol-tabs" id="speed-tabs">
              <button class="vol-tab${curSpeed === 1 ? ' active' : ''}" data-speed="1">${t('settings.speed1x')}</button>
              <button class="vol-tab${curSpeed === 1.5 ? ' active' : ''}" data-speed="1.5">${t('settings.speed15x')}</button>
              <button class="vol-tab${curSpeed === 2 ? ' active' : ''}" data-speed="2">${t('settings.speed2x')}</button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          ${isReplay ? '' : `<button class="settings-btn" id="settings-restart">🔄 ${t('settings.restart')}</button>`}
          ${isReplay ? '' : `<button class="settings-btn rank" id="settings-rank">🏆 ${t('settings.btnRank')}</button>`}
          <button class="settings-btn home" id="settings-home">🏠 ${t('settings.home')}</button>
        </div>
      </div>
    `;
  }

  private wireSettingsEvents(overlay: HTMLElement, audio: AudioManager): void {
    const closeModal = () => overlay.remove();

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    overlay.querySelector('#settings-close')!.addEventListener('click', closeModal);

    const updateVolLabel = (tabsId: string, vol: number) => {
      const row = overlay.querySelector(`#${tabsId}`)?.closest('.vol-row');
      if (!row) return;
      const label = row.querySelector('.vol-label') as HTMLElement;
      if (!label) return;
      const name = label.textContent?.replace(/[🔇🔊]/g, '').trim() || '';
      label.textContent = `${vol === 0 ? '🔇' : '🔊'} ${name}`;
    };

    overlay.querySelector('#bgm-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.vol-tab') as HTMLElement;
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx || '0');
      audio.setBgmVolume(VOL_VALUES[idx]);
      this.updateTabs(overlay, 'bgm-tabs', idx);
      updateVolLabel('bgm-tabs', VOL_VALUES[idx]);
    });

    overlay.querySelector('#sfx-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.vol-tab') as HTMLElement;
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx || '0');
      audio.setSfxVolume(VOL_VALUES[idx]);
      this.updateTabs(overlay, 'sfx-tabs', idx);
      updateVolLabel('sfx-tabs', VOL_VALUES[idx]);
    });

    overlay.querySelector('#settings-restart')?.addEventListener('click', () => {
      showConfirmDialog(t('settings.confirmRestart'), () => {
        closeModal();
        this.ctx.host.onRestart?.();
      });
    });

    overlay.querySelector('#settings-rank')?.addEventListener('click', () => {
      closeModal();
      this.ctx.host.onLeaderboardCurrentLevel?.();
    });

    overlay.querySelector('#settings-home')!.addEventListener('click', () => {
      showConfirmDialog(t('settings.confirmHome'), () => {
        closeModal();
        this.ctx.host.onMenu?.();
      });
    });

    overlay.querySelector('#lang-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-lang]') as HTMLElement;
      if (!btn) return;
      const lang = btn.dataset.lang as 'zh' | 'en';
      if (lang === getLang()) return;
      closeModal();
      setLang(lang);
      window.location.reload();
    });

    overlay.querySelector('#quality-tabs')!.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-res]') as HTMLElement;
      if (!btn) return;
      const res = parseFloat(btn.dataset.res || '2');
      setResolution(res);
      this.updateTabs(overlay, 'quality-tabs', RES_OPTIONS.indexOf(res));
    });

    overlay.querySelector('#speed-tabs')?.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('[data-speed]') as HTMLElement;
      if (!btn) return;
      const speed = parseFloat(btn.dataset.speed || '1') as BattleSpeed;
      setBattleSpeed(speed);
      overlay.querySelectorAll('#speed-tabs .vol-tab').forEach((el) => {
        el.classList.toggle('active', (el as HTMLElement).dataset.speed === String(speed));
      });
    });
  }

  private volToIdx(v: number): number {
    if (v === 0) return 0;
    if (v <= 0.2) return 1;
    if (v <= 0.5) return 2;
    return 3;
  }

  private updateTabs(overlay: HTMLElement, id: string, activeIdx: number): void {
    const container = overlay.querySelector(`#${id}`)!;
    container.querySelectorAll('.vol-tab').forEach((btn, i) => {
      btn.classList.toggle('active', i === activeIdx);
    });
  }
}
