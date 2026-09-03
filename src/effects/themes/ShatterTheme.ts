import { PieceType } from '../../core/types';
import type { EffectTheme } from '../EffectTheme';

export const SHATTER_THEME: EffectTheme = {
  name: '碎墨',
  palettes: {
    primary: 0x4a3728,   // deep wood-brown
    secondary: 0x8b6914,  // ochre
    accent: 0xd4a04a,     // amber
  },
  effects: {
    [PieceType.PAWN]: {
      cast: { duration: 0.2, type: 'char_spin' },
      travel: { duration: 0.25, type: 'char_fly' },
      hit: { duration: 0.3, type: 'char_explode', particleCount: 6 },
      defeat: { duration: 0.25, type: 'char_shatter' },
      ripple: { duration: 0.3, type: 'ring', radius: 40 },
    },
    [PieceType.CHARIOT]: {
      cast: { duration: 0.35, type: 'char_spin' },
      travel: { duration: 0.3, type: 'char_fly' },
      hit: { duration: 0.35, type: 'char_explode', particleCount: 8 },
      defeat: { duration: 0.35, type: 'char_shatter' },
      ripple: { duration: 0.4, type: 'mist', radius: 60 },
    },
    [PieceType.CANNON]: {
      cast: { duration: 0.4, type: 'char_spin' },
      travel: { duration: 0.4, type: 'char_fly' },
      hit: { duration: 0.4, type: 'char_explode', particleCount: 12 },
      defeat: { duration: 0.3, type: 'char_shatter' },
      ripple: { duration: 0.5, type: 'ring', radius: 80 },
    },
    [PieceType.HORSE]: {
      cast: { duration: 0.3, type: 'char_spin' },
      travel: { duration: 0.35, type: 'char_fly' },
      hit: { duration: 0.3, type: 'char_explode', particleCount: 8 },
      defeat: { duration: 0.3, type: 'char_shatter' },
      ripple: { duration: 0.35, type: 'splash', radius: 50 },
    },
    [PieceType.ELEPHANT]: {
      cast: { duration: 0.35, type: 'char_spin' },
      travel: { duration: 0.35, type: 'char_fly' },
      hit: { duration: 0.35, type: 'char_explode', particleCount: 10 },
      defeat: { duration: 0.35, type: 'char_shatter' },
      ripple: { duration: 0.4, type: 'fog', radius: 70 },
    },
    [PieceType.ADVISOR]: {
      cast: { duration: 0.3, type: 'char_spin' },
      travel: { duration: 0.25, type: 'char_fly' },
      hit: { duration: 0.3, type: 'char_explode', particleCount: 6 },
      defeat: { duration: 0.3, type: 'char_shatter' },
      ripple: { duration: 0.35, type: 'fog', radius: 45 },
    },
    [PieceType.GENERAL]: {
      cast: { duration: 0.4, type: 'char_spin' },
      travel: { duration: 0.3, type: 'char_fly' },
      hit: { duration: 0.35, type: 'char_explode', particleCount: 14 },
      defeat: { duration: 0.35, type: 'char_shatter' },
      ripple: { duration: 0.45, type: 'ring', radius: 90 },
    },
    // ── 英雄棋子（召唤令）：char_* 与全主题一致，shatterPool 已收录其图标笔画 ──
    [PieceType.HORSE_IRON]: {
      cast: { duration: 0.3, type: 'char_spin' },
      travel: { duration: 0.35, type: 'char_fly' },
      hit: { duration: 0.3, type: 'char_explode', particleCount: 10 },
      defeat: { duration: 0.3, type: 'char_shatter' },
      ripple: { duration: 0.35, type: 'splash', radius: 55 },
    },
    [PieceType.ELEPHANT_MENMA]: {
      cast: { duration: 0.35, type: 'char_spin' },
      travel: { duration: 0.4, type: 'char_fly' },
      hit: { duration: 0.35, type: 'char_explode', particleCount: 12 },
      defeat: { duration: 0.35, type: 'char_shatter' },
      ripple: { duration: 0.4, type: 'ring', radius: 75 },
    },
    [PieceType.CHARIOT_TANK]: {
      cast: { duration: 0.35, type: 'char_spin' },
      travel: { duration: 0.35, type: 'char_fly' },
      hit: { duration: 0.35, type: 'char_explode', particleCount: 10 },
      defeat: { duration: 0.35, type: 'char_shatter' },
      ripple: { duration: 0.4, type: 'mist', radius: 65 },
    },
    [PieceType.PAWN_ENGINEER]: {
      cast: { duration: 0.25, type: 'char_spin' },
      travel: { duration: 0.25, type: 'char_fly' },
      hit: { duration: 0.3, type: 'char_explode', particleCount: 8 },
      defeat: { duration: 0.25, type: 'char_shatter' },
      ripple: { duration: 0.3, type: 'ring', radius: 45 },
    },
  },
  kingsMeeting: {
    cast: { duration: 0.5, type: 'beam_clash' },
    travel: { duration: 0.4, type: 'triple_sweep' },
    hit: { duration: 0.35, type: 'cross', particleCount: 16 },
    defeat: { duration: 0.35, type: 'shatter' },
    ripple: { duration: 0.45, type: 'palace_grid', radius: 90 },
  },
};
