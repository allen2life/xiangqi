import { describe, expect, it } from 'vitest';
import { createLocalRecordBinding } from '../core/runBinding';

describe('lightweight run binding', () => {
  it('creates a local per-run binding without an API request', () => {
    const binding = createLocalRecordBinding('ab'.repeat(32), 7, 1_000);

    expect(binding.hash).toBe('ab'.repeat(32));
    expect(binding.levelId).toBe(7);
    expect(binding.rulesetId).toBe('xiangqiblast-v9-fullhand');
    expect(binding.runNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.issuedAt).toBe(1_000);
    expect(binding.expiresAt).toBeGreaterThan(binding.issuedAt);
  });
});
