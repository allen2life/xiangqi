import { describe, expect, it, vi } from 'vitest';
import { bytesToBase64, createGameRecordData, parseRecordHeader, persistGameRecord } from './gameRecord';

function recordBytes(version = 4, payloadLength = 8): Uint8Array {
  const bytes = new Uint8Array(payloadLength);
  bytes.set([0x58, 0x51, 0x42, 0x52, version & 0xff, version >> 8, 192, 0]);
  return bytes;
}

describe('game record publication data', () => {
  it('skips export only when already unpublishable and clears any stale record', () => {
    const exportRecord = vi.fn(() => recordBytes());
    const verifyRecord = vi.fn(() => ({ valid: true }));
    const saveRecord = vi.fn();
    const clearRecord = vi.fn();
    const reportError = vi.fn();

    persistGameRecord('err.debug_forced_win', exportRecord, verifyRecord, saveRecord, clearRecord, reportError);

    expect(exportRecord).not.toHaveBeenCalled();
    expect(saveRecord).not.toHaveBeenCalled();
    expect(clearRecord).toHaveBeenCalledOnce();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('keeps unexpected ranked export failures loud', () => {
    const failure = new Error('engine export failed');
    const clearRecord = vi.fn();
    const reportError = vi.fn();

    persistGameRecord(undefined, () => { throw failure; }, vi.fn(), vi.fn(), clearRecord, reportError);

    expect(clearRecord).toHaveBeenCalledOnce();
    expect(reportError).toHaveBeenCalledWith('[GameRecord] export failed', failure);
  });

  it('encodes the exact shipped engine bytes and derives protocol version from their header', () => {
    const bytes = recordBytes();
    const result = createGameRecordData(() => bytes, (record) => ({ valid: record === bytes, score: 420 }));

    expect(result.gameRecordData).toBe(bytesToBase64(bytes));
    expect(result.verifiedScore).toBe(420);
    expect(result.byteLength).toBe(bytes.length);
    expect(result.protocolVersion).toBe(4);
  });

  it('rejects empty, legacy, mismatched, and self-verification-failed records before upload', () => {
    const verify = vi.fn(() => ({ valid: true, score: 0 }));
    expect(() => createGameRecordData(() => new Uint8Array(), verify)).toThrow('err.record_empty');
    expect(() => createGameRecordData(() => Uint8Array.of(1), verify)).toThrow('err.record_too_short');

    const legacy = new Uint8Array(10_064);
    legacy[0] = 1;
    expect(() => createGameRecordData(() => legacy, verify)).toThrow('err.record_engine_too_old');
    expect(() => createGameRecordData(() => recordBytes(3), verify)).toThrow('err.record_version_mismatch');
    expect(verify).not.toHaveBeenCalled();

    expect(() => createGameRecordData(() => recordBytes(), () => ({ valid: false, score: 0 }))).toThrow('err.record_self_check_failed');
  });

  it('parses the protocol from the real wire header rather than caller metadata', () => {
    expect(parseRecordHeader(recordBytes())).toEqual({ magic: 'XQBR', version: 4, headerSize: 192 });
  });

  it('uses chunks when encoding large records', () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256);
    const encoded = bytesToBase64(bytes);
    expect(encoded.length).toBe(Math.ceil(bytes.length / 3) * 4);
    expect(atob(encoded).charCodeAt(99_999)).toBe(bytes[99_999]);
  });
});
