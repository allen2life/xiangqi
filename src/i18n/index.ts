import type { Lang } from './types';
import { STRINGS } from './strings';
import { AppError } from './AppError';

const STORAGE_KEY = 'chessblast_lang';

let currentLang: Lang = detectLang();

function detectLang(): Lang {
  // 1) URL param overrides everything（node 测试环境无 window，跳过）
  if (typeof window !== 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    const urlLang = urlParams.get('lang');
    if (urlLang === 'zh' || urlLang === 'en') return urlLang;

    // 2) localStorage (user has explicitly switched via settings)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
  }

  // 3) Default to English
  return 'en';
}

export function getLang(): Lang {
  return currentLang;
}

export function setLang(lang: Lang): void {
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);

  // Update <html> lang attribute
  const attr = lang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.setAttribute('lang', attr);

  // Dispatch event so UI components can react
  window.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
}

/**
 * Translate a key. Supports {param} substitution.
 *
 * @param key  - String key in STRINGS
 * @param params - Optional key-value pairs for {placeholder} replacement
 * @returns Translated string, or the key itself if not found (graceful fallback)
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const pair = STRINGS[key];
  if (!pair) return key;

  const raw: string = currentLang === 'zh' ? pair[0] : pair[1];
  if (!params) return raw;

  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const val = params[name];
    return val !== undefined ? String(val) : `{${name}}`;
  });
}

/**
 * Localize a thrown error for display. AppError carries an i18nKey (translated);
 * any other error is unexpected and falls back to a generic message — it MUST
 * NOT leak error.message, which may be a raw key or an English/Chinese string.
 */
export function localizedErrorMessage(error: unknown, fallbackKey = 'toast.networkError'): string {
  if (error instanceof AppError) return t(error.i18nKey, error.params);
  return t(fallbackKey);
}

/**
 * Localize a server error response. Maps `err_code` (e.g. "kouling_format") to
 * the i18n key `err.kouling_format`. Never returns res.message — if the code is
 * absent or unknown, falls back to fallbackKey so no Chinese ever leaks.
 */
export function serverErrorMessage(errCode: string | undefined, fallbackKey: string): string {
  if (errCode) {
    const key = `err.${errCode}`;
    if (STRINGS[key]) return t(key);
  }
  return t(fallbackKey);
}

// Initialize html lang attribute on load（node 测试环境无 document，跳过）
if (typeof document !== 'undefined') {
  const initAttr = currentLang === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.setAttribute('lang', initAttr);
}
