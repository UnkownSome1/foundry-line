// Training operators ("bots") that exercise the same systems remote players will:
// shared WeaponState, third-person reload tracks, positional audio, casings, mag drops.
import * as THREE from 'three';
import { Character } from './models/Character.js';
import { WeaponState } from '../shared/WeaponState.js';
import { WEAPONS } from '../shared/weapons.js';
import { PLAYER } from '../shared/constants.js';
import { damp, wrapAngle } from '../shared/math.js';

const tmp = new THREE.Vector3();

export class Operator {
  constructor(game, { name, team, x, z, yaw, behavior, waypoints = null, seed = 1 }) {
    this.game = game;
    this.name = name;
    this.behavior = behavior;
    this.char = new Character({ name, team });
    game.scene.add(this.char.root);
    this.pos = new THREE.Vector3(x, game.world.heightAt(x, z), z);
    this.home = this.pos.clone();
    this.homeYaw = yaw;
    this.yaw = yaw;
    this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.crouch = 0;
    this.wantCrouch = false;
    this.health = PLAYER.maxHealth;
    this.alive = true;
    this.respawnT = 0;
    this.weapon = new WeaponState(WEAPONS.p9, seed);
    this.waypoints = waypoints;
    this.wp = 0;
    this.wait = 1 + seed % 3;
    this.timer = 0;
    this.burst = 0;
    this.nextShot = 0;
    this.target = null;
    this.ready = behavior === 'guard' ? 0.35 : 1;
    this.char.onMagDrop = (matrix) => {
      const obj = this.char.pistol.cloneMagazine(0);
      matrix.decompose(obj.position, obj.quaternion, obj.scale);
      game.effects.dropMagazine(obj, new THREE.Vector3(0, -1.2, 0));
    };
  }

  damage(amount, part, dir) {
    if (!this.alive) return false;
    this.health -= amount;
    this.char.hit(dir.x, dir.z, part === 'head' ? 1.4 : 1);
    this.lastHit = this.game.time;
    if (this.health <= 0) {
      this.alive = false;
      this.respawnT = 5;
      this.char.kill();
      return true;
    }
    return false;
  }

  update(dt, now) {
    const g = this.game;
    const input = { fire: false, reload: false };

    if (!this.alive) {
      this.respawnT -= dt;
      this.vel.set(0, 0, 0);
      if (this.respawnT <= 0) {
        this.alive = true;
        this.health = PLAYER.maxHealth;
        this.char.revive();
        this.pos.copy(this.home);
        this.yaw = this.homeYaw;
        this.wp = 0;
      }
    } else if (this.behavior === 'patrol') {
      this._patrol(dt);
    } else if (this.behavior === 'shooter') {
      this._shooter(dt, now, input);
    } else {
      this._guard(dt, now);
    }
    if (this.alive && this.health < PLAYER.maxHealth && now - (this.lastHit || 0) > 4) this.health = Math.min(PLAYER.maxHealth, this.health + 25 * dt);

    this.crouch = damp(this.crouch, this.wantCrouch ? 1 : 0, 8, dt);
    this.pos.y = g.world.groundHeight(this.pos.x, this.pos.z, 0.25, this.pos.y + 0.5);

    // weapon sim (same code path as the local player / server)
    const events = this.weapon.update(now, dt, input);
    for (const ev of events) this._onWeaponEvent(ev);

    this.char.root.position.copy(this.pos);
    this.char.update(dt, {
      vx: this.vel.x, vz: this.vel.z, yaw: this.yaw, pitch: this.pitch, grounded: true,
      crouch: this.crouch, sprint: false, ready: this.ready,
    });
  }

  _patrol(dt) {
    const wpts = this.waypoints;
    const target = wpts[this.wp];
    tmp.set(target[0] - this.pos.x, 0, target[1] - this.pos.z);
    const dist = tmp.length();
    if (this.wait > 0) {
      this.wait -= dt;
      this.vel.multiplyScalar(Math.exp(-10 * dt));
      // look around while paused
      this.yaw += Math.sin(this.wait * 1.3) * 0.6 * dt;
      this.ready = damp(this.ready, 0.35, 3, dt);
    } else if (dist < 0.4) {
      this.wp = (this.wp + 1) % wpts.length;
      this.wait = 2.5;
    } else {
      const speed = 2.3;
      tmp.normalize();
      this.vel.x = damp(this.vel.x, tmp.x * speed, 6, dt);
      this.vel.z = damp(this.vel.z, tmp.z * speed, 6, dt);
      const want = Math.atan2(-tmp.x, -tmp.z);
      this.yaw += wrapAngle(want - this.yaw) * Math.min(1, dt * 5);
      this.ready = damp(this.ready, 0.55, 3, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pitch = damp(this.pitch, -0.12, 3, dt);
  }

  _shooter(dt, now, input) {
    const plates = this.game.map.steelPlates;
    this.vel.set(0, 0, 0);
    this.timer -= dt;
    if (!this.target || this.timer < -6) {
      this.target = plates[Math.floor(Math.random() * plates.length)];
      this.timer = 1.2;
      this.burst = 2 + Math.floor(Math.random() * 3);
    }
    // aim at the plate
    const c = this.target.center;
    tmp.set(c.x - this.pos.x, c.y - (this.pos.y + 1.45), c.z - this.pos.z);
    const yawT = Math.atan2(-tmp.x, -tmp.z);
    const pitchT = Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z));
    this.yaw += wrapAngle(yawT - this.yaw) * Math.min(1, dt * 6);
    this.pitch = damp(this.pitch, pitchT, 6, dt);
    this.ready = damp(this.ready, 1, 5, dt);
    const w = this.weapon;
    if (w.action === 'idle') {
      if (this.timer <= 0 && this.burst > 0 && now >= this.nextShot) {
        input.fire = !w.triggerWasDown;
        if (input.fire) { this.burst--; this.nextShot = now + 0.38 + Math.random() * 0.2; }
      } else if (this.burst === 0 && w.mag < 8 && w.chambered && this.timer < -1.5) {
        input.reload = true; // tactical top-up between strings
      }
      if (w.reserve <= 0) w.reserve = w.def.reserveStart; // infinite training ammo
    }
  }

  _guard(dt, now) {
    this.vel.set(0, 0, 0);
    this.yaw = this.homeYaw + Math.sin(now * 0.35) * 0.55 + Math.sin(now * 0.9) * 0.08;
    this.pitch = damp(this.pitch, Math.sin(now * 0.5) * 0.1 - 0.05, 2, dt);
    this.wantCrouch = Math.sin(now * 0.2) > 0.55;
    this.ready = damp(this.ready, Math.sin(now * 0.27) > 0.2 ? 1 : 0.3, 2, dt);
  }

  _onWeaponEvent(ev) {
    const g = this.game;
    const ch = this.char;
    const p = ch.pistol;
    switch (ev.type) {
      case 'fire': {
        ch.fire();
        if (ev.lastRound) ch.slideLocked = true;
        p.muzzle.getWorldPosition(tmp);
        g.effects.tpMuzzleFlash(tmp.clone());
        g.audio.gunshot(tmp, tmp.distanceTo(g.camera.position));
        // bullet → plate
        const t = this.target;
        if (t && Math.random() < 0.85) {
          t.vel += 2.4 + Math.random();
          const hitP = t.center.clone().add(new THREE.Vector3(0, (Math.random() - 0.5) * t.r, (Math.random() - 0.5) * t.r));
          setTimeout(() => {
            g.effects.impact(hitP.toArray(), [1, 0, 0], 'steel', { decal: false });
            g.audio.impact(hitP, 'steel');
          }, 30);
        }
        // casing
        p.ejectPort.getWorldPosition(tmp);
        const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        g.effects.ejectCasing(tmp, right.multiplyScalar(1.8 + Math.random() * 0.6).add(new THREE.Vector3(0, 2 + Math.random(), 0)));
        break;
      }
      case 'reloadStart':
        ch.startReload(ev.kind);
        break;
      case 'magOut':
        p.muzzle.getWorldPosition(tmp);
        g.audio.magRelease(tmp.clone());
        break;
      case 'magIn':
        p.muzzle.getWorldPosition(tmp);
        g.audio.magInsert(tmp.clone());
        break;
      case 'slideRelease':
        ch.slideLocked = false;
        p.muzzle.getWorldPosition(tmp);
        g.audio.slideRelease(tmp.clone());
        break;
    }
  }
}
