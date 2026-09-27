// First-person viewmodel: gloved arms + pistol rendered in their own scene/camera
// (no wall clipping, independent FOV). Animation layers, summed each frame:
//   base pose (hip ↔ ADS) + sprint + walk bob + mouse sway + recoil springs
//   + authored clips (draw / reload / inspect) + procedural slide/hammer/trigger.
import * as THREE from 'three';
import { PistolModel } from '../models/Pistol.js';
import { Hand, Forearm } from '../models/Hands.js';
import { RELOAD, INSPECT, DRAW } from '../anim/tracks.js';
import { damp, clamp } from '../../shared/math.js';
import * as T from '../gfx/textures.js';

const v3 = () => new THREE.Vector3();

class Spring {
  constructor(k = 300, c = 22, n = 3) { this.k = k; this.c = c; this.x = new Array(n).fill(0); this.v = new Array(n).fill(0); }
  kick(...a) { a.forEach((val, i) => (this.v[i] += val)); }
  step(dt) {
    // sub-step: the stiff recoil springs would go unstable on a long frame
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < this.x.length; i++) {
        const a = -this.k * this.x[i] - this.c * this.v[i];
        this.v[i] += a * h;
        this.x[i] += this.v[i] * h;
      }
    }
  }
}

export class Viewmodel {
  constructor({ environment = null } = {}) {
    this.scene = new THREE.Scene();
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.01, 6);

    this.hemi = new THREE.HemisphereLight(0xc6d6ea, 0x4d4436, 0.85);
    this.sun = new THREE.DirectionalLight(0xffe4bd, 2.4);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.flashLight = new THREE.PointLight(0xffb45a, 0, 1.5, 2);
    this.scene.add(this.flashLight);

    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.pistol = new PistolModel();
    this.holder.add(this.pistol.root);

    this.right = new Hand('right');
    this.pistol.anchorRight.add(this.right.root);
    this.left = new Hand('left');
    this.scene.add(this.left.root);
    this.rightArm = new Forearm(0.28);
    this.leftArm = new Forearm(0.28, { watch: true });
    this.scene.add(this.rightArm.root, this.leftArm.root);
    // approximate elbow positions (camera space); forearms aim from wrist to elbow
    this.shoulderR = new THREE.Vector3(0.22, -0.4, -0.04);
    this.shoulderL = new THREE.Vector3(-0.24, -0.42, -0.06);

    // Off-screen "belt pouch" target for the support hand
    this.belt = new THREE.Object3D();
    this.belt.position.set(-0.16, -0.46, -0.14);
    this.belt.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3().set(0, 0, -1), v3().set(-1, 0, 0), v3().set(0, 1, 0)));
    this.scene.add(this.belt);

    this._buildFlash();
    this.debris = [];

    // pose state
    this.aim = 0;
    this.sprint = 0;
    this.sway = new Spring(160, 18, 3);
    this.swayPos = new Spring(140, 16, 2);
    this.recoil = new Spring(420, 26, 4); // small nudges: [posZ, rotX, rotY, rotZ]
    // Shot recoil, two layers with different speeds (like a real handgun):
    //  kickPos — the gun shoves straight back into the hand (stiff, peaks ~35 ms)
    //  kickRot — the muzzle flips up around the wrist (softer, peaks ~65 ms, then dips
    //            slightly below rest and settles) + a little random cant and drift
    this.kickPos = new Spring(1000, 40, 3); // metres  [x, y, z]
    this.kickRot = new Spring(290, 19, 3);  // radians [pitch, yaw, roll]
    this.wrist = [0, -0.105, 0.09];         // flip pivot in gun space (below/behind the grip)
    this.land = new Spring(180, 16, 1);
    this.bob = 0;
    this.bobAmp = 0;
    this.time = 0;

    this.clip = null; // {name:'reload'|'inspect'|'draw', kind, t}
    this.slideT = -1;
    this.slideLocked = false;
    this.trigger = 0;
    this.flashT = 1;
    this.onMagDrop = null;
    this.playDraw();
  }

  _buildFlash() {
    const star = T.muzzleStar();
    const side = T.muzzleSide();
    const mk = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), mk(star));
    this.flash.add(front);
    for (let i = 0; i < 2; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.042), mk(side));
      p.rotation.set(0, Math.PI / 2, i * Math.PI / 2);
      p.position.z = -0.055;
      this.flash.add(p);
    }
    this.flashFront = front;
    this.flash.visible = false;
    this.pistol.muzzle.add(this.flash);
  }

  resize(aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Little dip when picking something up. */
  pickupDip() { this.land.kick(-0.9); this.recoil.kick(0, -1.2, 0, 0.8); }

  playDraw() { this.clip = { name: 'draw', t: 0, dur: DRAW.duration }; }
  playInspect() {
    if (!this.clip) this.clip = { name: 'inspect', t: 0, dur: INSPECT.duration };
  }
  get busy() { return !!this.clip && this.clip.name !== 'inspect'; }

  /** Handle simulation events from WeaponState. */
  onEvent(ev, weapon, lag = 0) {
    switch (ev.type) {
      case 'fire': {
        const K = weapon.def.kick;
        const s = 1 - this.aim * (1 - K.adsScale); // locked-out arms on the sights soak up more
        const r = 0.9 + Math.random() * 0.2;
        this.kickPos.kick((Math.random() - 0.5) * 0.12 * s, 0.18 * s, K.back * s * r);
        this.kickRot.kick(
          K.flip * s * r,
          (-0.25 + (Math.random() - 0.5) * 0.7) * s, // drifts a touch right for a right-hand grip
          (-0.35 + (Math.random() - 0.5) * 1.1) * s,
        );
        this.slideT = 0;
        this.pistol.setHammer(0);
        this.flashT = 0;
        this.flashFront.rotation.z = Math.random() * Math.PI;
        const fs = 0.85 + Math.random() * 0.4;
        this.flash.scale.set(fs, fs, 0.8 + Math.random() * 0.5);
        if (ev.lastRound) this.slideLocked = true;
        if (this.clip && this.clip.name === 'inspect') this.clip = null;
        break;
      }
      case 'reloadStart':
        this.clip = { name: 'reload', kind: ev.kind, t: lag, dur: RELOAD[ev.kind].duration, dropped: false, rounds: weapon.mag };
        break;
      case 'slideRelease':
        this.slideLocked = false;
        break;
      case 'dryFire':
        this.recoil.kick(0.1, 0.4, 0, 0);
        break;
    }
  }

  /**
   * @param {number} dt
   * @param {object} c  {aim, sprint, speedFrac, grounded, landSpeed, lookDX, lookDY, trigger, weapon, camQuat, sunDir, bobDist}
   */
  update(dt, c) {
    this.time += dt;
    const P = this.pistol;
    const reloading = this.clip && this.clip.name === 'reload';
    this.aim = damp(this.aim, c.aim && !reloading ? 1 : 0, 16, dt);
    this.sprint = damp(this.sprint, c.sprint && !reloading ? 1 : 0, 9, dt);
    const aim = this.aim, spr = this.sprint * (1 - aim);

    // lights follow the world sun in camera space
    if (c.camQuat && c.sunDir) {
      const inv = c.camQuat.clone().invert();
      this.sun.position.copy(c.sunDir).applyQuaternion(inv).multiplyScalar(5);
    }

    // springs
    // lag behind the look direction (gun trails the camera, then springs back)
    this.sway.kick(c.lookDY * 0.0022 * (1 - aim * 0.7), c.lookDX * 0.0022 * (1 - aim * 0.7), -c.lookDX * 0.0012);
    this.swayPos.kick(-c.lookDX * 0.00035 * (1 - aim * 0.8), c.lookDY * 0.00035 * (1 - aim * 0.8));
    this.sway.step(dt); this.swayPos.step(dt); this.recoil.step(dt);
    this.kickPos.step(dt); this.kickRot.step(dt);
    if (c.landSpeed > 2) this.land.kick(-Math.min(c.landSpeed, 12) * 0.05);
    this.land.step(dt);

    // walk bob
    this.bobAmp = damp(this.bobAmp, c.grounded ? c.speedFrac : 0, 8, dt);
    const bA = this.bobAmp * (1 - aim * 0.85) * (1 + spr * 0.8);
    const ph = c.bobDist * (spr > 0.5 ? 1.05 : 1.35);
    const breathe = Math.sin(this.time * 1.6) * 0.0012 * (1 - aim * 0.7);

    // base pose
    const hip = [0.086, -0.08, -0.27], ads = [0, -P.sightHeight, -(0.235 + P.rearSightZ)];
    const pos = [
      hip[0] + (ads[0] - hip[0]) * aim + Math.sin(ph) * 0.009 * bA + this.swayPos.x[0] + spr * 0.02,
      hip[1] + (ads[1] - hip[1]) * aim - Math.abs(Math.cos(ph)) * 0.011 * bA + breathe + this.swayPos.x[1] + this.land.x[0] * 0.3 - spr * 0.03,
      hip[2] + (ads[2] - hip[2]) * aim + this.recoil.x[0] * 0.04 + spr * 0.02,
    ];
    const rot = [
      this.sway.x[0] + this.recoil.x[1] * 0.045 + Math.sin(ph * 2) * 0.006 * bA - spr * 0.32 + this.land.x[0],
      (1 - aim) * 0.06 + this.sway.x[1] + this.recoil.x[2] * 0.02 + spr * 0.5,
      this.sway.x[2] + this.recoil.x[3] * 0.02 + Math.sin(ph) * 0.01 * bA + spr * 0.32 - (1 - aim) * 0.02,
    ];
    // shot recoil: rearward shove + muzzle flip pivoting on the wrist (offset = W − R·W)
    const KP = this.kickPos.x, KR = this.kickRot.x, W = this.wrist;
    const fc = Math.cos(KR[0]), fs = Math.sin(KR[0]);
    pos[0] += KP[0];
    pos[1] += KP[1] + (W[1] - (W[1] * fc - W[2] * fs));
    pos[2] += KP[2] + (W[2] - (W[1] * fs + W[2] * fc));
    rot[0] += KR[0];
    rot[1] += KR[1];
    rot[2] += KR[2];

    // authored clips
    let wFree = 0, wMag = 0, wRack = 0, leftCurl = 0.78, thumbPress = 0, slideOverride = null;
    P.anchorRack.position.z = P.rackBaseZ;
    if (this.clip) {
      const cl = this.clip;
      cl.t += dt;
      const t = cl.t;
      if (cl.name === 'draw') {
        const r = DRAW.gunRot(t), p = DRAW.gunPos(t);
        for (let i = 0; i < 3; i++) { rot[i] += r[i]; pos[i] += p[i]; }
      } else if (cl.name === 'inspect') {
        const r = INSPECT.gunRot(t), p = INSPECT.gunPos(t);
        for (let i = 0; i < 3; i++) { rot[i] += r[i] * (1 - aim); pos[i] += p[i] * (1 - aim); }
        wFree = INSPECT.wFree(t);
      } else if (cl.name === 'reload') {
        const R = RELOAD[cl.kind];
        const r = R.gunRot(t), p = R.gunPos(t);
        // first-person framing: lift the gun so the mag well and support hand stay on screen
        const env = Math.min(1, t / 0.25, Math.max(0, (cl.dur - t) / 0.35));
        const fe = env * env * (3 - 2 * env);
        const frame = [-0.03, 0.062, -0.075];
        rot[0] += r[0] * 0.45 - 0.05 * fe;
        rot[1] += r[1] * 0.5 - 0.1 * fe;
        rot[2] += r[2] * 0.9;
        for (let i = 0; i < 3; i++) pos[i] += p[i] * 0.6 + frame[i] * fe;
        const mag = P.magazine.root;
        P.setMagOffset(R.magOffset(t));
        const mp = R.magPos(t), mr = R.magRot(t);
        mag.position.x += mp[0]; mag.position.y += mp[1]; mag.position.z += mp[2];
        mag.rotation.set(mr[0], mr[1], mr[2]);
        const visible = t < R.dropAt || t >= 0.62;
        if (t >= R.dropAt && !cl.dropped) {
          cl.dropped = true;
          this._spawnDebris(cl.rounds);
          if (this.onMagDrop) this.onMagDrop(cl.kind, cl.rounds);
        }
        P.setMagVisible(visible);
        P.magazine.setRounds(t >= 0.62 ? 15 : cl.rounds);
        wFree = R.wFree(t); wMag = R.wMag(t); wRack = R.wRack(t);
        P.anchorRack.position.z = P.rackBaseZ + R.rackPull(t);
        leftCurl = R.leftCurl(t);
        thumbPress = R.thumb(t);
        if (R.slide) slideOverride = R.slide(t);
      }
      if (t >= cl.dur) {
        if (cl.name === 'reload') {
          P.setMagOffset(0);
          P.magazine.root.rotation.set(0, 0, 0);
          P.setMagVisible(true);
        }
        this.clip = null;
      }
    }
    if (!reloading) P.magazine.setRounds(c.weapon ? c.weapon.mag : 15);

    this.holder.position.set(pos[0], pos[1], pos[2]);
    this.holder.rotation.set(rot[0], rot[1], rot[2]);

    // slide / hammer / trigger
    if (slideOverride !== null) {
      P.setSlide(slideOverride);
    } else if (this.slideT >= 0) {
      this.slideT += dt;
      const st = this.slideT;
      let back = st < 0.016 ? st / 0.016 : Math.max(0, 1 - (st - 0.016) / 0.045);
      if (this.slideLocked && st >= 0.016) back = 0.93;
      P.setSlide(back * 0.03);
      if (st > 0.1 && !this.slideLocked) this.slideT = -1;
    } else {
      P.setSlide(this.slideLocked ? 0.028 : 0);
    }
    this.trigger = damp(this.trigger, c.trigger ? 1 : 0, 40, dt);
    P.setTrigger(this.trigger);

    // right hand pose (trigger finger + mag-release thumb)
    const rp = this.right.pose;
    rp.curl[0] = 0.28 + this.trigger * 0.22;
    rp.curl[1] = 0.8; rp.curl[2] = 0.84; rp.curl[3] = 0.88;
    rp.thumb = 0.35 + thumbPress * 0.35;
    rp.thumbOpp = 0.85 - thumbPress * 0.4;
    this.right.apply();

    // muzzle flash
    this.flashT += dt;
    this.flash.visible = this.flashT < 0.045;
    this.flashLight.intensity = this.flashT < 0.06 ? 4 * (1 - this.flashT / 0.06) : 0;

    // left hand target blend (support grip → belt pouch → new magazine → slide rack)
    this.scene.updateMatrixWorld(true);
    const lp = v3(), lq = new THREE.Quaternion(), tp = v3(), tq = new THREE.Quaternion();
    P.anchorLeft.getWorldPosition(lp);
    P.anchorLeft.getWorldQuaternion(lq);
    const blend = (o, w) => {
      if (w <= 0) return;
      o.getWorldPosition(tp); o.getWorldQuaternion(tq);
      lp.lerp(tp, w); lq.slerp(tq, w);
    };
    blend(this.belt, wFree);
    blend(P.magazine.baseAnchor, wMag);
    blend(P.anchorRack, wRack);
    this.left.root.position.copy(lp);
    this.left.root.quaternion.copy(lq);
    const lpz = this.left.pose;
    lpz.curl.fill(leftCurl);
    lpz.thumb = 0.3 + (wRack > 0.5 ? 0.3 : 0);
    lpz.thumbOpp = wMag > 0.5 ? 0.2 : 0.35;
    this.left.apply();

    // forearms aim from wrist toward the (off-screen) shoulders
    this.right.root.getWorldPosition(tp);
    this.rightArm.root.position.copy(tp);
    this.rightArm.root.lookAt(this.shoulderR);
    this.leftArm.root.position.copy(lp);
    this.leftArm.root.lookAt(this.shoulderL);

    // mag debris
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vel.y -= 9.8 * dt;
      d.obj.position.addScaledVector(d.vel, dt);
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.z += d.spin.z * dt;
      if (d.life <= 0) {
        this.scene.remove(d.obj);
        this.debris.splice(i, 1);
      }
    }
  }

  _spawnDebris(rounds) {
    const mag = this.pistol.magazine.root;
    mag.updateWorldMatrix(true, false);
    const obj = this.pistol.cloneMagazine(rounds);
    mag.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);
    this.scene.add(obj);
    const down = v3().set(0, -1, 0).applyQuaternion(obj.quaternion).multiplyScalar(1.3);
    this.debris.push({ obj, vel: down, spin: v3().set(-3 + Math.random() * 2, 0, 2 * (Math.random() - 0.5)), life: 0.9 });
  }
}

export { clamp };
