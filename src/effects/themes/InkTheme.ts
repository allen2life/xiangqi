import { PieceType } from '../../core/types';
import type { EffectTheme } from '../EffectTheme';

export const INK_THEME: EffectTheme = {
  name: '水墨',
  palettes: {
    primary: 0x222222,
    secondary: 0x666666,
    accent: 0xcc4444,
  },
  effects: {
    [PieceType.PAWN]: {
      cast: { duration: 0.2, type: 'contract' },
      travel: { duration: 0.25, type: 'dash' },
      hit: { duration: 0.3, type: 'bloom', particleCount: 4 },
      defeat: { duration: 0.25, type: 'pop' },
    },
    [PieceType.CHARIOT]: {
      cast: { duration: 0.35, type: 'pulse' },
      travel: { duration: 0.3, type: 'line' },
      hit: { duration: 0.35, type: 'pierce', particleCount: 6 },
      defeat: { duration: 0.35, type: 'shatter' },
      ripple: { duration: 0.4, type: 'mist', radius: 60 },
    },
    [PieceType.CANNON]: {
      cast: { duration: 0.4, type: 'contract' },
      travel: { duration: 0.4, type: 'arc' },
      hit: { duration: 0.4, type: 'explode', particleCount: 10 },
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.5, type: 'ring', radius: 80 },
    },
    [PieceType.HORSE]: {
      cast: { duration: 0.3, type: 'spin' },
      travel: { duration: 0.35, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.3, type: 'stamp', particleCount: 6 },
      defeat: { duration: 0.3, type: 'ink_fade' },
      ripple: { duration: 0.35, type: 'splash', radius: 50 },
    },
    [PieceType.ELEPHANT]: {
      cast: { duration: 0.35, type: 'spin' },
      travel: { duration: 0.35, type: 'arc' },
      hit: { duration: 0.35, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.35, type: 'dissolve' },
      ripple: { duration: 0.4, type: 'fog', radius: 70 },
    },
    [PieceType.ADVISOR]: {
      cast: { duration: 0.3, type: 'spin' },
      travel: { duration: 0.25, type: 'slash' },
      hit: { duration: 0.3, type: 'cross', particleCount: 4 },
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.35, type: 'fog', radius: 45 },
    },
    [PieceType.GENERAL]: {
      cast: { duration: 0.4, type: 'palace_seal' },
      travel: { duration: 0.35, type: 'decree_wave' },
      hit: { duration: 0.35, type: 'stamp', particleCount: 12 },
      defeat: { duration: 0.35, type: 'shatter' },
      ripple: { duration: 0.45, type: 'palace_grid', radius: 75 },
    },
    // ── 英雄棋子（召唤令）──
    [PieceType.HORSE_IRON]: {
      cast: { duration: 0.3, type: 'pulse' },          // 重骑：蓄力
      travel: { duration: 0.35, type: 'dash' },        // 冲刺
      hit: { duration: 0.3, type: 'pierce', particleCount: 8 },  // 穿刺破甲
      defeat: { duration: 0.3, type: 'shatter' },
      ripple: { duration: 0.35, type: 'splash', radius: 55 },
    },
    [PieceType.ELEPHANT_MENMA]: {
      cast: { duration: 0.35, type: 'gather_up' },     // 猛犸：践踏前兆
      travel: { duration: 0.4, type: 'multi_arc', segments: 8 },  // 多线践踏
      hit: { duration: 0.35, type: 'stamp', particleCount: 10 },  // 践踏印章
      defeat: { duration: 0.35, type: 'dissolve' },
      ripple: { duration: 0.4, type: 'ring', radius: 75 },
    },
    [PieceType.CHARIOT_TANK]: {
      cast: { duration: 0.35, type: 'contract' },      // 铁甲车：装甲蓄力
      travel: { duration: 0.35, type: 'line' },        // 冲击线
      hit: { duration: 0.35, type: 'explode', particleCount: 12 },  // 破阵爆裂
      defeat: { duration: 0.35, type: 'dissolve' },
      ripple: { duration: 0.4, type: 'ring', radius: 65 },
    },
    [PieceType.PAWN_ENGINEER]: {
      cast: { duration: 0.25, type: 'spin' },
      travel: { duration: 0.25, type: 'line' },
      hit: { duration: 0.3, type: 'cross', particleCount: 6 },
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
