import { Container, Graphics, Sprite, Text } from 'pixi.js';
import { CONFIG } from '../config';
import { logicalToScreen } from '../utils/coord';
import { createGradientTexture } from '../utils/gradient';
import { t } from '../i18n';

export class BoardRenderer {
  readonly container = new Container();
  private gridGfx = new Graphics();
  private boardBgGfx = new Graphics();
  private boardSprite: Sprite | null = null;
  private cornerGfx = new Graphics();
  private riverText: Text | null = null;
  private mottoText: Text | null = null;
  private lastCols = 0;
  private lastRows = 0;

  constructor() {
    this.container.addChild(this.boardBgGfx);
    this.container.addChild(this.gridGfx);
    this.container.addChild(this.cornerGfx);
  }

  draw(cols?: number, rows?: number): void {
    const nCols = cols ?? CONFIG.BOARD_COLS;
    const nRows = rows ?? CONFIG.BOARD_ROWS;
    this.lastCols = nCols; this.lastRows = nRows;
    this.gridGfx.clear();
    this.boardBgGfx.clear();
    this.cornerGfx.clear();

    // Calculate board bounding box
    const tl = logicalToScreen(-0.5, -0.5);
    const br = logicalToScreen(nCols - 1 + 0.5, nRows - 1 + 0.5);
    const bw = br.x - tl.x;
    const bh = br.y - tl.y;

    const isStandardBoard = nRows === 10 && nCols === 9;
    // 河界固定（引擎规则，TS 只负责渲染）：第 5 行分界，不随棋盘尺寸变化
    const riverLine = 5;

    // Board outer shadow
    this.boardBgGfx.roundRect(tl.x + 5, tl.y + 5, bw, bh, 8)
      .fill({ color: 0x000000, alpha: 0.4 });

    // Wood-like gradient board surface
    const woodTex = createGradientTexture(bw, bh, [
      { offset: 0, color: '#c9a66b' },
      { offset: 0.5, color: '#b8956a' },
      { offset: 1, color: '#a07d52' },
    ], 145);
    if (this.boardSprite) {
      this.boardSprite.texture = woodTex;
      this.boardSprite.x = tl.x;
      this.boardSprite.y = tl.y;
    } else {
      this.boardSprite = new Sprite(woodTex);
      this.boardSprite.x = tl.x;
      this.boardSprite.y = tl.y;
      this.container.addChildAt(this.boardSprite, 1);
    }

    // Enemy territory subtle tint (on non-standard boards, highlight rows 0-4)
    if (!isStandardBoard && nRows > 0) {
      const enemyRows = Math.min(riverLine, nRows);
      const enemyBot = logicalToScreen(0, enemyRows - 0.5).y;
      const enemyH = enemyBot - tl.y;
      this.boardBgGfx.rect(tl.x, tl.y, bw, enemyH)
        .fill({ color: 0x8b0000, alpha: 0.06 });
    }

    // Board border
    this.boardBgGfx.roundRect(tl.x, tl.y, bw, bh, 8)
      .stroke({ width: 4, color: 0x5d4037 });

    // ── Four-corner L-shaped decorations (Chinese scroll corner guards) ──
    const cornerLen = Math.min(bw, bh) * 0.08;
    const cornerColor = 0x8d6e3f;
    const cornerWidth = 2;
    const cornerInset = 6; // px inset from board edge

    // Top-left corner
    const tlx = tl.x + cornerInset, tly = tl.y + cornerInset;
    this.cornerGfx.moveTo(tlx, tly + cornerLen).lineTo(tlx, tly).lineTo(tlx + cornerLen, tly);

    // Top-right corner
    const trx = br.x - cornerInset, try_ = tl.y + cornerInset;
    this.cornerGfx.moveTo(trx - cornerLen, try_).lineTo(trx, try_).lineTo(trx, try_ + cornerLen);

    // Bottom-left corner
    const blx = tl.x + cornerInset, bly = br.y - cornerInset;
    this.cornerGfx.moveTo(blx, bly - cornerLen).lineTo(blx, bly).lineTo(blx + cornerLen, bly);

    // Bottom-right corner
    const brx = br.x - cornerInset, bry_ = br.y - cornerInset;
    this.cornerGfx.moveTo(brx - cornerLen, bry_).lineTo(brx, bry_).lineTo(brx, bry_ - cornerLen);

    this.cornerGfx.stroke({ width: cornerWidth, color: cornerColor });

    // Horizontal lines (always continuous)
    for (let r = 0; r < nRows; r++) {
      const s = logicalToScreen(0, r), e = logicalToScreen(nCols - 1, r);
      this.gridGfx.moveTo(s.x, s.y).lineTo(e.x, e.y);
    }

    // Vertical lines — split at the fixed river (between rows 4-5)
    // Interior columns have a gap at the river; edge columns are full.
    for (let c = 0; c < nCols; c++) {
      if (c === 0 || c === nCols - 1) {
        // Edge column: full line from top to bottom
        const s = logicalToScreen(c, 0), e = logicalToScreen(c, nRows - 1);
        this.gridGfx.moveTo(s.x, s.y).lineTo(e.x, e.y);
      } else if (nRows > riverLine) {
        // Interior column: split at the river (gap between row riverLine-1 and riverLine)
        const top = logicalToScreen(c, 0), topE = logicalToScreen(c, riverLine - 1);
        this.gridGfx.moveTo(top.x, top.y).lineTo(topE.x, topE.y);
        const bot = logicalToScreen(c, riverLine), botE = logicalToScreen(c, nRows - 1);
        this.gridGfx.moveTo(bot.x, bot.y).lineTo(botE.x, botE.y);
      } else {
        // Board too small to show river: draw full line
        const s = logicalToScreen(c, 0), e = logicalToScreen(c, nRows - 1);
        this.gridGfx.moveTo(s.x, s.y).lineTo(e.x, e.y);
      }
    }

    // Palace diagonals (only on boards with ≥7 cols and ≥7 rows)
    const cc = Math.floor(nCols / 2);
    if (nCols >= 7 && nRows >= 7) {
      const pc = cc - 1, pe = cc + 1;
      // Top palace (rows 0-2)
      const ttl = logicalToScreen(pc, 0), tbr = logicalToScreen(pe, 2);
      this.gridGfx.moveTo(ttl.x, ttl.y).lineTo(tbr.x, tbr.y);
      const ttr = logicalToScreen(pe, 0), tbl = logicalToScreen(pc, 2);
      this.gridGfx.moveTo(ttr.x, ttr.y).lineTo(tbl.x, tbl.y);
      // Bottom palace (rows nRows-3 ~ nRows-1)
      const btl = logicalToScreen(pc, nRows - 3), bbr = logicalToScreen(pe, nRows - 1);
      this.gridGfx.moveTo(btl.x, btl.y).lineTo(bbr.x, bbr.y);
      const btr = logicalToScreen(pe, nRows - 3), bbl = logicalToScreen(pc, nRows - 1);
      this.gridGfx.moveTo(btr.x, btr.y).lineTo(bbl.x, bbl.y);
    }

    // Apply stroke to grid lines
    this.gridGfx.stroke({ width: 1.5, color: CONFIG.COLORS.GRID_LINE });

    // River gap horizontal separator (always between rows riverLine-1 and riverLine)
    if (nRows > riverLine) {
      const riverTop = logicalToScreen(0, riverLine - 0.5).y;
      const riverBot = logicalToScreen(0, riverLine + 0.5).y;
      this.boardBgGfx.rect(tl.x, riverTop, bw, riverBot - riverTop)
        .fill({ color: 0x3e2723, alpha: 0.08 });
    }

    // Loong-scale boundary text (龙鳞界) — only on boards with rows ≥ 9
    if (this.riverText) { this.riverText.removeFromParent(); this.riverText.destroy(); this.riverText = null; }
    if (nRows >= 9) {
      const riverY = (logicalToScreen(0, riverLine - 1).y + logicalToScreen(0, riverLine).y) / 2;
      const riverX = logicalToScreen(0, 0).x + bw / 2;
      this.riverText = new Text({
        text: t('board.river'),
        style: { fontSize: 18, fill: 0xb8956a, fontFamily: 'Noto Serif SC, serif' },
      });
      this.riverText.anchor.set(0.5);
      this.riverText.x = riverX;
      this.riverText.y = riverY;
      this.riverText.alpha = 0.4;
      this.container.addChild(this.riverText);
    }

    // Motto text — centered below board (always shown)
    if (this.mottoText) { this.mottoText.removeFromParent(); this.mottoText.destroy(); this.mottoText = null; }
    const mottoY = br.y + 18;
    const mottoX = tl.x + bw / 2;
    this.mottoText = new Text({
      text: t('board.motto'),
      style: { fontSize: 12, fill: 0xb8956a, fontFamily: 'Noto Serif SC, serif' },
    });
    this.mottoText.anchor.set(0.5);
    this.mottoText.x = mottoX;
    this.mottoText.y = mottoY;
    this.mottoText.alpha = 0.35;
    this.container.addChild(this.mottoText);
  }

  destroy(): void {
    if (this.boardSprite) { this.boardSprite.destroy(); }
    if (this.mottoText) { this.mottoText.destroy(); }
    this.container.destroy({ children: true });
  }
}
