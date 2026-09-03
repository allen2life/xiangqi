export const CONFIG = {
  BOARD_COLS: 7,
  BOARD_ROWS: 7,
  CELL_SIZE: 60,
  TILT_ANGLE: 0,
  PIECE_RADIUS: 17,
  PIECE_FONT_SIZE: 18,
  ZONE_DOT_RADIUS: 8,
  COLORS: {
    BG: '#1a1a2e',
    GRID_LINE: 0x6a5a3a,
    RIVER_AREA: 0x16213e,
    PLAYER_FILL: 0xb83a2a,       // 朱砂红
    PLAYER_STROKE: 0xd4af37,     // gold
    ENEMY_FILL: 0x1a2a3a,        // 更深蓝黑
    ENEMY_STROKE: 0xd4af37,      // gold (will be dimmed via alpha in renderer)
    FORBIDDEN_ZONE: 0xff0000,
    VALID_PLACEMENT: 0xffd700,
    SKILL_RANGE: 0xff8833,
    HAND_BG: 0x5a5a9a,
    HAND_SELECTED: 0xffaa00,
    CONFIRM_BTN: 0x44aa44,
    TEXT_WHITE: 0xffffff,
  },
  GRADIENT: {
    BG_TOP: '#1a1a2e',
    BG_MID: '#16213e',
    BG_BOTTOM: '#0f3460',
  },
  GLASS: {
    FILL: 0xffffff,
    FILL_ALPHA: 0.08,
    BORDER: 0xffffff,
    BORDER_ALPHA: 0.15,
    RADIUS: 12,
  },
  SEMANTIC: {
    TURN: 0x2ecc71,
    SCORE: 0xffd700,
    STEPS: 0x3498db,
    ENEMY: 0xe74c3c,
    TEXT_PRIMARY: 0xffffff,
    TEXT_SECONDARY: 0xffffff,
  },
  ALPHA: {
    FORBIDDEN_ZONE: 0.35,
    PLACED_PREVIEW: 0.6,
    SKILL_PREVIEW: 0.2,
    VALID_PLACEMENT: 0.18,
  },
  ANIM: {
    PLACE: 0.3,
    RESOLVE: 0.4,
    ZONE_APPEAR: 0.25,
  },
} as const;

export interface ItemDef {
  id: string;
  name: string;
  nameEn?: string;
  desc: string;
  descEn?: string;
  icon: string;
  iconFile: string;
  category: string;
}

export const ITEM_DEFS: Record<string, ItemDef> = {
  undo:   { id: 'undo',   name: '悔棋令', nameEn: 'Undo', desc: '回到上一回合开始的状态', descEn: 'Undo to the beginning of the previous turn', icon: '↩',  iconFile: 'undo_64.png',  category: 'consumable' },
  redraw: { id: 'redraw', name: '换手卡', nameEn: 'Redraw', desc: '重新抽取手牌',          descEn: 'Redraw all hand pieces',                          icon: '⟳',  iconFile: 'redraw_64.png',  category: 'consumable' },
  unseal: { id: 'unseal', name: '解禁符', nameEn: 'Unseal', desc: '解除本回合所有禁区',    descEn: 'Remove all forbidden zones for this turn',        icon: '⛓',  iconFile: 'unseal_64.png',  category: 'consumable' },
  handSet:{ id: 'handSet',name: '手牌卡', nameEn: 'Hand Set', desc: '从所有棋子中选择3个作为手牌', descEn: 'Select 3 pieces from all types as your hand', icon: '🃏', iconFile: 'handset_64.png', category: 'consumable' },
  provision_wagon: { id: 'provision_wagon', name: '木牛流马', nameEn: 'Wooden Ox', desc: '+5 粮草上限，可叠加（用过即失 ★2）', descEn: '+5 provisions cap, stackable (using it forfeits ★2)', icon: '粮', iconFile: 'provision_wagon_64.png', category: 'consumable' },
  loong_soul: { id: 'loong_soul', name: '龙魂', nameEn: 'Loong Soul', desc: '龙息淬炼所得，集9魂可换一枚龙棋', descEn: 'Collect 9 to forge a Loong Piece', icon: '龙', iconFile: 'loong_soul_64.png', category: 'soul' },
  loong: { id: 'loong', name: '龙棋',   nameEn: 'Loong Piece', desc: '龍乂清野',  descEn: 'Loong\'s Wild Clearing',    icon: '🐉', iconFile: 'loong_64.png', category: 'ultimate' },
  // ── 召唤令增强棋子：落场后作为常驻棋子，攻击形态同基础棋子 ──
  horse_iron:      { id: 'horse_iron',      name: '重骑召唤令', nameEn: 'Iron Horse', desc: '“马”的增强版，可攻击石像', descEn: 'Enhanced Horse, can attack statues', icon: '骑', iconFile: 'horse_iron_64.png', category: 'ultimate' },
  elephant_mengma: { id: 'elephant_mengma', name: '猛犸象召唤令', nameEn: 'Mammoth', desc: '“象”的增强版，可攻击石像', descEn: 'Enhanced Elephant, can attack statues', icon: '犸', iconFile: 'elephant_mengma_64.png', category: 'ultimate' },
  chariot_tank:    { id: 'chariot_tank',    name: '铁甲车召唤令', nameEn: 'Tank Chariot', desc: '“车”的增强版，可攻击石像', descEn: 'Enhanced Chariot, can attack statues', icon: '甲', iconFile: 'chariot_tank_64.png', category: 'ultimate' },
  pawn_engineer:   { id: 'pawn_engineer',  name: '工兵召唤令', nameEn: 'Engineer Pawn', desc: '“兵”的增强版，可无视禁区放置', descEn: 'Enhanced Pawn, ignores forbidden zones', icon: '工', iconFile: 'pawn_engineer_64.png', category: 'ultimate' },
};

export const CATEGORY_LABELS: Record<string, [zh: string, en: string]> = {
  all: ['全部', 'All'],
  consumable: ['卡令', 'Cards'],
  ultimate: ['英雄', 'Heroes'],
};
