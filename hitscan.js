// Ray vs character hitboxes (head sphere + body box). Positions are feet positions.
import { HITBOX } from './constants.js';

export function rayVsCharacter(ox, oy, oz, dx, dy, dz, px, py, pz, crouch, maxDist) {
  const scale = 1 - 0.33 * crouch;
  let best = null;
  // Head sphere
  const hx = px - ox, hy = py + HITBOX.headY * scale - oy, hz = pz - oz;
  const b = hx * dx + hy * dy + hz * dz;
  const c = hx * hx + hy * hy + hz * hz - HITBOX.headR * HITBOX.headR;
  const disc = b * b - c;
  if (disc >= 0) {
    const t = b - Math.sqrt(disc);
    if (t > 0 && t < maxDist) best = { t, part: 'head' };
  }
  // Body box
  const h = HITBOX.bodyHalf;
  const min = [px - h, py, pz - h];
  const max = [px + h, py + HITBOX.bodyTop * scale, pz + h];
  const o = [ox, oy, oz], d = [dx, dy, dz];
  let tmin = 0, tmax = best ? best.t : maxDist, hit = true;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv, t2 = (max[i] - o[i]) * inv;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) { hit = false; break; }
  }
  if (hit && tmin > 0 && (!best || tmin < best.t)) best = { t: tmin, part: 'body' };
  return best;
}
