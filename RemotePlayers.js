// Draws the other co-op players: a full third-person Character per player, driven by
// interpolated server snapshots, plus their relayed shots (muzzle flash, gunshot from
// their position, impact where they hit) and reloads.
import * as THREE from 'three';
import { Character } from '../models/Character.js';

const tmp = new THREE.Vector3();

export class RemotePlayers {
  constructor(game) {
    this.g = game;
    this.list = new Map(); // id → {char, name, color, seen}
  }

  _get(id, name, color) {
    let r = this.list.get(id);
    if (!r) {
      const char = new Character({ name, team: color });
      this.g.scene.add(char.root);
      char.onMagDrop = (matrix) => {
        const obj = char.pistol.cloneMagazine(0);
        matrix.decompose(obj.position, obj.quaternion, obj.scale);
        this.g.effects.dropMagazine(obj, new THREE.Vector3(0, -1.2, 0));
      };
      r = { char, name, color };
      this.list.set(id, r);
    }
    return r;
  }

  update(dt, states) {
    const seen = new Set();
    for (const s of states) {
      seen.add(s.id);
      const r = this._get(s.id, s.name, s.color);
      r.char.root.visible = true;
      r.char.root.position.set(s.x, s.y, s.z);
      r.char.update(dt, { vx: s.vx, vz: s.vz, yaw: s.yaw, pitch: s.pitch, grounded: s.grounded, crouch: s.crouch, sprint: s.sprint, ready: 1 });
      r.last = s;
    }
    for (const [id, r] of this.list) if (!seen.has(id)) r.char.root.visible = false;
  }

  remove(id) {
    const r = this.list.get(id);
    if (!r) return;
    this.g.scene.remove(r.char.root);
    this.list.delete(id);
  }

  clear() { for (const id of [...this.list.keys()]) this.remove(id); }

  /** Cosmetic weapon events from another player. */
  onFx(m) {
    const r = this.list.get(m.from);
    const g = this.g;
    if (m.k === 'shot') {
      let muzzle;
      if (r && r.char.root.visible) {
        r.char.fire();
        r.char.pistol.muzzle.getWorldPosition(tmp);
        muzzle = tmp.clone();
        g.effects.tpMuzzleFlash(muzzle.clone());
        r.char.pistol.ejectPort.getWorldPosition(tmp);
        const yaw = r.last ? r.last.yaw : 0;
        const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
        g.effects.ejectCasing(tmp.clone(), right.multiplyScalar(1.8 + Math.random() * 0.6).add(new THREE.Vector3(0, 2 + Math.random(), 0)));
      } else if (Array.isArray(m.o)) muzzle = new THREE.Vector3(...m.o);
      if (muzzle) g.audio.gunshot(muzzle, muzzle.distanceTo(g.camera.position));
      if (Array.isArray(m.p) && m.s) {
        const p = new THREE.Vector3(...m.p);
        setTimeout(() => {
          g.effects.impact(m.p, Array.isArray(m.n) ? m.n : [0, 1, 0], m.s, { decal: m.s !== 'flesh' && m.s !== 'steel' });
          g.audio.impact(p, m.s);
        }, Math.min(120, (muzzle ? muzzle.distanceTo(p) : 0) / 3.6));
      }
      if (m.last && r) r.char.slideLocked = true;
    } else if (m.k === 'reload' && r) {
      r.char.startReload(m.kind);
      r.char.pistol.muzzle.getWorldPosition(tmp);
      g.audio.magRelease(tmp.clone());
    } else if (m.k === 'slide' && r) {
      r.char.slideLocked = false;
    }
  }
}
