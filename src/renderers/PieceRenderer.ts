import { Container, Graphics, Sprite, Text, Texture, ImageSource } from 'pixi.js';
import gsap from 'gsap';
import { CONFIG } from '../config';
import { logicalToScreen } from '../utils/coord';
import { Camp, PieceType } from '../core/types';
import { Layout } from '../ui/Layout';
import { fetchIconBlobUrl } from '../utils/iconAssetCache';

const iconUrl = (name: string) => `${import.meta.env.BASE_URL}icons/${encodeURIComponent(name)}`;

// ── Icon cache — all 14 piece PNGs loaded once, served synchronously ──
const PIECE_ICONS: Record<string, { player: string; enemy: string }> = {
  [PieceType.PAWN]:    { player: iconUrl('pawn_64.png'), enemy: iconUrl('pawn_enemy_64.png') },
  [PieceType.CHARIOT]: { player: iconUrl('chariot_64.png'), enemy: iconUrl('chariot_64.png') },
  [PieceType.CANNON]:  { player: iconUrl('cannon_64.png'), enemy: iconUrl('cannon_enemy_64.png') },
  [PieceType.HORSE]:   { player: iconUrl('horse_64.png'), enemy: iconUrl('horse_64.png') },
  [PieceType.ELEPHANT]:{ player: iconUrl('elephant_enemy_64.png'), enemy: iconUrl('elephant_64.png') },
  [PieceType.ADVISOR]: { player: iconUrl('advisor_enemy_64.png'), enemy: iconUrl('advisor_64.png') },
  [PieceType.GENERAL]:    { player: iconUrl('general_64.png'), enemy: iconUrl('general_enemy_64.png') },
  [PieceType.LOONG_FLAME]:{ player: iconUrl('loong_64.png'), enemy: iconUrl('loong_64.png') },
  [PieceType.LOONG_PIECE]:{ player: iconUrl('loong_64.png'), enemy: iconUrl('loong_64.png') },
  // ── 召唤令增强棋子（玩家专属，enemy 复用同图）──
  [PieceType.HORSE_IRON]:     { player: iconUrl('horse_iron_64.png'), enemy: iconUrl('horse_iron_64.png') },
  [PieceType.ELEPHANT_MENMA]: { player: iconUrl('elephant_mengma_64.png'), enemy: iconUrl('elephant_mengma_64.png') },
  [PieceType.CHARIOT_TANK]:   { player: iconUrl('chariot_tank_64.png'), enemy: iconUrl('chariot_tank_64.png') },
  [PieceType.PAWN_ENGINEER]:  { player: iconUrl('pawn_engineer_64.png'), enemy: iconUrl('pawn_engineer_64.png') },
};

const iconCache = new Map<string, Texture>();
let iconLoadPromise: Promise<void> | null = null;

/** Preload all piece icons into cache. Call once at startup and await before first render. */
export function preloadPieceIcons(): Promise<void> {
  if (iconLoadPromise) return iconLoadPromise;
  const allUrls = new Set<string>();
  for (const v of Object.values(PIECE_ICONS)) {
    allUrls.add(v.player);
    allUrls.add(v.enemy);
  }
  iconLoadPromise = Promise.all(Array.from(allUrls, async (url) => {
    try {
      // 单一数据源：fetch → blob URL，PIXI Texture 与 DOM <img> 共用同一份 blob。
      // blob: URL 同源，无需 crossOrigin；不再二次下载（旧实现 new Image(url) 与 DOM fetch 各一次）。
      const blobUrl = await fetchIconBlobUrl(url);
      const img = new Image();
      img.src = blobUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`load failed: ${url}`));
      });
      const source = new ImageSource({ resource: img });
      iconCache.set(url, new Texture({ source }));
    } catch (e) {
      console.warn(`[PieceRenderer] icon preload failed: ${url}`, e);
    }
  })).then(() => {
    console.warn(`[PieceRenderer] ${iconCache.size} piece icons loaded`);
  }) as Promise<void>;
  return iconLoadPromise;
}

/** Synchronous lookup — returns cached Texture or undefined if not yet loaded. */
function getIcon(pieceType: PieceType, isPlayer: boolean): Texture | undefined {
  const entry = PIECE_ICONS[pieceType];
  if (!entry) return;
  return iconCache.get(isPlayer ? entry.player : entry.enemy);
}

/** Public getter — returns cached piece icon Texture for shatterPool / effects. */
export function getPieceIconTexture(pieceType: PieceType, isPlayer: boolean): Texture | undefined {
  return getIcon(pieceType, isPlayer);
}

export class PieceRenderer {
  readonly container = new Container();
  private pieceMap = new Map<string, Container>();
  /** Reverse lookup: "col,row" → unitId. Used as fallback in animateKills when ID-based lookup fails. */
  private positionMap = new Map<string, string>();

  /** Call once early (start menu) to preload all piece PNGs. */
  static init(): void {
    preloadPieceIcons();
  }

  /** Find a container by board position (fallback when ID-based lookup returns undefined). */
  getContainerAt(col: number, row: number): Container | undefined {
    const id = this.positionMap.get(`${col},${row}`);
    return id ? this.pieceMap.get(id) : undefined;
  }

  addPiece(unit: any): Container | null {
    if (!unit.position || !unit.alive) return null;
    const { PLAYER_FILL, PLAYER_STROKE, ENEMY_FILL, ENEMY_STROKE } = CONFIG.COLORS;
    const r = Layout.pieceRadius;
    const isPlayer = unit.camp === Camp.PLAYER;
    const isCity = !!(unit as any).isCity;
    const isStatue = !!(unit as any).isStatue;
    const wrapper = new Container();
    const pos = logicalToScreen(unit.position.col, unit.position.row);

    if (isCity || isStatue) {
      // ── Obstacle (city / statue): emoji icon, no circle bg ──
      const emoji = isCity ? '🏰' : '🗿';
      const emojiSize = Math.round(Layout.pieceFontSize * 1.33);

      if (unit.active) {
        // Warm glow behind obstacle (amber for city, brown for statue)
        const glow = new Text({
          text: emoji,
          style: { fontSize: emojiSize, fontFamily: 'Arial' },
        });
        glow.anchor.set(0.5);
        glow.tint = isCity ? 0x8b6914 : 0x5c3a1e;
        glow.alpha = 0.2;
        glow.scale.set(1.2);
        wrapper.addChildAt(glow, 0);

        if (isStatue) {
          const brownGlow = new Text({
            text: emoji,
            style: { fontSize: emojiSize, fontFamily: 'Arial' },
          });
          brownGlow.anchor.set(0.5);
          brownGlow.tint = 0x8b4513;
          brownGlow.alpha = 0.3;
          brownGlow.scale.set(1.15);
          wrapper.addChildAt(brownGlow, 0);
        }
      }

      const text = new Text({
        text: emoji,
        style: { fontSize: emojiSize, fontFamily: 'Arial' },
      });
      text.anchor.set(0.5);
      text.alpha = unit.active ? 1 : 0.35;
      wrapper.addChild(text);
    } else {
      // ── Regular piece: circle bg + icon ──
      const gfx = new Graphics();
      const fillColor = isPlayer ? PLAYER_FILL : ENEMY_FILL;
      const strokeColor = isPlayer ? PLAYER_STROKE : ENEMY_STROKE;

      // Shadow (offset)
      gfx.circle(3, 3, r + 1)
        .fill({ color: 0x000000, alpha: 0.3 });
      // Main circle with gold border
      gfx.circle(0, 0, r)
        .fill(fillColor)
        .stroke({ width: 2, color: strokeColor });
      // Inner ring
      gfx.circle(0, 0, r - 4)
        .stroke({ width: 1, color: 0xd4af37 });
      // Highlight
      gfx.circle(-r * 0.3, -r * 0.3, r * 0.35)
        .fill({ color: 0xffffff, alpha: 0.12 });
      wrapper.addChild(gfx);

      // ── Piece icon ──
      const tex = getIcon(unit.pieceType as PieceType, isPlayer);
      if (tex) {
        const sprite = new Sprite(tex);
        sprite.anchor.set(0.5);
        sprite.scale.set((r * 2 - 3) / 64);
        sprite.alpha = unit.active ? 1 : 0.5;
        wrapper.addChild(sprite);
      } else {
        const fallback = new Text({
          text: (unit.pieceType === PieceType.LOONG_FLAME || unit.pieceType === PieceType.LOONG_PIECE) ? '龙' : '棋',
          style: {
            fontSize: Math.round(r * 1.25),
            fill: isPlayer ? 0xf4d58d : 0xefe4d0,
            fontFamily: 'STKaiti, KaiTi, serif',
            fontWeight: '700',
          },
        });
        fallback.anchor.set(0.5);
        fallback.alpha = unit.active ? 1 : 0.5;
        wrapper.addChild(fallback);
      }
    }

    wrapper.x = pos.x; wrapper.y = pos.y;

    wrapper.eventMode = 'static';
    wrapper.cursor = 'pointer';
    wrapper.on('pointerover', () => {
      gsap.to(wrapper.scale, { x: 1.1, y: 1.1, duration: 0.15, ease: 'power2.out' });
    });
    wrapper.on('pointerout', () => {
      gsap.to(wrapper.scale, { x: 1, y: 1, duration: 0.15, ease: 'power2.out' });
    });

    this.container.addChild(wrapper);
    this.pieceMap.set(unit.id, wrapper);
    this.positionMap.set(`${unit.position.col},${unit.position.row}`, unit.id);
    return wrapper;
  }

  getContainer(unitId: string): Container | undefined { return this.pieceMap.get(unitId); }

  removePiece(unitId: string): void {
    const w = this.pieceMap.get(unitId);
    if (w) {
      // Clean positionMap entry — find by iterating or by reverse mapping
      for (const [key, id] of this.positionMap) {
        if (id === unitId) { this.positionMap.delete(key); break; }
      }
      gsap.killTweensOf(w); gsap.killTweensOf(w.scale); this.container.removeChild(w); w.destroy({ children: true }); this.pieceMap.delete(unitId);
    }
  }

  clear(): void {
    for (const w of this.pieceMap.values()) { gsap.killTweensOf(w); gsap.killTweensOf(w.scale); this.container.removeChild(w); w.destroy({ children: true }); }
    this.pieceMap.clear();
    this.positionMap.clear();
  }

  renderAll(units: any[]): void { this.clear(); for (const u of units) if (u.alive) this.addPiece(u); }

  destroy(): void { this.clear(); this.container.destroy({ children: true }); }
}
