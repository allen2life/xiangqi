import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Minimal In-Memory DOM implementation for Node test environment ──
class FakeElement {
  id: string = '';
  className: string = '';
  tagName: string = 'div';
  _textContent: string = '';
  dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  checked: boolean = false;
  classList = {
    classes: new Set<string>(),
    add: (c: string) => { this.classList.classes.add(c); this.className = [...this.classList.classes].join(' '); },
    remove: (c: string) => { this.classList.classes.delete(c); this.className = [...this.classList.classes].join(' '); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  private listeners: Record<string, ((e?: any) => void)[]> = {};

  constructor(id = '', className = '', tagName = 'div') {
    this.id = id;
    this.className = className;
    this.tagName = tagName;
    if (className) {
      className.split(/\s+/).filter(Boolean).forEach(c => this.classList.classes.add(c));
    }
  }

  get textContent(): string {
    if (this._textContent) return this._textContent;
    return this.children.map(c => c.textContent).join(' ').trim();
  }

  set textContent(val: string) {
    this._textContent = val;
  }

  set innerHTML(html: string) {
    this.children = [];
    const parsed = parseHTML(html, fakeRegistry);
    for (const child of parsed) {
      this.appendChild(child);
    }
  }

  addEventListener(event: string, fn: (e?: any) => void) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  click() {
    this.listeners['click']?.forEach(fn => fn({ target: this, stopPropagation: () => {} }));
  }

  remove() {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx >= 0) this.parentElement.children.splice(idx, 1);
      this.parentElement = null;
    }
    if (this.id) fakeRegistry.delete(this.id);
  }

  appendChild(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) fakeRegistry.set(child.id, child);
  }

  querySelector(sel: string): FakeElement | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }

  querySelectorAll(sel: string): FakeElement[] {
    const results: FakeElement[] = [];
    const check = (el: FakeElement) => {
      let match = false;
      if (sel.startsWith('#')) {
        match = el.id === sel.slice(1);
      } else if (sel.startsWith('.')) {
        const parts = sel.split('.').filter(Boolean);
        match = parts.every(p => el.classList.contains(p));
      }
      if (match) results.push(el);
      for (const ch of el.children) check(ch);
    };
    for (const ch of this.children) check(ch);
    return results;
  }
}

function parseHTML(html: string, registry: Map<string, FakeElement>): FakeElement[] {
  const root = new FakeElement();
  const stack: FakeElement[] = [root];
  const tokenRegex = /<!--[\s\S]*?-->|<(\/)?([a-z0-9-]+)([^>]*)>|([^<]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const [full, isClosing, tagName, attrs, text] = match;
    if (full.startsWith('<!--')) continue;
    if (text) {
      const trimmed = text.trim();
      if (trimmed) {
        const top = stack[stack.length - 1];
        top._textContent = (top._textContent ? top._textContent + ' ' : '') + trimmed;
      }
      continue;
    }
    if (isClosing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    // Opening tag
    const idMatch = /\bid=["']([^"']+)["']/.exec(attrs);
    const classMatch = /\bclass=["']([^"']+)["']/.exec(attrs);
    const id = idMatch ? idMatch[1] : '';
    const className = classMatch ? classMatch[1] : '';
    const el = new FakeElement(id, className, tagName);
    if (id) registry.set(id, el);

    const parent = stack[stack.length - 1];
    parent.appendChild(el);

    const isVoid = /^(img|input|br|hr|meta|link)$/i.test(tagName) || attrs.trim().endsWith('/');
    if (!isVoid) {
      stack.push(el);
    }
  }

  return root.children;
}

const fakeRegistry = new Map<string, FakeElement>();
const fakeBody = new FakeElement('body', '', 'body');
const fakeDocument = {
  body: fakeBody,
  getElementById: (id: string) => fakeRegistry.get(id) ?? null,
  createElement: (tag: string) => new FakeElement('', '', tag),
  querySelector: (sel: string) => fakeBody.querySelector(sel),
};

vi.stubGlobal('document', fakeDocument);

// ── Mocks (hoisted) ──
vi.mock('../../wasm/EngineBridge', () => ({
  engineBridge: {
    getPlatformGold: vi.fn().mockReturnValue(8888),
    getPlatformItemCount: vi.fn().mockImplementation((id: string) => id === 'loong_soul' ? 12 : 0),
  },
}));

vi.mock('../../core/SaveManager', () => ({
  SaveManager: {
    getNickname: vi.fn().mockReturnValue('风清扬'),
    getMaxLevel: vi.fn().mockReturnValue(5),
    getAllLevelStars: vi.fn().mockReturnValue({ 1: 3, 2: 3, 3: 2, 4: 3, 5: 1 }),
  },
}));

vi.mock('../../i18n', () => ({
  t: vi.fn((key: string, params?: Record<string, string | number>) => {
    let text = key;
    if (key === 'start.btnChallengeLevel') text = '第 {level} 关 · 挑战';
    if (!params) return text;
    return Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), text);
  }),
}));

vi.mock('../sealDefs', () => ({
  SEAL_TIERS: [
    { tier: 0, id: 'chushi', threshold: 1 },
    { tier: 1, id: 'pozhen', threshold: 3 },
  ],
  getCurrentSealTier: vi.fn().mockReturnValue({ tier: 1, id: 'pozhen', threshold: 3 }),
  getAuthoritativeStar3Wins: vi.fn().mockReturnValue(4),
}));

vi.mock('./FtueController', () => ({
  FtueController: class {
    static isNeeded = vi.fn().mockReturnValue(false);
    showWelcome = vi.fn();
  },
}));

vi.mock('../../utils/buildInfo', () => ({
  formatBuildLabel: vi.fn().mockReturnValue('1.0.0-test'),
}));

import { StartMenuController } from './StartMenuController';
import type { DomUIContext } from '../DomUIContext';

describe('StartMenuController Chinese Classical Lobby', () => {
  let ctx: DomUIContext;
  let container: FakeElement;

  beforeEach(() => {
    fakeRegistry.clear();
    container = new FakeElement('ui-start-menu', 'hidden');
    fakeRegistry.set('ui-start-menu', container);
    fakeBody.children = [container];

    ctx = {
      state: {} as any,
      host: {
        onLeaderboard: vi.fn(),
        onSealBookOpen: vi.fn(),
        onCloudSync: vi.fn(),
        onBackpackOpen: vi.fn(),
      } as any,
    };
  });

  it('renders classical lobby structure with profile, currencies, hero cta, and 2x2 dock', () => {
    const ctrl = new StartMenuController(ctx);
    const onStart = vi.fn();
    ctrl.showStartMenu(onStart);

    expect(container.classList.contains('hidden')).toBe(false);

    // Profile Bar
    const nicknameEl = container.querySelector('.lobby-nickname');
    expect(nicknameEl?.textContent).toBe('风清扬');

    // Currencies
    const goldEl = container.querySelector('#currency-gold');
    expect(goldEl).not.toBeNull();
    const soulEl = container.querySelector('#currency-soul');
    expect(soulEl).not.toBeNull();
    const starEl = container.querySelector('.currency-pill.stars');
    expect(starEl).not.toBeNull();

    // Hero Battle CTA: current challenge level is maxLevel + 1 = 6
    const heroBtn = container.querySelector('#btn-new-game');
    expect(heroBtn).not.toBeNull();
    const badgeEl = heroBtn?.querySelector('.hero-btn-badge');
    expect(badgeEl?.textContent).toContain('6');

    // Sub action buttons
    expect(container.querySelector('#btn-endless-ladder')).not.toBeNull();
    expect(container.querySelector('#btn-level-select')).not.toBeNull();

    // 2x2 Utility Dock
    expect(container.querySelector('#btn-leaderboard')).not.toBeNull();
    expect(container.querySelector('#btn-seal-book')).not.toBeNull();
    expect(container.querySelector('#btn-daily-tasks')).not.toBeNull();
    expect(container.querySelector('#btn-cloud-sync')).not.toBeNull();

    // Footer Rules and Version
    expect(container.querySelector('#btn-rules')).not.toBeNull();
    expect(container.querySelector('.start-version')?.textContent).toContain('1.0.0-test');
  });

  it('clicking hero CTA triggers onStart with current challenge level', () => {
    const ctrl = new StartMenuController(ctx);
    const onStart = vi.fn();
    ctrl.showStartMenu(onStart);

    const heroBtn = container.querySelector('#btn-new-game')!;
    heroBtn.click();

    // debug=false, startLevel=6, isCampaign=false
    expect(onStart).toHaveBeenCalledWith(false, 6, false);
  });

  it('clicking dock buttons routes to host callbacks', () => {
    const ctrl = new StartMenuController(ctx);
    ctrl.showStartMenu(vi.fn());

    (container.querySelector('#btn-leaderboard') as FakeElement).click();
    expect(ctx.host.onLeaderboard).toHaveBeenCalled();

    (container.querySelector('#btn-seal-book') as FakeElement).click();
    expect(ctx.host.onSealBookOpen).toHaveBeenCalled();

    (container.querySelector('#btn-cloud-sync') as FakeElement).click();
    expect(ctx.host.onCloudSync).toHaveBeenCalled();

    (container.querySelector('#currency-gold') as FakeElement).click();
    expect(ctx.host.onBackpackOpen).toHaveBeenCalled();
  });

  it('clicking rules button opens help modal', () => {
    const ctrl = new StartMenuController(ctx);
    ctrl.showStartMenu(vi.fn());

    (container.querySelector('#btn-rules') as FakeElement).click();
    const helpModal = fakeDocument.getElementById('help-modal');
    expect(helpModal).not.toBeNull();
  });

  it('rapidly clicking title 5 times reveals debug toggle', () => {
    const ctrl = new StartMenuController(ctx);
    ctrl.showStartMenu(vi.fn());

    const title = container.querySelector('#start-title') as FakeElement;
    const debugToggle = container.querySelector('#debug-toggle') as FakeElement;
    expect(debugToggle.classList.contains('hidden')).toBe(true);

    for (let i = 0; i < 5; i++) {
      title.click();
    }

    expect(debugToggle.classList.contains('hidden')).toBe(false);
  });
});
