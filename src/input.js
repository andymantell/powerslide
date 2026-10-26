// Keyboard, gamepad and touch input merged into one analogue-ish state.

export class Input {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.touch = { steer: 0, tuck: 0, air: 0, pushTime: 0, slide: false };
    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    // tuck/air are analogue 0..1 (touch); push is a timed stroke from a tap.
    this.state = { steer: 0, up: false, down: false, slide: false, tuck: 0, air: 0, push: false };
    this.kbSteer = 0;
    this.padPrev = [];
    this.padConnected = false;
    addEventListener('gamepadconnected', () => {
      this.padConnected = true;
      this.onPad?.(true);
    });
    addEventListener('gamepaddisconnected', () => {
      const any = [...(navigator.getGamepads?.() || [])].some(Boolean);
      this.padConnected = any;
      if (!any) this.onPad?.(false);
    });
    this.setupTouch();
  }

  // Touch: the whole screen is one invisible analogue area. Wherever a finger
  // lands becomes the centre; dragging left/right steers, forward tucks down
  // progressively and back stands the rider up into an air brake. A quick tap
  // is one push. A second finger held down throws a powerslide.
  setupTouch() {
    const el = document.getElementById('game');
    if (!el || !('ontouchstart' in window)) return;
    const t = this.touch;
    t.tuck = 0;
    t.air = 0;
    t.pushTime = 0;
    let main = null; // { id, ox, oy, x, y, start, moved }
    const others = new Set();
    // Full deflection in px, scaled to the screen so an iPad and a phone feel alike.
    const range = () => Math.max(50, Math.min(innerWidth, innerHeight) * 0.11);
    const DEAD = 0.12; // fraction of range ignored around the centre
    const shape = (v) => Math.sign(v) * Math.max(0, Math.min(1, (Math.abs(v) - DEAD) / (1 - DEAD)));
    const apply = () => {
      if (!main) {
        t.steer = 0;
        t.tuck = 0;
        t.air = 0;
        return;
      }
      const r = range();
      // Overshooting drags the centre along, so reversing direction responds at once.
      const clampOrigin = (p, o) => Math.max(p - r, Math.min(p + r, o));
      main.ox = clampOrigin(main.x, main.ox);
      main.oy = clampOrigin(main.y, main.oy);
      const dx = (main.x - main.ox) / r;
      const dy = (main.y - main.oy) / r; // screen down = towards the rider = back
      t.steer = shape(dx);
      t.tuck = Math.max(0, shape(-dy));
      t.air = Math.max(0, shape(dy));
    };
    const start = (e) => {
      e.preventDefault();
      for (const c of e.changedTouches) {
        if (!main) {
          main = { id: c.identifier, ox: c.clientX, oy: c.clientY, x: c.clientX, y: c.clientY, start: performance.now(), moved: false };
        } else {
          others.add(c.identifier);
          this.pressed.add('Space');
        }
      }
      t.slide = others.size > 0;
      apply();
    };
    const move = (e) => {
      e.preventDefault();
      if (!main) return;
      for (const c of e.changedTouches) {
        if (c.identifier !== main.id) continue;
        main.x = c.clientX;
        main.y = c.clientY;
        if (Math.hypot(main.x - main.ox, main.y - main.oy) > range() * DEAD) main.moved = true;
      }
      apply();
    };
    const end = (e) => {
      e.preventDefault();
      for (const c of e.changedTouches) {
        if (main && c.identifier === main.id) {
          if (!main.moved && performance.now() - main.start < 300) {
            t.pushTime = 0.9; // about one stroke
          }
          main = null;
        } else {
          others.delete(c.identifier);
        }
      }
      t.slide = others.size > 0;
      apply();
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
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
      // Deadzone plus a gentle curve for fine control at speed.
      const dz = 0.12;
      if (Math.abs(ax) > dz) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - dz) / (1 - dz), 1.4);
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      if (b(7) || b(12) || (gp.axes[1] || 0) < -0.5) up = true;
      if (b(6) || b(13) || (gp.axes[1] || 0) > 0.5) down = true;
      if (b(0) || b(5) || b(4)) slide = true;
      // Rising edges for menu navigation: reported as Pad0, Pad1, ...
      const prev = (this.padPrev[gp.index] ||= []);
      gp.buttons.forEach((btn, i) => {
        if (btn.pressed && !prev[i]) this.pressed.add(`Pad${i}`);
        prev[i] = btn.pressed;
      });
    }
    const t = this.touch;
    if (t.steer) steer = t.steer;
    slide = slide || t.slide;
    t.pushTime = Math.max(0, t.pushTime - dt);

    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.up = up;
    this.state.down = down;
    this.state.slide = slide;
    this.state.tuck = t.tuck;
    this.state.air = t.air;
    this.state.push = t.pushTime > 0;
    return this.state;
  }

  endFrame() {
    this.pressed.clear();
  }
}
