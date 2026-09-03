import { describe, expect, it } from 'vitest';
import { parseXqbrRecord } from './ReplayController';

/** Construct a valid XQBR binary record for testing, returns base64. */
function buildXqbrRecord(opts: {
  mode?: number;
  levelId?: number;
  rngSeed?: number;
  configJson?: string;
  actions?: { type: number; code: number; count: number; arg0: number; arg1: number; arg2: number }[];
}): string {
  const HEADER_SIZE = 192;
  const configBytes = opts.configJson ? new TextEncoder().encode(opts.configJson) : new Uint8Array(0);
  const actions = opts.actions ?? [];
  const actionBytes = new Uint8Array(actions.length * 16);
  const adv = new DataView(actionBytes.buffer);
  actions.forEach((a, i) => {
    const off = i * 16;
    actionBytes[off] = a.type;
    actionBytes[off + 1] = a.code;
    actionBytes[off + 2] = a.count;
    actionBytes[off + 3] = 0;
    adv.setInt32(off + 4, a.arg0, true);
    adv.setInt32(off + 8, a.arg1, true);
    adv.setInt32(off + 12, a.arg2, true);
  });

  const total = HEADER_SIZE + configBytes.length + actions.length * 16 + 32;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);

  buf[0] = 0x58; buf[1] = 0x51; buf[2] = 0x42; buf[3] = 0x52; // "XQBR"
  view.setUint16(4, 1, true);       // version
  view.setUint16(6, HEADER_SIZE, true);
  buf[8] = opts.mode ?? 1;          // mode (CAMPAIGN)
  buf[9] = 1;                       // result (victory)
  view.setUint32(12, opts.levelId ?? 3, true);
  view.setUint32(16, opts.rngSeed ?? 42, true);
  view.setUint32(20, configBytes.length, true);
  view.setUint32(24, actions.length, true);
  view.setUint32(28, 1000, true);   // final score

  buf.set(configBytes, HEADER_SIZE);
  buf.set(actionBytes, HEADER_SIZE + configBytes.length);

  let binary = '';
  for (let i = 0; i < buf.length; i++) binary += String.fromCharCode(buf[i]);
  return btoa(binary);
}

describe('parseXqbrRecord', () => {
  it('parses a valid XQBR record with header + actions', () => {
    const actions = [
      { type: 1, code: 5, count: 0, arg0: 3, arg1: 4, arg2: 0 },  // PLACE
      { type: 4, code: 0, count: 0, arg0: 0, arg1: 0, arg2: 0 },  // CONFIRM
      { type: 8, code: 2, count: 1, arg0: 0, arg1: 0, arg2: 0 },  // USE_ITEM
    ];
    const b64 = buildXqbrRecord({ levelId: 7, rngSeed: 999, actions });
    const rec = parseXqbrRecord(b64)!;

    expect(rec).not.toBeNull();
    expect(rec.mode).toBe(1);
    expect(rec.levelId).toBe(7);
    expect(rec.rngSeed).toBe(999);
    expect(rec.actions.length).toBe(3);

    // PLACE action
    expect(rec.actions[0].type).toBe(1);
    expect(rec.actions[0].code).toBe(5);
    expect(rec.actions[0].arg0).toBe(3);
    expect(rec.actions[0].arg1).toBe(4);

    // CONFIRM action
    expect(rec.actions[1].type).toBe(4);

    // USE_ITEM action
    expect(rec.actions[2].type).toBe(8);
    expect(rec.actions[2].code).toBe(2);
    expect(rec.actions[2].count).toBe(1);
  });

  it('parses config JSON when present', () => {
    const config = '{"enemies":[{"type":1,"x":3,"y":4}]}';
    const b64 = buildXqbrRecord({ configJson: config });
    const rec = parseXqbrRecord(b64)!;

    expect(rec.configJson).toBe(config);
  });

  it('returns null for invalid magic bytes', () => {
    const bad = new Uint8Array(224);
    bad[0] = 0x00; bad[1] = 0x00; bad[2] = 0x00; bad[3] = 0x00;
    let binary = '';
    for (let i = 0; i < bad.length; i++) binary += String.fromCharCode(bad[i]);
    expect(parseXqbrRecord(btoa(binary))).toBeNull();
  });

  it('returns null for truncated data (shorter than header)', () => {
    const short = new Uint8Array(100);
    let binary = '';
    for (let i = 0; i < short.length; i++) binary += String.fromCharCode(short[i]);
    expect(parseXqbrRecord(btoa(binary))).toBeNull();
  });

  it('returns null for invalid base64', () => {
    expect(parseXqbrRecord('!!!not-base64!!!')).toBeNull();
  });

  it('handles empty action list', () => {
    const b64 = buildXqbrRecord({ actions: [] });
    const rec = parseXqbrRecord(b64)!;
    expect(rec.actions).toEqual([]);
  });
});
