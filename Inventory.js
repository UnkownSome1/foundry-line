// Slot inventory with stacking. Pure data; serialisable for saves and netcode.
import { ITEMS } from './items.js';

export class Inventory {
  constructor(size = 24) {
    this.size = size;
    this.slots = new Array(size).fill(null);
  }

  count(type) {
    let n = 0;
    for (const s of this.slots) if (s && s.type === type) n += s.count;
    return n;
  }

  /** How many of `type` would fit. */
  space(type) {
    const max = ITEMS[type].stack;
    let n = 0;
    for (const s of this.slots) {
      if (!s) n += max;
      else if (s.type === type) n += max - s.count;
    }
    return n;
  }

  /** Add items; returns the number that did NOT fit. */
  add(type, count) {
    if (!ITEMS[type] || count <= 0) return count;
    const max = ITEMS[type].stack;
    for (const s of this.slots) {
      if (count <= 0) break;
      if (s && s.type === type && s.count < max) {
        const k = Math.min(max - s.count, count);
        s.count += k;
        count -= k;
      }
    }
    for (let i = 0; i < this.size && count > 0; i++) {
      if (!this.slots[i]) {
        const k = Math.min(max, count);
        this.slots[i] = { type, count: k };
        count -= k;
      }
    }
    return count;
  }

  /** Remove exactly `count` of `type` (from the last stacks first). False if not enough. */
  remove(type, count) {
    if (this.count(type) < count) return false;
    for (let i = this.size - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.type === type) {
        const k = Math.min(s.count, count);
        s.count -= k;
        count -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    return true;
  }

  hasAll(req, times = 1) {
    return Object.entries(req).every(([t, n]) => this.count(t) >= n * times);
  }

  removeAll(req, times = 1) {
    if (!this.hasAll(req, times)) return false;
    for (const [t, n] of Object.entries(req)) this.remove(t, n * times);
    return true;
  }

  takeSlot(i, count = Infinity) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(count, s.count);
    s.count -= k;
    if (s.count <= 0) this.slots[i] = null;
    return { type: s.type, count: k };
  }

  move(from, to) {
    if (from === to || from < 0 || to < 0 || from >= this.size || to >= this.size) return;
    const a = this.slots[from], b = this.slots[to];
    if (a && b && a.type === b.type) {
      const max = ITEMS[a.type].stack;
      const k = Math.min(max - b.count, a.count);
      b.count += k;
      a.count -= k;
      if (a.count <= 0) this.slots[from] = null;
      return;
    }
    this.slots[from] = b;
    this.slots[to] = a;
  }

  toJSON() { return this.slots.map((s) => (s ? [s.type, s.count] : 0)); }
  static fromJSON(arr, size = 24) {
    const inv = new Inventory(size);
    (arr || []).slice(0, size).forEach((s, i) => {
      if (Array.isArray(s) && ITEMS[s[0]] && s[1] > 0) inv.slots[i] = { type: s[0], count: Math.min(s[1], ITEMS[s[0]].stack) };
    });
    return inv;
  }
}
