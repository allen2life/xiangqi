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
      cast: { duration: 0.2, type: 'contract' },
      travel: { duration: 0.25, type: 'dash' },
      hit: { duration: 0.3, type: 'stamp', particleCount: 4 },
      defeat: { duration: 0.25, type: 'pop' },
      ripple: { duration: 0.3, type: 'ring', radius: 35 },
    },
    [PieceType.CHARIOT]: {
      cast: { duration: 0.35, type: 'pulse' },
      travel: { duration: 0.3, type: 'line' },
      hit: { duration: 0.35, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.35, type: 'shatter' },
      ripple: { duration: 0.4, type: 'ring', radius: 60 },
    },
    [PieceType.CANNON]: {
      cast: { duration: 0.4, type: 'pulse' },
      travel: { duration: 0.4, type: 'arc' },
      hit: { duration: 0.4, type: 'explode', particleCount: 12 },
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.5, type: 'ring', radius: 80 },
    },
    [PieceType.HORSE]: {
      cast: { duration: 0.3, type: 'gather_up' },
      travel: { duration: 0.35, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.3, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.3, type: 'ink_fade' },
      ripple: { duration: 0.35, type: 'splash', radius: 50 },
    },
    [PieceType.ELEPHANT]: {
      cast: { duration: 0.35, type: 'pulse' },
      travel: { duration: 0.35, type: 'arc' },
      hit: { duration: 0.35, type: 'stamp', particleCount: 8 },
      defeat: { duration: 0.35, type: 'dissolve' },
      ripple: { duration: 0.4, type: 'fog', radius: 70 },
    },
    [PieceType.ADVISOR]: {
      cast: { duration: 0.3, type: 'gather_up' },
      travel: { duration: 0.25, type: 'slash' },
      hit: { duration: 0.3, type: 'bloom', particleCount: 6 },
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.35, type: 'fog', radius: 45 },
    },
    [PieceType.GENERAL]: {
      cast: { duration: 0.4, type: 'seal_press' },
      travel: { duration: 0.35, type: 'decree_wave' },
      hit: { duration: 0.35, type: 'stamp', particleCount: 14 },
      defeat: { duration: 0.35, type: 'shatter' },
      ripple: { duration: 0.45, type: 'palace_grid', radius: 75 },
    },
    // ── 英雄棋子（召唤令）──
    [PieceType.HORSE_IRON]: {
      cast: { duration: 0.3, type: 'gather_up' },
      travel: { duration: 0.35, type: 'dash' },
      hit: { duration: 0.3, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.35, type: 'ring', radius: 55 },
    },
    [PieceType.ELEPHANT_MENMA]: {
      cast: { duration: 0.35, type: 'pulse' },
      travel: { duration: 0.4, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.35, type: 'stamp', particleCount: 10 },
      defeat: { duration: 0.35, type: 'dissolve' },
      ripple: { duration: 0.4, type: 'fog', radius: 75 },
    },
    [PieceType.CHARIOT_TANK]: {
      cast: { duration: 0.35, type: 'pulse' },
      travel: { duration: 0.35, type: 'line' },
      hit: { duration: 0.35, type: 'bloom', particleCount: 12 },
      defeat: { duration: 0.35, type: 'shatter' },
      ripple: { duration: 0.4, type: 'ring', radius: 65 },
    },
    [PieceType.PAWN_ENGINEER]: {
      cast: { duration: 0.25, type: 'contract' },
      travel: { duration: 0.25, type: 'dash' },
      hit: { duration: 0.3, type: 'stamp', particleCount: 6 },
      defeat: { duration: 0.25, type: 'pop' },
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
