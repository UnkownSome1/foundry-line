// Low-poly 6×6 military delivery truck. Front faces -Z. Driven by the deterministic
// pose from shared/factory/truck.js; adds suspension wobble, wheel spin, tailgate,
// beacon, headlights and reverse lights on top.
import * as THREE from 'three';
import { chamferBox } from '../gfx/geometry.js';
import { TRUCK } from '../../shared/factory/truck.js';
import * as T from '../gfx/textures.js';
import { damp, wrapAngle } from '../../shared/math.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...o });

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

export class Truck {
  constructor() {
    const M = (this.M = {
      olive: std(0x55603a),
      oliveDark: std(0x434c2e),
      canvas: std(0x7d7a57, { roughness: 0.95, side: THREE.DoubleSide }),
      black: std(0x1c1d1e),
      rubber: std(0x202021, { roughness: 0.95 }),
      steel: std(0x6c7174, { metalness: 0.6, roughness: 0.45 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.6, emissive: 0x0b1318 }),
      head: new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b0, emissiveIntensity: 0 }),
      tail: new THREE.MeshStandardMaterial({ color: 0x7a1510, emissive: 0xff2010, emissiveIntensity: 0.4 }),
      rev: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 }),
      beacon: new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff9000, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 }),
      wood: std(0x6b5a3e),
      stencil: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'PLANT 07', size: 44 }, { text: 'LOGISTICS · D-07', size: 30 }], { w: 256, h: 128, fg: '#e8e3d0' }), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
      star: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: '★', size: 110 }], { w: 128, h: 128, fg: '#e8e3d0' }), transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }),
      plate: new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: 'FL 07-DLV', size: 40 }], { w: 256, h: 64, bg: '#e8e3d0', fg: '#1d1d1b' }), roughness: 0.6 }),
    });

    this.root = new THREE.Group();
    this.root.name = 'delivery-truck';
    this.body = new THREE.Group(); // sprung mass
    this.root.add(this.body);
    const B = this.body;

    // chassis rails
    for (const x of [-0.55, 0.55]) add(B, new THREE.BoxGeometry(0.16, 0.22, 7.0), M.black, x, 0.85, 0);
    // bumper + brush guard + tow hooks
    add(B, cb(2.5, 0.28, 0.24, 0.05), M.oliveDark, 0, 0.92, -3.66);
    for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) add(B, new THREE.BoxGeometry(0.06, 0.8, 0.06), M.black, x, 1.45, -3.64);
    add(B, new THREE.BoxGeometry(1.9, 0.06, 0.06), M.black, 0, 1.84, -3.64);
    for (const x of [-0.9, 0.9]) add(B, new THREE.TorusGeometry(0.08, 0.025, 4, 8), M.black, x, 0.85, -3.8, 0, Math.PI / 2, 0);
    // hood + grille + headlights
    add(B, cb(2.0, 0.95, 1.25, 0.12, { top: 0.92 }), M.olive, 0, 1.5, -3.0);
    add(B, new THREE.BoxGeometry(1.4, 0.6, 0.05), M.black, 0, 1.45, -3.64);
    for (let i = 0; i < 6; i++) add(B, new THREE.BoxGeometry(0.05, 0.56, 0.06), M.oliveDark, -0.55 + i * 0.22, 1.45, -3.66);
    this.headlights = [];
    for (const x of [-0.85, 0.85]) {
      add(B, new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10), M.black, x, 1.62, -3.6, Math.PI / 2, 0, 0);
      this.headlights.push(add(B, new THREE.CircleGeometry(0.12, 10), M.head, x, 1.62, -3.67, 0, Math.PI, 0));
    }
    // front fenders
    for (const x of [-1.0, 1.0]) add(B, cb(0.55, 0.12, 1.3, 0.04), M.oliveDark, x, 1.34, -2.9);
    // cab
    add(B, cb(2.3, 1.35, 1.45, 0.12), M.olive, 0, 2.02, -1.85);
    add(B, cb(2.36, 0.12, 1.55, 0.04), M.oliveDark, 0, 2.72, -1.85); // roof lip
    add(B, new THREE.BoxGeometry(1.95, 0.62, 0.04), M.glass, 0, 2.3, -2.58, -0.12, 0, 0); // windshield
    add(B, new THREE.BoxGeometry(0.06, 0.66, 0.06), M.oliveDark, 0, 2.3, -2.6, -0.12, 0, 0); // split frame
    for (const s of [-1, 1]) {
      add(B, new THREE.BoxGeometry(0.04, 0.5, 0.75), M.glass, s * 1.16, 2.35, -1.95);
      add(B, new THREE.PlaneGeometry(0.62, 0.31), M.stencil, s * 1.162, 1.75, -1.85, 0, s * Math.PI / 2, 0);
      add(B, new THREE.BoxGeometry(0.06, 0.28, 0.18), M.black, s * 1.33, 2.35, -2.45); // mirror
      add(B, new THREE.BoxGeometry(0.22, 0.03, 0.03), M.black, s * 1.23, 2.35, -2.42);
      add(B, cb(0.5, 0.08, 0.3, 0.02), M.black, s * 1.05, 1.1, -1.7); // step
    }
    add(B, new THREE.PlaneGeometry(0.5, 0.5), M.star, 0, 1.55, -3.63, 0, Math.PI, 0);
    // roof beacon
    this.beacon = new THREE.Group();
    this.beacon.position.set(0.55, 2.86, -1.9);
    B.add(this.beacon);
    add(this.beacon, new THREE.CylinderGeometry(0.11, 0.13, 0.18, 8), M.beacon, 0, 0, 0);
    add(this.beacon, new THREE.BoxGeometry(0.04, 0.16, 0.2), M.black, 0, 0, 0);
    // exhaust stack + fuel tank + spare
    add(B, new THREE.CylinderGeometry(0.07, 0.07, 1.7, 8), M.black, 1.2, 2.2, -1.05);
    this.exhaust = new THREE.Object3D();
    this.exhaust.position.set(1.2, 3.1, -1.05);
    B.add(this.exhaust);
    add(B, new THREE.CylinderGeometry(0.28, 0.28, 1.0, 10), M.oliveDark, -1.12, 1.05, -0.6, 0, 0, Math.PI / 2);
    add(B, new THREE.CylinderGeometry(0.52, 0.52, 0.3, 12), M.rubber, 0, 2.05, -0.95, Math.PI / 2, 0, 0);

    // cargo bed
    const bedZ0 = -0.95, bedZ1 = 3.7, bedLen = bedZ1 - bedZ0, bedMid = (bedZ0 + bedZ1) / 2;
    add(B, new THREE.BoxGeometry(2.5, 0.2, bedLen), M.oliveDark, 0, 1.2, bedMid);
    for (const s of [-1, 1]) {
      add(B, cb(0.08, 0.62, bedLen, 0.02), M.olive, s * 1.21, 1.6, bedMid);
      for (let z = bedZ0 + 0.4; z < bedZ1; z += 0.8) add(B, new THREE.BoxGeometry(0.1, 0.62, 0.08), M.oliveDark, s * 1.25, 1.6, z);
      add(B, cb(0.7, 0.14, 1.9, 0.04), M.oliveDark, s * 1.05, 1.02, 2.25); // rear fenders
      // jerry can
      add(B, cb(0.14, 0.42, 0.3, 0.03), M.olive, s * 1.33, 1.5, bedZ1 - 0.4);
    }
    add(B, cb(2.5, 0.62, 0.08, 0.02), M.olive, 0, 1.6, bedZ0 + 0.04); // headboard
    // canvas tilt with hoops
    const tilt = new THREE.CylinderGeometry(1.26, 1.26, bedLen - 0.1, 12, 1, true, -Math.PI / 2, Math.PI);
    tilt.rotateX(-Math.PI / 2);
    tilt.scale(1, 0.85, 1);
    add(B, tilt, M.canvas, 0, 1.9, bedMid);
    for (let z = bedZ0 + 0.3; z < bedZ1; z += 1.1) add(B, new THREE.TorusGeometry(1.265, 0.03, 4, 12, Math.PI).scale(1, 0.85, 1), M.oliveDark, 0, 1.9, z);
    add(B, new THREE.BoxGeometry(2.5, 0.56, 0.02), M.canvas, 0, 1.6 + 0.3, bedZ0 + 0.1); // front canvas wall (hidden mostly)
    // rolled-up rear flap
    add(B, new THREE.CylinderGeometry(0.12, 0.12, 2.3, 8), M.canvas, 0, 2.72, bedZ1 - 0.05, 0, 0, Math.PI / 2);
    // cargo inside: crates (visible through the back)
    for (const [x, z, s] of [[-0.5, 0.2, 0.7], [0.45, 0.4, 0.6], [0.0, 1.3, 0.55], [-0.55, 1.2, 0.5]]) add(B, cb(s, s, s, 0.04), M.wood, x, 1.3 + s / 2, z);
    // tail lights, reverse lights, plate
    for (const s of [-1, 1]) {
      add(B, new THREE.BoxGeometry(0.16, 0.1, 0.05), M.tail, s * 1.0, 1.0, bedZ1 + 0.03);
      add(B, new THREE.BoxGeometry(0.1, 0.08, 0.05), M.rev, s * 0.75, 1.0, bedZ1 + 0.03);
      add(B, new THREE.BoxGeometry(0.4, 0.4, 0.02), M.black, s * 1.05, 0.75, bedZ1 - 0.2); // mud flaps
    }
    add(B, new THREE.PlaneGeometry(0.44, 0.11), M.plate, 0, 0.95, bedZ1 + 0.06);
    // tailgate (hinged at the bottom rear edge)
    this.gate = new THREE.Group();
    this.gate.position.set(0, 1.3, bedZ1);
    B.add(this.gate);
    add(this.gate, cb(2.4, 0.6, 0.08, 0.02), M.olive, 0, 0.3, 0);
    for (const x of [-0.8, 0, 0.8]) add(this.gate, new THREE.BoxGeometry(0.08, 0.6, 0.1), M.oliveDark, x, 0.3, 0.02);
    this.rearPoint = new THREE.Object3D();
    this.rearPoint.position.set(0, 1.6, bedZ1);
    B.add(this.rearPoint);

    // wheels (unsprung, stay on the ground)
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.56, 0.56, 0.42, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.44, 8);
    hubGeo.rotateZ(Math.PI / 2);
    const lugGeo = new THREE.BoxGeometry(0.44, 0.1, 0.14);
    for (const z of [-2.85, 1.55, 2.85]) {
      for (const s of [-1, 1]) {
        const w = new THREE.Group();
        w.position.set(s * 1.0, 0.56, z);
        this.root.add(w);
        add(w, wheelGeo, M.rubber);
        add(w, hubGeo, M.olive);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          add(w, lugGeo, M.rubber, 0, Math.sin(a) * 0.54, Math.cos(a) * 0.54, a, 0, 0);
        }
        this.wheels.push(w);
      }
    }
    this.wheelSpin = 0;
    this.yawVis = null;
    this.bounce = { y: 0, vy: 0, pitch: 0, vp: 0, roll: 0, vr: 0 };
    this.lastSpeed = 0;
    this.exhaustT = 0;
    this.root.visible = false;
  }

  /**
   * @param pose from truckPose()
   * @param dt frame time
   * @param onExhaust(pos) called to emit smoke
   */
  update(pose, dt, time, onExhaust, heightAt = null) {
    this.root.visible = pose.visible;
    if (!pose.visible) { this.yawVis = null; return; }
    if (this.yawVis === null) this.yawVis = pose.yaw;
    this.yawVis += wrapAngle(pose.yaw - this.yawVis) * Math.min(1, dt * 10);
    const yawRate = wrapAngle(pose.yaw - (this._lastYaw ?? pose.yaw)) / Math.max(dt, 1e-3);
    this._lastYaw = pose.yaw;
    // follow the road surface: height at the axles, pitch from front vs rear
    let y = 0, pitch = 0;
    if (heightAt) {
      const fx = -Math.sin(this.yawVis), fz = -Math.cos(this.yawVis);
      const hf = heightAt(pose.x + fx * 2.85, pose.z + fz * 2.85);
      const hb = heightAt(pose.x - fx * 2.2, pose.z - fz * 2.2);
      y = (hf + hb) / 2;
      pitch = Math.atan2(hf - hb, 5.05);
    }
    this.root.rotation.order = 'YXZ';
    this.root.position.set(pose.x, y, pose.z);
    this.root.rotation.y = this.yawVis;
    this.root.rotation.x = pitch;

    // wheels
    const dir = pose.reversing ? -1 : 1;
    this.wheelSpin -= (pose.speed * dir * dt) / 0.56;
    for (const w of this.wheels) w.rotation.x = this.wheelSpin;

    // suspension: spring-damper driven by acceleration, turning and road buzz
    const acc = (pose.speed * dir - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = pose.speed * dir;
    const b = this.bounce;
    const buzz = pose.speed > 0.2 ? Math.sin(time * 23) * 0.0025 * Math.min(1, pose.speed / 5) : 0;
    b.vp += (-b.pitch * 60 - b.vp * 7 - acc * 0.012) * dt;
    b.pitch += b.vp * dt;
    b.vr += (-b.roll * 55 - b.vr * 6 + yawRate * pose.speed * 0.004) * dt;
    b.roll += b.vr * dt;
    b.vy += (-b.y * 90 - b.vy * 8) * dt;
    b.y += b.vy * dt;
    this.body.position.y = b.y + buzz;
    this.body.rotation.x = b.pitch;
    this.body.rotation.z = b.roll;

    // tailgate + lights
    this.gate.rotation.x = pose.gate * 1.62;
    this.beacon.rotation.y += dt * 9;
    const moving = pose.speed > 0.1;
    this.M.head.emissiveIntensity = 2.2;
    this.M.rev.emissiveIntensity = pose.reversing ? 3 : 0;
    this.M.tail.emissiveIntensity = !moving || acc < -0.5 ? 2.5 : 0.5;

    // exhaust puffs (heavier under load)
    this.exhaustT -= dt;
    if (this.exhaustT <= 0 && onExhaust) {
      this.exhaustT = moving ? 0.12 : 0.35;
      this.exhaust.getWorldPosition(this._ex || (this._ex = new THREE.Vector3()));
      onExhaust(this._ex, moving ? Math.min(1, pose.speed / 6) : 0.2);
    }
  }

  /** Kick the springs (the goofy hop when it chucks an item). */
  hop(strength = 1) {
    this.bounce.vy += 0.9 * strength;
    this.bounce.vp -= 1.2 * strength;
  }

  /** World-space OBB for pushing players out of the way. */
  obb() {
    return { x: this.root.position.x, z: this.root.position.z, yaw: this.root.rotation.y, hx: TRUCK.width / 2 + 0.1, hz: TRUCK.length / 2 + 0.1 };
  }
}
