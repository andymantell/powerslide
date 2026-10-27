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
  // is one push. A sudden flick back throws a powerslide, held until the finger
  // lifts or comes forward again; a second finger held down does the same.
  // A slow drag back stays the air brake. Flicked while steering, the slide
  // becomes a hand-down slide to the inside of the turn (see Player).
  // Lifting the finger centres the steering but holds the tuck or air brake;
  // the next touch carries on from that hold until the finger moves.
  setupTouch() {
    const el = document.getElementById('game');
    if (!el || !('ontouchstart' in window)) return;
    const t = this.touch;
    t.tuck = 0;
    t.air = 0;
    t.pushTime = 0;
    let main = null; // { id, ox, oy, x, y, sx, sy, start, moved, hist, slide, dy }
    const others = new Set();
    let held = 0; // forward/back deflection kept after the finger lifts, in range units
    this.resetTouchHold = () => {
      held = 0;
      if (!main) apply();
    };
    // Full deflection in px, scaled to the screen so an iPad and a phone feel alike.
    const range = () => Math.max(50, Math.min(innerWidth, innerHeight) * 0.11);
    const DEAD = 0.12; // fraction of range ignored around the centre
    // Steering gets twice the travel and an expo curve, so small finger
    // movements make small corrections instead of zig-zagging.
    const STEER_RANGE = 2;
    const STEER_EXPO = 1.8;
    const FLICK_MS = 120; // a flick covers FLICK_DIST of range within this time
    const FLICK_DIST = 0.6;
    const shape = (v) => Math.sign(v) * Math.max(0, Math.min(1, (Math.abs(v) - DEAD) / (1 - DEAD)));
    const apply = () => {
      if (!main) {
        t.steer = 0;
        t.tuck = Math.max(0, shape(-held));
        t.air = Math.max(0, shape(held));
        t.slide = others.size > 0;
        return;
      }
      const r = range();
      // Overshooting drags the centre along, so reversing direction responds at once.
      const clampOrigin = (p, o) => Math.max(p - r, Math.min(p + r, o));
      main.ox = Math.max(main.x - r * STEER_RANGE, Math.min(main.x + r * STEER_RANGE, main.ox));
      main.oy = clampOrigin(main.y, main.oy);
      const dx = (main.x - main.ox) / (r * STEER_RANGE);
      const dy = (main.y - main.oy) / r; // screen down = towards the rider = back
      t.steer = Math.sign(dx) * Math.pow(Math.abs(shape(dx)), STEER_EXPO);
      t.tuck = Math.max(0, shape(-dy));
      t.air = Math.max(0, shape(dy));
      if (main.slide && dy < 0) main.slide = false;
      t.slide = main.slide || others.size > 0;
      main.dy = dy;
    };
    const start = (e) => {
      e.preventDefault();
      for (const c of e.changedTouches) {
        if (!main) {
          const now = performance.now();
          // Start the centre offset so the held tuck / air brake carries on.
          main = { id: c.identifier, ox: c.clientX, oy: c.clientY - held * range(), x: c.clientX, y: c.clientY, sx: c.clientX, sy: c.clientY, start: now, moved: false, hist: [[now, c.clientY]], slide: false };
        } else {
          others.add(c.identifier);
          this.pressed.add('Space');
        }
      }
      apply();
    };
    const move = (e) => {
      e.preventDefault();
      if (!main) return;
      for (const c of e.changedTouches) {
        if (c.identifier !== main.id) continue;
        main.x = c.clientX;
        main.y = c.clientY;
        if (Math.hypot(main.x - main.sx, main.y - main.sy) > range() * DEAD) main.moved = true;
        // Flick detection: how far back the finger has travelled in the last moment.
        const now = performance.now();
        main.hist.push([now, main.y]);
        while (main.hist.length > 2 && now - main.hist[0][0] > FLICK_MS) main.hist.shift();
        if (!main.slide && main.y - main.hist[0][1] > range() * FLICK_DIST) {
          main.slide = true;
          this.pressed.add('Space');
        }
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
          // Letting go of a slide stands the rider back up rather than holding the flick.
          held = main.slide ? 0 : main.dy;
          main = null;
        } else {
          others.delete(c.identifier);
        }
      }
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
    let downAmount = down ? 1 : 0; // how hard: LT is analogue
    let slide = k.has('Space') || k.has('ShiftLeft') || k.has('ShiftRight');

    let padTuck = 0;
    let padPush = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      // Safari can hand over a pad without a gamepadconnected event.
      if (!this.padConnected) {
        this.padConnected = true;
        this.onPad?.(true);
      }
      const ax = gp.axes[0] || 0;
      // Deadzone plus a gentle curve for fine control at speed.
      const dz = 0.12;
      if (Math.abs(ax) > dz) steer = Math.sign(ax) * Math.pow((Math.abs(ax) - dz) / (1 - dz), 1.4);
      // Standard mapping: RT (7) analogue tuck, LT (6) analogue brake, A (0)
      // push, X (2) slide (LB / RB too). The stick only steers, so a hard
      // diagonal never tucks or brakes by accident. D-pad up / down still work.
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const rt = val(7) > 0.05 ? Math.min(1, (val(7) - 0.05) / 0.85) : 0;
      padTuck = Math.max(padTuck, rt, b(7) ? 0.35 : 0);
      if (b(0)) padPush = true;
      if (b(12)) up = true;
      if (b(6) || b(13)) down = true;
      downAmount = Math.max(downAmount, b(13) ? 1 : 0, b(6) ? Math.max(0.35, val(6)) : 0);
      if (b(2) || b(5) || b(4)) slide = true;
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
    this.state.downAmount = downAmount;
    this.state.slide = slide;
    this.state.tuck = Math.max(t.tuck, padTuck);
    this.state.air = t.air;
    this.state.push = t.pushTime > 0 || padPush;
    return this.state;
  }

  endFrame() {
    this.pressed.clear();
  }
}
