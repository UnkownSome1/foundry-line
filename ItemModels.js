// Low-poly models for every item type + icon thumbnails rendered from them.
// Models sit with their base on y=0 and are centred in X/Z.
import * as THREE from 'three';
import { chamferBox } from '../gfx/geometry.js';
import { ITEMS } from '../../shared/factory/items.js';
import * as T from '../gfx/textures.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, flatShading: true, ...o });
let M = null;
function mats() {
  if (M) return M;
  M = {
    steel: std(0x9aa2a8, { metalness: 0.7, roughness: 0.4 }),
    zinc: std(0xc2c8b8, { metalness: 0.7, roughness: 0.35 }),
    strap: std(0xd8641e),
    black: std(0x1e1f21, { roughness: 0.7 }),
    copper: std(0xc4753a, { metalness: 0.9, roughness: 0.3 }),
    white: std(0xe7e3d8, { roughness: 0.9 }),
    blue: std(0x2f5d8a, { roughness: 0.5 }),
    brass: std(0xd4a94f, { metalness: 1, roughness: 0.3 }),
    red: std(0xb3261e, { roughness: 0.5 }),
    lead: std(0x55595e, { metalness: 0.5, roughness: 0.55 }),
    pcb: std(0x2f7a3a, { roughness: 0.5 }),
    gold: std(0xe0b44a, { metalness: 1, roughness: 0.3 }),
    grey: std(0x6f767c, { roughness: 0.5, metalness: 0.3 }),
    orange: std(0xe0762a, { roughness: 0.55 }),
    yellow: std(0xf2b01e, { roughness: 0.6 }),
    olive: std(0x5b6536, { roughness: 0.7 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x103428, emissive: 0x3cffb0, emissiveIntensity: 0.7 }),
    labelPellet: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'PP PELLETS', size: 40 }, { text: '25 KG', size: 30 }], { w: 256, h: 128, bg: '#2f5d8a', fg: '#ffffff' }), roughness: 0.8 }),
    labelPowder: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'PROPELLANT', size: 30 }, { text: 'FLAMMABLE', size: 22, color: '#f2b01e' }], { w: 256, h: 96, bg: '#b3261e', fg: '#ffffff' }), roughness: 0.6 }),
    labelAmmo: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: '9×19MM · 30', size: 34 }], { w: 256, h: 64, bg: '#5b6536', fg: '#f2d64a' }), roughness: 0.7 }),
  };
  return M;
}

function add(g, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return m;
}
const cb = chamferBox;
const cyl = (rt, rb, h, s = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);

const BUILDERS = {
  steel_plate(g, m) {
    for (let i = 0; i < 4; i++) add(g, cb(0.6, 0.024, 0.4, 0.006), m.steel, (i % 2) * 0.012, 0.012 + i * 0.026, (i % 3) * 0.01, 0, (i - 1.5) * 0.03, 0);
    for (const x of [-0.18, 0.18]) add(g, cb(0.04, 0.12, 0.42, 0.005), m.strap, x, 0.055, 0);
  },
  copper_wire(g, m) {
    add(g, cyl(0.17, 0.17, 0.03, 14), m.black, 0, 0.015, 0);
    add(g, cyl(0.17, 0.17, 0.03, 14), m.black, 0, 0.235, 0);
    add(g, cyl(0.135, 0.135, 0.19, 14), m.copper, 0, 0.125, 0);
    add(g, cyl(0.05, 0.05, 0.26, 8), m.grey, 0, 0.13, 0);
  },
  pellets(g, m) {
    add(g, cb(0.52, 0.2, 0.36, 0.07, { top: 0.9 }), m.white, 0, 0.1, 0);
    add(g, new THREE.PlaneGeometry(0.28, 0.14), m.labelPellet, 0, 0.201, 0, -Math.PI / 2, 0, 0);
  },
  brass(g, m) {
    for (let i = 0; i < 7; i++) {
      const a = (i / 6) * Math.PI * 2;
      const r = i === 6 ? 0 : 0.038;
      add(g, cyl(0.019, 0.019, 0.46, 7), m.brass, 0, 0.06 + Math.sin(a) * r, Math.cos(a) * r, 0, 0, Math.PI / 2);
    }
    for (const x of [-0.12, 0.12]) add(g, new THREE.TorusGeometry(0.06, 0.008, 4, 10), m.black, x, 0.06, 0, 0, Math.PI / 2, 0);
  },
  powder(g, m) {
    add(g, cyl(0.085, 0.085, 0.17, 12), m.grey, 0, 0.085, 0);
    add(g, cyl(0.087, 0.087, 0.1, 12, true), m.labelPowder, 0, 0.085, 0);
    add(g, cyl(0.07, 0.07, 0.025, 12), m.black, 0, 0.18, 0);
  },
  lead(g, m) {
    add(g, cb(0.26, 0.07, 0.11, 0.012, { top: 0.72 }), m.lead, 0, 0.035, -0.06);
    add(g, cb(0.26, 0.07, 0.11, 0.012, { top: 0.72 }), m.lead, 0.01, 0.035, 0.06);
    add(g, cb(0.26, 0.07, 0.11, 0.012, { top: 0.72 }), m.lead, 0, 0.105, 0, 0, 0.1, 0);
  },
  circuit(g, m) {
    add(g, cb(0.28, 0.03, 0.2, 0.008), m.grey, 0, 0.015, 0);
    add(g, new THREE.BoxGeometry(0.24, 0.012, 0.16), m.pcb, 0, 0.036, 0);
    for (const [x, z, s] of [[-0.05, -0.02, 0.06], [0.06, 0.03, 0.04], [0.06, -0.04, 0.03], [-0.07, 0.05, 0.03]]) add(g, new THREE.BoxGeometry(s, 0.012, s), m.black, x, 0.048, z);
    add(g, new THREE.BoxGeometry(0.2, 0.006, 0.02), m.gold, 0, 0.044, 0.07);
  },
  fasteners(g, m) {
    add(g, cb(0.22, 0.1, 0.15, 0.015), m.blue, 0, 0.05, 0);
    for (let i = 0; i < 8; i++) add(g, cyl(0.012, 0.012, 0.05, 6), m.zinc, -0.08 + (i % 4) * 0.05, 0.11, -0.03 + Math.floor(i / 4) * 0.06, 0.3 * (i % 3 - 1), 0, 0.5 * ((i * 7) % 3 - 1));
  },
  bracket(g, m) {
    for (let i = 0; i < 3; i++) {
      const y = i * 0.03;
      add(g, cb(0.18, 0.012, 0.1, 0.003), m.zinc, 0, 0.006 + y, 0, 0, i * 0.2, 0);
      add(g, cb(0.012, 0.1, 0.1, 0.003), m.zinc, -0.084 + i * 0.004, 0.05 + y, 0, 0, i * 0.2, 0);
    }
  },
  housing(g, m) {
    add(g, cb(0.26, 0.13, 0.18, 0.025), m.orange, 0, 0.065, 0);
    add(g, new THREE.BoxGeometry(0.262, 0.008, 0.182), m.black, 0, 0.1, 0);
  },
  harness(g, m) {
    add(g, new THREE.TorusGeometry(0.1, 0.02, 5, 14), m.black, 0, 0.02, 0, Math.PI / 2, 0, 0);
    add(g, new THREE.TorusGeometry(0.095, 0.012, 5, 14), m.red, 0.01, 0.045, 0, Math.PI / 2, 0, 0);
    add(g, new THREE.TorusGeometry(0.1, 0.01, 5, 14), m.yellow, -0.01, 0.062, 0.005, Math.PI / 2, 0, 0);
    add(g, cb(0.07, 0.04, 0.05, 0.008), m.grey, 0.13, 0.03, 0);
  },
  motor(g, m) {
    add(g, cb(0.28, 0.03, 0.2, 0.008), m.grey, 0, 0.015, 0);
    add(g, cyl(0.12, 0.12, 0.28, 12), m.blue, 0, 0.15, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 5; i++) add(g, cyl(0.128, 0.128, 0.015, 12), m.blue, -0.1 + i * 0.05, 0.15, 0, 0, 0, Math.PI / 2);
    add(g, cyl(0.1, 0.1, 0.04, 12), m.grey, 0.16, 0.15, 0, 0, 0, Math.PI / 2);
    add(g, cyl(0.018, 0.018, 0.09, 8), m.steel, 0.22, 0.15, 0, 0, 0, Math.PI / 2);
    add(g, cb(0.08, 0.06, 0.08, 0.01), m.black, -0.02, 0.29, 0);
  },
  control_unit(g, m) {
    add(g, cb(0.3, 0.22, 0.13, 0.02), m.grey, 0, 0.11, 0);
    add(g, new THREE.BoxGeometry(0.3, 0.03, 0.135), m.orange, 0, 0.2, 0);
    add(g, new THREE.PlaneGeometry(0.14, 0.08), m.screen, -0.05, 0.12, 0.066);
    for (const [x, mt] of [[0.08, m.red], [0.12, m.yellow]]) add(g, cyl(0.014, 0.014, 0.02, 8), mt, x, 0.12, 0.07, Math.PI / 2, 0, 0);
  },
  conveyor(g, m) {
    add(g, new THREE.BoxGeometry(0.62, 0.04, 0.42), m.black, 0, 0.1, 0);
    for (const x of [-0.31, 0.31]) add(g, new THREE.BoxGeometry(0.04, 0.1, 0.46), m.yellow, x, 0.08, 0);
    for (const z of [-0.2, 0.2]) add(g, cyl(0.03, 0.03, 0.62, 8), m.steel, 0, 0.1, z, 0, 0, Math.PI / 2);
    for (const [x, z] of [[-0.28, -0.18], [0.28, -0.18], [-0.28, 0.18], [0.28, 0.18]]) add(g, new THREE.BoxGeometry(0.03, 0.08, 0.03), m.grey, x, 0.04, z);
  },
  ammo_box(g, m) {
    add(g, cb(0.28, 0.16, 0.13, 0.015), m.olive, 0, 0.08, 0);
    add(g, new THREE.BoxGeometry(0.29, 0.03, 0.14), m.olive, 0, 0.165, 0);
    add(g, new THREE.TorusGeometry(0.035, 0.008, 4, 8, Math.PI), m.black, 0, 0.18, 0);
    add(g, new THREE.PlaneGeometry(0.2, 0.05), m.labelAmmo, 0, 0.09, 0.066);
  },
};

// Flat-packed machine kit: slatted crate with a coloured band and stencil
const KIT_COLORS = { fabricator: 0x2f5d8a, press: 0x5b7a6c, moulder: 0x3f8a4a, electronics: 0x2f7fb0, assembler: 0xe8731c, ammo: 0x55603a };
const kitMats = {};
function kitBuilder(machine) {
  return (g, m) => {
    if (!kitMats[machine]) {
      const name = ITEMS[`kit_${machine}`].name.replace(' Kit', '').toUpperCase();
      kitMats[machine] = {
        band: std(KIT_COLORS[machine] || 0x777777, { roughness: 0.5 }),
        label: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: name, size: 40 }, { text: 'MACHINE KIT · THIS WAY UP', size: 20 }], { w: 512, h: 128, bg: '#e8e0cc', fg: '#1d1d1b' }), roughness: 0.7 }),
        wood: std(0xa98556, { roughness: 0.85 }),
        dark: std(0x7a5f3c, { roughness: 0.85 }),
      };
    }
    const k = kitMats[machine];
    add(g, cb(0.9, 0.6, 0.62, 0.03), k.wood, 0, 0.3, 0);
    for (const x of [-0.42, 0.42]) add(g, new THREE.BoxGeometry(0.06, 0.62, 0.64), k.dark, x, 0.31, 0);
    for (const y of [0.05, 0.57]) add(g, new THREE.BoxGeometry(0.92, 0.06, 0.64), k.dark, 0, y, 0);
    add(g, new THREE.BoxGeometry(0.92, 0.1, 0.645), k.band, 0, 0.31, 0);
    add(g, new THREE.PlaneGeometry(0.5, 0.125), k.label, 0, 0.44, 0.316);
    add(g, new THREE.PlaneGeometry(0.5, 0.125), k.label, 0, 0.44, -0.316, 0, Math.PI, 0);
  };
}
for (const type of Object.keys(ITEMS)) if (type.startsWith('kit_')) BUILDERS[type] = kitBuilder(type.slice(4));

const heights = {};

/** New mesh group for an item type; returns {root, pivot, h}. The pivot sits at the model centre. */
export function buildItem(type) {
  const m = mats();
  const inner = new THREE.Group();
  (BUILDERS[type] || BUILDERS.fasteners)(inner, m);
  if (heights[type] === undefined) {
    const box = new THREE.Box3().setFromObject(inner);
    heights[type] = box.max.y - box.min.y;
  }
  const h = heights[type];
  inner.position.y = -h / 2;
  const pivot = new THREE.Group();
  pivot.position.y = h / 2;
  pivot.add(inner);
  const root = new THREE.Group();
  root.add(pivot);
  root.userData.type = type;
  return { root, pivot, h };
}

/** Render a transparent thumbnail for every item (data URLs for the UI). */
export function renderIcons(size = 112) {
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setSize(size, size, false);
  r.setPixelRatio(1);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x3a332c, 1.4));
  const d = new THREE.DirectionalLight(0xffffff, 2.6);
  d.position.set(1.5, 2.5, 2);
  scene.add(d);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  const icons = {};
  for (const type of Object.keys(ITEMS)) {
    const { root } = buildItem(type);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    const rad = box.getSize(new THREE.Vector3()).length() / 2;
    const dist = rad / Math.sin((cam.fov / 2) * Math.PI / 180) * 1.02;
    cam.position.set(c.x + dist * 0.62, c.y + dist * 0.55, c.z + dist * 0.56);
    cam.lookAt(c);
    r.setClearColor(0x000000, 0);
    r.render(scene, cam);
    icons[type] = r.domElement.toDataURL('image/png');
    scene.remove(root);
  }
  r.dispose();
  try { r.forceContextLoss(); } catch (_) { /* ignore */ }
  return icons;
}
