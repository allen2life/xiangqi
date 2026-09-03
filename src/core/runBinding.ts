import { AppError } from '../i18n/AppError';

export const RECORD_RULESET_ID = 'xiangqiblast-v9-fullhand' as const;
export const RECORD_PROTOCOL_VERSION = 4 as const;

export interface RunStartData {
  runNonce: string;
  issuedAt: number;
  expiresAt: number;
  levelId: number;
  rulesetId: string;
}

const LOCAL_RUN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values, value => value.toString(16).padStart(2, '0')).join('');
}

export function createLocalRecordBinding(hash: string, levelId: number, now = Date.now()): RecordBinding {
  if (!/^[0-9a-f]{64}$/i.test(hash) || levelId <= 0) throw new AppError('err.identity_invalid');
  return {
    hash,
    runNonce: randomHex(32),
    issuedAt: now,
    expiresAt: now + LOCAL_RUN_LIFETIME_MS,
    levelId,
    rulesetId: RECORD_RULESET_ID,
  };
}

export interface RecordBinding {
  hash: string;
  runNonce: string;
  issuedAt: number;
  expiresAt: number;
  levelId: number;
  rulesetId: string;
}

export interface RecordPublicationState {
  recordBinding?: RecordBinding;
  recordPublishError?: string;
}

export function validateRecordBinding(
  binding: RecordBinding,
  expectedHash: string,
  expectedLevelId: number,
  now = Date.now(),
): RecordBinding {
  if (!/^[0-9a-f]{64}$/i.test(expectedHash) || binding.hash !== expectedHash) {
    throw new AppError('err.binding_identity_mismatch');
  }
  if (!/^[0-9a-f]{64}$/i.test(binding.runNonce)) throw new AppError('err.binding_nonce_invalid');
  if (binding.levelId !== expectedLevelId || binding.rulesetId !== RECORD_RULESET_ID) {
    throw new AppError('err.binding_level_mismatch');
  }
  if (!Number.isSafeInteger(binding.issuedAt) || !Number.isSafeInteger(binding.expiresAt) ||
      binding.issuedAt <= 0 || binding.issuedAt > now || binding.expiresAt <= binding.issuedAt || binding.expiresAt <= now) {
    throw new AppError('err.binding_expired');
  }
  return binding;
}

export function mapRunStartToRecordBinding(
  hash: string,
  expectedLevelId: number,
  data: RunStartData,
): RecordBinding {
  if (!hash || !/^[0-9a-f]{64}$/i.test(data.runNonce)) {
    throw new AppError('err.binding_server_invalid');
  }
  if (data.levelId !== expectedLevelId || data.rulesetId !== RECORD_RULESET_ID) {
    throw new AppError('err.binding_server_level_mismatch');
  }
  if (!Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.expiresAt) ||
      data.issuedAt <= 0 || data.expiresAt <= data.issuedAt || data.expiresAt <= Date.now()) {
    throw new AppError('err.binding_server_time_invalid');
  }
  return validateRecordBinding({
    hash,
    runNonce: data.runNonce,
    issuedAt: data.issuedAt,
    expiresAt: data.expiresAt,
    levelId: data.levelId,
    rulesetId: data.rulesetId,
  }, hash, expectedLevelId);
}

export function createResumedPublicationState(
  state: RecordPublicationState,
  hash: string,
  levelId: number,
): RecordPublicationState {
  if (state.recordPublishError) return { recordPublishError: state.recordPublishError };
  if (!state.recordBinding) return { recordPublishError: 'err.binding_resume_missing' };
  try {
    return { recordBinding: validateRecordBinding(state.recordBinding, hash, levelId) };
  } catch (error) {
    return { recordPublishError: error instanceof AppError ? error.i18nKey : 'err.binding_resume_invalid' };
  }
}

export function createPublishBindingFields(
  state: RecordPublicationState,
  hash: string,
  levelId: number,
): { runNonce: string; recordProtocolVersion: 4; levelId: number; rulesetId: string } {
  if (state.recordPublishError) throw new AppError(state.recordPublishError);
  const binding = state.recordBinding;
  if (!binding) throw new AppError('err.binding_missing');
  validateRecordBinding(binding, hash, levelId);
  return {
    runNonce: binding.runNonce,
    recordProtocolVersion: RECORD_PROTOCOL_VERSION,
    levelId: binding.levelId,
    rulesetId: binding.rulesetId,
  };
}
