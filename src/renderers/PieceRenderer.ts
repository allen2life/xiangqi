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

const obstacleTextureCache = new Map<string, Texture>();

/** Procedural vector canvas texture for City (Fortress Gate) and Statue (Ancient Stone Beast) */
function getObstacleTexture(type: 'city' | 'statue', active: boolean, size: number): Texture {
  const cacheKey = `${type}_${active ? '1' : '0'}_${size}`;
  const cached = obstacleTextureCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Texture.WHITE;

  const s = size / 64;
  ctx.save();
  ctx.translate(size / 2, size / 2);

  if (type === 'city') {
    // ── 关隘城池 (Classical Chinese Fortress Gate) ──
    const wallColor = active ? '#8c603a' : '#4a4440';
    const gateColor = '#1a1412';
    const roofColor = active ? '#b83a2a' : '#5c3a30';
    const goldColor = active ? '#d4af37' : '#7a6a4a';

    if (active) {
      ctx.shadowColor = 'rgba(243, 156, 18, 0.6)';
      ctx.shadowBlur = 10 * s;
    }

    // 1. Base foundation / 城台 (trapezoid)
    ctx.beginPath();
    ctx.moveTo(-22 * s, 22 * s);
    ctx.lineTo(22 * s, 22 * s);
    ctx.lineTo(19 * s, 4 * s);
    ctx.lineTo(-19 * s, 4 * s);
    ctx.closePath();
    ctx.fillStyle = wallColor;
    ctx.fill();
    ctx.lineWidth = 1.5 * s;
    ctx.strokeStyle = goldColor;
    ctx.stroke();

    // 2. Arched gate / 拱券门洞
    ctx.beginPath();
    ctx.arc(0, 15 * s, 7 * s, Math.PI, 0, false);
    ctx.lineTo(7 * s, 22 * s);
    ctx.lineTo(-7 * s, 22 * s);
    ctx.closePath();
    ctx.fillStyle = gateColor;
    ctx.fill();

    // 3. Crenellated battlements / 城垛
    ctx.fillStyle = wallColor;
    const cw = 7 * s, ch = 5 * s;
    [-18 * s, -3.5 * s, 11 * s].forEach((x) => {
      ctx.fillRect(x, -1 * s, cw, ch);
      ctx.strokeRect(x, -1 * s, cw, ch);
    });

    // 4. Watchtower / 城楼与飞檐
    ctx.beginPath();
    ctx.moveTo(-12 * s, -1 * s);
    ctx.lineTo(12 * s, -1 * s);
    ctx.lineTo(10 * s, -11 * s);
    ctx.lineTo(-10 * s, -11 * s);
    ctx.closePath();
    ctx.fillStyle = active ? '#2c1e18' : '#201d1b';
    ctx.fill();

    // Roof eaves / 飞檐
    ctx.beginPath();
    ctx.moveTo(-18 * s, -10 * s);
    ctx.quadraticCurveTo(0, -14 * s, 18 * s, -10 * s);
    ctx.lineTo(12 * s, -18 * s);
    ctx.lineTo(0, -21 * s);
    ctx.lineTo(-12 * s, -18 * s);
    ctx.closePath();
    ctx.fillStyle = roofColor;
    ctx.fill();
    ctx.strokeStyle = goldColor;
    ctx.stroke();

    // Beacon flame / 烽火灵光 (if active)
    if (active) {
      ctx.beginPath();
      ctx.arc(0, -23 * s, 3.5 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc00';
      ctx.shadowColor = '#ff4400';
      ctx.shadowBlur = 8 * s;
      ctx.fill();
    }
  } else {
    // ── 镇煞神兽石像 (Archaic Stone Beast Stele) ──
    const stoneColor = active ? '#34495e' : '#2c3e50';
    const runeColor = active ? '#00e5ff' : '#566573';
    const goldColor = active ? '#a2d9ce' : '#515a5a';

    if (active) {
      ctx.shadowColor = 'rgba(0, 229, 255, 0.5)';
      ctx.shadowBlur = 10 * s;
    }

    // 1. Carved plinth / 须弥座 (double step)
    ctx.fillStyle = active ? '#212f3d' : '#1c2833';
    ctx.fillRect(-22 * s, 16 * s, 44 * s, 6 * s);
    ctx.strokeStyle = goldColor;
    ctx.lineWidth = 1.2 * s;
    ctx.strokeRect(-22 * s, 16 * s, 44 * s, 6 * s);
    ctx.fillRect(-18 * s, 10 * s, 36 * s, 6 * s);
    ctx.strokeRect(-18 * s, 10 * s, 36 * s, 6 * s);

    // 2. Main Stone Monolith / 石兽主体 (Arched top stele with beast ears)
    ctx.beginPath();
    ctx.moveTo(-15 * s, 10 * s);
    ctx.lineTo(-15 * s, -10 * s);
    ctx.lineTo(-18 * s, -18 * s); // left ear/horn
    ctx.lineTo(-9 * s, -15 * s);
    ctx.quadraticCurveTo(0, -22 * s, 9 * s, -15 * s); // crown arch
    ctx.lineTo(18 * s, -18 * s); // right ear/horn
    ctx.lineTo(15 * s, -10 * s);
    ctx.lineTo(15 * s, 10 * s);
    ctx.closePath();
    ctx.fillStyle = stoneColor;
    ctx.fill();
    ctx.stroke();

    // 3. Ancient Runic Eye & Totem / 铭文与神目
    ctx.beginPath();
    ctx.arc(0, -5 * s, 6 * s, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#0b1e28' : '#151d23';
    ctx.fill();
    ctx.strokeStyle = runeColor;
    ctx.stroke();

    if (active) {
      ctx.beginPath();
      ctx.arc(0, -5 * s, 2.8 * s, 0, Math.PI * 2);
      ctx.fillStyle = '#00e5ff';
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 8 * s;
      ctx.fill();
    }

    // Carved tribal marks
    ctx.beginPath();
    ctx.moveTo(-8 * s, 4 * s);
    ctx.lineTo(8 * s, 4 * s);
    ctx.moveTo(-6 * s, 7 * s);
    ctx.lineTo(6 * s, 7 * s);
    ctx.strokeStyle = runeColor;
    ctx.lineWidth = 1.5 * s;
    ctx.stroke();
  }

  ctx.restore();

  const tex = Texture.from(canvas);
  obstacleTextureCache.set(cacheKey, tex);
  return tex;
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
      // ── Obstacle (city / statue): custom Chinese style vector texture ──
      const type = isCity ? 'city' : 'statue';
      const texSize = Math.max(64, Math.round(r * 2.8));
      const tex = getObstacleTexture(type, !!unit.active, texSize);
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      sprite.width = r * 2.4;
      sprite.height = r * 2.4;
      sprite.alpha = unit.active ? 1 : 0.4;
      wrapper.addChild(sprite);
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
