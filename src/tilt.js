// Tilt-to-steer: turn the phone or tablet like a steering wheel. Gravity from
// the motion sensor is turned into screen coordinates, and the angle of "down"
// within the screen is the wheel angle. That works however steeply the device
// is held, in portrait or landscape. Straight ahead is whatever angle the
// device was at when the run started (or the screen rotated).

const SENSITIVITY = { low: 35, medium: 25, high: 16 }; // degrees of tilt for full lock
export const TILT_SENSITIVITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']];
const DEAD = 2; // degrees ignored either side of straight ahead
const MIN_G = 3; // m/s² of gravity in the screen plane; flatter than this is ignored

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Tilt {
  constructor() {
    this.enabled = false;
    this.sensitivity = 'medium';
    this.angle = null; // latest wheel angle, radians (clockwise = right)
    this.smooth = null;
    this.neutral = 0;
    this.needCal = true;
    this.listening = false;
    addEventListener('orientationchange', () => (this.needCal = true));
    screen.orientation?.addEventListener?.('change', () => (this.needCal = true));
  }

  static get supported() {
    return 'DeviceMotionEvent' in window;
  }

  // Must be called from a tap or click: iOS only asks for motion access then.
  // Resolves true once readings are allowed.
  async request() {
    if (!Tilt.supported) return false;
    const ask = window.DeviceMotionEvent.requestPermission;
    if (typeof ask === 'function') {
      try {
        if ((await ask.call(window.DeviceMotionEvent)) !== 'granted') return false;
      } catch {
        return false;
      }
    }
    this.listen();
    return true;
  }

  listen() {
    if (this.listening) return;
    this.listening = true;
    addEventListener('devicemotion', (e) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      // Device axes to screen axes. window.orientation is 90 when the device
      // is turned anticlockwise (top edge on the left), -90 when clockwise.
      const o = (((window.orientation ?? screen.orientation?.angle ?? 0) * Math.PI) / 180);
      const sx = g.x * Math.cos(o) - g.y * Math.sin(o);
      const sy = g.x * Math.sin(o) + g.y * Math.cos(o);
      if (Math.hypot(sx, sy) < MIN_G) return;
      // Browsers disagree on the sign of gravity; flipping both axes only adds
      // half a turn, which calibration takes out.
      this.angle = Math.atan2(sx, -sy);
    });
  }

  // Straight ahead is however the device is held right now.
  calibrate() {
    this.needCal = true;
  }

  // Steering -1..1, or null when tilt is off or has no readings yet.
  steer(dt) {
    if (!this.enabled || this.angle === null) return null;
    if (this.smooth === null || this.needCal) this.smooth = this.angle;
    // Light smoothing takes out sensor jitter without feeling laggy.
    this.smooth += wrap(this.angle - this.smooth) * (1 - Math.exp(-dt * 18));
    if (this.needCal) {
      this.neutral = this.smooth;
      this.needCal = false;
    }
    const deg = (wrap(this.smooth - this.neutral) * 180) / Math.PI;
    const full = SENSITIVITY[this.sensitivity] || SENSITIVITY.medium;
    const v = Math.max(0, Math.min(1, (Math.abs(deg) - DEAD) / (full - DEAD)));
    return Math.sign(deg) * Math.pow(v, 1.3);
  }
}
