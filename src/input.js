// Keyboard, gamepad and touch input merged into one analogue-ish state.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, up: false, down: false, slide: false };
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.state = { steer: 0, up: false, down: false, slide: false };
    this.kbSteer = 0;
    this.setupTouch();
  }

  setupTouch() {
    const el = document.getElementById('touch');
    if (!el) return;
    if (!('ontouchstart' in window)) return;
    el.classList.add('on');
    const bind = (id, key) => {
      const b = document.getElementById(id);
      const on = (e) => {
        e.preventDefault();
        this.touch[key] = true;
        if (key === 'slide' || key === 'up') this.pressed.add(key === 'slide' ? 'Space' : 'KeyW');
      };
      const off = (e) => {
        e.preventDefault();
        this.touch[key] = false;
      };
      b.addEventListener('touchstart', on, { passive: false });
      b.addEventListener('touchend', off, { passive: false });
      b.addEventListener('touchcancel', off, { passive: false });
    };
    bind('t-up', 'up');
    bind('t-down', 'down');
    bind('t-slide', 'slide');
    const pad = document.getElementById('t-steer');
    const knob = pad.querySelector('.knob');
    const move = (e) => {
      e.preventDefault();
      const t = e.targetTouches[0];
      if (!t) return;
      const r = pad.getBoundingClientRect();
      const x = ((t.clientX - r.left) / r.width) * 2 - 1;
      this.touch.steer = Math.max(-1, Math.min(1, x * 1.2));
      knob.style.transform = `translateX(${this.touch.steer * r.width * 0.38}px)`;
    };
    const end = (e) => {
      e.preventDefault();
      this.touch.steer = 0;
      knob.style.transform = '';
    };
    pad.addEventListener('touchstart', move, { passive: false });
    pad.addEventListener('touchmove', move, { passive: false });
    pad.addEventListener('touchend', end, { passive: false });
  }

  wasPressed(code) {
    return this.pressed.has(code);
  }

  update(dt) {
    const k = this.keys;
    const left = k.has('KeyA') || k.has('ArrowLeft');
    const right = k.has('KeyD') || k.has('ArrowRight');
    // Keyboard steering ramps so tapping gives a gentle correction.
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate = target === 0 ? 6 : Math.sign(target) !== Math.sign(this.kbSteer) ? 8 : 3;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.kbSteer));
    let steer = this.kbSteer;
    let up = k.has('KeyW') || k.has('ArrowUp');
    let down = k.has('KeyS') || k.has('ArrowDown');
    let slide = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) steer = ax;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (b(7) || b(12) || (gp.axes[1] || 0) < -0.5) up = true;
      if (b(6) || b(13) || (gp.axes[1] || 0) > 0.5) down = true;
      if (b(0) || b(5) || b(4)) slide = true;
      if (b(9) && !this.padStart) this.pressed.add('Enter');
      this.padStart = b(9);
      if (b(3) && !this.padY) this.pressed.add('KeyC');
      this.padY = b(3);
    }
    if (this.touch.steer) steer = this.touch.steer;
    up = up || this.touch.up;
    down = down || this.touch.down;
    slide = slide || this.touch.slide;

    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.up = up;
    this.state.down = down;
    this.state.slide = slide;
    return this.state;
  }

  endFrame() {
    this.pressed.clear();
  }
}
