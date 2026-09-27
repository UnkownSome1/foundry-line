// Gloved hand with articulated fingers + sleeve forearm (first-person).
// Hand frame: wrist at origin, fingers toward -Z, palm faces -Y, back of hand +Y.
// Right hand thumb on -X, left hand thumb on +X.
import * as THREE from 'three';
import { chamferBox } from '../gfx/geometry.js';

let HM = null;
export function handMats(teamColor = 0xff6b1a) {
  if (HM) return HM;
  HM = {
    glove: new THREE.MeshStandardMaterial({ color: 0x2e2d2a, roughness: 0.85 }),
    gloveDark: new THREE.MeshStandardMaterial({ color: 0x1e1e1c, roughness: 0.7 }),
    knuckle: new THREE.MeshStandardMaterial({ color: 0x3b3d38, roughness: 0.5, metalness: 0.1 }),
    sleeve: new THREE.MeshStandardMaterial({ color: 0x2c3a4a, roughness: 0.9 }),
    cuff: new THREE.MeshStandardMaterial({ color: 0x232f3c, roughness: 0.9 }),
    hivis: new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.6, emissive: teamColor, emissiveIntensity: 0.08 }),
    reflect: new THREE.MeshStandardMaterial({ color: 0xd9dcd8, roughness: 0.3, metalness: 0.6 }),
    watch: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.4, metalness: 0.5 }),
    watchFace: new THREE.MeshStandardMaterial({ color: 0x2c4a3e, emissive: 0x44d69a, emissiveIntensity: 0.35 }),
  };
  return HM;
}

const FINGER_LEN = [
  [0.043, 0.027, 0.022], // index
  [0.047, 0.029, 0.023], // middle
  [0.044, 0.027, 0.022], // ring
  [0.035, 0.021, 0.019], // pinky
];

export class Hand {
  constructor(side = 'right', { simple = false } = {}) {
    const m = handMats();
    this.side = side;
    const s = side === 'right' ? -1 : 1; // thumb side sign
    this.root = new THREE.Group();
    this.root.name = `hand-${side}`;
    this.s = s;
    this.simple = simple;
    if (simple) { this._buildSimple(m, s); return; }
    // palm
    const palm = new THREE.Mesh(chamferBox(0.078, 0.025, 0.09, 0.0055, { top: 1, bottom: 0.94 }), m.glove);
    palm.position.set(0, 0, -0.046);
    this.root.add(palm);
    // knuckle armour + back-of-hand panel
    const kn = new THREE.Mesh(chamferBox(0.07, 0.007, 0.022, 0.003), m.knuckle);
    kn.position.set(0, 0.0145, -0.078);
    this.root.add(kn);
    const back = new THREE.Mesh(chamferBox(0.056, 0.005, 0.038, 0.002), m.gloveDark);
    back.position.set(0, 0.0135, -0.038);
    this.root.add(back);
    // wrist cuff of the glove
    const cuff = new THREE.Mesh(chamferBox(0.066, 0.038, 0.03, 0.009), m.gloveDark);
    cuff.position.set(0, 0.002, 0.004);
    this.root.add(cuff);

    this.fingers = [];
    const xs = [0.0285, 0.0095, -0.0095, -0.0275];
    FINGER_LEN.forEach((lens, fi) => {
      const joints = [];
      let parent = this.root;
      const base = new THREE.Group();
      base.position.set(s * xs[fi], -0.002, -0.089); // index sits on the thumb side
      parent.add(base);
      parent = base;
      lens.forEach((len, ji) => {
        const j = ji === 0 ? base : new THREE.Group();
        if (ji > 0) { j.position.z = -lens[ji - 1]; parent.add(j); }
        const w = 0.0152 - ji * 0.001 - (fi === 3 ? 0.0015 : 0);
        const seg = new THREE.Mesh(chamferBox(w, 0.0148 - ji * 0.001, len + 0.003, 0.0034), m.glove);
        seg.position.z = -len / 2;
        j.add(seg);
        if (ji === 0) {
          const pad = new THREE.Mesh(chamferBox(w * 0.9, 0.005, len * 0.6, 0.002), m.knuckle);
          pad.position.set(0, 0.009, -len * 0.45);
          j.add(pad);
        }
        joints.push(j);
        parent = j;
      });
      this.fingers.push(joints);
    });

    // thumb
    const tb = new THREE.Group();
    tb.position.set(s * 0.034, -0.006, -0.028);
    this.root.add(tb);
    const tm = new THREE.Group();
    tm.position.z = -0.036;
    tb.add(tm);
    const tt = new THREE.Group();
    tt.position.z = -0.03;
    tm.add(tt);
    const t0 = new THREE.Mesh(chamferBox(0.022, 0.02, 0.042, 0.006), m.glove);
    t0.position.z = -0.018;
    tb.add(t0);
    const t1 = new THREE.Mesh(chamferBox(0.019, 0.018, 0.034, 0.005), m.glove);
    t1.position.z = -0.015;
    tm.add(t1);
    const t2 = new THREE.Mesh(chamferBox(0.017, 0.016, 0.026, 0.005), m.glove);
    t2.position.z = -0.012;
    tt.add(t2);
    this.thumb = [tb, tm, tt];
    this.s = s;

    this.pose = { curl: [0.8, 0.8, 0.8, 0.8], thumb: 0.5, thumbOpp: 0.5, spread: 0.1 };
    this.apply();
  }

  /** Third-person LOD: palm, two-segment finger block, thumb (4 draw calls). */
  _buildSimple(m, s) {
    const palm = new THREE.Mesh(chamferBox(0.078, 0.026, 0.092, 0.007), m.glove);
    palm.position.set(0, 0, -0.046);
    const cuff = new THREE.Mesh(chamferBox(0.066, 0.038, 0.03, 0.009), m.gloveDark);
    cuff.position.set(0, 0.002, 0.004);
    this.f0 = new THREE.Group();
    this.f0.position.set(0, -0.002, -0.089);
    const b0 = new THREE.Mesh(chamferBox(0.07, 0.017, 0.048, 0.006), m.glove);
    b0.position.z = -0.024;
    this.f1 = new THREE.Group();
    this.f1.position.z = -0.046;
    const b1 = new THREE.Mesh(chamferBox(0.066, 0.015, 0.042, 0.006), m.glove);
    b1.position.z = -0.02;
    this.f0.add(b0, this.f1);
    this.f1.add(b1);
    this.tb = new THREE.Group();
    this.tb.position.set(s * 0.034, -0.006, -0.028);
    const t = new THREE.Mesh(chamferBox(0.02, 0.019, 0.07, 0.006), m.glove);
    t.position.z = -0.032;
    this.tb.add(t);
    this.root.add(palm, cuff, this.f0, this.tb);
    this.pose = { curl: [0.8, 0.8, 0.8, 0.8], thumb: 0.5, thumbOpp: 0.5, spread: 0.1 };
  }

  /** curl: 0 straight … 1 fist. index can be overridden (trigger finger). */
  apply(p = this.pose) {
    const s = this.s;
    if (this.simple) {
      const c = (p.curl[1] + p.curl[2] + p.curl[3]) / 3;
      this.f0.rotation.x = -c * 1.5;
      this.f1.rotation.x = -c * 1.7;
      this.tb.rotation.set(-0.25 - p.thumb * 0.35, -s * (0.75 - p.thumbOpp * 0.65), -s * (0.5 + p.thumbOpp * 0.4));
      return;
    }
    this.fingers.forEach((joints, fi) => {
      const c = p.curl[fi];
      joints[0].rotation.x = -c * 1.35;
      joints[1].rotation.x = -c * 1.55;
      joints[2].rotation.x = -c * 1.05;
      joints[0].rotation.y = s * (1.5 - fi) * 0.06 * p.spread;
    });
    const [tb, tm, tt] = this.thumb;
    tb.rotation.set(-0.25 - p.thumb * 0.35, -s * (0.75 - p.thumbOpp * 0.65), -s * (0.5 + p.thumbOpp * 0.4));
    tm.rotation.x = -p.thumb * 0.7;
    tt.rotation.x = -p.thumb * 0.8;
  }

  setShadows(v) {
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = v; o.receiveShadow = v; } });
  }
}

/** Jacketed forearm: place at the wrist and aim +Z toward the elbow. */
export class Forearm {
  constructor(length = 0.3, { watch = false } = {}) {
    const m = handMats();
    this.length = length;
    this.root = new THREE.Group();
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.05, length, 9, 1), m.sleeve);
    sleeve.material.flatShading = true;
    sleeve.rotation.x = Math.PI / 2;
    sleeve.position.z = length / 2 + 0.02;
    this.root.add(sleeve);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.04, 0.035, 9, 1), m.cuff);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.03;
    this.root.add(cuff);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0475, 0.0495, 0.03, 9, 1, true), m.hivis);
    band.rotation.x = Math.PI / 2;
    band.position.z = length * 0.72;
    this.root.add(band);
    const refl = new THREE.Mesh(new THREE.CylinderGeometry(0.0485, 0.05, 0.008, 9, 1, true), m.reflect);
    refl.rotation.x = Math.PI / 2;
    refl.position.z = length * 0.72;
    this.root.add(refl);
    if (watch) {
      const w = new THREE.Mesh(chamferBox(0.026, 0.01, 0.03, 0.004), m.watch);
      w.position.set(0, 0.041, 0.07);
      this.root.add(w);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(0.016, 0.018), m.watchFace);
      f.rotation.x = -Math.PI / 2;
      f.position.set(0, 0.0465, 0.07);
      this.root.add(f);
    }
  }
}
