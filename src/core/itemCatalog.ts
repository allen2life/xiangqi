import { EngineItemType } from '../wasm/types';
import { PieceType } from './types';

// 道具目录：道具 ID ↔ 引擎枚举的唯一映射（新增道具在此登记）。
// 引擎侧对应 kItemWireDefs（game_record.cpp），服务端对应 itemInventoryID。
export interface ItemCatalogEntry {
  id: string;
  engineType: EngineItemType | null;  // loong_soul 无引擎道具类型
}

export const ITEM_CATALOG: ItemCatalogEntry[] = [
  { id: 'undo', engineType: EngineItemType.UNDO },
  { id: 'redraw', engineType: EngineItemType.REDRAW },
  { id: 'unseal', engineType: EngineItemType.UNSEAL },
  { id: 'handSet', engineType: EngineItemType.HAND_SET },
  { id: 'loong', engineType: EngineItemType.LOONG },
  // ── 英雄棋子召唤令 ──
  { id: 'horse_iron', engineType: EngineItemType.SUMMON_HORSE_IRON },
  { id: 'elephant_mengma', engineType: EngineItemType.SUMMON_ELEPHANT_MENMA },
  { id: 'chariot_tank', engineType: EngineItemType.SUMMON_CHARIOT_TANK },
  { id: 'pawn_engineer', engineType: EngineItemType.SUMMON_PAWN_ENGINEER },
  // ── 木牛流马：+5 粮草上限（叠加；用过即失 ★2）──
  { id: 'provision_wagon', engineType: EngineItemType.PROVISION_WAGON },
  { id: 'loong_soul', engineType: null },
];

export const ITEM_IDS: readonly string[] = ITEM_CATALOG.map(entry => entry.id);

// 召唤令物品 → 英雄棋子（core PieceType）映射
export const SUMMON_ITEM_TO_PIECE: Record<string, PieceType> = {
  loong: PieceType.LOONG_PIECE,
  horse_iron: PieceType.HORSE_IRON,
  elephant_mengma: PieceType.ELEPHANT_MENMA,
  chariot_tank: PieceType.CHARIOT_TANK,
  pawn_engineer: PieceType.PAWN_ENGINEER,
};
