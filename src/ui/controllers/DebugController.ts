/**
 * Debug modal (piece picker) controller.
 * Controller — receives DomUIContext, does NOT import DomUI class.
 */

import { t } from '../../i18n';
import { PieceType } from '../../core/types';
import { pieceIconTag } from '../utils/pieceIcons';
import type { DomUIContext } from '../DomUIContext';

const PIECE_DEFS: { type: PieceType; iconKey: string }[] = [
  { type: PieceType.PAWN, iconKey: 'pawn' },
  { type: PieceType.ADVISOR, iconKey: 'advisor' },
  { type: PieceType.CHARIOT, iconKey: 'chariot' },
  { type: PieceType.CANNON, iconKey: 'cannon' },
  { type: PieceType.HORSE, iconKey: 'horse' },
  { type: PieceType.ELEPHANT, iconKey: 'elephant' },
  { type: PieceType.GENERAL, iconKey: 'general' },
  { type: PieceType.LOONG_FLAME, iconKey: 'loong_flame' },
  // 召唤令增强棋子（调试可选，便于测试）
  { type: PieceType.HORSE_IRON, iconKey: 'horse_iron' },
  { type: PieceType.ELEPHANT_MENMA, iconKey: 'elephant_mengma' },
  { type: PieceType.CHARIOT_TANK, iconKey: 'chariot_tank' },
  { type: PieceType.PAWN_ENGINEER, iconKey: 'pawn_engineer' },
];

export class DebugController {
  constructor(private ctx: DomUIContext) {}

  showDebugModal(currentHand: PieceType[], onConfirm: (types: PieceType[]) => void, onCancel?: () => void): void {
    const el = document.getElementById('ui-debug-modal')!;
    let selected: PieceType[] = [...currentHand];

    const render = () => {
      el.innerHTML = `
        <div class="debug-modal-card">
          <h3>${t('debug.title')}</h3>
          <p class="debug-modal-hint">${t('debug.hint')}</p>
          <div class="debug-selected" id="debug-selected-text">${
            selected.map(t => {
              const d = PIECE_DEFS.find(p => p.type === t);
              return d ? pieceIconTag(d.iconKey, '') : '';
            }).join('') || `<span class="muted">${t('debug.empty')}</span>`
          }</div>
          <div class="debug-piece-grid" id="debug-piece-grid"></div>
          <div class="debug-actions">
            <button class="debug-action-btn close" id="debug-close">${t('debug.close')}</button>
            <button class="debug-action-btn clear" id="debug-clear">${t('debug.clear')}</button>
            <button class="debug-action-btn confirm" id="debug-confirm">${t('debug.confirm')}</button>
          </div>
        </div>
      `;

      const grid = document.getElementById('debug-piece-grid')!;
      PIECE_DEFS.forEach(def => {
        const btn = document.createElement('button');
        const count = selected.filter(t => t === def.type).length;
        btn.className = 'debug-piece-btn' + (count > 0 ? ' active' : '');
        btn.innerHTML = pieceIconTag(def.iconKey, '');
        if (count > 0) {
          const badge = document.createElement('span');
          badge.className = 'debug-piece-badge';
          badge.textContent = String(count);
          btn.appendChild(badge);
        }
        btn.addEventListener('click', () => {
          if (selected.length < 3) selected.push(def.type);
          render();
        });
        grid.appendChild(btn);
      });

      document.getElementById('debug-confirm')!.addEventListener('click', () => {
        this.hideDebugModal(); onConfirm(selected);
      });
      document.getElementById('debug-clear')!.addEventListener('click', () => { selected = []; render(); });
      document.getElementById('debug-close')!.addEventListener('click', () => { this.hideDebugModal(); onCancel?.(); });
    };

    render();
    el.classList.remove('hidden');
  }

  hideDebugModal(): void {
    document.getElementById('ui-debug-modal')!.classList.add('hidden');
  }
}
