/**
 * Publish score to leaderboard controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t, localizedErrorMessage, serverErrorMessage } from '../../i18n';
import { AppError } from '../../i18n/AppError';
import { SaveManager } from '../../core/SaveManager';
import { engineBridge } from '../../wasm/EngineBridge';
import { publishRank } from '../../cloud/api';
import { createGameRecordData } from '../../core/gameRecord';
import { createPublishBindingFields, createLocalRecordBinding, RECORD_PROTOCOL_VERSION, type RecordPublicationState } from '../../core/runBinding';
import { showToast } from '../utils/domHelpers';
import { readLocalInventory, applyAuthoritativeInventory, projectInventoryWithSessionSouls } from '../utils/inventory';
import type { DomUIContext } from '../DomUIContext';

export class PublishController {
  constructor(private ctx: DomUIContext) {}

  showPublishHint(): void {
    const existing = document.getElementById('publish-hint-overlay');
    if (existing) return;

    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay publish-overlay';
    overlay.id = 'publish-hint-overlay';
    overlay.innerHTML = `
      <div class="publish-card">
        <div class="publish-title">🏆 ${t('publish.title')}</div>
        <p class="publish-hint-text">${t('publish.hintBefore3')}</p>
        <p class="publish-encourage">${t('publish.encourage')}</p>
        <button class="publish-btn primary" id="btn-publish-hint-ok">${t('publish.gotIt')}</button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#btn-publish-hint-ok')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  showPublishPanel(): void {
    const data = this.ctx.state.lastSettlementData;
    if (data) {
      this.renderPublishPanel();
    } else {
      showToast(t('toast.publishInSettlement'), 2);
    }
  }

  private renderPublishPanel(): void {
    const existing = document.getElementById('publish-overlay');
    if (existing) return;

    if (!this.ctx.state.lastSettlementData) {
      showToast(t('toast.noScore'), 2);
      return;
    }

    const hasHash = SaveManager.hasHash();
    const overlay = document.createElement('div');
    overlay.className = 'ui-panel overlay publish-overlay';
    overlay.id = 'publish-overlay';

    if (hasHash) {
      overlay.innerHTML = `
        <div class="publish-card">
          <div class="publish-title">🏆 ${t('publish.title')}</div>
          <div class="publish-data-row">${t('publish.totalScore', { score: this.ctx.state.lastSettlementData.totalScore })}</div>
          <div class="publish-cost-row">${t('publish.cost')}</div>
          <div class="publish-actions">
            <button class="publish-btn cancel" id="btn-pub-cancel">${t('publish.cancel')}</button>
            <button class="publish-btn primary" id="btn-pub-confirm">🏆 ${t('publish.confirm')}</button>
          </div>
        </div>
      `;
    } else {
      const cachedNick = SaveManager.getNickname();
      overlay.innerHTML = `
        <div class="publish-card">
          <div class="publish-title">🏆 ${t('publish.title')}</div>
          <p class="publish-setup-hint">${t('publish.setupHint')}</p>
          <div class="publish-field">
            <label class="publish-label">${t('publish.nicknameLabel')}</label>
            <input class="publish-input" id="pub-nickname" maxlength="20" placeholder="${t('publish.nicknamePlaceholder')}" value="${this.escapeAttr(cachedNick)}">
          </div>
          <div class="publish-field">
            <label class="publish-label">${t('publish.passwordLabel')}</label>
            <div class="kouling-row">
              <input class="kouling-input" id="pkl1" maxlength="8" placeholder="${t('publish.passwordPlaceholder')}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input class="kouling-input" id="pkl2" maxlength="8" placeholder="${t('publish.passwordPlaceholder')}" autocomplete="off">
              <span class="kouling-dot">.</span>
              <input class="kouling-input" id="pkl3" maxlength="8" placeholder="${t('publish.passwordPlaceholder')}" autocomplete="off">
            </div>
          </div>
          <div class="publish-warning">${t('publish.warning')}</div>
          <div class="publish-cost-row">${t('publish.cost')}</div>
          <div class="publish-actions">
            <button class="publish-btn cancel" id="btn-pub-cancel">${t('publish.cancel')}</button>
            <button class="publish-btn primary" id="btn-pub-confirm">🏆 ${t('publish.confirm')}</button>
          </div>
        </div>
      `;
    }

    document.body.appendChild(overlay);

    overlay.querySelector('#btn-pub-cancel')!.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#btn-pub-confirm')!.addEventListener('click', () => this.handlePublishConfirm(overlay));

    if (!hasHash) {
      overlay.querySelector('#pub-nickname')?.addEventListener('input', (e) => {
        SaveManager.saveNickname((e.target as HTMLInputElement).value);
      });
      ['pkl1', 'pkl2', 'pkl3'].forEach((id, i, ids) => {
        const input = overlay.querySelector(`#${id}`) as HTMLInputElement;
        if (!input) return;
        input.addEventListener('input', () => {
          if (input.value.length >= 8 && i < ids.length - 1) {
            const next = overlay.querySelector(`#${ids[i + 1]}`) as HTMLInputElement;
            if (next) next.focus();
          }
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && input.value.length === 0 && i > 0) {
            const prev = overlay.querySelector(`#${ids[i - 1]}`) as HTMLInputElement;
            if (prev) prev.focus();
          }
        });
      });
    }
  }

  private async handlePublishConfirm(overlay: HTMLElement): Promise<void> {
    if (!this.ctx.state.lastSettlementData) return;

    let hash = SaveManager.getHash();
    let kouling: string | undefined;

    const nicknameInput = (overlay.querySelector('#pub-nickname') as HTMLInputElement)?.value?.trim();
    const nickname = nicknameInput || SaveManager.getNickname();
    if (!nickname) {
      showToast(t('cs.nicknameMissing'), 2);
      return;
    }
    SaveManager.saveNickname(nickname);

    if (!hash) {
      const p1 = (overlay.querySelector('#pkl1') as HTMLInputElement)?.value?.trim() ?? '';
      const p2 = (overlay.querySelector('#pkl2') as HTMLInputElement)?.value?.trim() ?? '';
      const p3 = (overlay.querySelector('#pkl3') as HTMLInputElement)?.value?.trim() ?? '';
      const fullKouling = `${p1}.${p2}.${p3}`;
      if (!p1 || !p2 || !p3) {
        showToast(t('cs.passwordMissing'), 2);
        return;
      }
      try {
        hash = SaveManager.persistKoulingIdentity(fullKouling, nickname);
      } catch (e) {
        showToast(localizedErrorMessage(e), 2);
        return;
      }
      kouling = fullKouling;
    }

    const d = this.ctx.state.lastSettlementData;
    const records = SaveManager.loadRecords();
    let levelScores: Record<number, number> | undefined;
    if (records.length > 0) {
      const map: Record<number, number> = {};
      for (const r of records) { if (!map[r.level] || r.score > map[r.level]) map[r.level] = r.score; }
      levelScores = map;
    }

    const confirmBtn = overlay.querySelector('#btn-pub-confirm') as HTMLButtonElement;
    let operationKey: string | undefined;
    try {
      let bindingFields: { runNonce: string; recordProtocolVersion: 4; levelId: number; rulesetId: string };
      try {
        const gameState: RecordPublicationState = (SaveManager.loadGameState() ?? SaveManager.loadTurnSnapshot() ?? {}) as RecordPublicationState;
        if (gameState.recordBinding && !gameState.recordPublishError) {
          bindingFields = createPublishBindingFields(gameState, hash, d.level);
        } else {
          const binding = createLocalRecordBinding(hash, d.level);
          bindingFields = {
            runNonce: binding.runNonce,
            recordProtocolVersion: RECORD_PROTOCOL_VERSION,
            levelId: binding.levelId,
            rulesetId: binding.rulesetId,
          };
        }
      } catch {
        const binding = createLocalRecordBinding(hash, d.level);
        bindingFields = {
          runNonce: binding.runNonce,
          recordProtocolVersion: RECORD_PROTOCOL_VERSION,
          levelId: binding.levelId,
          rulesetId: binding.rulesetId,
        };
      }

      let gameRecordData = '';
      try {
        const record = createGameRecordData(
          () => engineBridge.exportRecord(),
          (data) => engineBridge.verifyRecord(data),
        );
        gameRecordData = record.gameRecordData;
      } catch (e) {
        console.warn('Game record export skipped:', e);
      }

      // 得分明细全量上传（与记录同源；服务端与记录明细块对照校验）
      const scoreDetail = JSON.stringify({
        finalScore: d.finalScore,
        piecesScore: d.piecesScore,
        cityScore: d.cityScore,
        statueScore: d.statueScore,
        allyLostPenalty: d.allyLostPenalty,
        comboGain: d.comboGain,
        starBonus: d.starBonus,
        starMask: d.stars.reduce((mask, achieved, i) => mask | (achieved ? (1 << i) : 0), 0),
        totalStars: d.totalStars,
        maxKillsPerStep: d.maxKillsPerStep,
        multiplierX10: Math.round(d.levelMultiplier * 10),
        turnCount: d.turnCount,
        bonusScores: d.bonusScores,
      });
      operationKey = `publish:${hash}:${bindingFields.runNonce}`;
      if (this.ctx.state.uncertainOperations.has(operationKey)) {
        return;
      }
      this.ctx.state.uncertainOperations.add(operationKey);
      confirmBtn.disabled = true;

      const res = await publishRank({
        hash,
        kouling,
        nickname,
        maxLevel: SaveManager.getMaxLevel(),
        totalScore: SaveManager.getTotalScore(),
        scoreTime: Date.now(),
        gameRecordData,
        ...bindingFields,
        checkpointData: SaveManager.getCheckpointRaw() ?? undefined,
        levelScores,
        levelStars: { [d.level]: d.stars.reduce((mask, achieved, i) => mask | (achieved ? (1 << i) : 0), 0) },
        scoreDetail,
      });

      if (res.code === 0 && res.data) {
        this.ctx.state.uncertainOperations.delete(operationKey);
        SaveManager.persistSyncHash(hash);
        SaveManager.saveNickname(nickname);
        this.ctx.state.inventory.settleAuthoritative(res.data.inventory);
        this.ctx.state.sessionEarnedLoongSouls = 0;
        applyAuthoritativeInventory(res.data.inventory, res.data.balance_remaining);
        this.ctx.host.onBackpackItemsChanged?.(res.data.inventory.loong_soul ?? 0);
        this.ctx.host.onRunPublished?.();

        overlay.innerHTML = `
          <div class="publish-card">
            <div class="publish-title">🏆 ${t('publish.success')}</div>
            <div class="publish-success-row">${t('publish.successCost')}</div>
            <div class="publish-success-row">${t('publish.successRank', { rank: res.data.rank })}</div>
            ${res.data.is_new_user ? `<div class="publish-welcome">${t('publish.welcome')}</div>` : ''}
            <div class="publish-actions">
              <button class="publish-btn primary" id="btn-pub-rank">${t('publish.viewRank')}</button>
              <button class="publish-btn cancel" id="btn-pub-done">${t('publish.done')}</button>
            </div>
          </div>
        `;

        overlay.querySelector('#btn-pub-rank')!.addEventListener('click', () => {
          overlay.remove();
          this.ctx.host.onLeaderboardCurrentLevel?.();
        });
        overlay.querySelector('#btn-pub-done')!.addEventListener('click', () => overlay.remove());
        setTimeout(() => { if (document.getElementById('publish-overlay')) overlay.remove(); }, 3000);
      } else {
        this.ctx.state.uncertainOperations.delete(operationKey);
        confirmBtn.disabled = false;
        if (res.errCode === 'nickname_empty') {
          const input = overlay.querySelector('#pub-nickname') as HTMLInputElement;
          if (input) input.focus();
        } else if (res.errCode === 'kouling_format' || res.errCode === 'kouling_mismatch') {
          const input = overlay.querySelector('#pkl1') as HTMLInputElement;
          if (input) input.focus();
        }
        showToast(serverErrorMessage(res.errCode, 'cs.uploadFailed'), 2);
      }
    } catch (error) {
      confirmBtn.disabled = false;
      if (typeof operationKey !== 'undefined') {
        this.ctx.state.uncertainOperations.delete(operationKey);
      }
      showToast(localizedErrorMessage(error), 2);
    }
  }

  private escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
