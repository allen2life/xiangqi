import { SaveManager } from '../core/SaveManager';
import {
  uploadData,
  downloadData,
} from './api';
import type { DownloadData } from './api';
import { showShareInvite } from './share';
import { engineBridge } from '../wasm/EngineBridge';
import { t, localizedErrorMessage, serverErrorMessage } from '../i18n';

export class CloudSyncUI {
  private el: HTMLElement | null = null;
  private onClose: (() => void) | null = null;

  constructor(onClose?: () => void) {
    this.onClose = onClose ?? null;
  }

  show(): void {
    if (this.el) return;
    this.el = document.createElement('div');
    this.el.className = 'ui-panel overlay cloud-sync-overlay';
    this.render();
    document.body.appendChild(this.el);
  }

  destroy(): void {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    this.onClose?.();
  }

  private render(): void {
    if (!this.el) return;
    const hasHash = SaveManager.hasHash();
    this.el.innerHTML = `
      <div class="cloud-sync-card lc-card lc-modal">
        <h2 class="cloud-sync-title lc-title">${t('cs.title')}</h2>
        <div class="cs-identity-block">
          <div class="cs-block-label">${t('cs.identityLabel')}</div>
          ${hasHash ? this.renderIdentitySection() : this.renderSetupSection()}
        </div>
        <div class="cs-ops-block">
          <div class="cs-block-label">${t('cs.opsLabel')}</div>
          ${this.renderOperationButtons()}
        </div>
        <button class="cs-close-btn" id="btn-cs-close" title="${t('confirm.cancel')}">&times;</button>
      </div>
    `;

    // Wire close
    this.el.querySelector('#btn-cs-close')!.addEventListener('click', () => this.destroy());

    // Wire upload/download/invite (shared)
    this.el.querySelector('#btn-cs-upload')?.addEventListener('click', () => {
      this.showConfirm([t('cs.uploadWarning')], () => this.handleUpload());
    });
    this.el.querySelector('#btn-cs-download')?.addEventListener('click', () => {
      this.showConfirm([t('cs.downloadWarning')], () => this.handleDownload());
    });
    this.el.querySelector('#btn-cs-invite')?.addEventListener('click', () => this.handleShowShare());

    if (hasHash) {
      this.wireIdentitySection();
    } else {
      this.wireBindForms('setup');
    }
  }

  private renderIdentitySection(): string {
    const nickname = SaveManager.getNickname();
    return `
      <div class="cs-section">
        <div class="cs-identity-display">
          <div class="kouling-mask-row">
            <span class="kouling-mask">***</span><span class="kouling-dot">.</span>
            <span class="kouling-mask">***</span><span class="kouling-dot">.</span>
            <span class="kouling-mask">***</span>
          </div>
          <span class="cs-nickname-display">${this.escapeHtml(nickname || t('cs.anonymous'))}</span>
        </div>
        ${nickname ? `<div class="cs-nickname-locked">${t('cs.nicknameLocked')}</div>` : ''}
        <div class="cs-switch-action">
          <button class="cs-btn-link" id="btn-cs-switch">${t('cs.bindOther')}</button>
        </div>
      </div>
    `;
  }

  private renderSetupSection(): string {
    return `
      <div class="cs-section">
        <p class="cs-hint">${t('cs.setupHint')}</p>
        ${this.renderBindForms('setup')}
        <p class="cs-hint">${t('cs.passwordHint')}</p>
      </div>
    `;
  }

  /** 绑定口令表单：用已有口令 / 新建口令两种方式并列，scope 区分主面板与浮层实例 */
  private renderBindForms(scope: string): string {
    const prefillNick = scope === 'setup' ? SaveManager.getNickname() : '';
    const passwordPlaceholder = this.escapeAttr(t('cs.passwordPlaceholder'));
    return `
      <div class="cs-bind-modes">
        <div class="cs-bind-mode">
          <div class="cs-bind-mode-title">${t('cs.useExistingKouling')}</div>
          <div class="cs-field">
            <div class="kouling-row">
              <input type="password" class="kouling-input" id="${scope}-ek1" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input type="password" class="kouling-input" id="${scope}-ek2" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input type="password" class="kouling-input" id="${scope}-ek3" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <button type="button" class="kouling-eye-btn" id="${scope}-ek-eye" title="切换显示/隐藏">👁️</button>
            </div>
          </div>
          <button class="cs-btn" id="btn-cs-sync-${scope}">${t('cs.syncBtn')}</button>
        </div>
        <div class="cs-bind-mode">
          <div class="cs-bind-mode-title">${t('cs.createNewKouling')}</div>
          <div class="cs-field">
            <label class="cs-label">${t('cs.nicknameLabel')}</label>
            <input class="cs-input" id="${scope}-nick" maxlength="20" placeholder="${this.escapeAttr(t('cs.nicknamePlaceholder'))}" value="${this.escapeAttr(prefillNick)}">
          </div>
          <div class="cs-field">
            <div class="kouling-row">
              <input type="password" class="kouling-input" id="${scope}-nk1" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input type="password" class="kouling-input" id="${scope}-nk2" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input type="password" class="kouling-input" id="${scope}-nk3" maxlength="8" placeholder="${passwordPlaceholder}" autocomplete="off">
              <button type="button" class="kouling-eye-btn" id="${scope}-nk-eye" title="切换显示/隐藏">👁️</button>
            </div>
          </div>
          <button class="cs-btn" id="btn-cs-bind-${scope}">${t('cs.bindBtn')}</button>
        </div>
      </div>
    `;
  }

  private renderOperationButtons(): string {
    return `
      <div class="cs-btn-group">
        <button class="cs-btn upload" id="btn-cs-upload">${t('cs.uploadBtn')}</button>
      </div>
      <div class="cs-ds-warning">${t('cs.uploadWarning')}</div>
      <div class="cs-btn-group">
        <button class="cs-btn download" id="btn-cs-download">${t('cs.downloadBtn')}</button>
        <button class="cs-btn invite" id="btn-cs-invite">${t('cs.inviteBtn')}</button>
      </div>
      <div class="cs-ds-warning">${t('cs.downloadWarning')}</div>
    `;
  }

  private wireIdentitySection(): void {
    this.el?.querySelector('#btn-cs-switch')?.addEventListener('click', () => {
      this.showBindOverlay();
    });
  }

  private showBindOverlay(): void {
    const existing = document.getElementById('cs-switch-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay';
    overlay.id = 'cs-switch-overlay';
    overlay.innerHTML = `
      <div class="switch-card lc-card lc-modal">
        <h3 class="switch-title">${t('cs.bindKouling')}</h3>
        <p class="cs-hint">${t('cs.switchHint')}</p>
        ${this.renderBindForms('ov')}
        <div class="cs-warning cs-warning-spaced">${t('cs.switchWarning')}</div>
        <div class="cs-actions cs-actions-spaced">
          <button class="cs-btn cancel" id="btn-switch-cancel">${t('cs.switchCancel')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    this.wireBindForms('ov');
    overlay.querySelector('#btn-switch-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  /** 绑定口令表单的事件绑定：按钮与输入框可能在主面板或 body 级浮层中，统一按 document 查询 */
  private wireBindForms(scope: string): void {
    this.wireKoulingAutoAdvance(`${scope}-ek`);
    this.wireKoulingAutoAdvance(`${scope}-nk`);

    // 用已有口令：绑定后提示是否立即下载云端存档
    document.querySelector(`#btn-cs-sync-${scope}`)?.addEventListener('click', () => {
      const kouling = this.getKouling(`${scope}-ek`);
      if (!kouling) { this.showToast(t('cs.passwordMissing')); return; }
      try {
        SaveManager.persistKoulingIdentity(kouling);
      } catch (error) {
        this.showToast(localizedErrorMessage(error, 'cs.identitySaveFailed'));
        return;
      }
      this.showDownloadPrompt(kouling);
    });

    // 新建口令：昵称 + 口令一起绑定（昵称此后不可修改）
    document.querySelector(`#btn-cs-bind-${scope}`)?.addEventListener('click', () => {
      const kouling = this.getKouling(`${scope}-nk`);
      const nickname = ((document.querySelector(`#${scope}-nick`) as HTMLInputElement)?.value ?? '').trim();
      if (!kouling) { this.showToast(t('cs.passwordMissing')); return; }
      if (!nickname) { this.showToast(t('cs.nicknameMissing')); return; }
      try {
        SaveManager.persistKoulingIdentity(kouling, nickname);
      } catch (error) {
        this.showToast(localizedErrorMessage(error, 'cs.identitySaveFailed'));
        return;
      }
      this.showToast(t('cs.bindSuccess'));
      this.finishBind();
    });
  }

  private showDownloadPrompt(kouling: string): void {
    this.showConfirm([], () => { void this.downloadForKouling(kouling); }, {
      title: t('cs.downloadPromptTitle'),
      okLabel: t('cs.downloadNow'),
      cancelLabel: t('cs.notNow'),
    });
  }

  /** 绑定完成：关闭切换浮层（如有）并刷新主面板身份显示 */
  private finishBind(): void {
    document.getElementById('cs-switch-overlay')?.remove();
    this.render();
  }

  private getKouling(prefix: string): string {
    const p1 = ((document.querySelector(`#${prefix}1`) as HTMLInputElement)?.value ?? '').trim();
    const p2 = ((document.querySelector(`#${prefix}2`) as HTMLInputElement)?.value ?? '').trim();
    const p3 = ((document.querySelector(`#${prefix}3`) as HTMLInputElement)?.value ?? '').trim();
    if (!p1 && !p2 && !p3) return '';
    return `${p1}.${p2}.${p3}`;
  }

  private wireKoulingAutoAdvance(prefix: string): void {
    const ids = [`${prefix}1`, `${prefix}2`, `${prefix}3`];
    ids.forEach((id, i) => {
      const input = document.querySelector(`#${id}`) as HTMLInputElement;
      if (!input) return;
      input.addEventListener('input', () => {
        const val = input.value;
        if (val.includes('.') || val.includes('。') || val.includes('·')) {
          const cleaned = val.replace(/[。·]/g, '.');
          const parts = cleaned.split('.');
          input.value = [...(parts[0] || '')].slice(0, 8).join('');
          if (parts.length > 1 && i < ids.length - 1) {
            const nextInp = document.querySelector(`#${ids[i + 1]}`) as HTMLInputElement;
            if (nextInp) {
              nextInp.value = [...(parts[1] || '')].slice(0, 8).join('');
              if (parts.length > 2 && i < ids.length - 2) {
                const thirdInp = document.querySelector(`#${ids[i + 2]}`) as HTMLInputElement;
                if (thirdInp) thirdInp.value = [...(parts[2] || '')].slice(0, 8).join('');
              }
              nextInp.focus();
            }
          }
          return;
        }
        if ([...input.value].length >= 8 && i < ids.length - 1) {
          const next = ids[i + 1];
          if (next) (document.querySelector(`#${next}`) as HTMLInputElement)?.focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value.length === 0 && i > 0) {
          const prev = ids[i - 1];
          if (prev) (document.querySelector(`#${prev}`) as HTMLInputElement)?.focus();
        }
      });

      input.addEventListener('paste', (e) => {
        const text = e.clipboardData?.getData('text');
        if (!text) return;
        const cleaned = text.trim().replace(/[。·]/g, '.');
        if (cleaned.includes('.')) {
          e.preventDefault();
          const parts = cleaned.split('.');
          if (parts.length >= 2) {
            const inp1 = document.querySelector(`#${ids[0]}`) as HTMLInputElement;
            const inp2 = document.querySelector(`#${ids[1]}`) as HTMLInputElement;
            const inp3 = document.querySelector(`#${ids[2]}`) as HTMLInputElement;
            if (inp1) inp1.value = [...(parts[0] || '').trim()].slice(0, 8).join('');
            if (inp2) inp2.value = [...(parts[1] || '').trim()].slice(0, 8).join('');
            if (inp3) inp3.value = [...(parts[2] || '').trim()].slice(0, 8).join('');
            if (inp3?.value) {
              inp3.focus();
            } else if (inp2?.value) {
              inp3?.focus();
            } else {
              inp2?.focus();
            }
          }
        }
      });
    });

    // 绑定眼睛切换明密文按钮
    document.querySelector(`#${prefix}-eye`)?.addEventListener('click', (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const firstInp = document.querySelector(`#${ids[0]}`) as HTMLInputElement;
      const isMasked = firstInp?.type === 'password';
      const newType = isMasked ? 'text' : 'password';
      ids.forEach(id => {
        const inp = document.querySelector(`#${id}`) as HTMLInputElement;
        if (inp) inp.type = newType;
      });
      btn.textContent = isMasked ? '🙈' : '👁️';
    });
  }

  private showConfirm(
    messages: string[],
    onConfirm: () => void,
    opts?: { title?: string; okLabel?: string; cancelLabel?: string },
  ): void {
    const existing = document.getElementById('cs-confirm-dialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay cs-confirm-overlay';
    overlay.id = 'cs-confirm-dialog';
    overlay.innerHTML = `
      <div class="switch-card lc-card lc-modal">
        <h3 class="switch-title">${opts?.title ?? t('cs.confirmTitle')}</h3>
        ${messages.map(m => `<div class="cs-warning cs-warning-spaced">${this.escapeHtml(m)}</div>`).join('')}
        <div class="cs-actions cs-actions-confirm">
          <button class="cs-btn cancel" id="cs-confirm-cancel">${opts?.cancelLabel ?? t('confirm.cancel')}</button>
          <button class="cs-btn danger" id="cs-confirm-ok">${opts?.okLabel ?? t('confirm.ok')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#cs-confirm-cancel')!.addEventListener('click', close);
    overlay.querySelector('#cs-confirm-ok')!.addEventListener('click', () => { close(); onConfirm(); });
  }

  private showToast(msg: string): void {
    const el = document.getElementById('ui-toast');
    if (el) {
      el.textContent = msg;
      el.classList.remove('hidden');
      setTimeout(() => el.classList.add('hidden'), 3000);
    }
  }

  private async handleUpload(): Promise<void> {
    try {
      const hash = SaveManager.getHash();
      if (!hash) { this.showToast(t('cs.passwordMissing')); return; }
      const nickname = SaveManager.getNickname();
      if (!nickname) { this.showToast(t('cs.nicknameMissing')); return; }
      const save = SaveManager.load();
      // 打包 platform blob + seal_wins 独立键，云同步跨设备保留胜场
      const platformBlob = localStorage.getItem('loong_platform');
      const sealWinsRaw = localStorage.getItem('loong_seal_wins');
      const platformData = platformBlob
        ? JSON.stringify({ blob: platformBlob, sealWins: sealWinsRaw ?? null })
        : undefined;
      const res = await uploadData({
        hash,
        nickname,
        maxLevel: SaveManager.getMaxLevel(),
        totalScore: save?.score ?? 0,
        scoreTime: save?.timestamp ?? Date.now(),
        recordData: SaveManager.getRecordRaw() ?? undefined,
        checkpointData: SaveManager.getCheckpointRaw() ?? undefined,
        platformData,
      });
      if (res.code === 0) {
        this.showToast(t('cs.uploadSuccess'));
      } else {
        this.showToast(serverErrorMessage(res.errCode, 'cs.uploadFailed'));
      }
    } catch {
      this.showToast(t('cs.networkError'));
    }
  }

  private async handleDownload(): Promise<void> {
    try {
      const hash = SaveManager.getHash();
      if (!hash) { this.showToast(t('cs.passwordMissing')); return; }
      const res = await downloadData({ hash });
      if (res.code === 0 && res.data) {
        this.applyDownload(res.data);
        this.showToast(t('cs.downloadSuccess', { nickname: res.data.nickname, level: res.data.maxLevel, score: res.data.totalScore }));
      } else {
        this.showToast(serverErrorMessage(res.errCode, 'cs.downloadFailed'));
      }
    } catch {
      this.showToast(t('cs.networkError'));
    }
  }

  /** 用已有口令绑定后立即拉取该身份的云端存档（昵称以云端为准） */
  private async downloadForKouling(kouling: string): Promise<void> {
    try {
      const res = await downloadData({ hash: SaveManager.koulingToHash(kouling), kouling });
      if (res.code === 0 && res.data) {
        this.applyDownload(res.data);
        this.showToast(t('cs.downloadSuccess', { nickname: res.data.nickname, level: res.data.maxLevel, score: res.data.totalScore }));
      } else if (res.errCode === 'download_no_data' || res.errCode === 'download_no_kouling_data') {
        this.showToast(t('err.download_no_data'));
      } else {
        this.showToast(serverErrorMessage(res.errCode, 'cs.downloadFailed'));
      }
    } catch {
      this.showToast(t('cs.networkError'));
    }
    this.finishBind();
  }

  private applyDownload(d: DownloadData): void {
    // 昵称不可修改：仅在云端有昵称时覆盖（切换身份场景以云端身份为准）
    if (d.nickname) SaveManager.saveNickname(d.nickname);
    SaveManager.restoreCloudData(d.recordData ?? null, d.checkpointData ?? null);
    if (d.platformData) {
      // 兼容新旧 platformData 格式：新格式为 JSON { blob, sealWins }，旧为纯 base64
      let blob = d.platformData;
      let sealWins: string | null = null;
      try {
        const parsed = JSON.parse(d.platformData);
        if (parsed && typeof parsed.blob === 'string') {
          blob = parsed.blob;
          sealWins = parsed.sealWins ?? null;
        }
      } catch { /* old plain-base64 format */ }
      localStorage.setItem('loong_platform', blob);
      if (sealWins) localStorage.setItem('loong_seal_wins', sealWins);
      try {
        const hash = SaveManager.getHash();
        if (hash) engineBridge.platformInit(hash, '1');
        else engineBridge.platformLoad();
      } catch { /* engine not loaded yet */ }
    }
  }

  private handleShowShare(): void {
    this.destroy();
    showShareInvite((msg) => this.showToast(msg));
  }

  private escapeHtml(s: string): string {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
