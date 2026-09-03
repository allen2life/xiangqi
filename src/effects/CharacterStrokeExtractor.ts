import { Renderer, Sprite, Rectangle, Texture } from 'pixi.js';

type StrokeData = {
  frame: Rectangle;
  centroid: { x: number; y: number };
};

export type CharacterData = {
  fullTexture: Texture;
  strokes: StrokeData[];
};

export class CharacterStrokeExtractor {
  private renderer: Renderer;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
  }

  /** Extract stroke fragments from piece icon Textures. Falls back to grid
   *  subdivision when flood-fill produces no connected components (which
   *  happens with anti-aliased PNG edges). */
  extract(textureMap: Map<string, Texture>): Map<string, CharacterData> {
    const result = new Map<string, CharacterData>();
    for (const [key, tex] of textureMap.entries()) {
      try {
        const data = this.extractSingle(tex);
        if (data) result.set(key, data);
      } catch (e) {
        console.warn(`[CharacterStrokeExtractor] Failed for "${key}":`, e);
      }
    }
    return result;
  }

  private extractSingle(texture: Texture): CharacterData | null {
    const sprite = new Sprite(texture);
    const fullTexture = this.renderer.extract.texture(sprite);
    const pixelResult = this.renderer.extract.pixels(sprite);
    const w = pixelResult.width;
    const h = pixelResult.height;
    const pixels = pixelResult.pixels;
    sprite.destroy();

    if (!pixels || pixels.length === 0) return null;

    // Try flood-fill on alpha channel first
    const strokes = this.floodFillStrokes(pixels, w, h);
    if (strokes.length > 0) {
      return { fullTexture, strokes };
    }

    // Fallback: subdivide into a grid (anti-aliased PNGs often have no clean
    // alpha edge for flood-fill to follow).
    return { fullTexture, strokes: this.gridFragments(w, h) };
  }

  private floodFillStrokes(pixels: Uint8ClampedArray | Uint8Array, w: number, h: number): StrokeData[] {
    const visited = new Uint8Array(w * h);
    const components: Array<Array<{ x: number; y: number }>> = [];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (visited[idx]) continue;
        if (pixels[idx * 4 + 3] < 16) continue;

        const comp: Array<{ x: number; y: number }> = [];
        const stack: Array<{ x: number; y: number }> = [{ x, y }];
        visited[idx] = 1;

        while (stack.length > 0) {
          const p = stack.pop()!;
          comp.push(p);
          visited[p.y * w + p.x] = 1;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
            const ni = ny * w + nx;
            if (visited[ni]) continue;
            if (pixels[ni * 4 + 3] < 16) continue;
            visited[ni] = 1;
            stack.push({ x: nx, y: ny });
          }
        }
        if (comp.length >= 3) components.push(comp);
      }
    }

    return components.map(comp => {
      let minX = w, minY = h, maxX = 0, maxY = 0, cx = 0, cy = 0;
      for (const p of comp) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        cx += p.x; cy += p.y;
      }
      return {
        frame: new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1),
        centroid: { x: cx / comp.length, y: cy / comp.length },
      };
    });
  }

  /** Subdivide into a 4×4 grid of fragments — always produces visible pieces. */
  private gridFragments(w: number, h: number): StrokeData[] {
    const cols = 4, rows = 4;
    const cellW = w / cols;
    const cellH = h / rows;
    const fragments: StrokeData[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        fragments.push({
          frame: new Rectangle(
            Math.round(c * cellW), Math.round(r * cellH),
            Math.round(cellW), Math.round(cellH),
          ),
          centroid: {
            x: Math.round((c + 0.5) * cellW),
            y: Math.round((r + 0.5) * cellH),
          },
        });
      }
    }
    return fragments;
  }
}
