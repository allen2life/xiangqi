import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('../i18n', () => ({
  getLang: vi.fn().mockReturnValue('zh'),
}));

import { CAMPAIGN_LEVEL_COUNT, getFormationName, getFormationTip, getLevelMeta } from './levelMeta';

describe('Campaign level metadata & 20 handcrafted levels', () => {
  it('defines metadata, Chinese/English names and tips for levels 1..20', () => {
    expect(CAMPAIGN_LEVEL_COUNT).toBe(20);
    for (let lv = 1; lv <= CAMPAIGN_LEVEL_COUNT; lv++) {
      const meta = getLevelMeta(lv);
      expect(meta).not.toBeNull();
      expect(meta!.nameZh.length).toBeGreaterThan(0);
      expect(meta!.nameEn.length).toBeGreaterThan(0);
      expect(meta!.tipZh.length).toBeGreaterThan(0);
      expect(meta!.tipEn.length).toBeGreaterThan(0);
      expect(getFormationName(lv)).toBe(meta!.nameZh);
      expect(getFormationTip(lv)).toBe(meta!.tipZh);
    }
    expect(getLevelMeta(21)).toBeNull();
  });

  it('validates all 20 level JSON files have valid bounds, zero coordinate overlaps, and generals in palace', () => {
    const levelsDir = path.resolve(__dirname, '../../engine/levels');
    for (let lv = 1; lv <= CAMPAIGN_LEVEL_COUNT; lv++) {
      const file = path.join(levelsDir, `level_${1000 + lv}.json`);
      expect(fs.existsSync(file)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(raw.levelId).toBe(1000 + lv);
      const { cols, rows } = raw.board;
      expect(cols).toBeGreaterThanOrEqual(7);
      expect(rows).toBeGreaterThanOrEqual(7);
      expect(raw.enemies.length).toBeGreaterThan(0);
      expect(raw.handQueue.length).toBeGreaterThanOrEqual(12);

      const used = new Set<string>();
      const cc = Math.floor(cols / 2);
      for (const item of [...raw.enemies, ...raw.obstacles]) {
        expect(item.col).toBeGreaterThanOrEqual(0);
        expect(item.col).toBeLessThan(cols);
        expect(item.row).toBeGreaterThanOrEqual(0);
        expect(item.row).toBeLessThan(rows);
        const key = `${item.col},${item.row}`;
        expect(used.has(key)).toBe(false);
        used.add(key);

        if (item.type === 'general') {
          expect(item.col).toBeGreaterThanOrEqual(cc - 1);
          expect(item.col).toBeLessThanOrEqual(cc + 1);
          expect(item.row).toBeGreaterThanOrEqual(0);
          expect(item.row).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
