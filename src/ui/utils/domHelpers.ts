/**
 * Pure DOM utility functions — no `this` dependency.
 * Extracted from DomUI.ts for modularity.
 */

import { resolveIconSrc } from '../../utils/iconAssetCache';

export function showToast(message: string, durationSec: number): void {
  const el = document.getElementById('ui-toast')!;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), durationSec * 1000);
}

export function showConfirmDialog(message: string, onConfirm: () => void): void {
  const existing = document.getElementById('confirm-dialog-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'confirm-dialog-overlay';
  overlay.className = 'ui-panel overlay cs-confirm-overlay';
  overlay.style.cssText = 'z-index:2000;display:flex;align-items:center;justify-content:center;';
  overlay.innerHTML = `
    <div class="confirm-card lc-card lc-modal" style="text-align:center;padding:24px;max-width:300px;width:90%;">
      <p style="margin:0 0 16px;color:var(--lc-text);font-size:15px;">${escapeHtml(message)}</p>
      <button class="start-btn lc-btn confirm-dialog-yes" style="min-width:80px;">${t_confirm('是', 'Yes')}</button>
      <button class="start-btn lc-btn lc-btn-quiet confirm-dialog-no" style="min-width:80px;margin-left:8px;">${t_confirm('取消', 'Cancel')}</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-dialog-yes')!.addEventListener('click', () => { overlay.remove(); onConfirm(); });
  overlay.querySelector('.confirm-dialog-no')!.addEventListener('click', () => overlay.remove());
}

/** Minimal inline t() for confirm dialog to avoid import cycle. */
function t_confirm(zh: string, en: string): string {
  return document.documentElement.lang === 'en' ? en : zh;
}

export function imageWithFallback(className: string, src: string, label: string, alt: string): string {
  return `<span class="${className} icon-fallback" data-fallback="${label}"><img src="${resolveIconSrc(src)}" alt="${alt}" onerror="this.parentElement?.classList.add('is-fallback');this.remove()"></span>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
