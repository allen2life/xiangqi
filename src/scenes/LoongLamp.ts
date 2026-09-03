// LoongLamp — DOM element: purple lamp showing loong soul count
// Positioned on the left side of HUD, fixed via CSS
// GSAP for breathing and pulse animations

import gsap from 'gsap';

const LAMP_HTML = `
<div id="loong-lamp" style="display:none">
  <div class="lamp-string"></div>
  <div class="lamp-glow"></div>
  <span class="lamp-count">0</span>
  <div class="lamp-tassels">
    <span class="tassel"></span>
    <span class="tassel"></span>
    <span class="tassel"></span>
    <span class="tassel"></span>
    <span class="tassel"></span>
  </div>
</div>`;

export class LoongLamp {
  private el: HTMLElement;
  private countEl: HTMLElement;
  private glowEl: HTMLElement;
  private count = 0;

  constructor() {
    // Inject into document body
    const existing = document.getElementById('loong-lamp');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', LAMP_HTML);
    this.el = document.getElementById('loong-lamp')!;
    this.countEl = this.el.querySelector('.lamp-count')!;
    this.glowEl = this.el.querySelector('.lamp-glow')!;
    // Set initial scale via GSAP (overrides CSS transform for consistency)
    gsap.set(this.el, { scale: 0.8 });
    gsap.set(this.glowEl, { opacity: 0.5 });
  }

  get container(): HTMLElement { return this.el; }

  show(): void {
    this.el.style.display = '';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  setCount(n: number): void {
    this.count = n;
    this.countEl.textContent = n > 99 ? '···' : String(n);
    // Glow intensifies with count
    const glowAlpha = Math.min(0.7, 0.15 + n * 0.004);
    this.el.style.setProperty('--glow-alpha', String(glowAlpha));
  }

  getCount(): number { return this.count; }

  /** 龙魂飞升入灯时的动效 — 闪亮 + 弹跳 + 计数弹缩 */
  pulseArrival(): void {
    // Glow flash
    gsap.to(this.glowEl, {
      opacity: 1, scale: 1.4, duration: 0.15,
      yoyo: true, repeat: 1, ease: 'power2.out',
    });
    // Body bounce
    gsap.to(this.el, {
      scale: 1.08, duration: 0.12,
      yoyo: true, repeat: 1, ease: 'power2.out',
    });
    // Count pop
    gsap.fromTo(this.countEl, { scale: 0.6 }, {
      scale: 1.3, duration: 0.12,
      yoyo: true, repeat: 1, ease: 'back.out',
    });
  }

  /** 锻造/升级动效 — 强力的震弹 */
  pulseForge(): void {
    gsap.to(this.glowEl, {
      opacity: 1, scale: 1.6, duration: 0.2,
      yoyo: true, repeat: 1, ease: 'back.out',
    });
    gsap.to(this.el, {
      scale: 1.25, duration: 0.25,
      yoyo: true, repeat: 1, ease: 'back.out',
    });
    gsap.fromTo(this.countEl, { scale: 0.5 }, {
      scale: 1.5, duration: 0.2,
      yoyo: true, repeat: 1, ease: 'back.out',
    });
  }

  destroy(): void {
    gsap.killTweensOf(this.el);
    gsap.killTweensOf(this.glowEl);
    gsap.killTweensOf(this.countEl);
    this.el.remove();
  }
}
