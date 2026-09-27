// Deterministic world: seeded heightfield + axis-aligned colliders + queries.
// Pure JS so an authoritative Node server can load the exact same world.

import { MAP } from './constants.js';
import { mulberry32, smoothstep, lerp } from './math.js';
import { createNoise2D, fbm } from './noise.js';
import { buildLayout, roadX, yardDistance, MASK } from './mapLayout.js';

const GRID = 8; // collider broadphase cell size (m)

export class World {
  constructor(seed = MAP.seed) {
    this.seed = seed;
    const rand = mulberry32(seed);
    this.n1 = createNoise2D(rand);
    this.n2 = createNoise2D(rand);
    this.n3 = createNoise2D(rand);

    this.size = MAP.size;
    this.seg = MAP.segments;
    this.cell = this.size / this.seg;
    this.half = this.size / 2;
    this.vpr = this.seg + 1;
    this.heights = new Float32Array(this.vpr * this.vpr);
    let maxH = -Infinity;
    for (let iz = 0; iz < this.vpr; iz++) {
      for (let ix = 0; ix < this.vpr; ix++) {
        const h = this.sampleHeight(-this.half + ix * this.cell, -this.half + iz * this.cell);
        this.heights[iz * this.vpr + ix] = h;
        if (h > maxH) maxH = h;
      }
    }
    this.maxHeight = maxH;

    this.colliders = [];
    this.props = [];
    this.steelTargets = [];
    buildLayout(this, mulberry32(seed ^ 0x5bd1e995));
    this._buildBroadphase();
    this._queryStamp = 0;
  }

  /** Analytic terrain function (sampled once into the grid). */
  sampleHeight(x, z) {
    const d = yardDistance(x, z);
    const rise = smoothstep(3, 46, d);
    const n = fbm(this.n1, x * 0.011, z * 0.011, 4);
    const ridge = 1 - Math.abs(this.n2(x * 0.018 + 7.3, z * 0.018 - 3.1));
    let h = rise * (5 + d * 0.17 + n * 8 + ridge * 5.5);
    h += smoothstep(1, 7, d) * this.n3(x * 0.09, z * 0.09) * 0.35;
    // Access road cut toward the south gate
    if (z > MAP.yardHalfZ - 3) {
      const m = 1 - smoothstep(3.5, 10, Math.abs(x - roadX(z)));
      const roadH = smoothstep(0, 90, z - MAP.yardHalfZ) * 5.5;
      h = lerp(h, Math.min(h, roadH), m);
    }
    return Math.max(h, -1.2);
  }

  _h(ix, iz) {
    ix = ix < 0 ? 0 : ix > this.seg ? this.seg : ix;
    iz = iz < 0 ? 0 : iz > this.seg ? this.seg : iz;
    return this.heights[iz * this.vpr + ix];
  }

  /** Height of the rendered triangle mesh at (x,z) — matches the mesh exactly. */
  heightAt(x, z) {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const h00 = this._h(ix, iz), h10 = this._h(ix + 1, iz);
    const h01 = this._h(ix, iz + 1), h11 = this._h(ix + 1, iz + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  /** Face normal of the terrain triangle under (x,z). */
  normalAt(x, z, out = [0, 1, 0]) {
    const gx = (x + this.half) / this.cell;
    const gz = (z + this.half) / this.cell;
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const c = this.cell;
    let dx, dz;
    if (fx + fz <= 1) {
      dx = (this._h(ix + 1, iz) - this._h(ix, iz)) / c;
      dz = (this._h(ix, iz + 1) - this._h(ix, iz)) / c;
    } else {
      dx = (this._h(ix + 1, iz + 1) - this._h(ix, iz + 1)) / c;
      dz = (this._h(ix + 1, iz + 1) - this._h(ix + 1, iz)) / c;
    }
    const len = Math.hypot(dx, 1, dz);
    out[0] = -dx / len; out[1] = 1 / len; out[2] = -dz / len;
    return out;
  }

  // ------------------------------------------------------------ broadphase
  _buildBroadphase() {
    this.grid = new Map();
    for (const c of this.colliders) this._insert(c);
  }

  _cells(c, fn) {
    const a0 = Math.floor(c.min[0] / GRID), a1 = Math.floor(c.max[0] / GRID);
    const b0 = Math.floor(c.min[2] / GRID), b1 = Math.floor(c.max[2] / GRID);
    for (let gx = a0; gx <= a1; gx++) for (let gz = b0; gz <= b1; gz++) fn(gx * 73856093 ^ gz * 19349663);
  }

  _insert(c) {
    c._q = 0;
    this._cells(c, (k) => {
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(c);
    });
  }

  /** Runtime colliders (placed machines, belts). */
  addCollider(c) {
    this.colliders.push(c);
    this._insert(c);
    return c;
  }

  removeCollider(c) {
    const i = this.colliders.indexOf(c);
    if (i >= 0) this.colliders.splice(i, 1);
    this._cells(c, (k) => {
      const list = this.grid.get(k);
      if (!list) return;
      const j = list.indexOf(c);
      if (j >= 0) list.splice(j, 1);
    });
  }

  /** Colliders whose XZ footprint may overlap the given rectangle. */
  query(minX, minZ, maxX, maxZ, mask = MASK.ALL, out = []) {
    out.length = 0;
    const stamp = ++this._queryStamp;
    const a0 = Math.floor(minX / GRID), a1 = Math.floor(maxX / GRID);
    const b0 = Math.floor(minZ / GRID), b1 = Math.floor(maxZ / GRID);
    for (let gx = a0; gx <= a1; gx++) {
      for (let gz = b0; gz <= b1; gz++) {
        const list = this.grid.get(gx * 73856093 ^ gz * 19349663);
        if (!list) continue;
        for (const c of list) {
          if (c._q === stamp || !(c.mask & mask)) continue;
          c._q = stamp;
          if (c.max[0] < minX || c.min[0] > maxX || c.max[2] < minZ || c.min[2] > maxZ) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  // ------------------------------------------------------------ raycasts
  /**
   * Ray vs world (colliders + terrain).
   * @returns {{t:number, point:number[], normal:number[], surface:string, collider:object|null}|null}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, mask = MASK.BULLET) {
    let best = null;
    let bestT = maxDist;
    const inv = [1 / dx, 1 / dy, 1 / dz];
    const o = [ox, oy, oz];
    for (const c of this.colliders) {
      if (!(c.mask & mask)) continue;
      let tmin = 0, tmax = bestT, axis = -1, sign = 0;
      let miss = false;
      for (let i = 0; i < 3; i++) {
        let t1 = (c.min[i] - o[i]) * inv[i];
        let t2 = (c.max[i] - o[i]) * inv[i];
        let s = -1;
        if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
        if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { miss = true; break; }
      }
      if (miss || axis < 0) continue; // axis<0: ray starts inside
      if (tmin < bestT) {
        bestT = tmin;
        const n = [0, 0, 0];
        n[axis] = sign;
        best = { t: tmin, normal: n, surface: c.surface, collider: c };
      }
    }
    const tt = this.raycastTerrain(ox, oy, oz, dx, dy, dz, bestT);
    if (tt !== null && tt < bestT) {
      bestT = tt;
      const px = ox + dx * tt, pz = oz + dz * tt;
      best = { t: tt, normal: this.normalAt(px, pz), surface: yardDistance(px, pz) < 0.5 ? 'concrete' : 'dirt', collider: null };
    }
    if (best) best.point = [ox + dx * best.t, oy + dy * best.t, oz + dz * best.t];
    return best;
  }

  raycastTerrain(ox, oy, oz, dx, dy, dz, maxDist) {
    const step = 0.6;
    let prevT = 0;
    let prevAbove = oy - this.heightAt(ox, oz);
    if (prevAbove < 0) return 0;
    for (let t = step; t <= maxDist + step; t += step) {
      const tc = Math.min(t, maxDist);
      const y = oy + dy * tc;
      if (y > this.maxHeight + 1 && dy >= 0) return null;
      const above = y - this.heightAt(ox + dx * tc, oz + dz * tc);
      if (above < 0) {
        let lo = prevT, hi = tc;
        for (let i = 0; i < 10; i++) {
          const mid = (lo + hi) / 2;
          const a = oy + dy * mid - this.heightAt(ox + dx * mid, oz + dz * mid);
          if (a < 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevT = tc;
      prevAbove = above;
      if (tc >= maxDist) break;
    }
    return null;
  }

  /** Highest walkable surface under a footprint that is at or below maxY. */
  groundHeight(x, z, r, maxY, scratch = []) {
    let g = this.heightAt(x, z);
    const list = this.query(x - r, z - r, x + r, z + r, MASK.PLAYER, scratch);
    for (const c of list) {
      const top = c.max[1];
      if (top <= maxY && top > g) g = top;
    }
    return g;
  }
}

export { MASK };
