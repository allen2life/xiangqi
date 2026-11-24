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
      cast: { duration: 0.12, type: 'contract' },
      travel: { duration: 0.14, type: 'dash' },
      hit: { duration: 0.16, type: 'bloom', particleCount: 4 },
      defeat: { duration: 0.14, type: 'pop' },
    },
    [PieceType.CHARIOT]: {
      cast: { duration: 0.16, type: 'pulse' },
      travel: { duration: 0.16, type: 'line' },
      hit: { duration: 0.18, type: 'pierce', particleCount: 6 },
      defeat: { duration: 0.18, type: 'shatter' },
      ripple: { duration: 0.22, type: 'mist', radius: 60 },
    },
    [PieceType.CANNON]: {
      cast: { duration: 0.18, type: 'contract' },
      travel: { duration: 0.20, type: 'arc' },
      hit: { duration: 0.22, type: 'explode', particleCount: 10 },
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.26, type: 'ring', radius: 80 },
    },
    [PieceType.HORSE]: {
      cast: { duration: 0.15, type: 'spin' },
      travel: { duration: 0.18, type: 'multi_arc', segments: 8 },
      hit: { duration: 0.16, type: 'stamp', particleCount: 6 },
      defeat: { duration: 0.16, type: 'ink_fade' },
      ripple: { duration: 0.20, type: 'splash', radius: 50 },
    },
    [PieceType.ELEPHANT]: {
      cast: { duration: 0.16, type: 'spin' },
      travel: { duration: 0.18, type: 'arc' },
      hit: { duration: 0.18, type: 'bloom', particleCount: 8 },
      defeat: { duration: 0.18, type: 'dissolve' },
      ripple: { duration: 0.22, type: 'fog', radius: 70 },
    },
    [PieceType.ADVISOR]: {
      cast: { duration: 0.14, type: 'spin' },
      travel: { duration: 0.14, type: 'slash' },
      hit: { duration: 0.16, type: 'cross', particleCount: 4 },
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.20, type: 'fog', radius: 45 },
    },
    [PieceType.GENERAL]: {
      cast: { duration: 0.18, type: 'palace_seal' },
      travel: { duration: 0.18, type: 'decree_wave' },
      hit: { duration: 0.18, type: 'stamp', particleCount: 12 },
      defeat: { duration: 0.18, type: 'shatter' },
      ripple: { duration: 0.24, type: 'palace_grid', radius: 75 },
    },
    // ── 英雄棋子（召唤令）──
    [PieceType.HORSE_IRON]: {
      cast: { duration: 0.15, type: 'pulse' },          // 重骑：蓄力
      travel: { duration: 0.18, type: 'dash' },        // 冲刺
      hit: { duration: 0.16, type: 'pierce', particleCount: 8 },  // 穿刺破甲
      defeat: { duration: 0.16, type: 'shatter' },
      ripple: { duration: 0.20, type: 'splash', radius: 55 },
    },
    [PieceType.ELEPHANT_MENMA]: {
      cast: { duration: 0.16, type: 'gather_up' },     // 猛犸：践踏前兆
      travel: { duration: 0.20, type: 'multi_arc', segments: 8 },  // 多线践踏
      hit: { duration: 0.18, type: 'stamp', particleCount: 10 },  // 践踏印章
      defeat: { duration: 0.18, type: 'dissolve' },
      ripple: { duration: 0.22, type: 'ring', radius: 75 },
    },
    [PieceType.CHARIOT_TANK]: {
      cast: { duration: 0.16, type: 'contract' },      // 铁甲车：装甲蓄力
      travel: { duration: 0.18, type: 'line' },        // 冲击线
      hit: { duration: 0.18, type: 'explode', particleCount: 12 },  // 破阵爆裂
      defeat: { duration: 0.18, type: 'dissolve' },
      ripple: { duration: 0.22, type: 'ring', radius: 65 },
    },
    [PieceType.PAWN_ENGINEER]: {
      cast: { duration: 0.12, type: 'spin' },
      travel: { duration: 0.14, type: 'line' },
      hit: { duration: 0.16, type: 'cross', particleCount: 6 },
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
