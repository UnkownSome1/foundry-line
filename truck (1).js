// Delivery truck route + deterministic pose. Given (phase, phase start time) every
// client computes the same truck position, so the server only has to send phase changes.
import { roadX } from '../mapLayout.js';

export const TRUCK = { length: 7.4, width: 2.5, rearOffset: 3.55, bedHeight: 1.45 };

function catmull(points, per = 10) {
  const out = [];
  const P = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < per; k++) {
      const t = k / per, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

function makeLeg(points, vmax, accel, dir) {
  const pts = catmull(points);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  // trapezoidal speed profile
  let ta = vmax / accel, da = 0.5 * accel * ta * ta;
  let v = vmax;
  if (2 * da > L) { ta = Math.sqrt(L / accel); da = L / 2; v = accel * ta; }
  const tc = (L - 2 * da) / v;
  const duration = 2 * ta + tc;
  const sAt = (t) => {
    if (t <= 0) return 0;
    if (t >= duration) return L;
    if (t < ta) return 0.5 * accel * t * t;
    if (t < ta + tc) return da + v * (t - ta);
    const u = duration - t;
    return L - 0.5 * accel * u * u;
  };
  const speedAt = (t) => (t <= 0 || t >= duration ? 0 : t < ta ? accel * t : t < ta + tc ? v : accel * (duration - t));
  return { pts, cum, L, duration, sAt, speedAt, dir };
}

function sample(leg, s) {
  const { pts, cum } = leg;
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const seg = cum[hi] - cum[lo] || 1;
  const u = Math.min(1, Math.max(0, (s - cum[lo]) / seg));
  const a = pts[lo], b = pts[hi];
  return { x: a[0] + (b[0] - a[0]) * u, z: a[1] + (b[1] - a[1]) * u, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

const roadPts = (from, to, step) => {
  const out = [];
  for (let z = from; step > 0 ? z <= to : z >= to; z += step) out.push([roadX(z), z]);
  return out;
};

const IN = [...roadPts(128, 50, -13), [0, 45], [0, 38], [1.4, 30], [4.6, 24.5], [9, 20.5]];
const REV = [[9, 20.5], [7, 15.5], [4.2, 10], [2.2, 6.4]];
const OUT = [[2.2, 6.4], [4.5, 11], [6.5, 17], [5.2, 24.5], [2.2, 31], [0, 38], [0, 45], ...roadPts(50, 128, 13)];

export const LEGS = {
  inbound: makeLeg(IN, 12, 3.2, 1),
  reversing: makeLeg(REV, 3.3, 1.8, -1),
  outbound: makeLeg(OUT, 12, 2.8, 1),
};

export const PHASE_TIME = {
  loading: 2.5,
  inbound: LEGS.inbound.duration,
  reversing: LEGS.reversing.duration,
  opening: 0.8,
  // dumping duration depends on the manifest: DUMP_INTERVAL per stack + tail
  closing: 1.0,
  outbound: LEGS.outbound.duration,
};
export const DUMP_INTERVAL = 0.45;
export const dumpDuration = (n) => 0.2 + n * DUMP_INTERVAL + 0.4;

/** Truck pose at time `now` for truck state {phase, t0}. */
export function truckPose(truck, now) {
  const t = now - truck.t0;
  const pose = { visible: true, x: 0, z: 0, yaw: 0, speed: 0, reversing: false, gate: 0, phase: truck.phase, t };
  const place = (leg, tt) => {
    const s = sample(leg, leg.sAt(tt));
    pose.x = s.x; pose.z = s.z;
    pose.speed = leg.speedAt(tt);
    pose.reversing = leg.dir < 0;
    pose.yaw = leg.dir > 0 ? Math.atan2(-s.dx, -s.dz) : Math.atan2(s.dx, s.dz);
  };
  switch (truck.phase) {
    case 'idle':
    case 'loading':
      pose.visible = false;
      place(LEGS.inbound, 0);
      break;
    case 'inbound': place(LEGS.inbound, t); break;
    case 'reversing': place(LEGS.reversing, t); break;
    case 'opening': place(LEGS.reversing, 1e9); pose.gate = Math.min(1, t / PHASE_TIME.opening); break;
    case 'dumping': place(LEGS.reversing, 1e9); pose.gate = 1; break;
    case 'closing': place(LEGS.reversing, 1e9); pose.gate = 1 - Math.min(1, t / PHASE_TIME.closing); break;
    case 'outbound': place(LEGS.outbound, t); break;
  }
  return pose;
}

/** World-space rear-door point and backward direction of a pose. */
export function truckRear(pose) {
  const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
  return { x: pose.x - fx * TRUCK.rearOffset, z: pose.z - fz * TRUCK.rearOffset, bx: -fx, bz: -fz };
}

/** Seconds until the truck starts unloading (null if not coming). */
export function truckEta(truck, now) {
  const t = now - truck.t0;
  const order = ['loading', 'inbound', 'reversing', 'opening'];
  const i = order.indexOf(truck.phase);
  if (i < 0) return null;
  let eta = PHASE_TIME[truck.phase] - t;
  for (let k = i + 1; k < order.length; k++) eta += PHASE_TIME[order[k]];
  return Math.max(0, eta);
}

// ------------------------------------------------------------------ pickup van
// Private buyer's van: drives to the outdoor cage east of the hall, loads the goods
// through its side door, three-point turns and leaves.
export const VAN = { length: 5.3, width: 2.1, sideOffset: 1.1 };

const VAN_IN = [...roadPts(128, 50, -13), [0, 45], [0.5, 38], [4, 31], [11, 23], [18.5, 15], [24, 8], [26.3, 1], [26.5, -5.8]];
const VAN_REV = [[26.5, -5.8], [26.8, -1], [28.5, 2.5], [31, 4]];
const VAN_OUT = [[31, 4], [27, 5.5], [21.5, 11], [14, 20], [5, 29], [1, 36], [0, 45], ...roadPts(50, 128, 13)];

export const VAN_LEGS = {
  inbound: makeLeg(VAN_IN, 13, 3.4, 1),
  reversing: makeLeg(VAN_REV, 3.2, 2, -1),
  outbound: makeLeg(VAN_OUT, 13, 3, 1),
};
export const VAN_TIME = { dispatch: 2, inbound: VAN_LEGS.inbound.duration, reversing: VAN_LEGS.reversing.duration, outbound: VAN_LEGS.outbound.duration };
export const VAN_LOAD_INTERVAL = 0.32;
export const vanLoadDuration = (n, interval = VAN_LOAD_INTERVAL) => 0.8 + n * interval + 0.8;

export function vanPose(van, now) {
  const t = now - van.t0;
  const pose = { visible: true, x: 0, z: 0, yaw: 0, speed: 0, reversing: false, door: 0, phase: van.phase, t };
  const place = (leg, tt) => {
    const s = sample(leg, leg.sAt(tt));
    pose.x = s.x; pose.z = s.z;
    pose.speed = leg.speedAt(tt);
    pose.reversing = leg.dir < 0;
    pose.yaw = leg.dir > 0 ? Math.atan2(-s.dx, -s.dz) : Math.atan2(s.dx, s.dz);
  };
  switch (van.phase) {
    case 'idle': case 'dispatch': pose.visible = false; place(VAN_LEGS.inbound, 0); break;
    case 'inbound': place(VAN_LEGS.inbound, t); break;
    case 'loading': {
      place(VAN_LEGS.inbound, 1e9);
      const dur = vanLoadDuration(van.manifest ? van.manifest.length : 0, van.interval || VAN_LOAD_INTERVAL);
      pose.door = Math.min(1, t / 0.5) * Math.min(1, Math.max(0, (dur - t) / 0.5));
      break;
    }
    case 'reversing': place(VAN_LEGS.reversing, t); break;
    case 'outbound': place(VAN_LEGS.outbound, t); break;
  }
  return pose;
}

/** Side-door point (van's left side) of a pose. */
export function vanDoor(pose) {
  const fx = -Math.sin(pose.yaw), fz = -Math.cos(pose.yaw);
  // left of forward (-Z facing) is -X in local space → world (fz, -fx) rotated
  const lx = -Math.cos(pose.yaw), lz = Math.sin(pose.yaw);
  return { x: pose.x + lx * VAN.sideOffset + fx * 0.3, z: pose.z + lz * VAN.sideOffset + fz * 0.3 };
}

export function vanEta(van, now) {
  const t = now - van.t0;
  if (van.phase === 'dispatch') return VAN_TIME.dispatch - t + VAN_TIME.inbound;
  if (van.phase === 'inbound') return VAN_TIME.inbound - t;
  return null;
}
