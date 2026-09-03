/**
 * 动效常量集中管理。所有数值单位为像素或秒。
 * 修改单个数值只需要在此处调整，避免跨文件 grep。
 */

// 通用尺寸
export const RING = {
  BASE_RADIUS: 30,
  CAST_RADIUS: 40,
  STAMP_RADIUS: 30,
  RIPPLE_DEFAULT: 60,
};

// 粒子相关
export const PARTICLE = {
  DEFAULT_COUNT: 8,
  DEFAULT_BURST_OUTER_RADIUS: 35,
  DEFAULT_BURST_INNER_RADIUS: 20,
  DEFAULT_BURST_HALO_RADIUS: 35,
  DOT_MIN_RADIUS: 2,
  DOT_MAX_RADIUS: 5,
  DEBRIS_MIN_SIZE: 2,
  DEBRIS_MAX_SIZE: 7,
  SHATTER_MIN_SIZE: 4,
  SHATTER_MAX_SIZE: 12,
};

// 飞行 / 拖尾
export const TRAVEL = {
  STROKE_WIDTH: 6,
  SLASH_HALF_LEN: 25,
  SLASH_WIDTH: 8,
  CROSS_DEFAULT_SIZE: 35,
  CROSS_WIDTH: 6,
  ARC_MAX_OFFSET: 40,         // arc/multi_arc 弧线偏移幅度
  PULSE_WAVE_REACH: 50,       // pulse_wave 单方向最远距离
  PULSE_WAVE_SEGMENTS: 4,
};

// 击碎 / 角色碎片
export const SHATTER = {
  STROKE_BASE_SCALE: 1.8,
  EXPLODE_FAST_SPEED_MIN: 35,
  EXPLODE_FAST_SPEED_RANGE: 25,
  EXPLODE_SLOW_SPEED_MIN: 20,
  EXPLODE_SLOW_SPEED_RANGE: 15,
  EXPLODE_LEN_THRESHOLD: 15,
  EXPLODE_GATHER_DUR: 0.12,
  DEFEAT_SPEED_MIN: 15,
  DEFEAT_SPEED_RANGE: 20,
  FLY_MIN_COUNT: 3,
  FLY_MAX_COUNT_EXTRA: 3,
  FLY_SCALE_MIN: 0.5,
  FLY_SCALE_RANGE: 0.2,
  FLY_MID_OFFSET: 30,
};

// 角色 cast
export const CHAR_SPIN = {
  INITIAL_SCALE: 0.85,
  SCALE_UP_TARGET: 0.95,
  TREMOR_AMPLITUDE: 5,
  TREMOR_ROTATION: 0.04,
  FADE_DURATION_RATIO: 0.25,
  TREMOR_PHASE_RATIO: 0.25,
  TREMOR_STEP_RATIO: 0.1,
  RANDOM_TREMOR_AMP: 6,
};

// 错峰
export const STAGGER = {
  PER_TARGET_DELAY: 0.06,   // 多目标每个目标延迟秒数
  PER_TARGET_MAX: 0.3,      // 累计上限
};

// 冲击 / hit-stop
export const IMPACT = {
  FLASH_DURATION: 0.06,      // impact frame 时长（秒）
  FLASH_ALPHA: 0.55,
  TARGET_PUNCH_SCALE: 0.18,  // 目标棋子被击中后的弹放幅度
  TARGET_PUNCH_DURATION: 0.18,
};

// hit-stop（每目标分量停顿）
export const HIT_STOP = {
  PER_TARGET: 0.05,   // 常规命中时间停顿
  FINAL: 0.15,        // 终局击杀延长版
};

// 屏幕震动（按击杀链规模分档，链末单次触发）
export const COMBO_SHAKE = {
  TIERS: [
    { minKills: 1, intensity: 0,  duration: 0    },  // 1-2 连击：无 shake
    { minKills: 3, intensity: 3,  duration: 0.18 },  // 3-4 连击：中
    { minKills: 5, intensity: 5,  duration: 0.24 },  // 5-7 连击：重
    { minKills: 8, intensity: 7,  duration: 0.30 },  // 8+ 连击：极重
  ],
  FINAL: { intensity: 8, duration: 0.4 },            // 终局击杀
};

// 终局事件独占手段
export const VIGNETTE = {
  ALPHA: 0.6,
  DURATION: 0.4,
};

export const SCREEN_FLASH = {
  ALPHA: 0.7,
  DURATION: 0.3,
};

export const SLOW_MO = {
  TIME_SCALE: 0.5,
  DURATION: 0.5,
};

// 主题切换过渡
export const THEME_TRANSITION = {
  FADE_DURATION: 0.2,
};

// 缓动
export const EASE = {
  POWER2_OUT: 'power2.out',
  POWER2_IN: 'power2.in',
  POWER3_OUT: 'power3.out',
  SINE_OUT: 'sine.out',
  SINE_IN_OUT: 'sine.inOut',
  BACK_OUT: 'back.out',
  POWER1_IN: 'power1.in',
} as const;

// 默认 fallback 配置（resolveDef 找不到时用）
export const DEFAULT_CAST_DURATION = 0.25;
export const DEFAULT_TRAVEL_DURATION = 0.3;
export const DEFAULT_HIT_DURATION = 0.3;
export const DEFAULT_DEFEAT_DURATION = 0.3;

// ─── 王见王（Kings' Meeting）专属常量 ────────────────────────────
export const KINGS_MEETING = {
  // beam_clash：双王对峙光束
  BEAM_WIDTH: 8,
  BEAM_GROW_DURATION_RATIO: 0.5,    // 前半段双向生长
  BEAM_CLASH_DURATION_RATIO: 0.5,   // 后半段中点相会爆发
  BEAM_CLASH_FLASH_RADIUS: 40,
  // triple_sweep：从中央射线向两侧扩散的光柱
  SWEEP_LINE_WIDTH: 14,
  SWEEP_LINE_LENGTH_MIN: 240,        // 光柱沿光束方向最小长度（实际按 cellSize*9 自适应，覆盖整盘）
  SWEEP_STAGGER: 0.08,               // 遗留：三条线错峰（已不用于单光柱路径）
  SWEEP_LINE_ALPHA: 0.55,
  SWEEP_PILLAR_SPREAD_RATIO: 0.35,   // 垂直扩散占 travel.duration 的比例（向两侧展开成 3 线宽）
  // 帅的舍身
  SACRIFICE_SCALE_UP: 1.25,
  SACRIFICE_SCALE_UP_DUR: 0.2,
  SACRIFICE_FLASH_DUR: 0.15,
  SACRIFICE_SHATTER_DUR: 0.35,
  SACRIFICE_TOTAL_DUR: 0.7,   // scale_up + flash + shatter，用于 timeline 占位
  // 双标题分时段
  TITLE_BONUS_DUR: 1000,             // 仅 bonus_kings_meeting 显示时长
  TITLE_VICTORY_DUR: 1500,           // victory_kings_meeting 显示时长
  TITLE_GAP: 300,                    // 两标题之间间隔
};

// ─── 坐镇中宫（GENERAL）加权 ─────────────────────────────────────
export const GENERAL_WEIGHT = {
  HIT_STOP: 0.08,                    // 帅命中停顿（高于常规 0.05）
  SHAKE_MIN_KILLS: 2,                // 帅 shake 起算阈值（低于常规 3）
};

// 九宫格 / 中宫 视觉
export const PALACE = {
  GRID_HALF_CELL: 1,                 // 印章格相对中心的偏移（3×3 = ±1）
  GRID_STROKE_WIDTH: 2,
  GRID_ALPHA: 0.7,
  SEAL_INNER_RADIUS: 18,
  SEAL_RING_RADIUS: 36,
};

// 金令符（decree_wave）参数
export const DECREE = {
  REACH: 80,                         // 单方向最远距离
  STROKE_WIDTH: 4,
  ALPHA: 0.8,
};
