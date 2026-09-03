/**
 * AppError — an Error that carries an i18n key instead of a localized message.
 *
 * Core modules throw `new AppError('err.xxx', params)`; the UI layer translates
 * the key via `t()` at display time. This keeps the chosen language out of the
 * throw site so a stored key (e.g. recordPublishError) can be re-translated
 * correctly even after the user switches language.
 *
 * `message` is set to the key for stack traces / debugging only — it MUST NOT
 * be displayed directly; use `localizedErrorMessage(error)` instead.
 */
export class AppError extends Error {
  readonly i18nKey: string;
  readonly params?: Record<string, string | number>;

  constructor(i18nKey: string, params?: Record<string, string | number>) {
    super(i18nKey);
    this.name = 'AppError';
    this.i18nKey = i18nKey;
    this.params = params;
  }
}
