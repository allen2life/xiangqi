import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { SkillEffectPlayer } from './SkillEffectPlayer';
import { INK_THEME } from './themes/InkTheme';
import { PieceType } from '../core/types';
import type { ResolveStep } from '../core/types';

/**
 * R1 回归测试：onStepClimax（命中音/触觉/称号）必须在 reduceMotion 模式下仍触发。
 * 声音与称号并非视觉运动，不应被 prefers-reduced-motion 门控。
 *
 * 用例让 timeline 自然播放（gsap ticker 驱动），用 vi.waitFor 等待首命中时刻回调触发，
 * 不依赖 seek 的回调触发行为，确定性更好。
 */

// 构造一个最小有效的结算步骤：1 个敌方目标。INK_THEME 中 PAWN 的 cast.duration=0.2s，
// 非 char_fly 路径下 hitStart = cast.duration = 0.2s。
function makeStep(): ResolveStep {
  return {
    playerPieceIndex: 0,
    origin: { col: 4, row: 5 },
    targets: [{ col: 4, row: 3, eid: 'e1' }],
  };
}

const players: SkillEffectPlayer[] = [];
afterEach(() => {
  for (const p of players) p.destroy();
  players.length = 0;
});

describe('SkillEffectPlayer.onStepClimax (R1: reduceMotion 不应静音命中反馈)', () => {
  it('reduceMotion=true 时仍在首命中时刻触发 onStepClimax', async () => {
    const player = new SkillEffectPlayer(INK_THEME);
    players.push(player);
    player.setReduceMotion(true);
    let fired = false;
    player.onStepClimax = () => { fired = true; };

    const layer = new Container();
    player.playSteps(layer, [makeStep()], [PieceType.PAWN], () => {});

    await vi.waitFor(() => { if (!fired) throw new Error('climax 未触发'); }, { timeout: 2000, interval: 10 });
    expect(fired).toBe(true);
  });

  it('reduceMotion=false 时同样触发 onStepClimax（无反向回归）', async () => {
    const player = new SkillEffectPlayer(INK_THEME);
    players.push(player);
    player.setReduceMotion(false);
    let fired = false;
    player.onStepClimax = () => { fired = true; };

    const layer = new Container();
    player.playSteps(layer, [makeStep()], [PieceType.PAWN], () => {});

    await vi.waitFor(() => { if (!fired) throw new Error('climax 未触发'); }, { timeout: 2000, interval: 10 });
    expect(fired).toBe(true);
  });

  it('onStepClimax 在 hitStart(>0) 触发，而非时间线起点', async () => {
    const player = new SkillEffectPlayer(INK_THEME);
    players.push(player);
    player.setReduceMotion(true);
    let fired = false;
    player.onStepClimax = () => { fired = true; };

    const layer = new Container();
    player.playSteps(layer, [makeStep()], [PieceType.PAWN], () => {});
    // 同步时刻（首个 tick 之前）不应触发——climax 在 hitStart(~0.2s)
    expect(fired).toBe(false);

    await vi.waitFor(() => { if (!fired) throw new Error('climax 未触发'); }, { timeout: 2000, interval: 10 });
    expect(fired).toBe(true);
  });
});
