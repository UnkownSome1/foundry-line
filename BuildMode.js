// Build mode: a see-through ghost of the machine (or conveyor) snaps to the 0.5 m
// floor grid where you look. Green = fits, red = blocked (same rule the server uses).
// R rotates · left click places · right click / Q cancels.
import * as THREE from 'three';
import { ITEMS, MACHINES } from '../../shared/factory/items.js';
import { snap } from '../../shared/factory/FactorySim.js';
import { buildMachine } from './MachineModels.js';

const OK = new THREE.Color(0x3cff8a), BAD = new THREE.Color(0xff4a3a);

export class BuildMode {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.q = 0;
    this.ghostMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.38, depthWrite: false });
    this.edgeMat = new THREE.MeshBasicMaterial({ color: OK, transparent: true, opacity: 0.8, depthWrite: false });
    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 3;
    game.scene.add(this.root);
    this.valid = { ok: false };
  }

  inv() { return this.g.factory.players.get(this.g.playerId).inventory; }

  /** Start placing the item in `slot` (or the first placeable item). */
  start(slot = null) {
    const inv = this.inv();
    if (slot == null) slot = inv.slots.findIndex((s) => s && ITEMS[s.type].place);
    const s = inv.slots[slot];
    if (!s || !ITEMS[s.type].place) { this.g.hud.toast('Nothing to place — craft or buy a machine kit first', 'warn'); return false; }
    this.itemType = s.type;
    this.type = ITEMS[s.type].place;
    this._buildGhost();
    this.active = true;
    this.root.visible = true;
    document.body.classList.add('building');
    this.g.audio.ui('open');
    return true;
  }

  /** Cycle to the next kind of placeable item in the inventory. */
  cycle() {
    const inv = this.inv();
    const kinds = [...new Set(inv.slots.filter((s) => s && ITEMS[s.type].place).map((s) => s.type))];
    if (!kinds.length) return this.stop();
    const i = kinds.indexOf(this.itemType);
    const next = kinds[(i + 1) % kinds.length];
    this.start(inv.slots.findIndex((s) => s && s.type === next));
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.root.visible = false;
    document.body.classList.remove('building');
    this.g.hud.prompt('');
  }

  rotate() { this.q = (this.q + 1) & 3; this.g.audio.ui(); }

  _buildGhost() {
    this.root.clear();
    const size = this.type === 'conveyor' ? [1, 1] : MACHINES[this.type].size;
    if (this.type === 'conveyor') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.42, 0.94).translate(0, 0.21, 0), this.ghostMat));
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.45, 3).rotateX(Math.PI / 2).translate(0, 0.5, 0.15), this.edgeMat);
      g.add(arrow);
      this.model = g;
    } else {
      this.model = buildMachine(this.type, { ghost: this.ghostMat }).root;
      // port markers stay coloured so you can line belts up
      this.model.traverse((o) => { if (o.userData.port) o.material = o.userData.port === 'in' ? this.g.factoryView.M.ledGreen : this.g.factoryView.M.ledAmber; });
    }
    this.root.add(this.model);
    // footprint outline on the floor
    const [w, d] = size;
    const pts = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [-w / 2, -d / 2]].map(([x, z]) => new THREE.Vector3(x, 0.02, z));
    this.outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: OK }));
    this.root.add(this.outline);
  }

  update() {
    if (!this.active) return;
    const g = this.g;
    // still have the item? (it may have been dropped or sold)
    if (this.inv().count(this.itemType) <= 0) { this.stop(); return; }
    const o = g.eyePosition(new THREE.Vector3());
    const d = new THREE.Vector3(-Math.sin(g.yaw) * Math.cos(g.pitch), Math.sin(g.pitch), -Math.cos(g.yaw) * Math.cos(g.pitch));
    let t = d.y < -0.05 ? -o.y / d.y : 9;
    t = Math.min(t, 9);
    const px = o.x + d.x * t, pz = o.z + d.z * t;
    const odd = (n) => (n % 2 === 1 ? 0.5 : 0);
    const size = this.type === 'conveyor' ? [1, 1] : MACHINES[this.type].size;
    const [w, dd] = this.q & 1 ? [size[1], size[0]] : size;
    // odd sizes centre on half cells so edges land on whole metres where possible
    this.x = snap(px - odd(w)) + odd(w);
    this.z = snap(pz - odd(dd)) + odd(dd);
    this.x = snap(this.x); this.z = snap(this.z);
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.q * Math.PI / 2;
    const p = g.player;
    this.valid = g.factory.canPlace(this.type, this.x, this.z, this.q, { playerPos: [p.x, p.y, p.z] });
    const c = this.valid.ok ? OK : BAD;
    this.ghostMat.color.copy(c);
    this.edgeMat.color.copy(c);
    this.outline.material.color.copy(c);
    const name = this.type === 'conveyor' ? `Conveyor ×${this.inv().count('conveyor')}` : MACHINES[this.type].name;
    g.hud.prompt(`<div class="pr-row"><kbd>LMB</kbd><span>Place ${name}${this.valid.ok ? '' : ` — <b>${this.valid.why}</b>`}</span></div><div class="pr-row keys"><kbd>R</kbd><span>Rotate</span><kbd>B</kbd><span>Next kit</span><kbd>Q</kbd><span>Cancel</span></div>`);
  }

  confirm() {
    if (!this.active) return;
    if (!this.valid.ok) { this.g.audio.ui('error'); this.g.hud.toast(this.valid.why, 'warn'); return; }
    const inv = this.inv();
    const slot = inv.slots.findIndex((s) => s && s.type === this.itemType);
    const type = this.type, itemType = this.itemType;
    this.g.audio.place(); // instant feedback; online the server confirms a moment later
    this.g.factoryCommand({ type: 'place', slot, x: this.x, z: this.z, q: this.q }, (r) => {
      if (!r.ok) { this.g.audio.ui('error'); this.g.hud.toast(r.error, 'warn'); return; }
      if (type !== 'conveyor') this.g.hud.toast(`${MACHINES[type].name} placed — press E on its panel to run it`, 'ok');
      if (this.active && this.inv().count(itemType) <= 0) this.stop();
    });
  }
}
