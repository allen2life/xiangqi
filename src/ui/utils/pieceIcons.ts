/**
 * Piece icon/label utilities — pure functions, no `this` dependency.
 * Extracted from DomUI.ts for modularity.
 */

import { imageWithFallback } from './domHelpers';

export const PIECE_LABELS: Record<string, string> = {
  pawn: '兵', chariot: '車', cannon: '炮', horse: '馬',
  elephant: '相', advisor: '仕', general: '帥', loong_flame: '龙', loong_piece: '龙',
  // 召唤令增强棋子
  horse_iron: '骑', elephant_mengma: '犸', chariot_tank: '甲', pawn_engineer: '工',
};
export const PIECE_ICON_FILES: Record<string, string> = {
  pawn: 'pawn_64.png', chariot: 'chariot_64.png', cannon: 'cannon_64.png', horse: 'horse_64.png',
  elephant: 'elephant_enemy_64.png', advisor: 'advisor_enemy_64.png', general: 'general_64.png',
  loong_flame: 'loong_64.png', loong_piece: 'loong_64.png',
  horse_iron: 'horse_iron_64.png', elephant_mengma: 'elephant_mengma_64.png',
  chariot_tank: 'chariot_tank_64.png', pawn_engineer: 'pawn_engineer_64.png',
};

/** Helper: get translated item name (English uses nameEn, Chinese/fallback uses name) */
export function itemName(def: { name: string; nameEn?: string }): string {
  return document.documentElement.lang === 'en' && def.nameEn ? def.nameEn : def.name;
}

/** Helper: render an item icon — PNG if available, text fallback */
export function itemIcon(def: { iconFile?: string; id?: string; icon: string }): string {
  return def.iconFile
    ? imageWithFallback('icon-img-wrap', `${import.meta.env.BASE_URL}icons/${def.iconFile}`, def.id === 'loong' ? '龙' : def.icon, itemName(def as any))
    : def.icon;
}

/** Helper: render a piece icon image tag for the hand panel */
export function pieceIconTag(pieceType: string, label: string): string {
  const f = PIECE_ICON_FILES[pieceType];
  return f
    ? imageWithFallback('piece-icon-wrap', `${import.meta.env.BASE_URL}icons/${f}`, label || (pieceType === 'loong_flame' ? '龙' : ''), label)
    : label;
}
