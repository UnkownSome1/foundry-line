// Private buyer's panel van ("Hallett Freight"). Front faces -Z; sliding side door
// on the left (-X) side opens while loading the pickup cage.
import * as THREE from 'three';
import { chamferBox } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { wrapAngle } from '../../shared/math.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, flatShading: true, ...o });
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

export class Van {
  constructor() {
    const M = (this.M = {
      white: std(0xe9e6de, { metalness: 0.2 }),
      teal: std(0x1f8a8a),
      black: std(0x1b1c1d),
      rubber: std(0x202021, { roughness: 0.95 }),
      steel: std(0x9aa0a4, { metalness: 0.7, roughness: 0.35 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.6 }),
      head: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 2 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x7a1510, emissive: 0xff2010, emissiveIntensity: 0.5 }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff9000, emissiveIntensity: 2.5 }),
      interior: std(0x3a3d40),
      livery: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'HALLETT FREIGHT', size: 58, color: '#1f8a8a' }, { text: 'WE BUY FACTORY SURPLUS · PLANT 07 CONTRACT', size: 22, color: '#3a3d40' }], { w: 1024, h: 180 }), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    });
    this.root = new THREE.Group();
    this.root.name = 'pickup-van';
    this.root.rotation.order = 'YXZ';
    this.body = new THREE.Group();
    this.root.add(this.body);
    const B = this.body;
    // body shell: cargo box + sloped cab nose
    add(B, cb(2.05, 1.95, 3.7, 0.14), M.white, 0, 1.55, 0.75);
    add(B, cb(2.0, 1.25, 1.35, 0.16, { top: 0.92 }), M.white, 0, 1.2, -1.75);
    add(B, cb(1.9, 0.5, 0.9, 0.12, { top: 0.8 }), M.white, 0, 2.05, -1.3);
    add(B, new THREE.BoxGeometry(1.8, 0.55, 0.05), M.glass, 0, 2.05, -1.8, -0.55, 0, 0); // windshield
    for (const s of [-1, 1]) {
      add(B, new THREE.BoxGeometry(0.04, 0.45, 0.7), M.glass, s * 1.02, 1.95, -1.15);
      add(B, new THREE.BoxGeometry(0.06, 0.18, 0.14), M.black, s * 1.13, 1.95, -1.65); // mirror
      add(B, new THREE.BoxGeometry(0.02, 0.18, 3.6), M.teal, s * 1.03, 1.0, 0.72); // stripe
    }
    add(B, new THREE.PlaneGeometry(3.4, 0.6), M.livery, 1.031, 1.75, 0.8, 0, Math.PI / 2, 0);
    add(B, new THREE.PlaneGeometry(3.4, 0.6), M.livery, -1.031, 1.75, 0.8, 0, -Math.PI / 2, 0);
    add(B, cb(2.1, 0.28, 0.25, 0.06), M.black, 0, 0.62, -2.45); // bumper
    add(B, cb(2.1, 0.28, 0.2, 0.06), M.black, 0, 0.62, 2.62);
    add(B, new THREE.BoxGeometry(1.2, 0.35, 0.04), M.black, 0, 1.0, -2.43); // grille
    for (const s of [-1, 1]) {
      add(B, new THREE.BoxGeometry(0.34, 0.16, 0.04), M.head, s * 0.75, 1.18, -2.43);
      add(B, new THREE.BoxGeometry(0.14, 0.4, 0.04), M.tail, s * 0.92, 1.3, 2.62);
    }
    // roof rack + beacon
    for (const z of [-0.2, 0.9, 2.0]) add(B, new THREE.BoxGeometry(1.9, 0.05, 0.06), M.steel, 0, 2.58, z);
    for (const s of [-1, 1]) add(B, new THREE.BoxGeometry(0.05, 0.05, 2.4), M.steel, s * 0.92, 2.6, 0.9);
    this.beacon = add(B, new THREE.CylinderGeometry(0.1, 0.12, 0.14, 8), M.beacon, 0, 2.62, -0.7);
    // cargo interior + sliding side door (left side)
    add(B, new THREE.BoxGeometry(0.02, 1.5, 1.3), M.interior, -1.0, 1.45, 0.25);
    this.door = new THREE.Group();
    this.door.position.set(-1.035, 1.45, 0.25);
    B.add(this.door);
    add(this.door, new THREE.BoxGeometry(0.04, 1.5, 1.3), M.white, 0, 0, 0);
    add(this.door, new THREE.BoxGeometry(0.02, 0.18, 1.3), M.teal, -0.02, -0.45, 0);
    add(this.door, new THREE.BoxGeometry(0.06, 0.05, 0.2), M.black, -0.03, 0, -0.5);
    this.doorPoint = new THREE.Object3D();
    this.doorPoint.position.set(-1.1, 1.2, 0.25);
    B.add(this.doorPoint);
    // wheels
    this.wheels = [];
    const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2);
    const hg = new THREE.CylinderGeometry(0.22, 0.22, 0.32, 8).rotateZ(Math.PI / 2);
    for (const z of [-1.55, 1.75]) for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.92, 0.42, z);
      this.root.add(w);
      add(w, wg, M.rubber);
      add(w, hg, M.steel);
      this.wheels.push(w);
    }
    this.spin = 0;
    this.yawVis = null;
    this.bob = { y: 0, vy: 0, p: 0, vp: 0 };
    this.lastSpeed = 0;
    this.exT = 0;
    this.root.visible = false;
  }

  update(pose, dt, time, heightAt, onExhaust) {
    this.root.visible = pose.visible;
    if (!pose.visible) { this.yawVis = null; return; }
    if (this.yawVis === null) this.yawVis = pose.yaw;
    this.yawVis += wrapAngle(pose.yaw - this.yawVis) * Math.min(1, dt * 10);
    const fx = -Math.sin(this.yawVis), fz = -Math.cos(this.yawVis);
    const hf = heightAt(pose.x + fx * 1.55, pose.z + fz * 1.55), hb = heightAt(pose.x - fx * 1.75, pose.z - fz * 1.75);
    this.root.position.set(pose.x, (hf + hb) / 2, pose.z);
    this.root.rotation.y = this.yawVis;
    this.root.rotation.x = Math.atan2(hf - hb, 3.3);
    const dir = pose.reversing ? -1 : 1;
    this.spin -= (pose.speed * dir * dt) / 0.42;
    for (const w of this.wheels) w.rotation.x = this.spin;
    const acc = (pose.speed * dir - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = pose.speed * dir;
    const b = this.bob;
    b.vp += (-b.p * 70 - b.vp * 7 - acc * 0.014) * dt; b.p += b.vp * dt;
    b.vy += (-b.y * 90 - b.vy * 8) * dt; b.y += b.vy * dt;
    this.body.position.y = b.y + (pose.speed > 0.2 ? Math.sin(time * 27) * 0.002 : 0);
    this.body.rotation.x = b.p;
    // sliding door runs back along the side
    this.door.position.z = 0.25 + pose.door * 1.25;
    this.door.position.x = -1.035 - pose.door * 0.08;
    this.beacon.rotation.y += dt * 8;
    this.M.beacon.emissiveIntensity = Math.sin(time * 10) > 0 ? 3 : 0.6;
    this.exT -= dt;
    if (this.exT <= 0 && onExhaust) {
      this.exT = pose.speed > 0.1 ? 0.14 : 0.4;
      const p = new THREE.Vector3(0.6, 0.35, 2.7).applyMatrix4(this.root.matrixWorld);
      onExhaust(p, Math.min(1, pose.speed / 6));
    }
  }

  hop() { this.bob.vy += 0.5; }
}
