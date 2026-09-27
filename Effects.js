// World-space effects: ejected casings, dropped magazines (with bounce physics
// against the shared world), bullet-hole decals, impact particles, smoke.
import * as THREE from 'three';
import * as T from '../gfx/textures.js';

const up = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

const SURFACE_FX = {
  concrete: { colors: [0x9a968e, 0x7d7a74, 0xb5b1a8], count: 10, speed: 3.5, dust: 0xb9b3a8, spark: false },
  dirt: { colors: [0x6b5238, 0x7d6446, 0x5a4a30], count: 10, speed: 3, dust: 0x8a7458, spark: false },
  rock: { colors: [0x7d7a74, 0x68655f], count: 9, speed: 3.5, dust: 0x9a968e, spark: false },
  brick: { colors: [0x8e4a34, 0x7a3e2c, 0xa0583e], count: 10, speed: 3.5, dust: 0x9a6a54, spark: false },
  wood: { colors: [0xa37a4c, 0x7d5a36, 0xc49a66], count: 9, speed: 3, dust: 0xa08060, spark: false },
  metal: { colors: [0xffd27a, 0xffb347, 0xfff0c0], count: 12, speed: 6, dust: 0x8a8a88, spark: true },
  fence: { colors: [0xffd27a, 0xffe0a0], count: 5, speed: 5, dust: 0x999999, spark: true },
  flesh: { colors: [0x8c1f1a, 0xa8322a, 0x6e1512], count: 8, speed: 2.4, dust: 0x7a2a22, spark: false },
  steel: { colors: [0xffe6a0, 0xffc060, 0xffffff], count: 16, speed: 7, dust: 0x888888, spark: true },
};

export class Effects {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.bodies = []; // casings + mags
    this.maxCasings = 48;
    this.maxMags = 12;

    // spent case = brass cylinder with an open mouth
    this.caseGeo = new THREE.CylinderGeometry(0.0049, 0.0049, 0.019, 8, 1, true);
    this.caseMat = new THREE.MeshStandardMaterial({ color: 0xd8ae52, roughness: 0.28, metalness: 1, side: THREE.DoubleSide });

    // decals
    this.decalMat = new THREE.MeshStandardMaterial({
      map: T.bulletHole(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1,
    });
    // bullet holes: one instanced draw call for all of them (ring buffer)
    this.maxDecals = 128;
    this.decals = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.075, 0.075), this.decalMat, this.maxDecals);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 2;
    this.decals.receiveShadow = true;
    this.decalIdx = 0;
    scene.add(this.decals);
    this._dObj = new THREE.Object3D();

    // spent casings: one instanced draw call, physics bodies write their matrices
    this.casingMesh = new THREE.InstancedMesh(this.caseGeo, this.caseMat, this.maxCasings);
    this.casingMesh.count = 0;
    this.casingMesh.frustumCulled = false;
    this.casingMesh.castShadow = true;
    this.casingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.casingMesh);

    // particles (instanced cubes)
    this.maxP = 420;
    const pg = new THREE.BoxGeometry(1, 1, 1);
    this.pMesh = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ roughness: 0.8, toneMapped: true }), this.maxP);
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pMesh.frustumCulled = false;
    this.pMesh.count = 0;
    this.pMesh.setColorAt(0, tmpC.set(0xffffff));
    scene.add(this.pMesh);
    this.sparkMesh = new THREE.InstancedMesh(pg, new THREE.MeshBasicMaterial({ toneMapped: false }), 160);
    this.sparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.sparkMesh.frustumCulled = false;
    this.sparkMesh.count = 0;
    this.sparkMesh.setColorAt(0, tmpC.set(0xffffff));
    scene.add(this.sparkMesh);
    this.particles = [];
    this.sparks = [];

    // soft puffs (dust + chimney smoke)
    this.puffTex = T.smokePuff();
    this.puffs = [];
    for (let i = 0; i < 90; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1, alpha: 0.5 });
    }
    this.puffIdx = 0;

    // third-person muzzle flashes (sprites)
    this.tpFlashTex = T.muzzleStar();
    this.tpFlashes = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tpFlashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      s.visible = false;
      s.scale.set(0.3, 0.3, 1);
      scene.add(s);
      this.tpFlashes.push({ s, t: 1 });
    }
    this.tpIdx = 0;
    // cartoon low-poly smoke: faceted white blobs that pop, drift up and shrink away
    this.maxBlobs = 260;
    const blobMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true, emissive: 0x9a9a9a, emissiveIntensity: 0.35 });
    this.blobMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), blobMat, this.maxBlobs);
    this.blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.blobMesh.frustumCulled = false;
    this.blobMesh.count = 0;
    this.blobMesh.castShadow = false;
    this.blobMesh.setColorAt(0, tmpC.set(0xffffff));
    scene.add(this.blobMesh);
    this.blobs = [];

    this.flashLight = new THREE.PointLight(0xffb45a, 0, 9, 2);
    scene.add(this.flashLight);
    this.flashLightT = 1;
  }

  // ------------------------------------------------------------------ spawners
  ejectCasing(pos, vel) {
    const m = new THREE.Object3D(); // transform only; drawn through casingMesh
    m.position.copy(pos);
    m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    this._addBody(m, vel, { radius: 0.005, kind: 'casing', spin: new THREE.Vector3(18 * (Math.random() - 0.5), 10, 22 * (Math.random() - 0.5)), life: 14 });
  }

  dropMagazine(obj, vel) {
    this.scene.add(obj);
    this._addBody(obj, vel, { radius: 0.012, kind: 'mag', spin: new THREE.Vector3(-4 + Math.random() * 2, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3), life: 25 });
  }

  _addBody(obj, vel, o) {
    const b = { obj, vel: vel.clone(), spin: o.spin, radius: o.radius, kind: o.kind, life: o.life, rest: false, bounces: 0 };
    this.bodies.push(b);
    const same = this.bodies.filter((x) => x.kind === o.kind);
    const cap = o.kind === 'casing' ? this.maxCasings : this.maxMags;
    if (same.length > cap) this._removeBody(same[0]);
  }

  _removeBody(b) {
    if (b.kind !== 'casing') this.scene.remove(b.obj);
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }

  impact(point, normal, surface = 'concrete', { decal = true } = {}) {
    const fx = SURFACE_FX[surface] || SURFACE_FX.concrete;
    const n = tmpV.fromArray(normal);
    if (decal && surface !== 'flesh' && surface !== 'fence') {
      const d = this._dObj;
      d.position.fromArray(point).addScaledVector(n, 0.004);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      d.rotateZ(Math.random() * Math.PI * 2);
      const s = 0.8 + Math.random() * 0.5;
      d.scale.set(s, s, 1);
      d.updateMatrix();
      this.decals.setMatrixAt(this.decalIdx, d.matrix);
      this.decalIdx = (this.decalIdx + 1) % this.maxDecals;
      this.decals.count = Math.min(this.maxDecals, this.decals.count + 1);
      this.decals.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < fx.count; i++) {
      const dir = new THREE.Vector3(n.x + (Math.random() - 0.5) * 1.3, n.y + (Math.random() - 0.5) * 1.3 + 0.3, n.z + (Math.random() - 0.5) * 1.3).normalize();
      const sp = fx.speed * (0.4 + Math.random() * 0.8);
      const p = {
        pos: new THREE.Vector3().fromArray(point).addScaledVector(n, 0.02),
        vel: dir.multiplyScalar(sp),
        life: fx.spark ? 0.18 + Math.random() * 0.25 : 0.5 + Math.random() * 0.6,
        size: fx.spark ? 0.008 + Math.random() * 0.006 : 0.01 + Math.random() * 0.018,
        color: fx.colors[Math.floor(Math.random() * fx.colors.length)],
        rot: Math.random() * 6,
        g: fx.spark ? 6 : 9.8,
      };
      (fx.spark ? this.sparks : this.particles).push(p);
    }
    this.puff(new THREE.Vector3().fromArray(point).addScaledVector(n, 0.08), n.clone().multiplyScalar(0.6), fx.dust, 0.25, 0.9, surface === 'metal' ? 0.25 : 0.5);
    if (this.particles.length > this.maxP) this.particles.splice(0, this.particles.length - this.maxP);
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
  }

  puff(pos, vel, color = 0xaaaaaa, size = 0.4, life = 1.2, alpha = 0.5, grow = 2.2) {
    const p = this.puffs[this.puffIdx];
    this.puffIdx = (this.puffIdx + 1) % this.puffs.length;
    p.s.visible = true;
    p.s.position.copy(pos);
    p.s.material.color.set(color);
    p.s.material.rotation = Math.random() * 6;
    p.size = size;
    p.grow = grow;
    p.life = 0;
    p.max = life;
    p.alpha = alpha;
    p.vel.copy(vel);
  }

  /** Goofy white low-poly smoke puff (truck deliveries, machine output). */
  lowPolyPuff(pos, scale = 1, { count = 9, color = 0xffffff, up = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
      const out = 0.6 + Math.random() * 0.9;
      this.blobs.push({
        pos: new THREE.Vector3(pos.x + Math.cos(a) * 0.12 * scale, pos.y + Math.random() * 0.15 * scale, pos.z + Math.sin(a) * 0.12 * scale),
        vel: new THREE.Vector3(Math.cos(a) * out * 1.4 * scale, (0.7 + Math.random() * 1.1) * up * scale, Math.sin(a) * out * 1.4 * scale),
        size: (0.16 + Math.random() * 0.2) * scale,
        life: 0, max: 0.75 + Math.random() * 0.45,
        rot: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        spin: (Math.random() - 0.5) * 3,
        color,
      });
    }
    if (this.blobs.length > this.maxBlobs) this.blobs.splice(0, this.blobs.length - this.maxBlobs);
  }

  tpMuzzleFlash(pos) {
    const f = this.tpFlashes[this.tpIdx];
    this.tpIdx = (this.tpIdx + 1) % this.tpFlashes.length;
    f.s.position.copy(pos);
    f.s.material.rotation = Math.random() * 6;
    f.t = 0;
    f.s.visible = true;
    this.flashLight.position.copy(pos);
    this.flashLightT = 0;
  }

  playerFlash(pos) {
    this.flashLight.position.copy(pos);
    this.flashLightT = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const world = this.world;
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      b.life -= dt;
      if (b.life <= 0) { this._removeBody(b); continue; }
      if (b.life < 1) b.obj.scale.setScalar(Math.max(0.01, b.life));
      if (b.rest) continue;
      b.vel.y -= 9.8 * dt;
      b.vel.multiplyScalar(Math.exp(-0.3 * dt));
      const o = b.obj;
      o.position.addScaledVector(b.vel, dt);
      o.rotation.x += b.spin.x * dt;
      o.rotation.y += b.spin.y * dt;
      o.rotation.z += b.spin.z * dt;
      const g = world.groundHeight(o.position.x, o.position.z, 0.01, o.position.y + 0.08) + b.radius;
      if (o.position.y <= g) {
        o.position.y = g;
        const impactV = -b.vel.y;
        if (impactV > 0.6 && this.audio) {
          if (b.kind === 'casing') this.audio.casingTink(o.position, Math.min(1, impactV / 4));
          else this.audio.magClatter(o.position, Math.min(1, impactV / 4));
        }
        b.bounces++;
        b.vel.y = impactV * (b.kind === 'casing' ? 0.38 : 0.22);
        b.vel.x *= 0.55; b.vel.z *= 0.55;
        b.spin.multiplyScalar(0.5);
        if (b.vel.y < 0.45 || b.bounces > 5) {
          b.rest = true;
          // settle lying on its side
          if (b.kind === 'casing') o.rotation.set(Math.PI / 2, 0, Math.random() * 6.28);
          else o.rotation.set(Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1), 0, Math.random() * 6.28);
          o.position.y = g + (b.kind === 'mag' ? 0.011 : 0);
        }
      }
    }

    // sync casing instances
    let ci = 0;
    for (const b of this.bodies) {
      if (b.kind !== 'casing') continue;
      b.obj.updateMatrix();
      this.casingMesh.setMatrixAt(ci++, b.obj.matrix);
    }
    this.casingMesh.count = ci;
    this.casingMesh.instanceMatrix.needsUpdate = true;

    // low-poly smoke blobs: pop in (overshoot), drift, shrink out
    let bi = 0;
    for (let i = this.blobs.length - 1; i >= 0; i--) {
      const b = this.blobs[i];
      b.life += dt;
      const u = b.life / b.max;
      if (u >= 1) { this.blobs.splice(i, 1); continue; }
      b.vel.multiplyScalar(Math.exp(-3.2 * dt));
      b.vel.y += 0.6 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.rot.x += b.spin * dt; b.rot.y += b.spin * 0.7 * dt;
      const pop = u < 0.18 ? 1.25 * (u / 0.18) : u < 0.3 ? 1.25 - (u - 0.18) / 0.12 * 0.25 : 1 - ((u - 0.3) / 0.7) ** 2;
      const sz = b.size * Math.max(0.001, pop);
      tmpQ.setFromEuler(b.rot);
      tmpM.compose(b.pos, tmpQ, tmpV.set(sz, sz * 0.9, sz));
      this.blobMesh.setMatrixAt(bi, tmpM);
      this.blobMesh.setColorAt(bi, tmpC.set(b.color));
      bi++;
    }
    this.blobMesh.count = bi;
    this.blobMesh.instanceMatrix.needsUpdate = true;
    if (this.blobMesh.instanceColor) this.blobMesh.instanceColor.needsUpdate = true;

    this._updateParticles(dt, this.particles, this.pMesh, true);
    this._updateParticles(dt, this.sparks, this.sparkMesh, false);

    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      const u = p.life / p.max;
      if (u >= 1) { p.s.visible = false; continue; }
      p.s.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
      const sz = p.size * (1 + u * p.grow);
      p.s.scale.set(sz, sz, 1);
      p.s.material.opacity = p.alpha * (1 - u) * Math.min(1, u * 8);
    }

    for (const f of this.tpFlashes) {
      if (!f.s.visible) continue;
      f.t += dt;
      if (f.t > 0.05) f.s.visible = false;
    }
    this.flashLightT += dt;
    this.flashLight.intensity = this.flashLightT < 0.07 ? 30 * (1 - this.flashLightT / 0.07) : 0;
  }

  _updateParticles(dt, list, mesh, shaded) {
    let n = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) { list.splice(i, 1); continue; }
      p.vel.y -= p.g * dt;
      p.vel.multiplyScalar(Math.exp(-(shaded ? 1.2 : 0.5) * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += dt * 8;
      const gy = this.world.heightAt(p.pos.x, p.pos.z);
      if (p.pos.y < gy) { p.pos.y = gy; p.vel.set(0, 0, 0); }
      if (n >= mesh.instanceMatrix.count) continue;
      const s = shaded ? p.size : p.size * Math.min(1, p.life * 6);
      tmpQ.setFromAxisAngle(up, p.rot);
      if (!shaded) {
        // stretch sparks along velocity
        const len = Math.max(1, p.vel.length() * 0.04 / s);
        tmpQ.setFromUnitVectors(up, tmpV.copy(p.vel).normalize());
        tmpM.compose(p.pos, tmpQ, new THREE.Vector3(s, s * len, s));
      } else {
        tmpM.compose(p.pos, tmpQ, new THREE.Vector3(s, s, s));
      }
      mesh.setMatrixAt(n, tmpM);
      mesh.setColorAt(n, tmpC.set(p.color));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}
