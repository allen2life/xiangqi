import { getLang } from '../i18n';

export const CAMPAIGN_LEVEL_COUNT = 20;

export interface LevelMeta {
  level: number;
  nameZh: string;
  nameEn: string;
  tipZh: string;
  tipEn: string;
}

export const LEVEL_META_LIST: Record<number, LevelMeta> = {
  1: {
    level: 1,
    nameZh: '当头炮',
    nameEn: 'Central Cannon',
    tipZh: '炮落中宫，借炮架一炮四连杀',
    tipEn: 'Drop Cannon in the center to trigger a 4-kill barrage',
  },
  2: {
    level: 2,
    nameZh: '车马冷着',
    nameEn: 'Chariot & Knight',
    tipZh: '车破城池，马跃斜角收割残兵',
    tipEn: 'Break the City with Chariot, sweep flanks with Horse',
  },
  3: {
    level: 3,
    nameZh: '隔山镇石',
    nameEn: 'Stone Breaker',
    tipZh: '借炮架隔山打牛击破石像，留龙息采龙魂',
    tipEn: 'Use Cannon over a screen to shatter Statues for Loong Souls',
  },
  4: {
    level: 4,
    nameZh: '破卫斩将',
    nameEn: 'Guard Break',
    tipZh: '先清士象护卫破除青盾，再一击斩首敌将',
    tipEn: 'Eliminate Royal Guards to break the cyan shield, then decapitate',
  },
  5: {
    level: 5,
    nameZh: '双王照面',
    nameEn: "Kings' Meeting",
    tipZh: '打通中路石像与挡路兵，红帅落九宫触发王见王',
    tipEn: "Clear the center file and place General in palace for Kings' Meeting",
  },
  6: {
    level: 6,
    nameZh: '重炮绝杀',
    nameEn: 'Double Cannon',
    tipZh: '双炮连环借架轰击，一回合横扫中路',
    tipEn: 'Chain two Cannons along the file for a sweeping barrage',
  },
  7: {
    level: 7,
    nameZh: '卧槽马',
    nameEn: 'Corner Horse',
    tipZh: '马跳敌宫侧翼，多点连击破防',
    tipEn: 'Leap Horse to the palace flank for a multi-target fork',
  },
  8: {
    level: 8,
    nameZh: '双车错',
    nameEn: 'Twin Chariots',
    tipZh: '双车交替纵横切线，破城清兵一气呵成',
    tipEn: 'Alternate twin Chariots along ranks and files to clear Cities',
  },
  9: {
    level: 9,
    nameZh: '铁门栓',
    nameEn: 'Iron Bolt',
    tipZh: '中路炮车锁喉，先拆护卫再拔敌将',
    tipEn: 'Lock the center with Cannon & Chariot, strip Guards then General',
  },
  10: {
    level: 10,
    nameZh: '马后炮',
    nameEn: 'Horse & Cannon',
    tipZh: '马做炮架又兼连杀，双子协同清场',
    tipEn: 'Coordinate Horse and Cannon for overlapping strikes',
  },
  11: {
    level: 11,
    nameZh: '天地炮',
    nameEn: 'Heaven & Earth Cannon',
    tipZh: '纵横双炮立体轰炸，注意避开友军误伤',
    tipEn: 'Crossfire Cannons vertically and horizontally without ally fire',
  },
  12: {
    level: 12,
    nameZh: '双马饮泉',
    nameEn: 'Twin Horses',
    tipZh: '左右双马夹击九宫，巧避红色禁区收割',
    tipEn: 'Pincer the palace with dual Horses around forbidden zones',
  },
  13: {
    level: 13,
    nameZh: '大刀剜心',
    nameEn: 'Heart Piercer',
    tipZh: '车象强拆城墙与中宫护卫，直取核心',
    tipEn: 'Crush the central City & Guards with Chariot and Elephant',
  },
  14: {
    level: 14,
    nameZh: '海底捞月',
    nameEn: 'Moon Scoop',
    tipZh: '底线穿插破除石像，后排炮击反杀',
    tipEn: 'Infiltrate the back rank, break Statues and strike from behind',
  },
  15: {
    level: 15,
    nameZh: '夹车炮',
    nameEn: 'Chariot-Cannon Pincer',
    tipZh: '车炮夹击带盾敌将，亦可用帅王见王绝杀',
    tipEn: "Pincer the shielded General with Chariot & Cannon, or Kings' Meeting",
  },
  16: {
    level: 16,
    nameZh: '三子归边',
    nameEn: 'Flank Assault',
    tipZh: '车马炮集火单翼破口，瓦解密集禁区',
    tipEn: 'Focus Chariot, Horse & Cannon on one flank to crack the fortress',
  },
  17: {
    level: 17,
    nameZh: '大胆穿心',
    nameEn: 'Center Pierce',
    tipZh: '连破双石像打通中轴，收割龙息反制',
    tipEn: 'Shatter twin Statues down the center and harvest Loong Flames',
  },
  18: {
    level: 18,
    nameZh: '闷宫杀',
    nameEn: 'Smothered Palace',
    tipZh: '标准九路大盘首秀：先拔双士象护卫，再破中宫',
    tipEn: 'Full 9×10 Xiangqi board: strip Royal Guards, then strike palace',
  },
  19: {
    level: 19,
    nameZh: '侧面虎',
    nameEn: 'Side Tiger',
    tipZh: '标准大盘侧翼车马奇袭，兼顾破城与防误伤',
    tipEn: 'Full 9×10 flank Chariot-Horse ambush around twin Cities',
  },
  20: {
    level: 20,
    nameZh: '七星聚会',
    nameEn: 'Seven Stars Endgame',
    tipZh: '经典古谱致敬局：巧破石像护卫，或王见王一锤定音',
    tipEn: "Classic endgame tribute: shatter Statues & Guards, or Kings' Meeting",
  },
};

export function getLevelMeta(level: number): LevelMeta | null {
  return LEVEL_META_LIST[level] ?? null;
}

export function getFormationName(level: number): string {
  const meta = getLevelMeta(level);
  if (!meta) return '';
  return getLang() === 'zh' ? meta.nameZh : meta.nameEn;
}

export function getFormationTip(level: number): string {
  const meta = getLevelMeta(level);
  if (!meta) return '';
  return getLang() === 'zh' ? meta.tipZh : meta.tipEn;
}
