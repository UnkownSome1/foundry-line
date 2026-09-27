// "Plant 07" map layout. Shared by server and client: this file produces BOTH the
// collision boxes (authoritative) and the prop descriptors the client renders.
// Keep every collider axis-aligned (rotations are multiples of 90°).

import { MAP } from './constants.js';
import { FACTORY } from './factory/layout.js';

export const MASK = { PLAYER: 1, BULLET: 2, ALL: 3 };

export const HALL = { x: 0, z: -16, w: 40, d: 24, h: 8, wall: 0.4 };
export const SPAWN = { x: 0, z: 17, yaw: 0 };

export function roadX(z) {
  return Math.sin((z - MAP.yardHalfZ) * 0.028) * 16;
}

/** Distance from (x,z) to the yard rectangle (0 inside). */
export function yardDistance(x, z) {
  const qx = Math.max(Math.abs(x) - MAP.yardHalfX, 0);
  const qz = Math.max(Math.abs(z) - MAP.yardHalfZ, 0);
  return Math.hypot(qx, qz);
}

export function buildLayout(world, rand) {
  const props = world.props;
  const box = (cx, cy, cz, sx, sy, sz, surface, mask = MASK.ALL) => {
    world.colliders.push({
      min: [cx - sx / 2, cy - sy / 2, cz - sz / 2],
      max: [cx + sx / 2, cy + sy / 2, cz + sz / 2],
      surface,
      mask,
    });
  };
  // Box resting on y0 with footprint rotated by 90° steps
  const block = (x, y0, z, sx, sy, sz, rot, surface, mask) => {
    const q = Math.round((rot || 0) / (Math.PI / 2)) & 1;
    box(x, y0 + sy / 2, z, q ? sz : sx, sy, q ? sx : sz, surface, mask);
  };

  // ---------------------------------------------------------------- Factory hall
  const H = HALL;
  const x0 = H.x - H.w / 2, x1 = H.x + H.w / 2;
  const z0 = H.z - H.d / 2, z1 = H.z + H.d / 2;
  const t = H.wall;
  const doors = {
    south: { from: -4, to: 4, h: 5.5 },
    north: { from: 8, to: 14, h: 5 },
    east: { from: -12.4, to: -10, h: 2.6 },
  };
  props.push({ type: 'hall', ...H, doors });

  // South wall (z = z1) with the big roller door
  const wallX = (za, xa, xb, y0, y1) => box((xa + xb) / 2, (y0 + y1) / 2, za, xb - xa, y1 - y0, t, 'metal');
  const wallZ = (xa, za, zb, y0, y1) => box(xa, (y0 + y1) / 2, (za + zb) / 2, t, y1 - y0, zb - za, 'metal');
  wallX(z1, x0, doors.south.from, 0, H.h);
  wallX(z1, doors.south.to, x1, 0, H.h);
  wallX(z1, doors.south.from, doors.south.to, doors.south.h, H.h);
  // North wall
  wallX(z0, x0, doors.north.from, 0, H.h);
  wallX(z0, doors.north.to, x1, 0, H.h);
  wallX(z0, doors.north.from, doors.north.to, doors.north.h, H.h);
  // West wall (solid)
  wallZ(x0, z0, z1, 0, H.h);
  // East wall with a personnel door
  wallZ(x1, z0, doors.east.from, 0, H.h);
  wallZ(x1, doors.east.to, z1, 0, H.h);
  wallZ(x1, doors.east.from, doors.east.to, doors.east.h, H.h);
  // Roof slab (bullets only matter here, nobody can reach it)
  box(H.x, H.h + 0.3, H.z, H.w + 0.4, 0.6, H.d + 0.4, 'metal');

  // Interior columns (I-beams) — centre row removed to open up the factory floor
  for (const cx of [-10, 10]) for (const cz of [-22, -10]) {
    props.push({ type: 'column', x: cx, z: cz, h: H.h });
    box(cx, H.h / 2, cz, 0.42, H.h, 0.42, 'metal');
  }
  props.push({ type: 'craneBeam', x: 0, z: -16, len: H.w - 1, y: 7.1 });

  // ---------------------------------------------------------------- Factory (empty floor)
  // Machines and belts are placed at runtime (FactorySim adds their colliders).
  props.push({ type: 'factory' });
  const FX = FACTORY;
  box(FX.terminal.x, 0.475, FX.terminal.z, FX.terminal.w, 0.95, FX.terminal.d, 'metal');
  const hp = FX.sell.hopper;
  box(hp.x, hp.h / 2, hp.z, hp.w, hp.h, hp.d, 'metal');
  // outdoor pickup cage (fence panels on three sides, open to the van)
  const cg = FX.cage;
  box((cg.x0 + cg.x1) / 2, 1.1, cg.z0, cg.x1 - cg.x0, 2.2, 0.1, 'fence', MASK.PLAYER);
  box((cg.x0 + cg.x1) / 2, 1.1, cg.z1, cg.x1 - cg.x0, 2.2, 0.1, 'fence', MASK.PLAYER);
  for (const c of FX.ammoCrates) block(c.x, 0, c.z, 1.1, 0.62, 0.62, c.rot, 'wood');

  // ------------------------------------------------------- Outdoor landmarks
  props.push({ type: 'chimney', x: -38, z: -32, r0: 2.4, r1: 1.5, h: 30 });
  box(-38, 15, -32, 4.6, 30, 4.6, 'brick');

  for (const s of [{ x: 36, z: -31 }, { x: 36, z: -21 }]) {
    props.push({ type: 'silo', ...s, r: 3.1, h: 12 });
    box(s.x, 7, s.z, 6.2, 14, 6.2, 'metal');
  }
  props.push({ type: 'pipeRack', fromX: 20, toX: 33, zs: [-29.5, -22.5], y: 5.2 });
  for (const px of [24.5, 29]) for (const pz of [-29.5, -22.5]) box(px, 2.6, pz, 0.3, 5.2, 0.3, 'metal');

  props.push({ type: 'generator', x: -24.5, z: -31, rot: 0 });
  block(-24.5, 0, -31, 3.2, 2.1, 1.8, 0, 'metal');

  // Shipping containers (ISO 20 ft: 6.06 × 2.59 × 2.44)
  const CW = 6.06, CH = 2.59, CD = 2.44;
  const containers = [
    { x: -32, z: 14, y: 0, rot: 0, color: 0x8e3b2c, code: 'FDRU 204817 3' },
    { x: -31.4, z: 14, y: CH, rot: 0, color: 0x2f5d8a, code: 'MSKU 771042 6' },
    { x: -23, z: 25, y: 0, rot: Math.PI / 2, color: 0x3f6b4a, code: 'TGHU 318265 0' },
    { x: 28, z: 18, y: 0, rot: 0, color: 0xc0612b, code: 'FDRU 204822 1' },
    { x: 28, z: 20.6, y: 0, rot: 0, color: 0x6f7478, code: 'CAIU 552910 4' },
    { x: 28.4, z: 19.3, y: CH, rot: 0, color: 0x8e3b2c, code: 'FDRU 204840 9' },
    { x: 40, z: 5, y: 0, rot: Math.PI / 2, color: 0x2f5d8a, code: 'MSKU 771188 2' },
    { x: -6, z: 31, y: 0, rot: 0, color: 0x7a4a2a, code: 'FDRU 204851 5' },
  ];
  for (const c of containers) {
    props.push({ type: 'container', ...c, w: CW, h: CH, d: CD });
    block(c.x, c.y, c.z, CW, CH, CD, c.rot, 'metal');
  }

  // Forklift parked by the containers
  props.push({ type: 'forklift', x: 19, z: 10, rot: Math.PI / 2 });
  block(19, 0, 10, 1.25, 2.2, 2.6, Math.PI / 2, 'metal');

  // Wooden crates [x, z, size, stackLevel]
  const crates = [
    [-8, 6, 1.2, 0], [-6.7, 6.1, 1.2, 0], [-7.4, 6, 1.2, 1],
    [-10, 20, 1.2, 0], [-8.7, 20.2, 0.9, 0],
    [-17, -1, 1.2, 0], [-17, 0.3, 1.2, 0], [-17, -0.3, 1.2, 1],
    [31, -8, 1.2, 0], [32.3, -8.4, 1.2, 0],
    [-40, 2, 1.2, 0], [-38.7, 2.4, 0.9, 0],
    [42, 30, 1.2, 0], [22, 32, 1.2, 0], [22.3, 33.3, 0.9, 0],
  ];
  const crateH = {}; // track stack height per slot
  for (const [x, z, s, lvl] of crates) {
    const key = `${Math.round(x)}|${Math.round(z)}`;
    const y = lvl ? (crateH[key] ?? 1.2) : 0;
    crateH[key] = y + s;
    const rot = (rand() - 0.5) * 0.001; // keep axis aligned; tiny jitter is visual only
    props.push({ type: 'crate', x, y, z, s, rot, variant: Math.floor(rand() * 3) });
    box(x, y + s / 2, z, s, s, s, 'wood');
  }

  // Oil drums
  const drums = [
    [-14, 10], [-13.3, 10.4], [-14.2, 10.8], [-13.5, 11.3],
    [22, -2], [22.7, -2.3], [22.3, -1.5],
    [-45, 30], [-44.3, 30.4], [27, -12], [27.7, -12.3],
  ];
  for (const [x, z] of drums) {
    const color = rand() < 0.5 ? 0x9c2f24 : rand() < 0.5 ? 0x2d5f86 : 0x5a6b3a;
    props.push({ type: 'drum', x, z, color, tilt: rand() });
    box(x, 0.45, z, 0.6, 0.9, 0.6, 'metal');
  }

  // Pallets of bagged product
  for (const [x, z] of [[3, 21], [4.4, 21], [-26, -6]]) {
    props.push({ type: 'palletLoad', x, z });
    box(x, 0.55, z, 1.2, 1.1, 1.0, 'wood');
  }

  // Jersey barriers at the south gate
  for (const [x, z, rot] of [[-9, 36, 0], [9, 36, 0]]) {
    props.push({ type: 'barrier', x, z, rot });
    block(x, 0, z, 2.2, 0.85, 0.65, rot, 'concrete');
  }

  // Steel target plates (shooting lane on the west side)
  const plates = [];
  for (let i = 0; i < 4; i++) {
    const p = { type: 'steelTarget', x: -45, z: 12 + i * 4.5, facing: Math.PI / 2, id: i, size: i % 2 ? 0.45 : 0.35 };
    props.push(p);
    plates.push(p);
    box(-45.25, 0.8, p.z, 0.2, 1.6, 1.3, 'metal', MASK.PLAYER);
  }
  world.steelTargets = plates;

  // Chain-link perimeter fence with gaps
  const F = { x: 50, z: 40, h: 2.4 };
  const gaps = {
    s: [[-6.5, 6.5]], n: [[-31, -24]], e: [[9, 16]], w: [[-11, -4]],
  };
  const fenceRun = (axis, fixed, from, to, side) => {
    const cuts = gaps[side];
    let a = from;
    const segs = [];
    for (const [g0, g1] of cuts) {
      if (g0 > a) segs.push([a, g0]);
      a = g1;
    }
    if (a < to) segs.push([a, to]);
    for (const [s0, s1] of segs) {
      props.push({ type: 'fence', axis, fixed, from: s0, to: s1, h: F.h });
      if (axis === 'x') box((s0 + s1) / 2, F.h / 2, fixed, s1 - s0, F.h, 0.12, 'fence', MASK.PLAYER);
      else box(fixed, F.h / 2, (s0 + s1) / 2, 0.12, F.h, s1 - s0, 'fence', MASK.PLAYER);
    }
  };
  fenceRun('x', F.z, -F.x, F.x, 's');
  fenceRun('x', -F.z, -F.x, F.x, 'n');
  fenceRun('z', F.x, -F.z, F.z, 'e');
  fenceRun('z', -F.x, -F.z, F.z, 'w');
  props.push({ type: 'boomGate', x: -6.5, z: 40.6, len: 12 });

  // Lamp posts
  for (const [x, z] of [[-46, -36], [46, -36], [-46, 36], [46, 36], [24, 2], [-27, 4], [-12.5, 38]]) {
    props.push({ type: 'lamp', x, z, face: Math.atan2(-x, -z) });
    box(x, 3.5, z, 0.3, 7, 0.3, 'metal');
  }

  // Timber power poles following the access road
  const poles = [];
  for (let z = 48; z < 124; z += 17) {
    const x = roadX(z) + 7.5;
    const y = world.heightAt(x, z);
    poles.push({ x, y, z });
    box(x, y + 4.5, z, 0.35, 9, 0.35, 'wood');
  }
  props.push({ type: 'powerLine', poles });

  // --------------------------------------------------------------- Nature
  const nearRoad = (x, z) => z > MAP.yardHalfZ - 4 && Math.abs(x - roadX(z)) < 10;
  const scatter = (count, minD, fn) => {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 20) {
      tries++;
      const x = (rand() * 2 - 1) * (MAP.bound + 4);
      const z = (rand() * 2 - 1) * (MAP.bound + 4);
      const d = yardDistance(x, z);
      if (d < minD || nearRoad(x, z)) continue;
      if (fn(x, z, d)) placed++;
    }
  };
  const trees = [];
  scatter(230, 7, (x, z, d) => {
    // denser further out
    if (rand() > 0.35 + d / 60) return false;
    const kind = rand() < 0.78 ? 'pine' : 'broadleaf';
    const s = 0.75 + rand() * 0.7;
    const y = world.heightAt(x, z);
    trees.push({ x, y, z, s, kind, rot: rand() * Math.PI * 2, tint: rand() });
    box(x, y + 1.5 * s, z, 0.45 * s, 3 * s, 0.45 * s, 'wood');
    return true;
  });
  props.push({ type: 'trees', items: trees });

  const rocks = [];
  scatter(90, 5, (x, z) => {
    const s = 0.4 + Math.pow(rand(), 2) * 2.4;
    const y = world.heightAt(x, z);
    rocks.push({ x, y, z, s, rot: rand() * Math.PI * 2, variant: Math.floor(rand() * 4), tint: rand() });
    if (s > 0.8) box(x, y + s * 0.35, z, s * 1.3, s * 0.9, s * 1.3, 'rock');
    return true;
  });
  props.push({ type: 'rocks', items: rocks });
}
