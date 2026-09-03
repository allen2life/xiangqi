import { Container, Sprite, Texture } from 'pixi.js';

/**
 * 通用 Sprite 对象池，缓解 Pixi 对象频繁创建/销毁导致的 GC 压力。
 *
 * 使用方式：
 *   const sp = pool.acquire(texture);
 *   // ... 用完后
 *   pool.release(sp);
 *
 * 池按 texture 引用分组缓存释放后的 Sprite，acquire 命中即复用。
 * 不限定 texture 的 Sprite 用 `acquire(undefined)`，使用前自行 `sp.texture = tex`。
 */
export class SpritePool {
  private free = new Map<Texture | undefined, Sprite[]>();
  private inUse = new Set<Sprite>();
  private parent: Container;

  constructor(parent: Container) {
    this.parent = parent;
  }

  acquire(texture?: Texture): Sprite {
    const list = this.free.get(texture);
    if (list && list.length > 0) {
      const sp = list.pop()!;
      sp.texture = texture ?? Texture.EMPTY;
      sp.visible = true;
      sp.alpha = 1;
      sp.tint = 0xffffff;
      sp.scale.set(1);
      sp.rotation = 0;
      sp.x = 0;
      sp.y = 0;
      this.inUse.add(sp);
      if (sp.parent !== this.parent) this.parent.addChild(sp);
      return sp;
    }
    const sp = new Sprite(texture ?? Texture.EMPTY);
    this.inUse.add(sp);
    this.parent.addChild(sp);
    return sp;
  }

  release(sp: Sprite): void {
    if (!this.inUse.has(sp)) return;
    this.inUse.delete(sp);
    sp.visible = false;
    const key = sp.texture;
    let list = this.free.get(key);
    if (!list) { list = []; this.free.set(key, list); }
    list.push(sp);
  }

  releaseAll(): void {
    for (const sp of this.inUse) {
      sp.visible = false;
      const key = sp.texture;
      let list = this.free.get(key);
      if (!list) { list = []; this.free.set(key, list); }
      list.push(sp);
    }
    this.inUse.clear();
  }

  destroy(): void {
    for (const list of this.free.values()) {
      for (const sp of list) sp.destroy();
    }
    for (const sp of this.inUse) sp.destroy();
    this.free.clear();
    this.inUse.clear();
  }
}
