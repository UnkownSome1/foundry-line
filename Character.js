// Plant-security operator: low-poly rigged character with procedural locomotion,
// analytic two-bone arm IK onto the pistol, aim pitch, crouch, jump, reload
// (driven by the same tracks as first person), hit flinch and death.
import * as THREE from 'three';
import { chamferBox, batchStatic } from '../gfx/geometry.js';
import { PistolModel } from './Pistol.js';
import { Hand } from './Hands.js';
import { RELOAD } from '../anim/tracks.js';
import { damp, clamp } from '../../shared/math.js';
import * as T from '../gfx/textures.js';

const V = () => new THREE.Vector3();
const Q = () => new THREE.Quaternion();

function cmat(color, o = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o });
}

let CM = null;
function charMats() {
  if (CM) return CM;
  CM = {
    skin: cmat(0xc28a66),
    skinDark: cmat(0x9c6a4c),
    jacket: cmat(0x2c3a4a),
    jacketDark: cmat(0x222e3b),
    pants: cmat(0x3a3d42),
    vest: cmat(0x6f6450),
    vestDark: cmat(0x5a513f),
    webbing: cmat(0x2a2826),
    boot: cmat(0x2a2320),
    sole: cmat(0x141210),
    knee: cmat(0x2b2c2e, { roughness: 0.6 }),
    helmet: cmat(0x4b5347, { roughness: 0.7 }),
    helmetDark: cmat(0x383e36),
    ear: cmat(0x3d4a3a, { roughness: 0.6 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xe0a030, roughness: 0.1, metalness: 0.4, emissive: 0x6a3a00, emissiveIntensity: 0.4 }),
    frame: cmat(0x1a1a1a, { roughness: 0.5 }),
    reflect: new THREE.MeshStandardMaterial({ color: 0xd9dcd8, roughness: 0.3, metalness: 0.6, flatShading: true }),
    magBlack: cmat(0x1c1d1f, { roughness: 0.5 }),
    antenna: cmat(0x111111),
    eye: new THREE.MeshBasicMaterial({ color: 0x1b1410 }),
    brow: cmat(0x3a2a20),
  };
  return CM;
}

function part(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
const cb = chamferBox;

function joint(parent, x, y, z, name) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export class Character {
  constructor({ name = 'Operator', team = 0xff6b1a } = {}) {
    const m = charMats();
    const accent = cmat(team, { roughness: 0.6, emissive: team, emissiveIntensity: 0.06 });
    this.accentMat = accent;
    this.name = name;
    this.root = new THREE.Group();
    this.root.name = `char-${name}`;
    this.body = joint(this.root, 0, 0, 0, 'body'); // death/fall pivot

    // ---------------------------------------------------------------- skeleton
    const hips = (this.hips = joint(this.body, 0, 0.96, 0, 'hips'));
    const spine = (this.spine = joint(hips, 0, 0.1, 0, 'spine'));
    const chest = (this.chest = joint(spine, 0, 0.2, 0, 'chest'));
    const neck = (this.neck = joint(chest, 0, 0.21, 0.005, 'neck'));
    const head = (this.head = joint(neck, 0, 0.07, 0, 'head'));
    this.legs = [-1, 1].map((s) => {
      const thigh = joint(hips, s * 0.1, -0.03, 0, 'thigh');
      const shin = joint(thigh, 0, -0.43, 0, 'shin');
      const foot = joint(shin, 0, -0.44, 0, 'foot');
      return { s, thigh, shin, foot };
    });
    this.arms = [-1, 1].map((s) => {
      const upper = joint(chest, s * 0.215, 0.165, 0.0, 'upperArm');
      const lower = joint(upper, 0, -0.29, 0, 'foreArm');
      const wrist = joint(lower, 0, -0.27, 0, 'wrist');
      return { s, upper, lower, wrist, L1: 0.29, L2: 0.27 };
    });

    // ---------------------------------------------------------------- meshes
    // Pelvis + belt
    part(hips, cb(0.34, 0.2, 0.22, 0.04), m.pants, 0, -0.02, 0);
    part(hips, cb(0.36, 0.06, 0.24, 0.015), m.webbing, 0, 0.06, 0);
    part(hips, cb(0.06, 0.045, 0.02, 0.006), m.frame, 0, 0.06, -0.125); // buckle
    // Left-hip magazine pouch (reload source) + dump pouch on the back
    const pouch = part(hips, cb(0.05, 0.1, 0.045, 0.01), m.vestDark, -0.15, 0.0, -0.1);
    part(pouch, cb(0.03, 0.03, 0.022, 0.005), m.magBlack, 0, 0.06, 0.0);
    part(hips, cb(0.16, 0.12, 0.07, 0.02), m.vestDark, 0.04, -0.01, 0.135);
    this.beltAnchor = new THREE.Object3D();
    this.beltAnchor.position.set(-0.19, 0.02, -0.07);
    // fingers pointing down into the pouch, palm facing the body
    this.beltAnchor.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V().set(0, 0, -1), V().set(-1, 0, 0), V().set(0, 1, 0)));
    hips.add(this.beltAnchor);
    // Drop-leg holster on the right thigh (empty — pistol is in hand)

    // Abdomen + chest (jacket)
    part(spine, cb(0.32, 0.22, 0.2, 0.05, { top: 1.08 }), m.jacket, 0, 0.1, 0);
    part(chest, cb(0.4, 0.3, 0.23, 0.06, { bottom: 0.9 }), m.jacket, 0, 0.1, 0);
    part(chest, cb(0.14, 0.05, 0.13, 0.02), m.jacketDark, 0, 0.26, 0.0); // collar
    // Plate carrier
    part(chest, cb(0.33, 0.3, 0.05, 0.015), m.vest, 0, 0.1, -0.13);
    part(chest, cb(0.33, 0.32, 0.05, 0.015), m.vest, 0, 0.1, 0.13);
    for (const s of [-1, 1]) {
      part(chest, cb(0.06, 0.03, 0.28, 0.01), m.vest, s * 0.12, 0.26, 0); // shoulder straps
      part(chest, cb(0.035, 0.22, 0.24, 0.01), m.vestDark, s * 0.2, 0.06, 0); // cummerbund
    }
    // Front pistol-mag pouches with mags peeking out
    for (let i = 0; i < 3; i++) {
      const x = -0.1 + i * 0.1;
      part(chest, cb(0.075, 0.11, 0.04, 0.01), m.vestDark, x, 0.02, -0.17);
      part(chest, cb(0.028, 0.025, 0.022, 0.005), m.magBlack, x - 0.015, 0.085, -0.168);
      part(chest, cb(0.028, 0.025, 0.022, 0.005), m.magBlack, x + 0.015, 0.085, -0.168);
    }
    // admin pouch + name tape + hi-vis back panel + radio
    part(chest, cb(0.16, 0.08, 0.03, 0.01), m.vestDark, 0, 0.19, -0.163);
    part(chest, cb(0.12, 0.028, 0.004, 0.002), accent, 0, 0.19, -0.18);
    part(chest, cb(0.28, 0.045, 0.01, 0.004), accent, 0, 0.16, 0.16);
    part(chest, cb(0.28, 0.014, 0.012, 0.003), m.reflect, 0, 0.16, 0.162);
    part(chest, cb(0.28, 0.045, 0.01, 0.004), accent, 0, 0.04, 0.16);
    part(chest, cb(0.28, 0.014, 0.012, 0.003), m.reflect, 0, 0.04, 0.162);
    const radio = part(chest, cb(0.06, 0.12, 0.04, 0.01), m.frame, -0.215, 0.12, 0.08);
    part(radio, new THREE.CylinderGeometry(0.004, 0.006, 0.26, 5), m.antenna, 0, 0.18, 0);
    part(chest, cb(0.035, 0.05, 0.02, 0.006), m.frame, 0.13, 0.22, -0.16); // PTT mic

    // Neck + head
    part(neck, new THREE.CylinderGeometry(0.055, 0.062, 0.1, 8), m.skin, 0, 0.02, 0);
    part(head, cb(0.19, 0.22, 0.21, 0.05, { top: 0.92 }), m.skin, 0, 0.1, 0);
    part(head, cb(0.035, 0.05, 0.04, 0.012, { top: 0.6 }), m.skinDark, 0, 0.085, -0.112); // nose
    part(head, cb(0.17, 0.05, 0.03, 0.015), m.skin, 0, 0.03, -0.09); // jaw
    for (const s of [-1, 1]) {
      part(head, cb(0.025, 0.012, 0.01, 0.003), m.eye, s * 0.045, 0.118, -0.103);
      part(head, cb(0.04, 0.01, 0.012, 0.003), m.brow, s * 0.045, 0.14, -0.102);
    }
    part(head, cb(0.06, 0.008, 0.01, 0.003), m.skinDark, 0, 0.045, -0.106); // mouth
    // Ballistic glasses
    part(head, cb(0.17, 0.035, 0.01, 0.004), m.lens, 0, 0.118, -0.112);
    part(head, cb(0.175, 0.008, 0.012, 0.003), m.frame, 0, 0.137, -0.112);
    // Helmet
    const shell = new THREE.SphereGeometry(0.135, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.52);
    shell.scale(1.0, 0.95, 1.12);
    part(head, shell, m.helmet, 0, 0.16, 0.005);
    part(head, new THREE.CylinderGeometry(0.139, 0.142, 0.022, 12, 1, true).scale(1, 1, 1.12), m.helmetDark, 0, 0.165, 0.005);
    part(head, cb(0.07, 0.045, 0.02, 0.008), m.helmetDark, 0, 0.215, -0.14); // NVG shroud
    part(head, cb(0.05, 0.035, 0.004, 0.002), accent, 0, 0.26, 0.13, -0.5); // team patch (back)
    for (const s of [-1, 1]) {
      part(head, cb(0.012, 0.03, 0.13, 0.004), m.helmetDark, s * 0.132, 0.19, 0.005); // ARC rails
      // Hearing protection (earmuffs) + headband
      const cup = part(head, new THREE.CylinderGeometry(0.048, 0.05, 0.04, 10), m.ear, s * 0.112, 0.1, 0.01, 0, 0, Math.PI / 2);
      cup.scale.set(1, 1, 1.15);
      part(head, cb(0.012, 0.09, 0.02, 0.004), m.frame, s * 0.132, 0.16, 0.01);
      part(head, cb(0.012, 0.05, 0.012, 0.004), m.frame, s * 0.095, 0.04, -0.03, 0.4); // chin strap
    }

    // Arms
    for (const a of this.arms) {
      part(a.upper, cb(0.1, 0.1, 0.12, 0.03), m.vest, 0, -0.01, 0); // shoulder pad
      part(a.upper, cb(0.095, 0.3, 0.1, 0.03, { bottom: 0.85 }), m.jacket, 0, -0.15, 0);
      part(a.upper, cb(0.1, 0.04, 0.105, 0.01), accent, 0, -0.13, 0); // hi-vis band
      part(a.upper, cb(0.102, 0.012, 0.107, 0.004), m.reflect, 0, -0.13, 0);
      part(a.lower, cb(0.085, 0.28, 0.09, 0.025, { bottom: 0.78 }), m.jacket, 0, -0.135, 0);
      part(a.lower, cb(0.075, 0.07, 0.06, 0.02), m.knee, 0, -0.015, 0.035); // elbow pad
      const hand = new Hand(a.s > 0 ? 'right' : 'left', { simple: true });
      hand.setShadows(false);
      a.hand = hand;
      a.wrist.add(hand.root);
    }

    // Legs
    for (const l of this.legs) {
      part(l.thigh, cb(0.15, 0.44, 0.17, 0.04, { bottom: 0.78 }), m.pants, 0, -0.21, 0);
      part(l.thigh, cb(0.035, 0.12, 0.1, 0.012), m.pants, l.s * 0.085, -0.22, 0); // cargo pocket
      part(l.shin, cb(0.12, 0.44, 0.13, 0.035, { bottom: 0.8 }), m.pants, 0, -0.22, 0);
      part(l.shin, cb(0.11, 0.12, 0.05, 0.02), m.knee, 0, -0.03, -0.06); // knee pad
      part(l.foot, cb(0.11, 0.12, 0.14, 0.03), m.boot, 0, -0.03, 0.0); // ankle
      part(l.foot, cb(0.11, 0.07, 0.25, 0.025), m.boot, 0, -0.075, -0.05);
      part(l.foot, cb(0.12, 0.022, 0.27, 0.008), m.sole, 0, -0.114, -0.05);
    }
    // Merge static meshes per bone (keeps draw calls sane)
    for (const g of [hips, spine, chest, neck, head, ...this.legs.flatMap((l) => [l.thigh, l.shin, l.foot]),
      ...this.arms.flatMap((a) => [a.upper, a.lower])]) batchStatic(g, { shallow: true });

    // ---------------------------------------------------------------- weapon
    this.gunMount = joint(chest, 0.012, 0.12, -0.47, 'gunMount');
    this.gunPose = joint(this.gunMount, 0, 0, 0, 'gunPose');
    this.pistol = new PistolModel();
    this.pistol.setShadows(false);
    this.gunPose.add(this.pistol.root);
    // third-person LOD: cartridges are invisible at this scale
    this.pistol.magazine.rounds.forEach((r) => (r.visible = false));
    this.pistol.magazine.setRounds = () => {};
    // only large body parts cast shadows (halves the shadow-pass draw calls)
    const sphere = new THREE.Sphere();
    this.root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      sphere.copy(o.geometry.boundingSphere);
      if (sphere.radius < 0.09) o.castShadow = false;
    });

    // Name tag
    this.tag = makeTag(name);
    this.tag.position.set(0, 2.08, 0);
    this.root.add(this.tag);

    // ---------------------------------------------------------------- state
    this.phase = 0;
    this.hipYaw = 0;
    this.lean = 0;
    this.crouch = 0;
    this.air = 0;
    this.sprint = 0;
    this.ready = 1; // 1 = gun up, 0 = low ready
    this.flinch = V();
    this.flinchVel = V();
    this.dead = false;
    this.deadT = 0;
    this.reload = null; // {kind, t}
    this.fireKick = 0;
    this.fireT = 9;
    this.fireCant = 0;
    this._tmp = { a: V(), b: V(), c: V(), q: Q(), q2: Q(), m: new THREE.Matrix4() };
    this.onMagDrop = null; // callback(worldMatrix, rounds)
  }

  startReload(kind) {
    this.reload = { kind, t: 0, dropped: false };
  }

  fire() {
    this.fireKick = 1;
    this.fireT = 0;
    this.fireCant = (Math.random() - 0.6) * 0.12;
    this.slideT = 0;
  }

  hit(dirX, dirZ, strength = 1) {
    // local-space push on the spine
    this.flinchVel.x += -dirZ * 5 * strength;
    this.flinchVel.z += dirX * 5 * strength;
  }

  kill() {
    this.dead = true;
    this.deadT = 0;
    this.reload = null;
  }

  revive() {
    this.dead = false;
    this.deadT = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  /**
   * @param {number} dt
   * @param {{vx:number,vz:number,yaw:number,pitch:number,grounded:boolean,crouch:number,sprint:boolean,ready?:number}} s
   */
  update(dt, s) {
    const t = this._tmp;
    this.root.rotation.y = s.yaw;

    // ---------------- locomotion
    const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
    const vf = s.vx * -sin + s.vz * -cos;
    const vr = s.vx * cos + s.vz * -sin;
    const speed = Math.hypot(vf, vr);
    const moving = speed > 0.3 && s.grounded;
    const moveAng = Math.atan2(vr, vf);
    let dir = 1, targetHip = 0;
    if (moving) {
      if (Math.abs(moveAng) <= 1.95) targetHip = -moveAng;
      else { dir = -1; targetHip = -(moveAng - Math.PI * Math.sign(moveAng)); }
      targetHip = clamp(targetHip, -1.1, 1.1);
    }
    this.hipYaw = damp(this.hipYaw, targetHip, 8, dt);
    const stride = 1.2 + speed * 0.3;
    this.phase += dir * (speed / stride) * Math.PI * 2 * dt;
    const amp = moving ? Math.min(1, speed / 4.6) * (0.46 + 0.08 * this.sprint) * (1 - 0.35 * this.crouch) : 0;
    this.amp = damp(this.amp ?? 0, amp, 10, dt);
    this.crouch = damp(this.crouch, s.crouch, 12, dt);
    this.air = damp(this.air, s.grounded ? 0 : 1, 10, dt);
    this.sprint = damp(this.sprint, s.sprint ? 1 : 0, 6, dt);
    const A = this.amp, c = this.crouch, air = this.air;

    let hipDrop = 0;
    for (const l of this.legs) {
      const ph = this.phase + (l.s > 0 ? Math.PI : 0);
      const swing = Math.sin(ph) * A;
      const knee = -Math.max(0, Math.cos(ph)) * A * 1.5 - 0.08 * A;
      let th = swing + c * 1.2 + air * 0.55 * (l.s > 0 ? 1 : 0.6);
      let sh = knee - c * 2.05 - air * 1.0;
      l.thigh.rotation.set(th, 0, l.s * (0.03 + c * 0.1));
      l.shin.rotation.x = sh;
      l.foot.rotation.x = -(th + sh) * 0.75 + c * 0.2;
      const ext = 0.43 * Math.cos(th) + 0.44 * Math.cos(th + sh) + 0.12;
      hipDrop = Math.max(hipDrop, 0.99 - ext);
    }
    const bob = Math.abs(Math.sin(this.phase)) * 0.03 * A;
    this.hips.position.y = damp(this.hips.position.y, 0.96 - hipDrop * (air > 0.5 ? 0.3 : 0.92) - bob, 20, dt);
    this.hips.rotation.set(0, this.hipYaw, Math.sin(this.phase) * 0.035 * A);

    // ---------------- upper body + aim
    this.flinchVel.addScaledVector(this.flinch, -140 * dt).multiplyScalar(Math.exp(-10 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    const pitch = s.pitch;
    const lean = -0.1 * A - 0.28 * c - this.sprint * 0.12;
    this.spine.rotation.set(lean * 0.6 + pitch * 0.3 + this.flinch.x, -this.hipYaw, this.flinch.z);
    this.chest.rotation.set(lean * 0.4 + pitch * 0.35, 0, 0);
    this.neck.rotation.set(-(lean) * 0.5 + pitch * 0.2, 0, 0);
    this.head.rotation.set(pitch * 0.15, 0, 0);

    // weapon mount: remaining pitch so the muzzle follows aim exactly
    const ready = this.ready = damp(this.ready, s.sprint ? 0 : (s.ready ?? 1), 8, dt);
    const reloading = !!this.reload;
    this.reloadBlend = damp(this.reloadBlend ?? 0, reloading ? 1 : 0, 10, dt);
    const rb = this.reloadBlend;
    const low = 1 - ready;
    this.gunMount.position.set(
      0.012 + low * 0.06 - rb * 0.02,
      0.12 - low * 0.16 - rb * 0.06,
      -0.47 + low * 0.16 + rb * 0.16,
    );
    const residual = pitch - (pitch * 0.3 + pitch * 0.35) - (lean * 0.6 + lean * 0.4);
    this.gunMount.rotation.set(residual - low * 0.95, low * 0.3, 0);

    // fire kick
    // fire kick: shove back fast (~20 ms), muzzle flips up a beat later (~35 ms), then
    // settles with a small dip below rest — same feel as the first-person gun
    this.fireKick = Math.max(0, this.fireKick - dt * 9);
    this.fireT = (this.fireT ?? 9) + dt;
    const ft = this.fireT;
    const back = ft < 0.02 ? ft / 0.02 : Math.exp(-(ft - 0.02) * 20);
    const flip = ft < 0.035 ? Math.sin((ft / 0.035) * Math.PI / 2) : Math.exp(-(ft - 0.035) * 12) * Math.cos((ft - 0.035) * 17);
    this.gunPose.position.set(0, flip * 0.018, back * 0.05);
    this.gunPose.rotation.set(flip * 0.34, 0, flip * this.fireCant);
    // slide cycle
    if (this.slideT !== undefined) {
      this.slideT += dt;
      const st = this.slideT;
      const back = st < 0.02 ? st / 0.02 : Math.max(0, 1 - (st - 0.02) / 0.05);
      if (!this.slideLocked) this.pistol.setSlide(back * 0.03);
      else this.pistol.setSlide(Math.min(0.028, back * 0.03 + (st > 0.02 ? 0.028 : 0)));
      if (st > 0.2) this.slideT = undefined;
    }

    // ---------------- reload tracks (shared with first person)
    let wFree = 0, wMag = 0, wRack = 0, curl = 0.8;
    if (this.reload) {
      const R = RELOAD[this.reload.kind];
      const rt = (this.reload.t += dt);
      const gr = R.gunRot(rt), gp = R.gunPos(rt);
      this.gunPose.rotation.x += gr[0];
      this.gunPose.rotation.y += gr[1];
      this.gunPose.rotation.z += gr[2];
      this.gunPose.position.x += gp[0] * 1.3;
      this.gunPose.position.y += gp[1] * 1.3;
      this.gunPose.position.z += gp[2] * 1.3;
      const off = R.magOffset(rt);
      const mp = R.magPos(rt), mr = R.magRot(rt);
      const pm = this.pistol.magazine.root;
      this.pistol.setMagOffset(off);
      pm.position.x += mp[0]; pm.position.y += mp[1]; pm.position.z += mp[2];
      pm.rotation.set(mr[0], mr[1], mr[2]);
      const visible = rt < R.dropAt || rt >= 0.62;
      this.pistol.setMagVisible(visible);
      if (rt >= R.dropAt && !this.reload.dropped) {
        this.reload.dropped = true;
        pm.visible = true;
        pm.updateWorldMatrix(true, false);
        if (this.onMagDrop) this.onMagDrop(pm.matrixWorld.clone(), 0);
        pm.visible = false;
      }
      this.pistol.magazine.setRounds(rt >= 0.62 ? 15 : 0);
      if (R.slide) this.pistol.setSlide(R.slide(rt));
      wFree = R.wFree(rt); wMag = R.wMag(rt); wRack = R.wRack(rt);
      this.pistol.anchorRack.position.z = this.pistol.rackBaseZ + R.rackPull(rt);
      curl = R.leftCurl(rt);
      if (rt >= R.duration) {
        this.reload = null;
        this.pistol.setMagOffset(0);
        pm.rotation.set(0, 0, 0);
        this.pistol.setMagVisible(true);
        this.slideLocked = false;
      }
    }
    this.pistol.setTrigger(this.fireKick > 0.7 ? 1 : 0);

    // ---------------- death
    if (this.dead) {
      this.deadT += dt;
      const u = Math.min(1, this.deadT / 0.75);
      const e = u * u * (3 - 2 * u);
      this.body.rotation.x = e * 1.45;
      this.body.position.y = e * 0.05;
      this.body.position.z = e * 0.25;
      this.hips.position.y -= Math.min(1, this.deadT / 0.3) * 0.25;
    }

    // ---------------- arm IK
    this.root.updateMatrixWorld(true);
    const [left, right] = this.arms; // s=-1 left, s=+1 right
    // right hand → pistol grip
    this.pistol.anchorRight.getWorldPosition(t.a);
    this.pistol.anchorRight.getWorldQuaternion(t.q);
    this._poleFor(right, t.c);
    solveTwoBone(right, t.a, t.q, t.c);
    right.hand.pose.curl = [0.55, 0.82, 0.86, 0.9];
    right.hand.pose.thumb = 0.45;
    right.hand.pose.thumbOpp = 0.8;
    right.hand.apply();

    // left hand → blended target (support / belt pouch / magazine / slide rack)
    const pos = t.a, quat = t.q;
    this.pistol.anchorLeft.getWorldPosition(pos);
    this.pistol.anchorLeft.getWorldQuaternion(quat);
    const blend = (obj, w) => {
      if (w <= 0) return;
      obj.getWorldPosition(t.b);
      obj.getWorldQuaternion(t.q2);
      pos.lerp(t.b, w);
      quat.slerp(t.q2, w);
    };
    blend(this.beltAnchor, wFree);
    blend(this.pistol.magazine.baseAnchor, wMag);
    blend(this.pistol.anchorRack, wRack);
    if (this.dead) { pos.y -= 0.1; }
    this._poleFor(left, t.c);
    solveTwoBone(left, pos, quat, t.c);
    left.hand.pose.curl = [curl, curl, curl, curl];
    left.hand.pose.thumb = 0.4;
    left.hand.pose.thumbOpp = 0.4;
    left.hand.apply();
  }

  _poleFor(arm, out) {
    // elbows point down and out, slightly back
    out.set(arm.s * 0.55, -0.45, 0.35);
    this.chest.localToWorld(out);
    return out;
  }
}

// --------------------------------------------------------------------------- IK
const _a = new THREE.Vector3(), _e = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _w = new THREE.Vector3(), _s = new THREE.Vector3();
const _m = new THREE.Matrix4(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion();

/** Point a bone (mesh along local -Y) from `from` to `to`, twisting its +Z toward `pole`. */
function aimBone(bone, from, to, pole) {
  _y.subVectors(from, to).normalize(); // +Y points back up the bone
  _z.subVectors(pole, from);
  _z.addScaledVector(_y, -_z.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  _qw.setFromRotationMatrix(_m);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qw));
  bone.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (law of cosines) with a pole target.
 * arm: {upper, lower, wrist, L1, L2}; target: wrist world pos; quat: wrist world rot.
 */
export function solveTwoBone(arm, target, quat, pole) {
  const { upper, lower, wrist, L1, L2 } = arm;
  upper.getWorldPosition(_a);
  _d.subVectors(target, _a);
  let dist = _d.length();
  dist = Math.min(Math.max(dist, Math.abs(L1 - L2) + 1e-3), L1 + L2 - 1e-4);
  _d.normalize();
  const cosA = (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _p.subVectors(pole, _a);
  _p.addScaledVector(_d, -_p.dot(_d)).normalize();
  _e.copy(_a).addScaledVector(_d, cosA * L1).addScaledVector(_p, sinA * L1);
  _w.copy(_a).addScaledVector(_d, dist); // clamped wrist position
  _s.copy(_a);
  aimBone(upper, _s, _e, pole);
  aimBone(lower, _e, _w, pole);
  // wrist orientation
  lower.getWorldQuaternion(_qp);
  wrist.quaternion.copy(_qp.invert().multiply(quat));
}

function makeTag(text) {
  const tex = T.textPlate([{ text: text.toUpperCase(), size: 44 }], { w: 512, h: 96, bg: 'rgba(20,22,24,0.62)', fg: '#ede8df' });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(0.62, 0.116, 1);
  s.renderOrder = 10;
  return s;
}
