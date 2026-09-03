import { SaveManager } from '../core/SaveManager';
import { getInviteCode } from './api';
import { t, serverErrorMessage } from '../i18n';

/**
 * Show a share invite overlay. Both the backpack and cloud-sync panels use this.
 *
 * @param showToast - Function to show a toast message, receiving (text, durationSec?).
 * @param onBack    - If set, a "back" button is shown instead of just "close".
 */
export async function showShareInvite(
  showToast: (msg: string, sec?: number) => void,
  onBack?: () => void,
): Promise<void> {
  const existing = document.getElementById('share-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ui-panel overlay share-overlay';
  overlay.id = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-card lc-card lc-modal">
      <h2 class="share-title lc-title">${t('share.title')}</h2>
      <p class="share-hint" id="share-hint">${t('share.loading')}</p>
      <div class="share-link-area hidden" id="share-link-area">
        <textarea class="share-link-input" id="share-link-input" rows="2" spellcheck="false" readonly></textarea>
        <button class="cs-btn invite share-copy-btn" id="btn-share-copy">${t('share.copyBtn')}</button>
      </div>
      <div class="share-rules hidden" id="share-rules">
        <h3>${t('share.rulesTitle')}</h3>
        <ul>
          <li>${t('share.rule1')}</li>
          <li>${t('share.rule2')}</li>
          <li>${t('share.rule3')}</li>
        </ul>
      </div>
      <button class="share-back-btn" id="btn-share-back">${t('share.back')}</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector('#btn-share-back')!.addEventListener('click', () => { overlay.remove(); onBack?.(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  // Fetch invite link
  try {
    const hash = SaveManager.getHash();
    if (!hash) {
      overlay.querySelector('#share-hint')!.textContent = t('share.noAccount');
      return;
    }
    const res = await getInviteCode(hash);
    if (res.code !== 0 || !res.data) {
      overlay.querySelector('#share-hint')!.textContent = serverErrorMessage(res.errCode, 'share.fetchFailed');
      return;
    }
    const url = `${window.location.origin}/?xq=${res.data.code}`;

    overlay.querySelector('#share-hint')!.classList.add('hidden');
    overlay.querySelector('#share-link-area')!.classList.remove('hidden');
    overlay.querySelector('#share-rules')!.classList.remove('hidden');

    const input = overlay.querySelector('#share-link-input') as HTMLTextAreaElement;
    if (input) {
      input.value = url;
      input.addEventListener('focus', () => { input.readOnly = false; input.select(); });
    }
    overlay.querySelector('#btn-share-copy')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        showToast(t('share.copied'), 1.5);
      } catch {
        input?.select();
        showToast(t('share.manualCopy'), 2);
      }
    });
  } catch {
    overlay.querySelector('#share-hint')!.textContent = t('share.networkError');
  }
}
