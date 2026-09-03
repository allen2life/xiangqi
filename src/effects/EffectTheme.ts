import { PieceType } from '../core/types';

export interface CastEffect {
  duration: number;
  type: 'spin' | 'pulse' | 'contract' | 'gather_up' | 'char_spin'
    | 'palace_seal' | 'seal_press' | 'beam_clash';
}

export interface TravelEffect {
  duration: number;
  type: 'line' | 'arc' | 'multi_arc' | 'pulse_wave' | 'slash' | 'dash' | 'none' | 'char_fly'
    | 'decree_wave' | 'triple_sweep';
  segments?: number;
}

export interface HitEffect {
  duration: number;
  type: 'explode' | 'slice' | 'stamp' | 'cross' | 'bloom' | 'pierce' | 'char_explode';
  particleCount?: number;
}

export interface DefeatEffect {
  duration: number;
  type: 'ink_fade' | 'shatter' | 'dissolve' | 'melt' | 'pop' | 'char_shatter';
}

export interface RippleEffect {
  duration: number;
  type: 'ring' | 'mist' | 'splash' | 'fog' | 'palace_grid';
  radius?: number;
}

export interface SkillEffectDef {
  cast: CastEffect;
  travel: TravelEffect;
  hit: HitEffect;
  defeat: DefeatEffect;
  ripple?: RippleEffect;
}

export interface EffectTheme {
  name: string;
  palettes: {
    primary: number;
    secondary: number;
    accent: number;
  };
  effects: Partial<Record<PieceType, SkillEffectDef>>;
  /** 王见王 专属 def（不绑定 PieceType，由 GameScene 在 KM 步骤显式调用） */
  kingsMeeting?: SkillEffectDef;
}

const REQUIRED_PIECE_TYPES: PieceType[] = [
  PieceType.PAWN,
  PieceType.CHARIOT,
  PieceType.CANNON,
  PieceType.HORSE,
  PieceType.ELEPHANT,
  PieceType.ADVISOR,
  PieceType.GENERAL,
  // 英雄棋子（召唤令）：缺失 def 时 resolveDef 返回 undefined，会在 playSteps 抛错
  // 导致整条结算链（动效/飘分/销毁回调）中断，故必须纳入兜底校验
  PieceType.HORSE_IRON,
  PieceType.ELEPHANT_MENMA,
  PieceType.CHARIOT_TANK,
  PieceType.PAWN_ENGINEER,
];

/**
 * 校验主题配置完整性。缺少 PieceType 时回填一条默认 def，并在开发期 warn。
 * 返回值是一个新的、补全过的 EffectTheme（不修改入参）。
 */
export function validateTheme(theme: EffectTheme): EffectTheme {
  const effects = { ...theme.effects };
  for (const pt of REQUIRED_PIECE_TYPES) {
    if (!effects[pt]) {
      console.warn(`[EffectTheme] theme "${theme.name}" missing config for ${pt}, fallback to default`);
      effects[pt] = {
        cast: { duration: 0.25, type: 'pulse' },
        travel: { duration: 0.3, type: 'line' },
        hit: { duration: 0.3, type: 'explode', particleCount: 6 },
        defeat: { duration: 0.3, type: 'ink_fade' },
        ripple: { duration: 0.35, type: 'ring', radius: 50 },
      };
    }
  }
  return { ...theme, effects };
}
