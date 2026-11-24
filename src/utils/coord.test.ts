import { describe, it, expect, beforeEach } from 'vitest';
import { setBoardParams, screenToLogicalMagnetic, logicalToScreen } from './coord';

describe('screenToLogicalMagnetic', () => {
  beforeEach(() => {
    // 设置标准测试棋盘：原点(100, 100)，单元格大小 60px，7列7行（列范围 0..6）
    setBoardParams(100, 100, 60, 7, 7);
  });

  it('棋盘边缘向外探测：远距离不触发吸附（> 0.65 * cellSize = 39px）', () => {
    // 使用最右侧一列 col=6，向右移动（右侧无第7列，纯净测量单点距离）
    const edgePoint = logicalToScreen(6, 2);
    // 偏离 45px，超出 39px 候选阈值
    const res = screenToLogicalMagnetic(edgePoint.x + 45, edgePoint.y);
    expect(res).toBeNull();
  });

  it('吸附预备区（在 27px ~ 39px 之间）：返回 candidate=true 但 locked=false', () => {
    const edgePoint = logicalToScreen(6, 2);
    // 偏离 32px（位于 27px 强锁定与 39px 预备上限之间）
    const res = screenToLogicalMagnetic(edgePoint.x + 32, edgePoint.y);
    expect(res).not.toBeNull();
    expect(res!.point).toEqual({ col: 6, row: 2 });
    expect(res!.isCandidate).toBe(true);
    expect(res!.isLocked).toBe(false);
  });

  it('强磁吸锁定区（<= 0.45 * cellSize = 27px）：返回 locked=true', () => {
    const edgePoint = logicalToScreen(6, 2);
    // 偏离 20px（小于 27px 强锁定阈值）
    const res = screenToLogicalMagnetic(edgePoint.x + 20, edgePoint.y);
    expect(res).not.toBeNull();
    expect(res!.point).toEqual({ col: 6, row: 2 });
    expect(res!.isLocked).toBe(true);
    expect(res!.isCandidate).toBe(true);
  });

  it('防抖迟滞逻辑：已锁定点在 33px 迟滞线内晃动坚决不脱落，超出 33px 才解除强锁定', () => {
    const edgePoint = logicalToScreen(6, 2);
    const lockedPoint = { col: 6, row: 2 };

    // 1. 手指从 20px 晃动到 30px（虽大于 27px，但在迟滞线 33px 内）
    const jitterRes = screenToLogicalMagnetic(edgePoint.x + 30, edgePoint.y, lockedPoint);
    expect(jitterRes).not.toBeNull();
    expect(jitterRes!.point).toEqual(lockedPoint);
    expect(jitterRes!.isLocked).toBe(true);

    // 2. 手指移出到 35px（超出 33px 迟滞脱离线）
    const releaseRes = screenToLogicalMagnetic(edgePoint.x + 35, edgePoint.y, lockedPoint);
    // 脱离强锁定，但仍在预备区（35px < 39px）
    expect(releaseRes).not.toBeNull();
    expect(releaseRes!.point).toEqual(lockedPoint);
    expect(releaseRes!.isLocked).toBe(false);
    expect(releaseRes!.isCandidate).toBe(true);

    // 3. 手指移出到 45px（彻底脱离预备区）
    const outRes = screenToLogicalMagnetic(edgePoint.x + 45, edgePoint.y, lockedPoint);
    expect(outRes).toBeNull();
  });
});
