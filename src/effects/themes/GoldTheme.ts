import { PieceType } from '../../core/types';
import type { EffectTheme } from '../EffectTheme';

/**
 * 金銮主题：与水墨共享结构骨架，但 hit 类型整体偏向 bloom/stamp，
 * 营造"金光绽放、印章加冕"的辉煌感，而非水墨的"笔锋切割"。
 * 调色板走金/铜/琥珀。
 */
export const GOLD_THEME: EffectTheme = {
  name: '金銮',
  palettes: {
    primary: 0xccaa44,
    secondary: 0x887722,
    accent: 0xffdd66,
  },
  effects: {
    [PieceType.PAWN]: {
      cast: { duration: 0.12, type: 'contract' },
      travel: { duration: 0.14, type: 'dash' },
      hit: { duration: 0.16, type: 'stamp', particleCount: 4 },
      defeat: { duration: 0.14, type: 'pop' },
      ripple: { duration: 0.18, type: 'ring', radius: 35 },
    },
    [PieceType.CHARIOT]: {
      cast: { duration: 0.16, type: 'pulse' },
      travel: { duration: 0.16, type: 'line' },
      hit: { duration: 0.18, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.18, type: 'shatter' },
      ripple: { duration: 0.22, type: 'ring', radius: 60 },
    },
    [PieceType.CANNON]: {
      cast: { duration: 0.18, type: 'pulse' },
      travel: { duration: 0.20, type: 'arc' },
      hit: { duration: 0.22, type: 'explode', particleCount: 12 },
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.26, type: 'ring', radius: 80 },
    },
    [PieceType.HORSE]: {
      cast: { duration: 0.15, type: 'gather_up' },
      travel: { duration: 0.18, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.16, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.16, type: 'ink_fade' },
      ripple: { duration: 0.20, type: 'splash', radius: 50 },
    },
    [PieceType.ELEPHANT]: {
      cast: { duration: 0.16, type: 'pulse' },
      travel: { duration: 0.18, type: 'arc' },
      hit: { duration: 0.18, type: 'stamp', particleCount: 8 },
      defeat: { duration: 0.18, type: 'dissolve' },
      ripple: { duration: 0.22, type: 'fog', radius: 70 },
    },
    [PieceType.ADVISOR]: {
      cast: { duration: 0.14, type: 'gather_up' },
      travel: { duration: 0.14, type: 'slash' },
      hit: { duration: 0.16, type: 'bloom', particleCount: 6 },
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.20, type: 'fog', radius: 45 },
    },
    [PieceType.GENERAL]: {
      cast: { duration: 0.18, type: 'seal_press' },
      travel: { duration: 0.18, type: 'decree_wave' },
      hit: { duration: 0.18, type: 'stamp', particleCount: 14 },
      defeat: { duration: 0.18, type: 'shatter' },
      ripple: { duration: 0.24, type: 'palace_grid', radius: 75 },
    },
    // ── 英雄棋子（召唤令）──
    [PieceType.HORSE_IRON]: {
      cast: { duration: 0.15, type: 'gather_up' },
      travel: { duration: 0.18, type: 'dash' },
      hit: { duration: 0.16, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.20, type: 'ring', radius: 55 },
    },
    [PieceType.ELEPHANT_MENMA]: {
      cast: { duration: 0.16, type: 'pulse' },
      travel: { duration: 0.20, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.18, type: 'stamp', particleCount: 10 },
      defeat: { duration: 0.18, type: 'dissolve' },
      ripple: { duration: 0.22, type: 'fog', radius: 75 },
    },
    [PieceType.CHARIOT_TANK]: {
      cast: { duration: 0.16, type: 'pulse' },
      travel: { duration: 0.18, type: 'line' },
      hit: { duration: 0.18, type: 'bloom', particleCount: 12 },
      defeat: { duration: 0.18, type: 'shatter' },
      ripple: { duration: 0.22, type: 'ring', radius: 65 },
    },
    [PieceType.PAWN_ENGINEER]: {
      cast: { duration: 0.12, type: 'contract' },
      travel: { duration: 0.14, type: 'dash' },
      hit: { duration: 0.16, type: 'stamp', particleCount: 6 },
      defeat: { duration: 0.14, type: 'pop' },
      ripple: { duration: 0.18, type: 'ring', radius: 45 },
    },
  },
  kingsMeeting: {
    cast: { duration: 0.30, type: 'beam_clash' },
    travel: { duration: 0.25, type: 'triple_sweep' },
    hit: { duration: 0.22, type: 'cross', particleCount: 16 },
    defeat: { duration: 0.20, type: 'shatter' },
    ripple: { duration: 0.28, type: 'palace_grid', radius: 90 },
  },
};
