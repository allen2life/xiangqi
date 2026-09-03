import { CONFIG } from '../config';
import type { Point } from '../core/types';

let offsetX = 0, offsetY = 0;
let _cellSize: number = CONFIG.CELL_SIZE;
let _boardCols: number = CONFIG.BOARD_COLS;
let _boardRows: number = CONFIG.BOARD_ROWS;

export function setBoardParams(ox: number, oy: number, cellSize: number, cols: number, rows: number) {
  offsetX = ox; offsetY = oy;
  _cellSize = cellSize; _boardCols = cols; _boardRows = rows;
}

export function getCellSize(): number { return _cellSize; }

export function logicalToScreen(col: number, row: number): { x: number; y: number } {
  const tiltRad = (CONFIG.TILT_ANGLE * Math.PI) / 180;
  const flatX = col * _cellSize;
  const flatY = row * _cellSize;
  return { x: flatX + offsetX, y: flatY + flatY * Math.sin(tiltRad) + offsetY };
}

export function screenToLogical(screenX: number, screenY: number): Point | null {
  const threshold = _cellSize * 0.5;
  let best: Point | null = null, bestDist = threshold;
  for (let c = 0; c < _boardCols; c++) {
    for (let r = 0; r < _boardRows; r++) {
      const sp = logicalToScreen(c, r);
      const dist = Math.hypot(screenX - sp.x, screenY - sp.y);
      if (dist < bestDist) { bestDist = dist; best = { col: c, row: r }; }
    }
  }
  return best;
}
