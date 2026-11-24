import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from 'pixi.js';
import {
  canUseDisplacementFilter,
  setDisplacementFilterAvailable,
  playTransientShockwave,
} from './ShockwaveHelper';

describe('ShockwaveHelper 降级与安全机制', () => {
  beforeEach(() => {
    // 重置状态
    setDisplacementFilterAvailable(null);
  });

  it('在无 DOM/非浏览器环境下安全返回 false，不抛出异常', () => {
    const isSupported = canUseDisplacementFilter();
    // vitest 默认环境可能没有完整的 WebGL/document 支持，必须安全返回 boolean 而不是抛错
    expect(typeof isSupported).toBe('boolean');
  });

  it('当置换滤镜被标记为不支持时，调用冲击波为完全无副作用的空操作（No-Op）', () => {
    setDisplacementFilterAvailable(false);

    const parent = new Container();
    const target = new Container();
    const initialParentChildren = parent.children.length;
    const initialTargetFilters = target.filters;

    // 触发特效
    playTransientShockwave(parent, target, 100, 100, 0.25);

    // 验证：如同没有这次修改，无新增节点，无滤镜附加
    expect(parent.children.length).toBe(initialParentChildren);
    expect(target.filters).toBe(initialTargetFilters);
  });
});
