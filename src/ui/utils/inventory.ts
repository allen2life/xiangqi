/**
 * Inventory/items utility functions — pure logic, no `this` dependency.
 * Extracted from DomUI.ts for modularity.
 */

import { engineBridge } from '../../wasm/EngineBridge';
import { ITEM_DEFS } from '../../config';
import { t, getLang } from '../../i18n';
import { ITEM_IDS } from '../../core/itemCatalog';

export function readLocalInventory(): Record<string, number> {
  return Object.fromEntries(ITEM_IDS.map(id => [id, engineBridge.getPlatformItemCount(id)]));
}

export function applyAuthoritativeInventory(items: Record<string, number>, balance?: number): void {
  for (const id of ITEM_IDS) {
    if (id === 'loong_soul') continue;  // 龙魂为本地权威（收集/锻造扣减），不随服务端覆盖
    const current = engineBridge.getPlatformItemCount(id);
    const delta = (items[id] ?? 0) - current;
    if (delta > 0) engineBridge.addPlatformItem(id, delta);
    else if (delta < 0) engineBridge.removePlatformItem(id, -delta);
  }
  if (balance !== undefined) engineBridge.platformSetBalance(balance, 0);
  engineBridge.platformSave();
}

/** Bonus key → display name mapping (引擎只返回 key，UI 层负责本地化) */
export const BONUS_NAMES: Record<string, string> = {
  bonus_cannon: t('bonusCannon'),
  bonus_cannon_t2: t('bonusCannonT2'),
  bonus_horse: t('bonusHorse'),
  bonus_horse_t2: t('bonusHorseT2'),
  bonus_horse_t3: t('bonusHorseT3'),
  bonus_chariot_t1: t('bonusChariotT1'),
  bonus_chariot_t2: t('bonusChariotT2'),
  bonus_elephant: t('bonusElephant'),
  bonus_general: t('bonusGeneral'),
  bonus_kings_meeting: t('bonusKingsMeeting'),
  bonus_stars: t('bonusStars'),
  victory_kings_meeting: t('victoryKingsMeeting'),
  victory_normal: t('victoryNormal'),
};

export function projectInventoryWithSessionSouls(
  items: Readonly<Record<string, number>>,
  sessionEarnedLoongSouls: number,
): Record<string, number> {
  return {
    ...items,
    loong_soul: (items.loong_soul ?? 0) + Math.max(0, sessionEarnedLoongSouls),
  };
}

export type ItemDetailAction = 'info' | 'forge';

export function getItemDetailAction(itemId: string, _inventoryQuantity: number): ItemDetailAction {
  const category = ITEM_DEFS[itemId]?.category;
  if (category === 'soul') return 'info';
  return 'forge';
}
