// Authoritative weapon state machine. Pure logic: feed it time + inputs, it returns
// events. The same class runs on the client (prediction) and later on the server.
//
// Ammo model is "magazine + chamber": a pistol with a round chambered and a full
// 15-round mag holds 15+1. Firing the last round locks the slide back, which
// forces the longer "empty" reload (mag swap + slide release).

import { DEG, hash01 } from './math.js';

export class WeaponState {
  constructor(def, seed = 1) {
    this.def = def;
    this.seed = seed >>> 0;
    this.mag = def.magSize;
    this.chambered = true;
    this.reserve = def.reserveStart;
    this.slideLocked = false;
    this.magInserted = true;

    this.action = 'idle'; // 'idle' | 'reload'
    this.reloadKind = null; // 'tactical' | 'empty'
    this.actionStart = 0;
    this._pending = []; // queued timeline events [{t, type}]

    this.nextFire = 0;
    this.triggerWasDown = false;
    this.bloom = 0; // extra spread (deg) from sustained fire
    this.shotCount = 0;
  }

  /** Add reserve ammo up to the cap; returns how many were added. */
  addReserve(n) {
    const before = this.reserve;
    this.reserve = Math.min(this.def.reserveMax, this.reserve + n);
    return this.reserve - before;
  }

  /** Top the reserve up to the cap (infinite ammo crate). */
  refill() { return this.addReserve(Infinity); }

  get rounds() {
    return this.mag + (this.chambered ? 1 : 0);
  }

  get reloadTimeline() {
    return this.reloadKind ? this.def.reload[this.reloadKind] : null;
  }

  /** Seconds into the current reload (or -1). */
  reloadElapsed(now) {
    return this.action === 'reload' ? now - this.actionStart : -1;
  }

  canReload() {
    if (this.action !== 'idle' || this.reserve <= 0) return false;
    return this.slideLocked || !this.chambered || this.mag < this.def.magSize;
  }

  startReload(now, events) {
    if (!this.canReload()) return false;
    this.action = 'reload';
    this.reloadKind = this.slideLocked || !this.chambered ? 'empty' : 'tactical';
    this.actionStart = now;
    const tl = this.def.reload[this.reloadKind];
    this._pending = [
      { t: now + tl.magOut, type: 'magOut' },
      { t: now + tl.magIn, type: 'magIn' },
    ];
    if (tl.slideRelease != null) this._pending.push({ t: now + tl.slideRelease, type: 'slideRelease' });
    this._pending.push({ t: now + tl.duration, type: 'reloadEnd' });
    events.push({ type: 'reloadStart', kind: this.reloadKind, t: now });
    return true;
  }

  _applyTimeline(ev, events) {
    switch (ev.type) {
      case 'magOut':
        // Rounds left in the dropped magazine go back to the pool (arcade-friendly).
        this.reserve += this.mag;
        this.mag = 0;
        this.magInserted = false;
        break;
      case 'magIn': {
        const take = Math.min(this.def.magSize, this.reserve);
        this.reserve -= take;
        this.mag = take;
        this.magInserted = true;
        break;
      }
      case 'slideRelease':
        if (this.mag > 0) {
          this.mag--;
          this.chambered = true;
        }
        this.slideLocked = false;
        break;
      case 'reloadEnd':
        this.action = 'idle';
        this.reloadKind = null;
        break;
    }
    events.push({ type: ev.type, kind: this.reloadKind, t: ev.t });
  }

  /**
   * Advance the weapon.
   * @param {number} now   simulation time (s)
   * @param {number} dt    tick length (s)
   * @param {{fire:boolean, reload:boolean}} input
   * @returns {Array} events emitted this tick
   */
  update(now, dt, input) {
    const events = [];
    this.bloom = Math.max(0, this.bloom - this.def.spread.recover * dt);

    // Timeline events that came due.
    while (this._pending.length && this._pending[0].t <= now + 1e-9) {
      this._applyTimeline(this._pending.shift(), events);
    }

    if (input.reload) this.startReload(now, events);

    const pressed = input.fire && !this.triggerWasDown;
    this.triggerWasDown = input.fire;

    if (pressed && this.action === 'idle') {
      if (this.chambered && now >= this.nextFire) {
        this._fire(now, events);
      } else if (!this.chambered) {
        if (this.reserve > 0) this.startReload(now, events);
        else events.push({ type: 'dryFire', t: now });
      }
    }
    return events;
  }

  _fire(now, events) {
    this.chambered = false;
    this.nextFire = now + 60 / this.def.rpm;
    this.shotCount++;
    if (this.mag > 0) {
      this.mag--;
      this.chambered = true;
    } else {
      this.slideLocked = true;
    }
    const s = this.def.spread;
    this.bloom = Math.min(s.max, this.bloom + s.perShot);
    events.push({ type: 'fire', t: now, shot: this.shotCount, lastRound: this.slideLocked });
  }

  /** Current cone half-angle in radians. */
  spread(aimBlend, moveFrac, airborne) {
    const s = this.def.spread;
    const base = s.hip + (s.ads - s.hip) * aimBlend;
    const deg = base + s.move * moveFrac * (1 - 0.7 * aimBlend) + (airborne ? s.air : 0) + this.bloom * (1 - 0.6 * aimBlend);
    return deg * DEG;
  }

  /** Reproducible spread offsets for a given shot: the server can re-derive them. */
  spreadSample(shot, cone) {
    const a = hash01(this.seed, shot * 2) * Math.PI * 2;
    const r = Math.sqrt(hash01(this.seed, shot * 2 + 1)) * cone;
    return { yaw: Math.cos(a) * r, pitch: Math.sin(a) * r };
  }

  damageAt(part, dist) {
    const d = this.def.damage;
    const base = part === 'head' ? d.head : d.body;
    const f = dist <= d.falloffStart ? 1
      : dist >= d.falloffEnd ? d.falloffMin
      : 1 - (1 - d.falloffMin) * ((dist - d.falloffStart) / (d.falloffEnd - d.falloffStart));
    return Math.round(base * f);
  }

  /** Serializable snapshot for netcode. */
  snapshot() {
    return {
      mag: this.mag, chambered: this.chambered, reserve: this.reserve,
      slideLocked: this.slideLocked, action: this.action, reloadKind: this.reloadKind,
      actionStart: this.actionStart,
    };
  }
}
