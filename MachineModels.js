// Low-poly machine models in their own local frame (operator side faces +Z),
// matching the footprints/colliders in shared/factory/items.js. Each builder returns
// { root, anim(dt, running, progress, t, ctx), lamp?, labelY }.
// Static parts go in `st` (merged per material), animated parts in `dyn`.
import * as THREE from 'three';
import { materials } from '../gfx/materials.js';
import { chamferBox, batchStatic, cyl } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { MACHINES } from '../../shared/factory/items.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cb = chamferBox;
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

export function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

let MM = null;
export function machineMats() {
  if (MM) return MM;
  MM = {
    orange: std(0xe8731c, { roughness: 0.5, metalness: 0.2, flatShading: true }),
    robotDark: std(0x2b2d30, { roughness: 0.5, metalness: 0.4, flatShading: true }),
    esd: std(0x2f5f86, { roughness: 0.85 }),
    bench: std(0x8a6a44, { roughness: 0.8 }),
    plastic: std(0xd9d4c7, { roughness: 0.6 }),
    board: std(0x55606a, { roughness: 0.8 }),
    clear: new THREE.MeshStandardMaterial({ color: 0xcfe6ee, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
    brassBin: std(0xd4a94f, { metalness: 0.9, roughness: 0.35, flatShading: true }),
    copperBin: std(0xb8683a, { metalness: 0.9, roughness: 0.35, flatShading: true }),
    olive: std(0x55603a, { roughness: 0.8, flatShading: true }),
    darkGrey: std(0x2a2c2e),
    midGrey: std(0x4a5056),
    heater: std(0x6a3a22, { roughness: 0.5, metalness: 0.5 }),
    screenGreen: std(0x103428, { emissive: 0x3cffb0, emissiveIntensity: 0.5 }),
    screenBlue: std(0x0c2a3a, { emissive: 0x2fb5ff, emissiveIntensity: 0.6 }),
    trayLabel: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'OUTPUT', size: 44 }], { w: 256, h: 64, bg: '#f2b01e', fg: '#1d1d1b' }), roughness: 0.6 }),
    portIn: new THREE.MeshStandardMaterial({ color: 0x2a6f3a, emissive: 0x30ff70, emissiveIntensity: 0.5 }),
    portOut: new THREE.MeshStandardMaterial({ color: 0x7a4a10, emissive: 0xffa000, emissiveIntensity: 0.5 }),
  };
  return MM;
}

function statusLamp(parent, x, y, z) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a5a2a, emissive: 0x20ff60, emissiveIntensity: 1.2 });
  add(parent, cyl(0.06, 0.06, 0.12, 8), mat, x, y, z, 0, 0, 0, false);
  add(parent, cyl(0.07, 0.07, 0.03, 8), materials().steelDark, x, y - 0.075, z);
  return mat;
}

function tray(parent, x, z) {
  const M = materials(), g = new THREE.Group();
  g.position.set(x, 0, z);
  parent.add(g);
  add(g, BOX(0.72, 0.04, 0.62), M.steelGalv, 0, 0.84, 0);
  for (const s of [-1, 1]) add(g, BOX(0.72, 0.1, 0.03), M.steelGalv, 0, 0.9, s * 0.3);
  for (const s of [-1, 1]) add(g, BOX(0.03, 0.1, 0.62), M.steelGalv, s * 0.35, 0.9, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, BOX(0.04, 0.82, 0.04), M.steelDark, sx * 0.32, 0.41, sz * 0.27);
  add(g, BOX(0.4, 0.1, 0.01), machineMats().trayLabel, 0, 0.72, 0.315);
}

/** Little arrow plates on the floor showing where belts connect (green in, amber out). */
function ports(parent, type) {
  const def = MACHINES[type], mm = machineMats();
  const arrow = new THREE.Shape([new THREE.Vector2(-0.18, -0.2), new THREE.Vector2(0.18, -0.2), new THREE.Vector2(0.18, 0.02), new THREE.Vector2(0.3, 0.02), new THREE.Vector2(0, 0.3), new THREE.Vector2(-0.3, 0.02), new THREE.Vector2(-0.18, 0.02)]);
  const geo = new THREE.ShapeGeometry(arrow);
  for (const [k, mat] of [['in', mm.portIn], ['out', mm.portOut]]) {
    const p = def.ports[k];
    // marker sits on the machine edge, pointing the way items flow
    const m = add(parent, geo, mat, p.cell[0] - p.dir[0] * 0.5, 0.012, p.cell[1] - p.dir[1] * 0.5, 0, 0, 0, false);
    m.rotation.set(-Math.PI / 2, 0, Math.atan2(-p.dir[0], -p.dir[1]));
    m.userData.port = k;
  }
}

// ======================================================================= builders
const BUILD = {
  fabricator(st, dyn) {
    const M = materials(), mm = machineMats();
    add(st, BOX(2.8, 0.06, 0.95), mm.bench, 0, 0.92, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(st, BOX(0.07, 0.9, 0.07), M.steelDark, sx * 1.33, 0.45, sz * 0.4);
    add(st, BOX(2.7, 0.04, 0.85), M.steelDark, 0, 0.25, 0);
    add(st, BOX(2.8, 1.2, 0.04), mm.board, 0, 1.55, -0.46);
    for (let i = 0; i < 10; i++) add(st, BOX(0.04, 0.22 + (i % 3) * 0.08, 0.03), M.steelDark, -1.2 + i * 0.26, 1.7, -0.42);
    add(st, cb(0.24, 0.16, 0.16, 0.02), M.steelBlue, -1.1, 1.03, 0.2); // vise
    // bench drill
    add(st, cb(0.3, 0.05, 0.3, 0.01), mm.midGrey, -0.45, 0.97, -0.15);
    add(st, cyl(0.04, 0.04, 0.7, 8), M.steelGalv, -0.45, 1.3, -0.25);
    add(st, cb(0.18, 0.24, 0.34, 0.03), mm.orange, -0.45, 1.6, -0.12);
    // welder + sheet stock + sign
    add(st, cb(0.4, 0.3, 0.3, 0.03), std(0x2f5d8a), 0.35, 1.1, -0.2);
    for (let i = 0; i < 4; i++) add(st, BOX(0.6, 0.015, 0.45), M.steelGalv, 1.0, 0.96 + i * 0.016, -0.1);
    const sign = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'FAB BENCH', size: 48 }, { text: 'MACHINE KITS · CONVEYORS', size: 22, color: '#f2b01e' }], { w: 512, h: 128, bg: '#1d2328', fg: '#ede8df' }), roughness: 0.5 });
    add(st, BOX(1.3, 0.32, 0.02), sign, 0, 2.28, -0.44);
    const lamp = statusLamp(st, 1.28, 1.02, -0.35);
    const spark = { t: 0 };
    return {
      lamp, labelY: 2.8,
      anim: (dt, run, prog, t, ctx) => {
        spark.t -= dt;
        if (run && spark.t <= 0 && ctx) { spark.t = 0.25 + Math.random() * 0.4; ctx.sparks(V(0.35 + (Math.random() - 0.5) * 0.4, 1.0, 0.1)); }
      },
    };
  },

  press(st, dyn) {
    const M = materials();
    const b = new THREE.Group(); b.position.set(-0.4, 0, -0.2); st.add(b);
    add(b, cb(3.2, 0.9, 2.6, 0.08), M.machineGreen, 0, 0.45, 0);
    add(b, BOX(2.6, 0.18, 2.0), M.steelDark, 0, 0.99, 0);
    for (const sx of [-1, 1]) add(b, cb(0.6, 3.0, 2.2, 0.06), M.machineGreen, sx * 1.3, 2.4, 0);
    add(b, cb(3.3, 1.0, 2.5, 0.08), M.machineGreen, 0, 3.9, 0);
    add(b, BOX(3.32, 0.18, 0.1), M.hazard, 0, 3.5, 1.26);
    add(b, BOX(2.0, 0.12, 0.05), M.hazard, 0, 1.1, 1.03);
    add(b, cyl(0.7, 0.7, 0.25, 16).rotateZ(Math.PI / 2), M.steelDark, 1.4, 4.7, -0.4);
    add(b, BOX(0.35, 1.2, 0.3), M.steelYellow, 1.95, 0.6, 1.55);
    add(b, BOX(0.5, 0.36, 0.2), M.steelYellow, 1.95, 1.32, 1.6);
    add(b, cyl(0.045, 0.045, 0.05, 10).rotateX(Math.PI / 2), M.ledGreen, 1.85, 1.34, 1.71, 0, 0, 0, false);
    add(b, cyl(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), M.ledRed, 2.05, 1.34, 1.71, 0, 0, 0, false);
    tray(st, 1.55, 0.5);
    const lamp = statusLamp(st, 0.9, 4.55, 0.9);
    const ram = add(dyn, chamferBox(2.1, 0.7, 1.7, 0.06), M.steelDark, -0.4, 3.0, -0.2);
    add(ram, BOX(2.12, 0.14, 0.05), M.hazard, 0, -0.15, 0.86);
    let last = 0;
    return {
      lamp, labelY: 5.6,
      anim: (dt, run, prog, t, ctx) => {
        if (run) {
          const c = (t % 1.1) / 1.1;
          const s = c < 0.22 ? c / 0.22 : c < 0.42 ? 1 - (c - 0.22) / 0.2 : 0;
          ram.position.y = 3.0 - s * s * 1.55;
          if (c >= 0.22 && last < 0.22 && ctx) ctx.sound('press');
          last = c;
        } else ram.position.y += (3.0 - ram.position.y) * Math.min(1, dt * 4);
      },
    };
  },

  moulder(st, dyn) {
    const M = materials(), mm = machineMats();
    const b = new THREE.Group(); b.position.set(-0.4, 0, -0.2); st.add(b);
    add(b, cb(4.2, 1.0, 1.4, 0.06), M.machineGreen, 0, 0.5, 0);
    add(b, cyl(0.16, 0.16, 1.9, 12).rotateZ(Math.PI / 2), M.steelGalv, -1.0, 1.35, 0);
    add(b, cb(0.5, 0.35, 0.5, 0.04), M.machineGreen, -1.95, 1.2, 0);
    add(b, cyl(0.28, 0.1, 0.45, 10), mm.plastic, -1.7, 1.85, 0);
    add(b, cyl(0.28, 0.28, 0.25, 10), mm.plastic, -1.7, 2.18, 0);
    add(b, cb(0.22, 1.1, 1.2, 0.03), M.steelDark, 0.3, 1.55, 0);
    add(b, cb(0.22, 1.1, 1.2, 0.03), M.steelDark, 1.95, 1.55, 0);
    for (const y of [1.1, 2.0]) for (const z of [-0.45, 0.45]) add(b, cyl(0.05, 0.05, 1.8, 8).rotateZ(Math.PI / 2), M.steelGalv, 1.12, y, z);
    add(b, BOX(1.5, 0.9, 0.02), mm.clear, 1.12, 1.55, 0.66, 0, 0, 0, false);
    add(b, BOX(0.5, 0.6, 0.12), M.steelYellow, 1.4, 1.3, 0.76);
    add(b, new THREE.PlaneGeometry(0.3, 0.2), mm.screenGreen, 1.4, 1.38, 0.822, 0, 0, 0, false);
    add(st, BOX(0.5, 0.05, 0.4), M.steelGalv, 1.85, 1.02, 0.45, 0, 0, -0.35);
    tray(st, 2.1, 0.5);
    const lamp = statusLamp(st, 1.55, 2.2, 0.2);
    const heat = new THREE.MeshStandardMaterial({ color: 0xff6a2a, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 0.4 });
    for (let i = 0; i < 4; i++) add(dyn, cyl(0.19, 0.19, 0.12, 12).rotateZ(Math.PI / 2), heat, -1.95 + i * 0.35, 1.35, -0.2);
    const platen = add(dyn, cb(0.2, 1.0, 1.1, 0.03), M.steelYellow, 0.9, 1.55, -0.2);
    const mould = add(dyn, BOX(0.25, 0.5, 0.6), M.steelGalv, 0.15, 1.55, -0.2);
    let last = 0;
    return {
      lamp, labelY: 3.1,
      anim: (dt, run, prog, t, ctx) => {
        heat.emissiveIntensity += ((run ? 1.6 : 0.05) - heat.emissiveIntensity) * Math.min(1, dt * 2);
        const c = run ? (t % 1.6) / 1.6 : 0;
        const open = c < 0.25 ? 0 : c < 0.4 ? (c - 0.25) / 0.15 : c < 0.75 ? 1 : 1 - (c - 0.75) / 0.25;
        platen.position.x = 0.9 + open * 0.45;
        mould.position.x = 0.15 + open * 0.2;
        if (run && c > 0.25 && last <= 0.25 && ctx) ctx.sound('moulder');
        last = c;
      },
    };
  },

  electronics(st, dyn) {
    const M = materials(), mm = machineMats();
    const b = new THREE.Group(); b.position.set(-0.6, 0, 0); st.add(b);
    const w = 2.6, d = 0.9;
    add(b, BOX(w, 0.05, d), M.steelDark, 0, 0.9, 0);
    add(b, BOX(w - 0.04, 0.012, d - 0.04), mm.esd, 0, 0.93, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(b, BOX(0.05, 0.88, 0.05), M.steelDark, sx * (w / 2 - 0.06), 0.44, sz * (d / 2 - 0.06));
    add(b, BOX(w, 1.1, 0.04), mm.board, 0, 1.5, -d / 2 + 0.02);
    for (let i = 0; i < 9; i++) add(b, BOX(0.04, 0.2 + (i % 3) * 0.06, 0.02), M.steelDark, -1.1 + i * 0.27, 1.62, -d / 2 + 0.06);
    const cols = [0xd8322a, 0x2f5d8a, 0xf2b01e, 0x3f8a4a];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) add(b, cb(0.14, 0.08, 0.16, 0.01), std(cols[(r + c) % 4]), 0.72 + c * 0.15, 1.02 + r * 0.09, -0.28);
    add(b, cb(0.22, 0.1, 0.16, 0.015), mm.darkGrey, -0.75, 0.99, 0.05);
    add(b, cyl(0.02, 0.02, 0.5, 6), M.steelGalv, 0.2, 1.18, -0.28);
    add(b, cyl(0.02, 0.02, 0.45, 6), M.steelGalv, 0.2, 1.43, -0.08, Math.PI / 2 - 0.5, 0, 0);
    const ring = new THREE.MeshStandardMaterial({ color: 0xfff6e0, emissive: 0xfff0d0, emissiveIntensity: 0.6 });
    add(b, new THREE.TorusGeometry(0.12, 0.025, 5, 14), ring, 0.2, 1.5, 0.12, -Math.PI / 2 + 0.4, 0, 0, false);
    add(b, cb(0.42, 0.28, 0.32, 0.02), mm.midGrey, -0.15, 1.08, -0.2);
    add(b, new THREE.PlaneGeometry(0.26, 0.17), mm.screenGreen, -0.17, 1.09, -0.035, 0, 0, 0, false);
    add(b, BOX(0.24, 0.012, 0.16), std(0x2f7a3a), -0.35, 0.94, 0.15);
    tray(st, 1.3, 0);
    const lamp = statusLamp(st, -1.75, 2.15, -0.35);
    const tip = new THREE.MeshStandardMaterial({ color: 0x552200, emissive: 0xff6a00, emissiveIntensity: 0 });
    const iron = new THREE.Group(); iron.position.set(-1.1, 1.02, 0.1); dyn.add(iron);
    add(iron, cyl(0.015, 0.012, 0.18, 6), mm.darkGrey, 0, 0, 0, 0, 0, Math.PI / 2 - 0.3);
    add(iron, cyl(0.004, 0.002, 0.06, 5), tip, 0.11, 0.035, 0, 0, 0, Math.PI / 2 - 0.3, false);
    let spark = 0;
    return {
      lamp, labelY: 2.4,
      anim: (dt, run, prog, t, ctx) => {
        tip.emissiveIntensity = run ? 2 + Math.sin(t * 40) * 0.8 : 0.1;
        ring.emissiveIntensity = run ? 2.2 : 0.4;
        iron.rotation.z = run ? Math.sin(t * 3) * 0.15 : 0;
        spark -= dt;
        if (run && spark <= 0 && ctx) { spark = 0.35 + Math.random() * 0.4; ctx.sparks(V(-1.0, 1.05, 0.1)); ctx.sound('electronics'); }
      },
    };
  },

  assembler(st, dyn) {
    const M = materials(), mm = machineMats();
    const b = new THREE.Group(); b.position.set(-0.6, 0, -0.4); st.add(b);
    const W = 4.4, D = 4.0, H = 2.6, hw = W / 2, hd = D / 2;
    add(b, BOX(W, 0.04, D), std(0x2a2d31, { roughness: 0.9 }), 0, 0.02, 0, 0, 0, 0, false);
    for (const [x, z] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]]) add(b, BOX(0.1, H, 0.1), M.steelYellow, x, H / 2, z);
    for (const [x, z, len, ry] of [[0, -hd, W, 0], [-hw, 0, D, Math.PI / 2], [hw, 0, D, Math.PI / 2]]) {
      add(b, new THREE.PlaneGeometry(len - 0.1, H - 0.4), M.fence, x, H / 2 + 0.1, z, 0, ry, 0);
      add(b, BOX(len, 0.06, 0.06), M.steelYellow, x, H, z, 0, ry, 0);
    }
    add(b, BOX(W, 0.06, 0.06), M.steelYellow, 0, H, hd);
    for (const sx of [-1, 1]) {
      add(b, BOX(0.08, 1.8, 0.08), mm.darkGrey, sx * (hw - 0.25), 0.9, hd - 0.05);
      add(b, BOX(0.02, 1.7, 0.02), M.ledRed, sx * (hw - 0.25) - sx * 0.05, 0.9, hd - 0.05, 0, 0, 0, false);
    }
    add(b, cb(1.2, 0.8, 0.8, 0.04), M.steelDark, 0.6, 0.4, 0.75);
    add(b, BOX(0.9, 0.06, 0.6), M.steelGalv, 0.6, 0.83, 0.75);
    add(b, BOX(0.9, 0.12, 0.7), M.wood, -1.25, 0.06, 0.4);
    for (let i = 0; i < 3; i++) add(b, cb(0.3, 0.2, 0.3, 0.02), M.cardboard, -1.4 + (i % 2) * 0.32, 0.22 + Math.floor(i / 2) * 0.2, 0.4);
    add(b, BOX(0.18, 1.1, 0.18), M.steelDark, 0, 0.55, hd + 0.18);
    add(b, cb(0.5, 0.36, 0.1, 0.02), std(0x3a3f44), 0, 1.25, hd + 0.2, -0.3, 0, 0);
    add(b, new THREE.PlaneGeometry(0.38, 0.24), mm.screenBlue, 0, 1.26, hd + 0.262, -0.3, 0, 0, false);
    add(b, cyl(0.03, 0.03, 0.6, 6), M.steelDark, hw, H + 0.3, hd);
    tray(st, 2.4, 1.0);
    const stack = [0xff2a1a, 0xffa000, 0x20ff60].map((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.15, transparent: true, opacity: 0.9 });
      add(dyn, cyl(0.07, 0.07, 0.12, 8), m, -0.6 + hw, H + 0.65 + (2 - i) * 0.13, -0.4 + hd, 0, 0, 0, false);
      return m;
    });
    const R = mm.orange, Dk = mm.robotDark;
    const base = new THREE.Group(); base.position.set(-0.8, 0, -0.95); dyn.add(base);
    add(base, cyl(0.38, 0.42, 0.25, 10), Dk, 0, 0.125, 0);
    const turret = new THREE.Group(); turret.position.y = 0.25; base.add(turret);
    add(turret, cyl(0.3, 0.34, 0.35, 10), R, 0, 0.175, 0);
    const shoulder = new THREE.Group(); shoulder.position.set(0, 0.45, 0); turret.add(shoulder);
    add(shoulder, cyl(0.2, 0.2, 0.46, 10).rotateZ(Math.PI / 2), Dk, 0, 0, 0);
    add(shoulder, cb(0.24, 1.0, 0.28, 0.05), R, 0, 0.5, 0);
    const elbow = new THREE.Group(); elbow.position.y = 1.0; shoulder.add(elbow);
    add(elbow, cyl(0.15, 0.15, 0.36, 10).rotateZ(Math.PI / 2), Dk, 0, 0, 0);
    add(elbow, cb(0.2, 0.2, 0.9, 0.04), R, 0, 0, 0.42);
    const wrist = new THREE.Group(); wrist.position.set(0, 0, 0.88); elbow.add(wrist);
    add(wrist, cyl(0.09, 0.09, 0.16, 8).rotateX(Math.PI / 2), Dk, 0, 0, 0);
    add(wrist, cb(0.18, 0.08, 0.12, 0.02), Dk, 0, -0.08, 0.02);
    const fingers = [-1, 1].map((s) => add(wrist, BOX(0.03, 0.16, 0.06), M.steelGalv, s * 0.05, -0.18, 0.02));
    const held = add(wrist, cb(0.16, 0.12, 0.16, 0.02), M.cardboard, 0, -0.28, 0.02);
    held.visible = false;
    const pose = { yaw: 0, sh: 0.2, el: 1.4 };
    let sparkT = 0, whirrT = 0;
    return {
      lamp: null, stack, labelY: 3.6,
      anim: (dt, run, prog, t, ctx) => {
        let target, grip = 0;
        if (run) {
          const c = (t % 3) / 3;
          if (c < 0.2) target = { yaw: -0.85, sh: 0.78, el: 1.42 };
          else if (c < 0.35) { target = { yaw: -0.85, sh: 0.45, el: 1.3 }; grip = 1; }
          else if (c < 0.6) { target = { yaw: 0.55, sh: 0.62, el: 1.25 }; grip = 1; }
          else { target = { yaw: 0.55, sh: 0.82, el: 1.34 }; grip = c < 0.7 ? 1 : 0; }
          held.visible = grip > 0;
          sparkT -= dt;
          if (c > 0.7 && sparkT <= 0 && ctx) { sparkT = 0.08; ctx.sparks(V(0, 0.9, 0.35)); }
          whirrT -= dt;
          if (whirrT <= 0 && ctx) { whirrT = 1.5; ctx.sound('assembler'); }
        } else {
          target = { yaw: Math.sin(t * 0.4) * 0.15, sh: 0.1, el: 1.2 + Math.sin(t * 0.7) * 0.05 };
          held.visible = false;
        }
        const k = Math.min(1, dt * 5);
        pose.yaw += (target.yaw - pose.yaw) * k;
        pose.sh += (target.sh - pose.sh) * k;
        pose.el += (target.el - pose.el) * k;
        turret.rotation.y = pose.yaw;
        shoulder.rotation.x = pose.sh;
        elbow.rotation.x = pose.el - Math.PI / 2;
        wrist.rotation.x = Math.PI / 2 - pose.el - pose.sh + 0.2;
        fingers[0].position.x = -0.05 + grip * 0.02;
        fingers[1].position.x = 0.05 - grip * 0.02;
        stack[1].emissiveIntensity = run ? (Math.sin(t * 8) > 0 ? 2.5 : 0.3) : 0.15;
        stack[2].emissiveIntensity = run ? 0.15 : 2.2;
      },
    };
  },

  ammo(st, dyn) {
    const M = materials(), mm = machineMats();
    const w = 2.2, d = 0.8;
    add(st, BOX(w, 0.06, d), mm.bench, 0, 0.92, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(st, BOX(0.06, 0.9, 0.06), M.steelDark, sx * (w / 2 - 0.06), 0.45, sz * (d / 2 - 0.06));
    add(st, BOX(w, 0.9, 0.03), mm.board, 0, 1.42, -d / 2 + 0.02);
    const px = -0.35;
    add(st, cb(0.32, 0.06, 0.28, 0.01), mm.olive, px, 0.98, 0.05);
    for (const sx of [-1, 1]) add(st, cyl(0.025, 0.025, 0.45, 8), M.steelGalv, px + sx * 0.1, 1.23, 0.05);
    add(st, cb(0.3, 0.1, 0.24, 0.02), mm.olive, px, 1.48, 0.05);
    for (let i = 0; i < 4; i++) add(st, cyl(0.022, 0.022, 0.12, 8), M.steelDark, px + (i % 2 - 0.5) * 0.1, 1.6, 0.05 + (Math.floor(i / 2) - 0.5) * 0.1);
    add(st, cyl(0.035, 0.035, 0.75, 8), mm.clear, px + 0.12, 1.98, -0.02, 0, 0, 0, false);
    add(st, cyl(0.025, 0.025, 0.7, 8), mm.brassBin, px + 0.12, 1.98, -0.02);
    add(st, cyl(0.05, 0.05, 0.22, 10), mm.clear, px - 0.06, 1.8, 0.12, 0, 0, 0, false);
    add(st, cyl(0.045, 0.045, 0.12, 10), mm.darkGrey, px - 0.06, 1.76, 0.12);
    add(st, cb(0.26, 0.1, 0.2, 0.02), std(0x2f5d8a), 0.25, 1.0, -0.2);
    add(st, BOX(0.22, 0.02, 0.16), mm.brassBin, 0.25, 1.05, -0.2);
    const sign = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'AMMO PRESS', size: 44 }, { text: 'BRASS + POWDER + LEAD → 9×19mm', size: 20, color: '#f2b01e' }], { w: 512, h: 128, bg: '#1d2328', fg: '#ede8df' }), roughness: 0.5 });
    add(st, BOX(1.2, 0.3, 0.02), sign, 0, 2.05, -0.39);
    const lamp = statusLamp(st, -0.95, 1.02, -0.25);
    const shell = add(dyn, cyl(0.11, 0.11, 0.025, 10), M.steelGalv, px, 1.1, 0.05);
    const handle = new THREE.Group(); handle.position.set(px + 0.18, 1.25, 0.05); dyn.add(handle);
    add(handle, cyl(0.015, 0.015, 0.45, 6), M.steelGalv, 0.02, 0.2, 0.05, -0.4, 0, 0);
    add(handle, new THREE.SphereGeometry(0.035, 8, 6), M.ledRed, 0.02, 0.4, 0.14);
    let last = 0;
    return {
      lamp, labelY: 2.5,
      anim: (dt, run, prog, t, ctx) => {
        const c = run ? (t % 0.9) / 0.9 : 0;
        const pull = c < 0.5 ? Math.sin(c / 0.5 * Math.PI) : 0;
        handle.rotation.x = pull * 0.9;
        if (run && c < last) { shell.rotation.y += Math.PI / 2.5; if (ctx) ctx.sound('ammo'); }
        last = c;
      },
    };
  },
};

/**
 * Build a machine model. `ghost` builds a single-material preview (no batching).
 * @returns {{root:THREE.Group, anim:Function, lamp:any, stack:any, labelY:number}}
 */
export function buildMachine(type, { ghost = null } = {}) {
  const root = new THREE.Group();
  root.name = `machine-${type}`;
  const st = new THREE.Group(), dyn = new THREE.Group();
  root.add(st, dyn);
  const view = BUILD[type](st, dyn);
  ports(dyn, type);
  if (ghost) {
    root.traverse((o) => { if (o.isMesh) { o.material = ghost; o.castShadow = false; o.receiveShadow = false; } });
  } else {
    batchStatic(st);
  }
  return { root, ...view };
}
