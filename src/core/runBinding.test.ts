import { describe, expect, it } from 'vitest';
import { createPublishBindingFields, createResumedPublicationState, mapRunStartToRecordBinding } from './runBinding';

describe('record binding field mapping', () => {
  const response = {
    runNonce: 'ab'.repeat(32),
    issuedAt: Date.now() - 1_000,
    expiresAt: Date.now() + 60_000,
    levelId: 4,
    rulesetId: 'xiangqiblast-v9-fullhand',
  };

  it('maps server fields into saved binding and protocol-v4 publish fields', () => {
    const binding = mapRunStartToRecordBinding('aa'.repeat(32), 4, response);

    expect(binding).toEqual({ hash: 'aa'.repeat(32), ...response });
    expect(createPublishBindingFields({ recordBinding: binding }, 'aa'.repeat(32), 4)).toEqual({
      runNonce: 'ab'.repeat(32),
      recordProtocolVersion: 4,
      levelId: 4,
      rulesetId: 'xiangqiblast-v9-fullhand',
    });
  });

  it('rejects absent, failed, wrong-identity, and mismatched-level bindings', () => {
    expect(() => createPublishBindingFields({}, 'aa'.repeat(32), 4)).toThrow('err.binding_missing');
    expect(() => createPublishBindingFields({ recordPublishError: 'err.binding_expired' }, 'aa'.repeat(32), 4)).toThrow('err.binding_expired');
    const binding = mapRunStartToRecordBinding('aa'.repeat(32), 4, response);
    expect(() => createPublishBindingFields({ recordBinding: binding }, 'bb'.repeat(32), 4)).toThrow('err.binding_identity_mismatch');
    expect(() => createPublishBindingFields({ recordBinding: binding }, 'aa'.repeat(32), 5)).toThrow('err.binding_level_mismatch');
  });

  it('keeps a valid restored v4 state publishable and preserves explicit failures', () => {
    const binding = mapRunStartToRecordBinding('aa'.repeat(32), 4, response);
    const resumed = createResumedPublicationState({ recordBinding: binding }, 'aa'.repeat(32), 4);
    expect(createPublishBindingFields(resumed, 'aa'.repeat(32), 4).recordProtocolVersion).toBe(4);
    expect(createResumedPublicationState({ recordPublishError: 'err.binding_resume_invalid' }, 'aa'.repeat(32), 4)).toEqual({ recordPublishError: 'err.binding_resume_invalid' });
  });

  it('fails restored and publish binding validation closed for malformed, expired, or wrong identity data', () => {
    const binding = mapRunStartToRecordBinding('aa'.repeat(32), 4, response);
    expect(createResumedPublicationState({ recordBinding: { ...binding, runNonce: 'bad' } }, 'aa'.repeat(32), 4).recordPublishError).toBe('err.binding_nonce_invalid');
    expect(createResumedPublicationState({ recordBinding: binding }, 'bb'.repeat(32), 4).recordPublishError).toBe('err.binding_identity_mismatch');
    expect(() => createPublishBindingFields({ recordBinding: { ...binding, expiresAt: Date.now() - 1 } }, 'aa'.repeat(32), 4)).toThrow('err.binding_expired');
  });

  it('rejects malformed or expired server bindings before gameplay starts', () => {
    expect(() => mapRunStartToRecordBinding('aa'.repeat(32), 4, { ...response, runNonce: 'bad' })).toThrow('err.binding_server_invalid');
    expect(() => mapRunStartToRecordBinding('aa'.repeat(32), 4, { ...response, expiresAt: response.issuedAt })).toThrow('err.binding_server_time_invalid');
    expect(() => mapRunStartToRecordBinding('aa'.repeat(32), 4, { ...response, expiresAt: Date.now() - 1 })).toThrow('err.binding_server_time_invalid');
  });

  it('rejects a run-start response for a different level or ruleset', () => {
    expect(() => mapRunStartToRecordBinding('aa'.repeat(32), 5, response)).toThrow('err.binding_server_level_mismatch');
    expect(() => mapRunStartToRecordBinding('aa'.repeat(32), 4, { ...response, rulesetId: 'other' })).toThrow('err.binding_server_level_mismatch');
  });
});
