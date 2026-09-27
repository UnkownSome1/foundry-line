// Keyboard + mouse with pointer lock. Produces per-tick movement commands and
// edge-triggered actions; mouse look is applied per frame for responsiveness.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.pressed = new Set(); // edges since last consume
    this.mouse = { left: false, right: false, dx: 0, dy: 0 };
    this.mousePressed = { left: false, right: false };
    this.locked = false;
    this.sensitivity = 0.0022;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || (this.locked && ['Space', 'ControlLeft', 'KeyC'].includes(e.code))) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });
    el.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true; }
      if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // clamp spikes some browsers emit on lock
      const mx = Math.max(-300, Math.min(300, e.movementX || 0));
      const my = Math.max(-300, Math.min(300, e.movementY || 0));
      this.mouse.dx += mx;
      this.mouse.dy += my;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) { this.keys.clear(); this.mouse.left = this.mouse.right = false; }
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  lock() {
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { this.el.requestPointerLock(); } catch (_) { /* ignore */ } });
    } catch (_) {
      try { this.el.requestPointerLock(); } catch (__) { /* pointer lock unavailable */ }
    }
  }

  down(code) { return this.keys.has(code); }
  consume(code) {
    const had = this.pressed.has(code);
    this.pressed.delete(code);
    return had;
  }
  takeLook() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = this.mouse.dy = 0;
    return d;
  }
  clearEdges() {
    this.pressed.clear();
    this.mousePressed.left = this.mousePressed.right = false;
  }
}
