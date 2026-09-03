import { Container, Renderer, Sprite, Texture } from 'pixi.js';
import { PieceType } from '../core/types';
import { getPieceIconTexture } from '../renderers/PieceRenderer';
import { CharacterStrokeExtractor, type CharacterData } from './CharacterStrokeExtractor';

export interface StrokeSpriteData {
  texture: Texture;
  centroid: { x: number; y: number };
}

/** Composite key for a piece icon: e.g. "0_p" = PAWN+player, "0_e" = PAWN+enemy. */
function makePieceKey(type: PieceType, isPlayer: boolean): string {
  return `${type}_${isPlayer ? 'p' : 'e'}`;
}

export class CharacterShatterPool {
  private dataMap = new Map<string, CharacterData>();
  private strokeTextureMap = new Map<string, StrokeSpriteData[]>();
  private ready = false;

  constructor() {
    // init is called async separately
  }

  async init(renderer: Renderer): Promise<void> {
    // Build texture map from preloaded piece icons (guaranteed ready by caller)
    const textureMap = new Map<string, Texture>();
    const types = Object.values(PieceType) as PieceType[];
    for (const type of types) {
      const playerTex = getPieceIconTexture(type, true);
      const enemyTex = getPieceIconTexture(type, false);
      if (playerTex) textureMap.set(makePieceKey(type, true), playerTex);
      if (enemyTex) textureMap.set(makePieceKey(type, false), enemyTex);
    }

    const extractor = new CharacterStrokeExtractor(renderer);
    this.dataMap = extractor.extract(textureMap);
    // Pre-create subtextures to avoid allocating new Texture on every getStrokes() call
    for (const [key, data] of this.dataMap.entries()) {
      const strokes = data.strokes.map(s => ({
        texture: new Texture({
          source: data.fullTexture.source,
          frame: s.frame.clone(),
        }),
        centroid: { ...s.centroid },
      }));
      this.strokeTextureMap.set(key, strokes);
    }
    this.ready = true;
    if (this.dataMap.size === 0) {
      console.warn('[CharacterShatterPool] init done but 0 character textures extracted — effects will use ink fallback');
    } else {
      console.log(`[CharacterShatterPool] init done: ${this.dataMap.size} character textures ready`);
    }
  }

  isReady(): boolean { return this.ready; }

  /** Get stroke data for a piece icon key (use getPlayerKey / getEnemyKey). */
  getStrokes(key: string): StrokeSpriteData[] | null {
    return this.strokeTextureMap.get(key) ?? null;
  }

  /** Get full texture for a piece icon key. */
  getFullTexture(key: string): Texture | null {
    return this.dataMap.get(key)?.fullTexture ?? null;
  }

  /** Get the centroid (in texture pixels) of a piece icon — replaces the
   *  previously hardcoded 32. Returns null when key is missing. */
  getCenter(key: string): { x: number; y: number } | null {
    const tex = this.dataMap.get(key)?.fullTexture;
    if (!tex) return null;
    // fullTexture is a square icon; frame width/height is the icon size.
    const w = tex.frame.width;
    const h = tex.frame.height;
    return { x: w / 2, y: h / 2 };
  }

  /** Get the icon size (width = height) for a piece key. */
  getSize(key: string): number {
    const tex = this.dataMap.get(key)?.fullTexture;
    return tex ? tex.frame.width : 64;
  }

  /** Build a Container with the full piece icon as a single Sprite,
   *  centered at (0,0) so the caller places it directly at the target position. */
  buildCharacter(key: string): Container | null {
    const fullTex = this.getFullTexture(key);
    if (!fullTex) return null;
    const c = new Container();
    const sp = new Sprite(fullTex);
    sp.anchor.set(0.5);
    c.addChild(sp);
    return c;
  }

  /** Key for the player-side icon of a piece type. */
  getPlayerKey(type: PieceType): string { return makePieceKey(type, true); }
  /** Key for the enemy-side icon of a piece type. */
  getEnemyKey(type: PieceType): string { return makePieceKey(type, false); }
}
