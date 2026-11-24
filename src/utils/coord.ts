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

export interface MagneticResult {
  point: Point;
  distance: number;
  isLocked: boolean;    // dist <= _cellSize * 0.45（强吸附锁定区）
  isCandidate: boolean; // dist <= _cellSize * 0.65（吸附预备区）
  screenPos: { x: number; y: number };
}

/**
 * 带迟滞防抖的双层距离磁吸计算
 * @param screenX 触控屏幕 X
 * @param screenY 触控屏幕 Y
 * @param currentLocked 当前已锁定的目标点（用于防抖迟滞判定）
 */
export function screenToLogicalMagnetic(
  screenX: number,
  screenY: number,
  currentLocked: Point | null = null
): MagneticResult | null {
  const lockThreshold = _cellSize * 0.45;      // 进入强锁定的距离（约 27px @ 60px）
  const candidateThreshold = _cellSize * 0.65; // 进入吸附预备区的距离（约 39px @ 60px）
  const releaseThreshold = _cellSize * 0.55;   // 脱离锁定的迟滞线（约 33px @ 60px）

  // 1. 如果已有锁定目标，先检查是否仍在迟滞防抖范围内
  if (currentLocked) {
    const lockedSp = logicalToScreen(currentLocked.col, currentLocked.row);
    const lockedDist = Math.hypot(screenX - lockedSp.x, screenY - lockedSp.y);
    if (lockedDist <= releaseThreshold) {
      return {
        point: currentLocked,
        distance: lockedDist,
        isLocked: true,
        isCandidate: true,
        screenPos: lockedSp,
      };
    }
  }

  // 2. 搜索全局距离最近的交叉点
  let bestPoint: Point | null = null;
  let bestDist = candidateThreshold;
  let bestPos = { x: 0, y: 0 };

  for (let c = 0; c < _boardCols; c++) {
    for (let r = 0; r < _boardRows; r++) {
      const sp = logicalToScreen(c, r);
      const dist = Math.hypot(screenX - sp.x, screenY - sp.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestPoint = { col: c, row: r };
        bestPos = sp;
      }
    }
  }

  if (!bestPoint) return null;

  return {
    point: bestPoint,
    distance: bestDist,
    isLocked: bestDist <= lockThreshold,
    isCandidate: true,
    screenPos: bestPos,
  };
}
