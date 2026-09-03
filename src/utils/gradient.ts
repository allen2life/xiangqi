import { Texture } from 'pixi.js';

export interface GradientStop {
  offset: number;
  color: string;
}

export function createGradientTexture(
  width: number,
  height: number,
  stops: GradientStop[],
  angleDeg = 135,
): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const rad = (angleDeg * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const halfLen = Math.sqrt(width * width + height * height) / 2;
  const x0 = cx - Math.cos(rad) * halfLen;
  const y0 = cy - Math.sin(rad) * halfLen;
  const x1 = cx + Math.cos(rad) * halfLen;
  const y1 = cy + Math.sin(rad) * halfLen;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const s of stops) {
    grad.addColorStop(s.offset, s.color);
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  return Texture.from(canvas);
}
