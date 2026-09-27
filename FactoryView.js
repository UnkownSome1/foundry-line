// Renders the factory from the shared FactorySim: placed machines (animated while
// running), conveyor belts (instanced), the supply terminal, sell corner + wall chute,
// outdoor pickup cage, delivery truck, pickup van, world items and live screens.
import * as THREE from 'three';
import { materials } from '../gfx/materials.js';
import { chamferBox, batchStatic, cyl } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { FACTORY } from '../../shared/factory/layout.js';
import { ITEMS, MACHINES, CONVEYOR } from '../../shared/factory/items.js';
import { truckEta, vanEta } from '../../shared/factory/truck.js';
import { buildItem } from './ItemModels.js';
import { buildMachine, add, machineMats } from './MachineModels.js';
import { Truck } from './Truck.js';
import { Van } from './Van.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cb = chamferBox;
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { c, ctx: c.getContext('2d'), tex: t };
}

function mergeGeos(list) {
  let n = 0;
  const geos = list.map(([g, x, y, z]) => { const gg = (g.index ? g.toNonIndexed() : g.clone()).translate(x, y, z); n += gg.attributes.position.count; return gg; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

export class FactoryView {
  constructor(scene, sim, effects, audio) {
    this.scene = scene;
    this.sim = sim;
    this.fx = effects;
    this.audio = audio;
    this.M = materials();
    this.static = new THREE.Group();
    this.dynamic = new THREE.Group();
    scene.add(this.static, this.dynamic);
    this.mat = {
      desk: std(0x6d757b, { roughness: 0.5, metalness: 0.4 }),
      plastic: std(0xd9d4c7),
      olive: std(0x55603a, { roughness: 0.8, flatShading: true }),
      crateWood: std(0x7a5f3c, { roughness: 0.85, flatShading: true }),
      paintY: new THREE.MeshStandardMaterial({ color: 0xe0a92a, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 }),
      dark: std(0x111213),
      red: std(0xd8322a, { emissive: 0xff2010, emissiveIntensity: 0.4 }),
    };
    this.machines = new Map();
    this.items = new Map();
    this.fixed = []; // fixed interactables
    this.flying = [];

    this._buildTerminal();
    this._buildSellCorner();
    this._buildCage();
    this._buildBay();
    this._buildAmmoCrates();
    this._buildBoard();
    this._buildBelts();
    batchStatic(this.static);

    for (const m of sim.machines.values()) this._addMachine(m);
    this._rebuildBelts();

    this.truck = new Truck();
    this.van = new Van();
    scene.add(this.truck.root, this.van.root);
    this.lastPhase = sim.truck.phase;
    this.lastVan = sim.van.phase;
    this.beepT = 0;
    this.screenT = 0;
    this.cageKey = '';
    this.engineSnd = null;
    this.vanSnd = null;
  }

  // =================================================================== fixed pieces
  _buildTerminal() {
    const t = FACTORY.terminal, M = this.M;
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    this.static.add(g);
    add(g, cb(t.w, 0.05, t.d, 0.015), this.mat.desk, 0, 0.93, 0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, BOX(0.05, 0.9, 0.05), M.steelDark, sx * (t.w / 2 - 0.06), 0.45, sz * (t.d / 2 - 0.06));
    add(g, cb(0.22, 0.48, 0.5, 0.02), M.steelDark, -0.62, 0.25, 0);
    add(g, cb(0.62, 0.48, 0.5, 0.05, { bottom: 0.9, bottomZ: 0.7 }), this.mat.plastic, 0, 1.24, 0.08);
    add(g, cb(0.3, 0.05, 0.25, 0.02), this.mat.plastic, 0, 0.98, 0.08);
    this.termScreen = canvasTex(512, 384);
    const scr = new THREE.MeshStandardMaterial({ map: this.termScreen.tex, emissive: 0xffffff, emissiveMap: this.termScreen.tex, emissiveIntensity: 0.9, roughness: 0.3 });
    add(this.dynamic, new THREE.PlaneGeometry(0.5, 0.37), scr, t.x, 1.25, t.z - 0.172, 0, Math.PI, 0, false);
    add(g, cb(0.55, 0.03, 0.18, 0.01), this.mat.plastic, 0, 0.965, -0.24);
    const sign = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'SUPPLY TERMINAL', size: 46 }, { text: 'PARTS · MACHINES · PICKUP · CONTRACTS', size: 20, color: '#f2b01e' }], { w: 512, h: 128, bg: '#1d2328', fg: '#ede8df' }), roughness: 0.5 });
    add(this.static, BOX(1.8, 0.45, 0.04), sign, t.x, 2.35, -4.23, 0, Math.PI, 0);
    this.fixed.push({ kind: 'terminal', pos: V(...t.panel), r: 0.55, label: 'Use supply terminal' });
  }

  _buildSellCorner() {
    const S = FACTORY.sell, M = this.M, z = S.zone, hp = S.hopper;
    // floor zone: hazard border + stencil
    const line = (x, zz, w, d) => add(this.static, new THREE.PlaneGeometry(w, d), this.mat.paintY, x, 0.004, zz, -Math.PI / 2, 0, 0, false);
    line((z.x0 + z.x1) / 2, z.z0 + 0.09, z.x1 - z.x0, 0.18);
    line(z.x0 + 0.09, (z.z0 + z.z1) / 2, 0.18, z.z1 - z.z0);
    for (let i = 0; i < 6; i++) add(this.static, new THREE.PlaneGeometry(0.14, 1.1), this.mat.paintY, z.x0 + 0.5 + i * 0.65, 0.004, z.z0 + 0.6, -Math.PI / 2, 0, 0.75, false);
    const txt = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'SELL CORNER', size: 70 }, { text: 'DROP GOODS · BELTS END HERE', size: 30 }], { w: 512, h: 160, fg: '#e0a92a' }), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    add(this.static, new THREE.PlaneGeometry(2.9, 0.9), txt, (z.x0 + z.x1) / 2 - 0.3, 0.005, z.z1 - 0.8, -Math.PI / 2, 0, 0, false);
    // hopper against the east wall with a funnel mouth
    const g = new THREE.Group();
    g.position.set(hp.x, 0, hp.z);
    this.static.add(g);
    add(g, cb(hp.w, hp.h - 0.2, hp.d, 0.04), M.steelGalv, 0, (hp.h - 0.2) / 2, 0);
    add(g, BOX(hp.w + 0.02, 0.14, hp.d + 0.02), M.hazard, 0, hp.h - 0.27, 0);
    for (const [x, zz, w, d, rx, rz] of [[-hp.w / 2, 0, 0.06, hp.d, 0, 0.5], [0, -hp.d / 2, hp.w, 0.06, -0.5, 0], [0, hp.d / 2, hp.w, 0.06, 0.5, 0]]) add(g, BOX(w || 0.06, 0.35, d || 0.06), M.steelGalv, x, hp.h - 0.05, zz, rx, 0, rz);
    add(g, BOX(hp.w - 0.2, 0.02, hp.d - 0.2), this.mat.dark, 0, hp.h - 0.19, 0, 0, 0, 0, false);
    // chute opening in the wall (inside + outside) and the slide into the cage
    add(this.static, new THREE.PlaneGeometry(1.2, 0.7), this.mat.dark, 19.775, 0.95, hp.z, 0, -Math.PI / 2, 0, false);
    add(this.static, new THREE.PlaneGeometry(1.2, 0.7), this.mat.dark, 20.225, 0.95, hp.z, 0, Math.PI / 2, 0, false);
    add(this.static, BOX(1.1, 0.05, 1.3), M.steelGalv, 20.75, 0.72, hp.z, 0, 0, -0.45);
    for (const s of [-1, 1]) add(this.static, BOX(1.1, 0.25, 0.04), M.steelGalv, 20.75, 0.85, hp.z + s * 0.65, 0, 0, -0.45);
    // wall sign above the hopper: a dark backing plate flat on the east wall's inner face,
    // with the printed face on a plane facing into the hall (-X) so the text reads left→right
    const sign = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'SELL', size: 80 }, { text: 'COLLECTED BY PICKUP VAN · 80% COMPANY / 20% YOU', size: 18, color: '#7fd18b' }], { w: 512, h: 160, bg: '#1d2328', fg: '#ede8df' }), roughness: 0.5 });
    add(this.static, BOX(0.05, 0.85, 2.42), this.mat.dark, 19.77, 2.3, hp.z);
    add(this.static, new THREE.PlaneGeometry(2.3, 0.75), sign, 19.742, 2.3, hp.z, 0, -Math.PI / 2, 0, false);
    // call-van post with button + small status screen
    const [bx, by, bz] = S.button;
    add(this.static, BOX(0.12, by + 0.3, 0.12), M.steelYellow, bx, (by + 0.3) / 2, bz - 0.12);
    add(this.static, cb(0.4, 0.5, 0.14, 0.03), M.steelYellow, bx, by + 0.05, bz);
    this.btnMesh = add(this.dynamic, cyl(0.07, 0.08, 0.06, 12).rotateX(Math.PI / 2), this.mat.red, bx, by - 0.08, bz + 0.09, 0, 0, 0, false);
    this.sellScreen = canvasTex(256, 128);
    add(this.dynamic, new THREE.PlaneGeometry(0.32, 0.16), new THREE.MeshStandardMaterial({ map: this.sellScreen.tex, emissive: 0xffffff, emissiveMap: this.sellScreen.tex, emissiveIntensity: 0.8 }), bx, by + 0.15, bz + 0.072, 0, 0, 0, false);
    this.fixed.push({ kind: 'callVan', pos: V(bx, by, bz + 0.1), r: 0.4, label: 'Call the pickup van' });
    this.fixed.push({ kind: 'deposit', pos: V(hp.x - hp.w / 2 - 0.2, 1.0, hp.z), r: 0.7, label: 'Deposit all parts & products for sale' });
  }

  _buildCage() {
    const c = FACTORY.cage, M = this.M;
    const posts = [[c.x0 + 0.05, c.z0], [c.x1, c.z0], [c.x0 + 0.05, c.z1], [c.x1, c.z1]];
    for (const [x, z] of posts) add(this.static, BOX(0.1, 2.3, 0.1), M.steelYellow, x, 1.15, z);
    for (const z of [c.z0, c.z1]) {
      add(this.static, new THREE.PlaneGeometry(c.x1 - c.x0, 2.1), M.fence, (c.x0 + c.x1) / 2, 1.1, z, 0, 0, 0);
      add(this.static, BOX(c.x1 - c.x0, 0.07, 0.07), M.steelYellow, (c.x0 + c.x1) / 2, 2.25, z);
    }
    add(this.static, BOX(0.07, 0.07, c.z1 - c.z0), M.steelYellow, c.x1, 2.25, (c.z0 + c.z1) / 2);
    add(this.static, BOX(c.x1 - c.x0, 0.03, c.z1 - c.z0), std(0x6f6a62, { roughness: 0.95 }), (c.x0 + c.x1) / 2, 0.015, (c.z0 + c.z1) / 2, 0, 0, 0, false);
    const sign = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'PICKUP', size: 70 }, { text: 'HALLETT FREIGHT COLLECTION POINT', size: 22 }], { w: 512, h: 150, bg: '#1f8a8a', fg: '#ffffff' }), roughness: 0.5 });
    add(this.static, BOX(1.6, 0.46, 0.04), sign, (c.x0 + c.x1) / 2, 2.6, c.z1 + 0.02);
    this.cageGroup = new THREE.Group();
    this.dynamic.add(this.cageGroup);
    this.cageSlots = [];
    for (let row = 0; row < 6; row++) for (let col = 0; col < 5; col++) this.cageSlots.push(V(c.x0 + 0.55 + col * 0.72, 0.03, c.z0 + 0.5 + row * 0.72));
  }

  _buildBay() {
    const b = FACTORY.bay;
    const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const line = (x, z, lw, ld) => add(this.static, new THREE.PlaneGeometry(lw, ld), this.mat.paintY, x, 0.004, z, -Math.PI / 2, 0, 0, false);
    line(cx, b.z0, w, 0.18); line(cx, b.z1, w, 0.18); line(b.x0, cz, 0.18, d); line(b.x1, cz, 0.18, d);
    for (let i = 0; i < 7; i++) add(this.static, new THREE.PlaneGeometry(0.16, 1.3), this.mat.paintY, b.x0 + 0.6 + i * 1.3, 0.004, b.z1 - 0.7, -Math.PI / 2, 0, 0.7, false);
    const text = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'DELIVERIES', size: 88 }], { w: 512, h: 128, fg: '#e0a92a' }), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 });
    add(this.static, new THREE.PlaneGeometry(4.4, 1.1), text, cx, 0.005, b.z0 + 1.2, -Math.PI / 2, 0, 0, false);
  }

  _buildAmmoCrates() {
    const label = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: '9×19mm', size: 40 }, { text: 'UNLIMITED ∞', size: 30, color: '#f2d64a' }], { w: 256, h: 128, bg: '#3f4a28', fg: '#ede8df' }), roughness: 0.7 });
    for (const c of FACTORY.ammoCrates) {
      const g = new THREE.Group();
      g.position.set(c.x, 0, c.z);
      g.rotation.y = c.rot;
      this.static.add(g);
      add(g, cb(1.1, 0.5, 0.62, 0.03), this.mat.olive, 0, 0.25, 0);
      for (const sx of [-0.45, 0, 0.45]) add(g, BOX(0.08, 0.52, 0.64), this.mat.crateWood, sx, 0.26, 0);
      add(g, BOX(0.5, 0.25, 0.01), label, 0, 0.27, 0.315);
      add(g, BOX(0.5, 0.25, 0.01), label, 0, 0.27, -0.315, 0, Math.PI, 0);
      add(g, cb(1.1, 0.06, 0.62, 0.02), this.mat.olive, 0, 0.62, -0.42, -1.2, 0, 0);
      for (let i = 0; i < 4; i++) add(g, cb(0.22, 0.14, 0.14, 0.015), this.mat.olive, -0.36 + i * 0.24, 0.52, 0.02);
      for (let i = 0; i < 4; i++) add(g, BOX(0.2, 0.02, 0.04), std(0xf2d64a), -0.36 + i * 0.24, 0.6, 0.02);
      add(g, cyl(0.015, 0.015, 1.3, 5), this.M.steelGalv, 0.5, 0.9, -0.25);
      add(g, BOX(0.02, 0.22, 0.34), std(0xf2b01e), 0.5, 1.45, -0.08);
      this.fixed.push({ kind: 'ammo', pos: V(c.x, 0.8, c.z), r: 0.65, label: 'Refill ammo (unlimited)' });
    }
  }

  _buildBoard() {
    const b = FACTORY.board;
    this.board = canvasTex(1024, 480);
    const mat = new THREE.MeshStandardMaterial({ map: this.board.tex, emissive: 0xffffff, emissiveMap: this.board.tex, emissiveIntensity: 0.55, roughness: 0.5 });
    add(this.static, cb(5.3, 2.6, 0.12, 0.03), this.M.steelDark, b.x, b.y, b.z - 0.02);
    add(this.dynamic, new THREE.PlaneGeometry(5.0, 2.34), mat, b.x, b.y, b.z + 0.05, 0, 0, 0, false);
  }

  // =================================================================== conveyors
  _buildBelts() {
    const top = CONVEYOR.top;
    const rails = mergeGeos([[BOX(0.07, 0.13, 1.0), -0.465, top - 0.03, 0], [BOX(0.07, 0.13, 1.0), 0.465, top - 0.03, 0]]);
    const frame = mergeGeos([
      [BOX(0.86, 0.05, 1.0), 0, top - 0.04, 0],
      ...[[-0.44, -0.4], [0.44, -0.4], [-0.44, 0.4], [0.44, 0.4]].map(([x, z]) => [BOX(0.05, top - 0.06, 0.05), x, (top - 0.06) / 2, z]),
      [BOX(0.86, 0.04, 0.04), 0, 0.12, -0.4], [BOX(0.86, 0.04, 0.04), 0, 0.12, 0.4],
      [cyl(0.045, 0.045, 0.86, 8).rotateZ(Math.PI / 2), 0, top - 0.02, -0.47], [cyl(0.045, 0.045, 0.86, 8).rotateZ(Math.PI / 2), 0, top - 0.02, 0.47],
    ]);
    // belt surface with chevrons pointing toward local +Z (the flow direction)
    const bc = canvasTex(64, 64);
    const x = bc.ctx;
    x.fillStyle = '#26282a'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#f2b01e'; x.lineWidth = 5;
    x.beginPath(); x.moveTo(14, 18); x.lineTo(32, 42); x.lineTo(50, 18); x.stroke();
    x.fillStyle = '#1a1b1c'; for (let i = 0; i < 64; i += 16) x.fillRect(0, i, 64, 2);
    bc.tex.wrapS = bc.tex.wrapT = THREE.RepeatWrapping;
    this.beltTex = bc.tex;
    const surf = new THREE.PlaneGeometry(0.86, 1.0).rotateX(-Math.PI / 2).translate(0, top + 0.002, 0);
    const MAX = 600;
    this.beltMeshes = [
      new THREE.InstancedMesh(rails, this.M.steelYellow, MAX),
      new THREE.InstancedMesh(frame, this.M.steelDark, MAX),
      new THREE.InstancedMesh(surf, new THREE.MeshStandardMaterial({ map: bc.tex, roughness: 0.85 }), MAX),
    ];
    for (const m of this.beltMeshes) { m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.dynamic.add(m); }
    this.beltMeshes[2].castShadow = false;
  }

  _rebuildBelts() {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V(1, 1, 1);
    let i = 0;
    for (const b of this.sim.belts.values()) {
      q.setFromAxisAngle(V(0, 1, 0), b.q * Math.PI / 2);
      mtx.compose(V(b.x, 0, b.z), q, s);
      for (const m of this.beltMeshes) m.setMatrixAt(i, mtx);
      i++;
    }
    for (const m of this.beltMeshes) { m.count = i; m.instanceMatrix.needsUpdate = true; }
  }

  // =================================================================== machines
  _addMachine(m) {
    if (this.machines.has(m.id)) return;
    const v = buildMachine(m.type);
    v.root.position.set(m.x, 0, m.z);
    v.root.rotation.y = m.q * Math.PI / 2;
    this.dynamic.add(v.root);
    const lab = canvasTex(320, 96);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: lab.tex, transparent: true, depthWrite: false }));
    sprite.scale.set(1.25, 0.375, 1);
    sprite.position.set(m.x, v.labelY, m.z);
    sprite.renderOrder = 5;
    this.dynamic.add(sprite);
    const ctx = {
      sparks: (local) => { v.root.updateMatrixWorld(); this.fx.impact(local.clone().applyMatrix4(v.root.matrixWorld).toArray(), [0, 1, 0], 'fence', { decal: false }); },
      sound: (kind) => this.audio.machine(kind, V(m.x, 1.5, m.z)),
    };
    this.machines.set(m.id, { ...v, id: m.id, type: m.type, t: 0, label: { ...lab, sprite, key: '' }, ctx });
  }

  _removeMachine(id) {
    const v = this.machines.get(id);
    if (!v) return;
    this.dynamic.remove(v.root);
    this.dynamic.remove(v.label.sprite);
    this.machines.delete(id);
  }

  _addItem(id, type, x, y, z) {
    if (this.items.has(id)) return;
    const v = buildItem(type);
    v.root.position.set(x, y, z);
    v.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.dynamic.add(v.root);
    this.items.set(id, v);
  }

  /** Switch to another sim (solo save ↔ co-op replica): rebuild machines, belts, items. */
  rebind(sim) {
    for (const id of [...this.machines.keys()]) this._removeMachine(id);
    for (const v of this.items.values()) this.dynamic.remove(v.root);
    this.items.clear();
    for (const f of this.flying) this.dynamic.remove(f.v.root);
    this.flying = [];
    this.sim = sim;
    for (const m of sim.machines.values()) this._addMachine(m);
    for (const it of sim.items.values()) this._addItem(it.id, it.type, it.x, it.y, it.z);
    this._rebuildBelts();
    this.lastPhase = sim.truck.phase;
    this.lastVan = sim.van.phase;
    this.cageKey = '';
    this.screenT = 0;
  }

  /** Everything the player can point at and press E on. */
  interactables() {
    const list = this.fixed.slice();
    for (const m of this.sim.machines.values()) list.push({ kind: 'machine', id: m.id, pos: V(...m.geo.panel), r: 0.6, label: `Operate ${m.def.name}` });
    for (const b of this.sim.belts.values()) list.push({ kind: 'belt', id: b.id, pos: V(b.x, 0.3, b.z), r: 0.42, label: 'Pick up conveyor section' });
    return list;
  }

  // =================================================================== events
  onEvent(e) {
    switch (e.type) {
      case 'itemSpawn': {
        this._addItem(e.id, e.item, e.x, e.y, e.z);
        if (e.puff) { this.fx.lowPolyPuff(V(e.x, e.y + 0.2, e.z), 1.15, { count: 11 }); this.audio.puff(V(e.x, e.y, e.z)); }
        break;
      }
      case 'itemRemove': {
        const v = this.items.get(e.id);
        if (v) { this.dynamic.remove(v.root); this.items.delete(e.id); }
        break;
      }
      case 'itemBounce':
        this.audio.itemThud(V(e.x, e.y, e.z), e.strength, ['steel_plate', 'bracket', 'motor', 'powder', 'ammo_box'].includes(e.item));
        break;
      case 'chuck': this.truck.hop(1); break;
      case 'machinePlaced': this._addMachine(this.sim.machines.get(e.id)); this.fx.lowPolyPuff(V(e.x, 0.3, e.z), 1.6, { count: 14 }); this.audio.puff(V(e.x, 0.5, e.z)); break;
      case 'machineRemoved': this._removeMachine(e.id); break;
      case 'beltPlaced': this._rebuildBelts(); this.fx.lowPolyPuff(V(e.x, 0.3, e.z), 0.5, { count: 5 }); this.audio.itemThud(V(e.x, 0.4, e.z), 0.6, true); break;
      case 'beltRemoved': this._rebuildBelts(); break;
      case 'machineDone': {
        const m = this.sim.machines.get(e.id);
        if (m && !e.toBelt) this.fx.lowPolyPuff(V(m.geo.tray[0], 1.2, m.geo.tray[2]), 0.45, { count: 6 });
        if (m) this.audio.machine('done', V(m.x, 1.2, m.z));
        break;
      }
      case 'deposit':
        this.fx.lowPolyPuff(V(e.x, e.y + 0.2, e.z), 0.55, { count: 6 });
        this.fx.lowPolyPuff(V(20.9, 0.8, FACTORY.sell.hopper.z), 0.5, { count: 5 });
        this.audio.deposit(V(e.x, e.y, e.z));
        break;
      case 'vanLoad': {
        const v = buildItem(e.item);
        v.root.position.fromArray(e.from);
        this.dynamic.add(v.root);
        this.flying.push({ v, from: V(...e.from), to: V(...e.to), t: 0, dur: 0.55 });
        break;
      }
    }
  }

  // =================================================================== update
  update(dt, time, cam) {
    const sim = this.sim;
    if (sim.items.size !== this.items.size) {
      for (const it of sim.items.values()) if (!this.items.has(it.id)) this._addItem(it.id, it.type, it.x, it.y, it.z);
      for (const [id, v] of this.items) if (!sim.items.has(id)) { this.dynamic.remove(v.root); this.items.delete(id); }
    }
    for (const [id, v] of this.items) {
      const it = sim.items.get(id);
      if (!it) continue;
      v.root.position.set(it.x, it.y, it.z);
      v.pivot.rotation.set(it.tumble, it.ry, 0);
    }
    for (const v of this.machines.values()) {
      const m = sim.machines.get(v.id);
      if (!m) continue;
      if (v.type !== m.type) continue;
      const run = !!m.current;
      v.t += dt;
      v.anim(dt, run, sim.machineProgress(v.id), v.t, v.ctx);
      if (v.lamp) {
        v.lamp.emissive.setHex(run ? 0xffa000 : m.auto ? 0x2fb5ff : 0x20ff60);
        v.lamp.emissiveIntensity = run ? (Math.sin(time * 8) > 0 ? 2.5 : 0.6) : 1.2;
      }
      this._drawLabel(v, m);
      if (cam) v.label.sprite.visible = cam.position.distanceToSquared(v.label.sprite.position) > 3.4 * 3.4;
    }
    this.beltTex.offset.y = (time * CONVEYOR.speed) % 1;

    // cage contents (what's waiting + what the van hasn't loaded yet)
    const V_ = sim.van;
    const shown = [...(V_.phase === 'loading' ? V_.manifest.slice(V_.loaded) : []), ...sim.cage];
    const key = shown.map((s) => s.type + s.count).join('|');
    if (key !== this.cageKey) {
      this.cageKey = key;
      this.cageGroup.clear();
      shown.slice(0, this.cageSlots.length).forEach((s, i) => {
        const v = buildItem(s.type);
        v.root.position.copy(this.cageSlots[i]);
        v.root.rotation.y = (i * 1.7) % 6.28;
        this.cageGroup.add(v.root);
      });
    }
    // flying goods into the van
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      f.v.root.position.lerpVectors(f.from, f.to, u);
      f.v.root.position.y += Math.sin(u * Math.PI) * 1.4;
      f.v.pivot.rotation.x += dt * 9;
      if (u >= 1) {
        this.dynamic.remove(f.v.root);
        this.flying.splice(i, 1);
        this.fx.lowPolyPuff(f.to, 0.7, { count: 7 });
        this.audio.chaChing(f.to);
        this.van.hop();
      }
    }

    // vehicles
    const hAt = (x, z) => sim.world.heightAt(x, z);
    const tp = sim.truckPose();
    this.truck.update(tp, dt, time, (pos, load) => this.fx.puff(pos.clone(), V(0.3, 1.4 + load, 0.2), 0x3a3a38, 0.25 + load * 0.2, 1.3, 0.35 + load * 0.2, 3), hAt);
    if (sim.truck.phase !== this.lastPhase) {
      if (sim.truck.phase === 'reversing' || sim.truck.phase === 'opening') this.audio.horn(V(tp.x, 2, tp.z));
      this.lastPhase = sim.truck.phase;
    }
    const vp = sim.vanPose();
    this.van.root.updateMatrixWorld();
    this.van.update(vp, dt, time, hAt, (pos, load) => this.fx.puff(pos, V(0.2, 1 + load, 0.3), 0x55524e, 0.2, 1.0, 0.3, 2.5));
    if (sim.van.phase !== this.lastVan) {
      if (sim.van.phase === 'loading') this.audio.horn(V(vp.x, 2, vp.z));
      this.lastVan = sim.van.phase;
    }
    this.beepT -= dt;
    const reversing = (tp.visible && tp.reversing && tp.speed > 0.05) ? tp : (vp.visible && vp.reversing && vp.speed > 0.05) ? vp : null;
    if (reversing && this.beepT <= 0) { this.beepT = 0.55; this.audio.beep(V(reversing.x, 1.5, reversing.z)); }
    if (this.audio.enabled) {
      if (!this.engineSnd) this.engineSnd = this.audio.engine();
      if (!this.vanSnd) this.vanSnd = this.audio.engine();
      if (this.engineSnd) this.engineSnd.set(V(tp.x, 1.5, tp.z), tp.speed, tp.visible);
      if (this.vanSnd) this.vanSnd.set(V(vp.x, 1.2, vp.z), vp.speed * 1.3, vp.visible);
    }
    this.mat.red.emissiveIntensity = sim.cage.length && sim.van.phase === 'idle' ? (Math.sin(time * 5) > 0 ? 1.6 : 0.3) : 0.3;

    this.screenT -= dt;
    if (this.screenT <= 0) { this.screenT = 0.5; this._drawTerminal(time); this._drawBoard(); this._drawSellScreen(); }
  }

  // =================================================================== status text
  truckStatus() {
    const sim = this.sim, T_ = sim.truck;
    const eta = truckEta(T_, sim.time);
    switch (T_.phase) {
      case 'idle': return { text: 'At depot', short: 'AT DEPOT' };
      case 'loading': return { text: `Loading at depot · arrives in ${Math.ceil(eta)} s`, short: `LOADING · ETA ${Math.ceil(eta)}s` };
      case 'inbound': return { text: `On the way · arrives in ${Math.ceil(eta)} s`, short: `EN ROUTE · ETA ${Math.ceil(eta)}s` };
      case 'reversing': return { text: 'Reversing into the delivery bay', short: 'REVERSING' };
      case 'opening': case 'dumping': case 'closing': return { text: 'Unloading at the delivery bay', short: 'UNLOADING' };
      case 'outbound': return { text: sim.pending.length ? 'Returning for your next order' : 'Returning to depot', short: 'RETURNING' };
      default: return { text: T_.phase, short: T_.phase.toUpperCase() };
    }
  }

  vanStatus() {
    const sim = this.sim, v = sim.van;
    const eta = vanEta(v, sim.time);
    switch (v.phase) {
      case 'idle': return { text: sim.cage.length ? 'Ready — call it when you want to sell' : 'Waiting for goods in the cage', short: sim.cage.length ? 'READY TO CALL' : 'CAGE EMPTY' };
      case 'dispatch': case 'inbound': return { text: `On the way · arrives in ${Math.ceil(eta)} s`, short: `VAN ETA ${Math.ceil(eta)}s` };
      case 'loading': return { text: 'Loading the cage', short: 'LOADING' };
      default: return { text: 'Heading back to the buyer', short: 'LEAVING' };
    }
  }

  _drawLabel(v, m) {
    const L = v.label;
    const run = !!m.current;
    const prog = this.sim.machineProgress(v.id);
    const bufN = Object.values(m.buffer).reduce((a, n) => a + n, 0);
    const key = `${run}|${Math.round(prog * 40)}|${m.queue.length}|${m.auto}|${bufN}`;
    if (L.key === key) return;
    L.key = key;
    const x = L.ctx;
    x.clearRect(0, 0, 320, 96);
    x.fillStyle = 'rgba(18,21,24,0.78)';
    x.fillRect(0, 0, 320, 96);
    x.fillStyle = run ? '#f2b01e' : m.auto ? '#2fb5ff' : '#7fd18b';
    x.fillRect(0, 0, 6, 96);
    x.fillStyle = '#ede8df';
    x.font = '700 30px "Barlow Condensed", Impact, sans-serif';
    x.fillText(m.def.name.toUpperCase(), 18, 36, 290);
    x.font = '500 17px "IBM Plex Mono", monospace';
    x.fillStyle = run ? '#f2b01e' : '#a9aca9';
    const r = m.current?.recipe;
    const autoTxt = m.auto ? `AUTO · ${bufN} IN BUFFER` : 'IDLE · PRESS E';
    const tail = run ? `${m.queue.length ? ` +${m.queue.length}` : ''}${m.current.auto ? ' ·A' : ''}` : '';
    let head = run ? r.name.toUpperCase() : autoTxt;
    // shorten long recipe names with an ellipsis instead of clipping off the plate
    while (run && head.length > 4 && x.measureText(head + tail).width > 290) head = head.slice(0, -2) + '…';
    x.fillText(head + tail, 18, 62, 290);
    x.fillStyle = 'rgba(237,232,223,0.15)';
    x.fillRect(18, 74, 284, 8);
    if (run) { x.fillStyle = '#f2b01e'; x.fillRect(18, 74, 284 * prog, 8); }
    L.tex.needsUpdate = true;
  }

  _drawTerminal(time) {
    const { ctx: x, tex } = this.termScreen;
    const sim = this.sim;
    x.fillStyle = '#140d05';
    x.fillRect(0, 0, 512, 384);
    x.fillStyle = '#ffb347';
    x.font = '700 26px "IBM Plex Mono", monospace';
    x.fillText('FOUNDRY SUPPLY NET', 24, 44);
    x.font = '500 16px "IBM Plex Mono", monospace';
    x.fillStyle = '#c98a3a';
    x.fillText('v3.0 · PLANT 07 · TERMINAL 01', 24, 68);
    x.fillRect(24, 82, 464, 2);
    x.fillStyle = '#ffb347';
    x.font = '500 20px "IBM Plex Mono", monospace';
    const rows = [
      ['FUNDS', money(sim.funds)],
      ['TRUCK D-07', this.truckStatus().short],
      ['PICKUP VAN', this.vanStatus().short],
      ['CAGE VALUE', money(sim.cageValue())],
    ];
    rows.forEach(([k, v], i) => { x.fillText(k, 24, 124 + i * 40); x.textAlign = 'right'; x.fillText(v, 488, 124 + i * 40); x.textAlign = 'left'; });
    x.fillRect(24, 290, 464, 2);
    x.fillText('> PRESS [E] TO ACCESS' + (Math.floor(time * 2) % 2 ? '_' : ''), 24, 334);
    x.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < 384; y += 4) x.fillRect(0, y, 512, 2);
    tex.needsUpdate = true;
  }

  _drawSellScreen() {
    const { ctx: x, tex } = this.sellScreen;
    const sim = this.sim;
    x.fillStyle = '#0b1a14'; x.fillRect(0, 0, 256, 128);
    x.fillStyle = '#7fd18b';
    x.font = '700 22px "IBM Plex Mono", monospace';
    x.fillText('CAGE ' + money(sim.cageValue()), 12, 38);
    x.font = '500 16px "IBM Plex Mono", monospace';
    x.fillText(`${sim.cage.length} STACK${sim.cage.length === 1 ? '' : 'S'}`, 12, 66);
    x.fillStyle = '#f2b01e';
    x.fillText(this.vanStatus().short, 12, 100);
    tex.needsUpdate = true;
  }

  _drawBoard() {
    const { ctx: x, tex } = this.board;
    const sim = this.sim;
    x.fillStyle = '#0f1316';
    x.fillRect(0, 0, 1024, 480);
    x.fillStyle = '#f2b01e';
    x.fillRect(0, 0, 1024, 70);
    x.fillStyle = '#1d1d1b';
    x.font = '800 44px "Barlow Condensed", Impact, sans-serif';
    x.fillText('PLANT 07 · PRODUCTION', 30, 50);
    x.textAlign = 'right';
    x.font = '600 24px "IBM Plex Mono", monospace';
    x.fillText(`VAN: ${this.vanStatus().short}`, 994, 46);
    x.textAlign = 'left';
    const tiles = [['FUNDS', money(sim.funds)], ['SOLD', money(sim.stats.shippedValue)], ['UNITS MADE', String(sim.stats.produced)], ['CONTRACTS', String(sim.stats.contracts)]];
    tiles.forEach(([k, v], i) => {
      const tx = 30 + i * 246;
      x.fillStyle = '#9aa1a7';
      x.font = '500 20px "IBM Plex Mono", monospace';
      x.fillText(k, tx, 118);
      x.fillStyle = '#ede8df';
      x.font = '700 58px "Barlow Condensed", Impact, sans-serif';
      x.fillText(v, tx, 178);
    });
    x.fillStyle = 'rgba(237,232,223,0.15)';
    x.fillRect(30, 205, 964, 2);
    const list = [...sim.machines.values()].slice(0, 5);
    if (!list.length) { x.fillStyle = '#9aa1a7'; x.font = '500 24px "IBM Plex Mono", monospace'; x.fillText('No machines yet — craft or buy one at the terminal', 30, 260); }
    list.forEach((m, i) => {
      const y = 250 + i * 44;
      const run = !!m.current;
      x.fillStyle = run ? '#f2b01e' : m.auto ? '#2fb5ff' : '#7fd18b';
      x.beginPath(); x.arc(44, y - 8, 9, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ede8df';
      x.font = '600 28px "Barlow Condensed", Impact, sans-serif';
      x.fillText(m.def.name.toUpperCase(), 66, y);
      x.font = '500 20px "IBM Plex Mono", monospace';
      x.fillStyle = run ? '#f2b01e' : '#9aa1a7';
      x.fillText(run ? `${m.current.recipe.name}  ${Math.round(sim.machineProgress(m.id) * 100)}%${m.queue.length ? `  (+${m.queue.length})` : ''}` : m.auto ? 'Auto · waiting for inputs' : 'Idle', 360, y);
    });
    tex.needsUpdate = true;
  }
}

export { money, machineMats };
