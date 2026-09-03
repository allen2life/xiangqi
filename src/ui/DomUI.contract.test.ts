import { describe, expect, it } from 'vitest';
import { ITEM_DEFS } from '../config';
import { getItemDetailAction, PIECE_ICON_FILES, PIECE_LABELS, projectInventoryWithSessionSouls } from './DomUI';

describe('forge-only item details', () => {
  it.each([0, 1, 7])('keeps consumables forgeable at inventory quantity %i', (quantity) => {
    expect(getItemDetailAction('undo', quantity)).toBe('forge');
    expect(getItemDetailAction('redraw', quantity)).toBe('forge');
    expect(getItemDetailAction('unseal', quantity)).toBe('forge');
    expect(getItemDetailAction('handSet', quantity)).toBe('forge');
  });

  it('never turns forge or collectible details into use actions', () => {
    expect(getItemDetailAction('loong', 3)).toBe('forge');
    expect(getItemDetailAction('loong_soul', 9)).toBe('info');
  });
});

describe('loong soul display contract', () => {
  it('shows authoritative inventory plus souls earned in the current unpublished run', () => {
    expect(projectInventoryWithSessionSouls({ loong_soul: 5, undo: 2 }, 3)).toEqual({
      loong_soul: 8,
      undo: 2,
    });
  });

  it('does not subtract inventory for an invalid negative session count', () => {
    expect(projectInventoryWithSessionSouls({ loong_soul: 5 }, -2).loong_soul).toBe(5);
  });
});

describe('loong visual contract', () => {
  it('uses the loong icon and 龙 fallback in item, hand, and board mappings', () => {
    expect(ITEM_DEFS.loong.iconFile).toBe('loong_64.png');
    expect(ITEM_DEFS.loong.icon).not.toBe('?');
    expect(PIECE_ICON_FILES.loong_flame).toBe('loong_64.png');
    expect(PIECE_LABELS.loong_flame).toBe('龙');
  });
});
