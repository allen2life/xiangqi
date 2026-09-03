import { AppError } from '../i18n/AppError';

export interface ParsedRecordHeader {
  magic: string;
  version: number;
  headerSize: number;
}

export function parseRecordHeader(bytes: Uint8Array): ParsedRecordHeader {
  if (bytes.byteLength < 8) throw new AppError('err.record_too_short');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const version = bytes[4] | (bytes[5] << 8);
  const headerSize = bytes[6] | (bytes[7] << 8);
  if (magic !== 'XQBR') throw new AppError('err.record_engine_too_old');
  return { magic, version, headerSize };
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function persistGameRecord(
  recordPublishError: string | undefined,
  exportRecord: () => Uint8Array,
  verifyRecord: (data: Uint8Array) => { valid: boolean },
  saveRecord: (data: string) => void,
  clearRecord: () => void,
  reportError: (message: string, error: unknown) => void = console.error,
): void {
  if (recordPublishError !== undefined) {
    clearRecord();
    return;
  }
  try {
    const record = exportRecord();
    if (!verifyRecord(record).valid) throw new Error('record self-verification failed');
    saveRecord(bytesToBase64(record));
  } catch (error) {
    clearRecord();
    reportError('[GameRecord] export failed', error);
  }
}

export function createGameRecordData(
  exportRecord: () => Uint8Array,
  verifyRecord: (data: Uint8Array) => { valid: boolean; score: number },
  requiredVersion = 4,
): { gameRecordData: string; verifiedScore: number; byteLength: number; protocolVersion: number } {
  const record = exportRecord();
  if (record.byteLength === 0) throw new AppError('err.record_empty');
  const header = parseRecordHeader(record);
  if (header.version !== requiredVersion) {
    throw new AppError('err.record_version_mismatch', { required: requiredVersion, actual: header.version });
  }
  const verified = verifyRecord(record);
  if (!verified.valid) throw new AppError('err.record_self_check_failed');
  return {
    gameRecordData: bytesToBase64(record),
    verifiedScore: verified.score,
    byteLength: record.byteLength,
    protocolVersion: header.version,
  };
}
