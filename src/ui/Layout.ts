import { setBoardParams, getCellSize } from '../utils/coord';

export class Layout {
  static boardOrigin = { x: 0, y: 0 };
  static cellSize = 60;
  static boardCols = 7;
  static boardRows = 7;

  /** Measured bottom boundary of the board area (top of hand panel,
   *  which sits above the quick bar). Exposed for pointer guards. */
  static boardBottom = 0;

  static screenWidth = window.innerWidth;
  static screenHeight = window.innerHeight;

  /** Measure the real board area from DOM element positions.
   *  Returns fallback hardcoded estimates when elements aren't rendered yet
   *  or are display:none (height=0).
   *  Bottom boundary is the hand panel top (hand sits above quick bar).
   *  Guards against degenerate measurements (handTop <= hudBottom) that would
   *  produce a zero/negative cellSize and a vertically shifted board — the
   *  classic symptom of re-entering the battlefield before DOM settles. */
  static measureBoundaries(): { top: number; bottom: number } {
    const hud = document.getElementById('ui-hud');
    const hand = document.getElementById('ui-hand');
    const h = window.innerHeight;

    const hudRect = hud?.getBoundingClientRect();
    const handRect = hand?.getBoundingClientRect();
    const hudBottom = (hudRect && hudRect.height > 0) ? hudRect.bottom : 80;
    const handTop = (handRect && handRect.height > 0) ? handRect.top - 5 : h - 160;
    // If the measured region is inverted or too small to fit a board, fall
    // back to conservative estimates rather than emitting a degenerate layout.
    if (handTop - hudBottom < 120) {
      return { top: 80, bottom: h - 160 };
    }
    return { top: hudBottom, bottom: handTop };
  }

  static logicalToScreen(col: number, row: number): { x: number; y: number } {
    return {
      x: col * this.cellSize + this.boardOrigin.x,
      y: row * this.cellSize + this.boardOrigin.y,
    };
  }

  static screenToLogical(sx: number, sy: number): { col: number; row: number } | null {
    const threshold = this.cellSize * 0.5;
    let best: { col: number; row: number } | null = null;
    let bestDist = threshold;
    for (let c = 0; c < this.boardCols; c++) {
      for (let r = 0; r < this.boardRows; r++) {
        const sp = this.logicalToScreen(c, r);
        const dist = Math.hypot(sx - sp.x, sy - sp.y);
        if (dist < bestDist) { bestDist = dist; best = { col: c, row: r }; }
      }
    }
    return best;
  }

  static update(w: number, h: number, cols: number, rows: number): void {
    this.screenWidth = w; this.screenHeight = h;
    this.boardCols = cols; this.boardRows = rows;

    const paddingX = 60; // 30px each side
    const paddingY = 80;
    const { top: hudBottom, bottom: handTop } = this.measureBoundaries();
    this.boardBottom = handTop;
    const availW = w - paddingX;
    const availH = handTop - hudBottom - paddingY;

    const colsMinus1 = Math.max(cols - 1, 1); // guard against 1-col board
    const cellSizeFromW = Math.floor(availW / colsMinus1);
    const cellSizeFromH = Math.floor(Math.max(availH, 0) / colsMinus1);
    const cellSize = Math.min(cellSizeFromW, cellSizeFromH, 60); // cap at 60
    const cellSizeClamped = Math.max(cellSize, 24); // floor at 24px

    this.cellSize = cellSizeClamped;

    const gridW = (cols - 1) * cellSizeClamped;
    const gridH = (rows - 1) * cellSizeClamped;
    const availCenterY = hudBottom + (handTop - hudBottom) / 2;
    this.boardOrigin = {
      x: w / 2 - gridW / 2,
      y: availCenterY - gridH / 2,
    };

    setBoardParams(this.boardOrigin.x, this.boardOrigin.y, cellSizeClamped, cols, rows);
  }

  /** Piece radius scaled relative to cell size (base: 17px at cellSize=60). */
  static get pieceRadius(): number {
    return Math.round(25 * this.cellSize / 60);
  }

  /** Piece font size scaled relative to cell size (base: 18px at cellSize=60). */
  static get pieceFontSize(): number {
    return Math.round(20 * this.cellSize / 60);
  }
}
