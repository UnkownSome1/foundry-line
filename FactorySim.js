// Authoritative factory simulation (build 0.3).
//  • The hall starts empty: supply terminal + a free fab bench.
//  • Machines are bought (delivered as kits) or crafted at the fab bench, then placed
//    on a 0.5 m grid. Conveyor sections carry items between machine ports.
//  • Machines run manually from a player's inventory, or automatically from a buffer
//    that input belts fill. Output goes to the tray (pick up) or out onto a belt.
//  • Goods that land in the sell corner slide through the wall chute into the outdoor
//    cage; a pickup van collects the cage and pays 80 % company / 20 % depositor.
//  • Government / private contracts pay a bonus on top of the fixed price.
// Pure JS: runs unchanged on a Node server. Clients send commands, render events.

import { ITEMS, MACHINES, CATALOG, EQUIPMENT, ECON, CONVEYOR, BUYERS } from './items.js';
import { Inventory } from './Inventory.js';
import { FACTORY } from './layout.js';
import { PHASE_TIME, DUMP_INTERVAL, dumpDuration, truckPose, truckRear, TRUCK,
  VAN_TIME, VAN_LOAD_INTERVAL, vanLoadDuration, vanPose, vanDoor } from './truck.js';
import { MASK } from '../mapLayout.js';
import { hash01 } from '../math.js';
import { levelFor, levelGrant, perksAt, GOALS, LEVEL_UNLOCKS } from './progression.js';

const GRAV = 14;
const REACH = 3.2;
const EPS = 1e-4;
const scratch = [];

// ------------------------------------------------------------------ geometry
/** Rotate a local (x, z) by q quarter turns (same convention as three.js rotation.y). */
export function rotQ(q, x, z) {
  switch (q & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}
export const snap = (v) => Math.round(v / FACTORY.grid) * FACTORY.grid;
const keyOf = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
const overlap = (a, b) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.z0 < b.z1 - EPS && a.z1 > b.z0 + EPS;

/** World footprint rectangle for a machine/belt type at (x, z, q). */
export function footprint(type, x, z, q) {
  const size = type === 'conveyor' ? CONVEYOR.size : MACHINES[type].size;
  const [w, d] = q & 1 ? [size[1], size[0]] : size;
  return { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
}

/** Machine geometry in world space: collider boxes, panel, tray, ports. */
export function machineGeometry(type, x, z, q) {
  const def = MACHINES[type];
  const W = (lx, lz) => { const [a, b] = rotQ(q, lx, lz); return [x + a, z + b]; };
  const boxes = def.colliders.map(([cx, cz, w, d, h]) => {
    const [wx, wz] = W(cx, cz);
    const [bw, bd] = q & 1 ? [d, w] : [w, d];
    return { x0: wx - bw / 2, x1: wx + bw / 2, z0: wz - bd / 2, z1: wz + bd / 2, h };
  });
  const [px, pz] = W(def.panel[0], def.panel[2]);
  const [tx, tz] = W(def.tray[0], def.tray[1]);
  const port = (p) => {
    const [cx, cz] = W(p.cell[0], p.cell[1]);
    const [dx, dz] = rotQ(q, p.dir[0], p.dir[1]);
    return { x: cx, z: cz, dx: Math.round(dx), dz: Math.round(dz) };
  };
  return { boxes, panel: [px, def.panel[1], pz], tray: [tx, def.tray[2], tz], in: port(def.ports.in), out: port(def.ports.out) };
}

const freshStats = () => ({
  shipped: 0, shippedValue: 0, madeValue: 0, produced: 0, delivered: 0, contracts: 0,
  orders: 0, crafted: 0, placed: 0, beltsLaid: 0, deposited: 0, vanTrips: 0, autoSet: 0, advanced: 0,
});

export class FactorySim {
  constructor(world, { seed = 1, funds = ECON.startFunds, fresh = true } = {}) {
    this.world = world;
    this.seed = seed;
    this.time = 0;
    this.funds = funds;
    this.players = new Map();
    this.items = new Map();
    this.nextItemId = 1;
    this.machines = new Map();
    this.belts = new Map();
    this.beltKeys = new Map();
    this.nextMachineId = 1;
    this.truck = { phase: 'idle', t0: 0, manifest: [], dumped: 0, trips: 0 };
    this.pending = [];
    this.van = { phase: 'idle', t0: 0, manifest: [], loaded: 0, trips: 0 };
    this.cage = [];
    this.contracts = { offers: [], active: [], nextId: 1, nextOfferAt: 0 };
    this.stats = freshStats();
    this.progress = { xp: 0, goals: [] };
    this._goalT = 0;
    this.events = [];
    this._rng = 0;
    if (fresh) for (const s of FACTORY.starter) this._createMachine(s.type, s.x, s.z, s.q);
  }

  rand() { return hash01(this.seed * 7919 + 17, this._rng++); }
  emit(e) { this.events.push(e); }

  // ------------------------------------------------------------------ progression
  levelInfo() { return levelFor(this.progress.xp); }
  perks() { return perksAt(this.levelInfo().level); }
  saleMultiplier() { return 1 + this.perks().saleBonus; }

  _gainXp(amount) {
    if (!(amount > 0)) return;
    const before = levelFor(this.progress.xp).level;
    this.progress.xp += amount;
    const after = levelFor(this.progress.xp).level;
    for (let L = before + 1; L <= after; L++) {
      const grant = levelGrant(L);
      this.funds += grant;
      this.emit({ type: 'funds', funds: this.funds, delta: grant });
      this.emit({ type: 'levelUp', level: L, grant, unlocks: LEVEL_UNLOCKS[L] || [], saleBonus: perksAt(L).saleBonus });
    }
    this.emit({ type: 'xp', xp: this.progress.xp });
  }

  goalProgress(g) { return Math.min(g.target, g.value(this) || 0); }

  _checkGoals() {
    for (const g of GOALS) {
      if (this.progress.goals.includes(g.id)) continue;
      if ((g.value(this) || 0) < g.target) continue;
      this.progress.goals.push(g.id);
      this.funds += g.reward;
      this.emit({ type: 'funds', funds: this.funds, delta: g.reward });
      this.emit({ type: 'goalDone', goal: g.id, name: g.name, reward: g.reward });
    }
  }

  // ------------------------------------------------------------------ players
  addPlayer(id, saved = null) {
    const p = { id, inventory: saved && saved.inv ? Inventory.fromJSON(saved.inv) : new Inventory(24), pos: [0, 0, 0], wallet: (saved && saved.wallet) || 0 };
    this.players.set(id, p);
    return p;
  }

  _pay(value, ownerId) {
    const company = Math.round(value * ECON.companyShare);
    const personal = value - company;
    const p = this.players.get(ownerId);
    if (p) {
      p.wallet += personal;
      this.funds += company;
      this.emit({ type: 'wallet', player: p.id, wallet: p.wallet, delta: personal });
    } else {
      this.funds += value;
    }
    this.emit({ type: 'funds', funds: this.funds, delta: p ? company : value });
  }

  // ------------------------------------------------------------------ commands
  apply(playerId, cmd) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: 'Unknown player' };
    if (cmd.pos) p.pos = cmd.pos;
    switch (cmd.type) {
      case 'order': return this._order(p, cmd.items || {});
      case 'pickup': return this._pickup(p, cmd.itemId);
      case 'drop': return this._drop(p, cmd.slot, cmd.count ?? Infinity, cmd.at, cmd.vel);
      case 'run': return this._run(p, cmd.machine, cmd.recipe, cmd.times || 1);
      case 'scrap': return this._scrap(p, cmd.slot, cmd.count ?? Infinity);
      case 'use': return this._use(p, cmd.slot);
      case 'move': p.inventory.move(cmd.from, cmd.to); this.emit({ type: 'inventory', player: p.id }); return { ok: true };
      case 'place': return this._place(p, cmd.slot, cmd.x, cmd.z, cmd.q);
      case 'pack': return this._pack(p, cmd.id);
      case 'packBelt': return this._packBelt(p, cmd.id);
      case 'auto': return this._setAuto(p, cmd.machine, cmd.recipe);
      case 'output': return this._setOutput(p, cmd.machine, cmd.mode);
      case 'unload': return this._unload(p, cmd.machine);
      case 'deposit': return this._depositAll(p);
      case 'callVan': return this._callVan(p);
      case 'accept': return this._accept(p, cmd.contract);
      default: return { ok: false, error: 'Unknown command' };
    }
  }

  quote(items) {
    let total = 0, units = 0;
    for (const [type, qty] of Object.entries(items)) {
      const def = ITEMS[type];
      const q = Math.floor(qty);
      if (!def || def.buy == null || !(q > 0)) continue;
      total += def.buy * q;
      units += q;
    }
    const fee = units && !this.perks().freeDelivery ? ECON.deliveryFee : 0;
    return { total: total + fee, units, fee };
  }

  _order(p, items) {
    const clean = {};
    for (const [type, qty] of Object.entries(items)) {
      const q = Math.min(200, Math.floor(qty));
      if ((CATALOG.includes(type) || EQUIPMENT.includes(type)) && q > 0) clean[type] = q;
    }
    const { total, units } = this.quote(clean);
    if (!units) return { ok: false, error: 'Nothing to order' };
    if (total > this.funds) return { ok: false, error: `Not enough company funds (need $${total.toLocaleString('en-US')})` };
    this.funds -= total;
    for (const [type, q] of Object.entries(clean)) {
      let left = q;
      while (left > 0) {
        const n = Math.min(left, ITEMS[type].stack);
        this.pending.push({ type, count: n, owner: p.id });
        left -= n;
      }
    }
    this.stats.orders++;
    if (this.truck.phase === 'idle') this._setTruck('loading');
    this.emit({ type: 'funds', funds: this.funds, delta: -total });
    this.emit({ type: 'ordered', units, total });
    return { ok: true, total };
  }

  _near(p, pos, reach = REACH) {
    const dx = p.pos[0] - pos[0], dz = p.pos[2] - pos[2];
    return dx * dx + dz * dz <= reach * reach;
  }

  _pickup(p, itemId) {
    const it = this.items.get(itemId);
    if (!it) return { ok: false, error: 'Gone' };
    if (!this._near(p, [it.x, it.y, it.z])) return { ok: false, error: 'Too far away' };
    const left = p.inventory.add(it.type, it.count);
    const taken = it.count - left;
    if (taken <= 0) return { ok: false, error: 'Inventory full' };
    if (left > 0) { it.count = left; this.emit({ type: 'itemCount', id: it.id, count: left }); }
    else this._removeItem(it.id);
    this.emit({ type: 'pickup', player: p.id, item: it.type, count: taken, x: it.x, y: it.y, z: it.z });
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true, taken, full: left > 0 };
  }

  _drop(p, slot, count, at, vel) {
    const s = p.inventory.takeSlot(slot, count);
    if (!s) return { ok: false, error: 'Empty slot' };
    const pos = at || [p.pos[0], p.pos[1] + 1.2, p.pos[2]];
    this.spawnItem(s.type, s.count, pos, vel || [0, 1, 0], { owner: p.id });
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true };
  }

  _scrap(p, slot, count) {
    const s = p.inventory.takeSlot(slot, count);
    if (!s) return { ok: false, error: 'Empty slot' };
    const value = Math.round(ITEMS[s.type].value * s.count * this.perks().scrapRate);
    this.funds += value;
    this.emit({ type: 'funds', funds: this.funds, delta: value });
    this.emit({ type: 'sold', via: 'scrap', item: s.type, count: s.count, value });
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true, value };
  }

  _use(p, slot) {
    const s = p.inventory.slots[slot];
    if (!s) return { ok: false, error: 'Empty slot' };
    const use = ITEMS[s.type].use;
    if (!use) return { ok: false, error: `${ITEMS[s.type].name} can't be used` };
    p.inventory.takeSlot(slot, 1);
    this.emit({ type: 'use', player: p.id, item: s.type, effect: use });
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true, effect: use };
  }

  // ------------------------------------------------------------------ building
  /** Can `type` go at (x, z, q)? Shared by the client ghost and the server check. */
  canPlace(type, x, z, q, { playerPos = null, ignore = null } = {}) {
    const fp = footprint(type, x, z, q);
    const F = FACTORY.floor;
    if (fp.x0 < F.x0 - EPS || fp.x1 > F.x1 + EPS || fp.z0 < F.z0 - EPS || fp.z1 > F.z1 + EPS) return { ok: false, why: 'Must be inside the factory hall' };
    for (const r of FACTORY.reserved) if (overlap(fp, r)) return { ok: false, why: `Keep the ${r.why} clear` };
    for (const m of this.machines.values()) {
      if (m.id === ignore) continue;
      if (overlap(fp, m.fp)) return { ok: false, why: `Blocked by ${m.def.name}` };
    }
    for (const b of this.belts.values()) if (b.id !== ignore && overlap(fp, b.fp)) return { ok: false, why: 'Blocked by a conveyor' };
    for (const c of this.world.query(fp.x0, fp.z0, fp.x1, fp.z1, MASK.ALL, scratch)) {
      if (c.dyn || c.min[1] > 2.5) continue;
      if (overlap(fp, { x0: c.min[0], x1: c.max[0], z0: c.min[2], z1: c.max[2] })) return { ok: false, why: 'Blocked by the building' };
    }
    if (playerPos) {
      const r = 0.34;
      const pb = { x0: playerPos[0] - r, x1: playerPos[0] + r, z0: playerPos[2] - r, z1: playerPos[2] + r };
      if (overlap(fp, pb)) return { ok: false, why: "You're standing in the way" };
    }
    return { ok: true };
  }

  _place(p, slot, x, z, q) {
    const s = p.inventory.slots[slot];
    if (!s) return { ok: false, error: 'Empty slot' };
    const type = ITEMS[s.type].place;
    if (!type) return { ok: false, error: `${ITEMS[s.type].name} can't be placed` };
    x = snap(x); z = snap(z); q = (q | 0) & 3;
    if (!this._near(p, [x, 0, z], 14)) return { ok: false, error: 'Too far away to build there' };
    const chk = this.canPlace(type, x, z, q, { playerPos: p.pos });
    if (!chk.ok) return { ok: false, error: chk.why };
    p.inventory.takeSlot(slot, 1);
    const obj = type === 'conveyor' ? this._createBelt(x, z, q) : this._createMachine(type, x, z, q);
    if (type === 'conveyor') this.stats.beltsLaid++; else this.stats.placed++;
    this.emit({ type: 'inventory', player: p.id });
    this.emit({ type: 'placed', kind: type, id: obj.id, x, z, q });
    return { ok: true, id: obj.id, type };
  }

  _createMachine(type, x, z, q, id = null) {
    const def = MACHINES[type];
    const g = machineGeometry(type, x, z, q);
    const m = {
      id: id || `m${this.nextMachineId++}`, type, def, x, z, q, fp: footprint(type, x, z, q), geo: g,
      queue: [], current: null, auto: null, outMode: 'tray', buffer: {}, outBuffer: [], colliders: [],
    };
    for (const b of g.boxes) {
      m.colliders.push(this.world.addCollider({ min: [b.x0, 0, b.z0], max: [b.x1, b.h, b.z1], surface: 'metal', mask: MASK.ALL, dyn: true, machine: m.id }));
    }
    this.machines.set(m.id, m);
    this.emit({ type: 'machinePlaced', id: m.id, machine: type, x, z, q });
    return m;
  }

  _createBelt(x, z, q, id = null) {
    const [dx, dz] = rotQ(q, 0, 1); // belts run toward local +Z (the placement arrow)
    const b = { id: id || `b${this.nextMachineId++}`, x, z, q, dx: Math.round(dx), dz: Math.round(dz), fp: footprint('conveyor', x, z, q) };
    b.collider = this.world.addCollider({ min: [x - 0.5, 0, z - 0.5], max: [x + 0.5, CONVEYOR.top, z + 0.5], surface: 'metal', mask: MASK.ALL, dyn: true, belt: b.id });
    this.belts.set(b.id, b);
    this.beltKeys.set(keyOf(x, z), b);
    this.emit({ type: 'beltPlaced', id: b.id, x, z, q });
    return b;
  }

  _pack(p, id) {
    const m = this.machines.get(id);
    if (!m) return { ok: false, error: 'Nothing to pack up' };
    if (!this._near(p, m.geo.panel, 4)) return { ok: false, error: 'Too far from the machine' };
    if (m.current || m.queue.length || m.outBuffer.length) return { ok: false, error: 'Wait for the machine to finish first' };
    const kit = `kit_${m.type}`;
    if (p.inventory.space(kit) < 1) return { ok: false, error: 'No room in your inventory for the kit' };
    // hand back anything still sitting in the input buffer
    for (const [t, n] of Object.entries(m.buffer)) {
      const left = p.inventory.add(t, n);
      if (left > 0) this.spawnItem(t, left, [m.geo.tray[0], 1.4, m.geo.tray[2]], [0, 1, 0], { owner: p.id });
    }
    this.removeMachine(id);
    p.inventory.add(kit, 1);
    for (const it of this.items.values()) if (it.x > m.fp.x0 && it.x < m.fp.x1 && it.z > m.fp.z0 && it.z < m.fp.z1) { it.rest = false; it.belt = null; }
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true, kit };
  }

  _packBelt(p, id) {
    const b = this.belts.get(id);
    if (!b) return { ok: false, error: 'Nothing to pick up' };
    if (!this._near(p, [b.x, 0, b.z])) return { ok: false, error: 'Too far away' };
    if (p.inventory.space('conveyor') < 1) return { ok: false, error: 'Inventory full' };
    this.removeBelt(id);
    for (const it of this.items.values()) if (it.belt === id) { it.belt = null; it.rest = false; }
    p.inventory.add('conveyor', 1);
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true };
  }

  /** Remove a machine and its colliders (pack-up, load, replicas). */
  removeMachine(id) {
    const m = this.machines.get(id);
    if (!m) return;
    for (const c of m.colliders) this.world.removeCollider(c);
    this.machines.delete(id);
    this.emit({ type: 'machineRemoved', id });
  }

  removeBelt(id) {
    const b = this.belts.get(id);
    if (!b) return;
    this.world.removeCollider(b.collider);
    this.belts.delete(id);
    if (this.beltKeys.get(keyOf(b.x, b.z)) === b) this.beltKeys.delete(keyOf(b.x, b.z));
    this.emit({ type: 'beltRemoved', id });
  }

  /** Take every machine/belt collider out of the shared World (switching sessions). */
  dispose() {
    for (const id of [...this.machines.keys()]) this.removeMachine(id);
    for (const id of [...this.belts.keys()]) this.removeBelt(id);
    this.items.clear();
    this.events.length = 0;
  }

  beltAt(x, z) {
    // tiles are 1 m on a 0.5 m grid: check the nearby grid centres
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const cx = snap(x) + i * 0.5, cz = snap(z) + j * 0.5;
      const b = this.beltKeys.get(keyOf(cx, cz));
      if (b && Math.abs(x - b.x) <= 0.5 && Math.abs(z - b.z) <= 0.5) return b;
    }
    return null;
  }

  // ------------------------------------------------------------------ machines
  _machineCheck(p, id, reach = REACH) {
    const m = this.machines.get(id);
    if (!m) return { error: 'Unknown machine' };
    if (!this._near(p, m.geo.panel, reach)) return { error: 'Too far from the machine' };
    return { m };
  }

  _run(p, id, recipeId, times) {
    const { m, error } = this._machineCheck(p, id);
    if (error) return { ok: false, error };
    const r = m.def.recipes.find((x) => x.id === recipeId);
    if (!r) return { ok: false, error: 'Unknown recipe' };
    times = Math.max(1, Math.min(times | 0, ECON.maxQueue - m.queue.length - (m.current ? 1 : 0)));
    if (times <= 0) return { ok: false, error: 'Queue is full' };
    let n = 0;
    while (n < times && p.inventory.hasAll(r.inputs)) { p.inventory.removeAll(r.inputs); n++; }
    if (!n) return { ok: false, error: 'Missing materials' };
    for (let i = 0; i < n; i++) m.queue.push({ recipe: r, owner: p.id });
    if (!m.current) this._startNext(m);
    this.emit({ type: 'inventory', player: p.id });
    this.emit({ type: 'machineState', id: m.id });
    return { ok: true, queued: n };
  }

  _setAuto(p, id, recipeId) {
    const { m, error } = this._machineCheck(p, id, 4);
    if (error) return { ok: false, error };
    if (recipeId && !m.def.recipes.find((r) => r.id === recipeId)) return { ok: false, error: 'Unknown recipe' };
    m.auto = recipeId || null;
    m.autoOwner = p.id;
    if (recipeId) this.stats.autoSet++;
    this.emit({ type: 'machineState', id: m.id });
    return { ok: true };
  }

  _setOutput(p, id, mode) {
    const { m, error } = this._machineCheck(p, id, 4);
    if (error) return { ok: false, error };
    m.outMode = mode === 'belt' ? 'belt' : 'tray';
    this.emit({ type: 'machineState', id: m.id });
    return { ok: true };
  }

  _unload(p, id) {
    const { m, error } = this._machineCheck(p, id, 4);
    if (error) return { ok: false, error };
    let moved = 0;
    for (const [t, n] of Object.entries(m.buffer)) {
      const left = p.inventory.add(t, n);
      moved += n - left;
      if (left > 0) m.buffer[t] = left; else delete m.buffer[t];
    }
    if (!moved) return { ok: false, error: 'Nothing in the input buffer' };
    this.emit({ type: 'inventory', player: p.id });
    this.emit({ type: 'machineState', id: m.id });
    return { ok: true, moved };
  }

  /** Does this machine take `type` into its belt-fed input buffer? */
  accepts(m, type, count = 1) {
    if (!m.def.recipes.some((r) => r.inputs[type])) return false;
    return (m.buffer[type] || 0) + count <= ECON.bufferCap || !(m.buffer[type] > 0);
  }

  _startNext(m) {
    let job = m.queue.shift();
    if (!job && m.auto && m.outBuffer.length < 3) {
      const r = m.def.recipes.find((x) => x.id === m.auto);
      if (r && Object.entries(r.inputs).every(([t, n]) => (m.buffer[t] || 0) >= n)) {
        for (const [t, n] of Object.entries(r.inputs)) { m.buffer[t] -= n; if (!m.buffer[t]) delete m.buffer[t]; }
        job = { recipe: r, owner: m.autoOwner, auto: true };
      }
    }
    if (!job) {
      if (m.current) { m.current = null; this.emit({ type: 'machineIdle', id: m.id }); }
      return;
    }
    m.current = { recipe: job.recipe, start: this.time, end: this.time + job.recipe.time, owner: job.owner, auto: !!job.auto };
    this.emit({ type: 'machineStart', id: m.id, machine: m.type, recipe: job.recipe.id, duration: job.recipe.time, auto: !!job.auto });
  }

  machineProgress(id) {
    const m = this.machines.get(id);
    if (!m || !m.current) return 0;
    return Math.min(1, (this.time - m.current.start) / (m.current.end - m.current.start));
  }

  _stepMachines() {
    for (const m of this.machines.values()) {
      if (m.current && this.time >= m.current.end) {
        const outBelt = m.outMode === 'belt' ? this.beltAt(m.geo.out.x, m.geo.out.z) : null;
        let i = 0;
        for (const [type, n] of Object.entries(m.current.recipe.outputs)) {
          if (outBelt) m.outBuffer.push({ type, count: n, owner: m.current.owner });
          else this.spawnItem(type, n, [m.geo.tray[0] + (i % 2) * 0.12, m.geo.tray[1] + 0.6 + i * 0.25, m.geo.tray[2]], [0, 0.5, 0], { owner: m.current.owner });
          this.stats.produced += n;
          if (type === 'motor' || type === 'control_unit') this.stats.advanced += n;
          i++;
        }
        if (m.type === 'fabricator') this.stats.crafted++;
        this.emit({ type: 'machineDone', id: m.id, machine: m.type, recipe: m.current.recipe.id, toBelt: !!outBelt });
        const wasQueued = m.queue.length > 0 || m.auto;
        m.current = null;
        this._startNext(m);
        if (!m.current && !wasQueued) this.emit({ type: 'machineIdle', id: m.id });
        else if (!m.current) this.emit({ type: 'machineState', id: m.id });
      } else if (!m.current) {
        this._startNext(m);
      }
      // push finished goods out onto the output belt when there's room
      if (m.outBuffer.length) {
        const b = this.beltAt(m.geo.out.x, m.geo.out.z);
        if (!b || m.outMode !== 'belt') {
          const s = m.outBuffer.shift();
          this.spawnItem(s.type, s.count, [m.geo.tray[0], m.geo.tray[1] + 0.6, m.geo.tray[2]], [0, 0.5, 0], { owner: s.owner });
        } else {
          const ex = b.x - b.dx * 0.3, ez = b.z - b.dz * 0.3;
          const busy = [...this.items.values()].some((it) => it.belt === b.id && Math.hypot(it.x - ex, it.z - ez) < 0.55);
          if (!busy) {
            const s = m.outBuffer.shift();
            const it = this.spawnItem(s.type, s.count, [ex, CONVEYOR.top, ez], [0, 0, 0], { owner: s.owner, puff: false, eject: true });
            it.rest = true; it.belt = b.id;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ items
  spawnItem(type, count, pos, vel = [0, 0, 0], opts = {}) {
    const id = this.nextItemId++;
    const it = {
      id, type, count,
      x: pos[0], y: pos[1], z: pos[2],
      vx: vel[0], vy: vel[1], vz: vel[2],
      ry: hash01(this.seed, id) * Math.PI * 2,
      spin: opts.spin ?? (hash01(this.seed + 3, id) - 0.5) * 8,
      tumble: 0, tumbleV: opts.tumble ?? 0,
      rest: false, belt: null, suck: 0,
      owner: opts.owner || null,
      r: ITEMS[type].r,
    };
    this.items.set(id, it);
    this.emit({ type: 'itemSpawn', id, item: type, count, x: it.x, y: it.y, z: it.z, puff: !!opts.puff, eject: !!opts.eject });
    return it;
  }

  _removeItem(id) {
    if (this.items.delete(id)) this.emit({ type: 'itemRemove', id });
  }

  _machineAtPort(x, z) {
    for (const m of this.machines.values()) if (Math.abs(m.geo.in.x - x) < 0.05 && Math.abs(m.geo.in.z - z) < 0.05) return m;
    return null;
  }

  _stepBelts(dt, beltItems) {
    const S = CONVEYOR.speed;
    for (const it of beltItems) {
      const b = this.belts.get(it.belt);
      if (!b) { it.belt = null; it.rest = false; continue; }
      let along = (it.x - b.x) * b.dx + (it.z - b.z) * b.dz;
      let lat = (it.x - b.x) * -b.dz + (it.z - b.z) * b.dx;
      // queue behind the item in front
      let blocked = false;
      for (const o of beltItems) {
        if (o === it) continue;
        const ax = o.x - it.x, az = o.z - it.z;
        const ahead = ax * b.dx + az * b.dz;
        if (ahead > 0 && ahead < 0.5 && Math.abs(ax * -b.dz + az * b.dx) < 0.4) { blocked = true; break; }
      }
      if (!blocked) along += S * dt;
      lat -= lat * Math.min(1, dt * 6);
      if (along > 0.5) {
        const nx = b.x + b.dx, nz = b.z + b.dz;
        const m = this._machineAtPort(nx, nz);
        const next = this.beltKeys.get(keyOf(nx, nz));
        if (m) {
          if (this.accepts(m, it.type, it.count)) {
            m.buffer[it.type] = (m.buffer[it.type] || 0) + it.count;
            this._removeItem(it.id);
            this.emit({ type: 'machineFed', id: m.id, item: it.type, count: it.count });
            this.emit({ type: 'machineState', id: m.id });
            continue;
          }
          along = 0.5; // hold at the port until there's room
        } else if (next) {
          it.belt = next.id;
        } else if (this._inSellZone({ x: nx, z: nz })) {
          // belt runs into the sell corner: straight down the chute
          this._deposit(it.type, it.count, it.owner, [it.x, it.y, it.z], it.id);
          continue;
        } else {
          // end of the line: shoot it off the belt
          it.belt = null; it.rest = false;
          it.vx = b.dx * S * 1.4; it.vz = b.dz * S * 1.4; it.vy = 1.2;
          it.x = b.x + b.dx * 0.5; it.z = b.z + b.dz * 0.5; it.y = CONVEYOR.top + 0.05;
          this.emit({ type: 'beltLaunch', id: it.id });
          continue;
        }
      }
      if (it.belt === b.id) {
        it.x = b.x + b.dx * along - b.dz * lat;
        it.z = b.z + b.dz * along + b.dx * lat;
      }
      it.y = CONVEYOR.top;
      it.ry += (Math.atan2(b.dx, b.dz) - it.ry) * Math.min(1, dt * 4);
    }
  }

  _inSellZone(it) {
    const z = FACTORY.sell.zone;
    return it.x >= z.x0 - 0.01 && it.x <= z.x1 && it.z >= z.z0 - 0.01 && it.z <= z.z1;
  }

  _stepItems(dt) {
    const w = this.world;
    const beltItems = [];
    for (const it of this.items.values()) if (it.belt) beltItems.push(it);
    if (beltItems.length) this._stepBelts(dt, beltItems);

    for (const it of [...this.items.values()]) {
      if (it.belt) continue;
      if (it.rest) {
        if (this._inSellZone(it)) {
          it.suck += dt;
          if (it.suck > 0.35) this._deposit(it.type, it.count, it.owner, [it.x, it.y, it.z], it.id);
        }
        continue;
      }
      it.vy -= GRAV * dt;
      const drag = Math.exp(-0.25 * dt);
      it.vx *= drag; it.vz *= drag;
      const prevY = it.y;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      it.ry += it.spin * dt;
      it.tumble += it.tumbleV * dt;
      const r = it.r * 0.7;
      for (const c of w.query(it.x - r, it.z - r, it.x + r, it.z + r, MASK.PLAYER, scratch)) {
        if (it.y + 0.05 < c.min[1] || Math.max(it.y, prevY) > c.max[1] - 0.05) continue;
        const px1 = it.x + r - c.min[0], px2 = c.max[0] - (it.x - r);
        const pz1 = it.z + r - c.min[2], pz2 = c.max[2] - (it.z - r);
        const pen = Math.min(px1, px2, pz1, pz2);
        if (pen <= 0) continue;
        if (pen === px1) { it.x -= px1; it.vx = -Math.abs(it.vx) * 0.3; }
        else if (pen === px2) { it.x += px2; it.vx = Math.abs(it.vx) * 0.3; }
        else if (pen === pz1) { it.z -= pz1; it.vz = -Math.abs(it.vz) * 0.3; }
        else { it.z += pz2; it.vz = Math.abs(it.vz) * 0.3; }
      }
      const g = w.groundHeight(it.x, it.z, r * 0.5, Math.max(prevY, it.y) + 0.05, scratch);
      if (it.y <= g) {
        it.y = g;
        const iv = -it.vy;
        if (iv > 1.5) this.emit({ type: 'itemBounce', id: it.id, item: it.type, strength: Math.min(1, iv / 7), x: it.x, y: it.y, z: it.z });
        it.vy = iv * 0.28;
        it.vx *= 0.55; it.vz *= 0.55;
        it.spin *= 0.5; it.tumbleV *= 0.4;
        if (it.vy < 0.6) {
          it.rest = true;
          it.vx = it.vy = it.vz = 0;
          it.tumble = Math.round(it.tumble / Math.PI) * Math.PI;
          // landed on a belt? ride it
          const b = Math.abs(it.y - CONVEYOR.top) < 0.08 ? this.beltAt(it.x, it.z) : null;
          if (b) { it.belt = b.id; it.tumble = 0; }
        }
      }
      if (it.y < -5) this._removeItem(it.id);
    }
  }

  // ------------------------------------------------------------------ selling
  _deposit(type, count, owner, pos, itemId = null) {
    if (itemId) this._removeItem(itemId);
    owner = owner || null;
    // top up an existing stack of the same item + owner before opening a new one
    const cap = ITEMS[type].stack || 20;
    let left = count;
    for (const s of this.cage) {
      if (!left) break;
      if (s.type !== type || s.owner !== owner || s.count >= cap) continue;
      const n = Math.min(cap - s.count, left);
      s.count += n;
      left -= n;
    }
    while (left > 0) { const n = Math.min(cap, left); this.cage.push({ type, count: n, owner }); left -= n; }
    this.stats.deposited += count;
    const value = this.cageValue();
    this.emit({ type: 'deposit', item: type, count, x: pos[0], y: pos[1], z: pos[2], cage: this.cage.length, value });
  }

  cageValue() { return this.cage.reduce((a, s) => a + ITEMS[s.type].value * s.count, 0); }

  _depositAll(p) {
    const hp = FACTORY.sell.hopper;
    if (!this._near(p, [hp.x - 1.5, 0, hp.z], 4.2)) return { ok: false, error: 'Too far from the sell corner' };
    let units = 0;
    for (let i = 0; i < p.inventory.size; i++) {
      const s = p.inventory.slots[i];
      if (!s || ITEMS[s.type].cat === 'raw' || ITEMS[s.type].cat === 'kit') continue;
      const t = p.inventory.takeSlot(i);
      this._deposit(t.type, t.count, p.id, [hp.x - 0.4, hp.h + 0.2, hp.z]);
      units += t.count;
    }
    if (!units) return { ok: false, error: 'No parts or products to sell' };
    this.emit({ type: 'inventory', player: p.id });
    return { ok: true, units };
  }

  _callVan(p) {
    if (this.van.phase !== 'idle') return { ok: false, error: 'The pickup van is already on its way' };
    if (!this.cage.length) return { ok: false, error: 'The pickup cage is empty' };
    this.van.caller = p.id;
    this._setVan('dispatch');
    return { ok: true };
  }

  _setVan(phase) {
    const V = this.van;
    V.phase = phase;
    V.t0 = this.time;
    if (phase === 'loading') { V.manifest = this.cage.splice(0, this.cage.length); V.loaded = 0; V.payout = 0; V.interval = this.perks().vanFast ? VAN_LOAD_INTERVAL / 2 : VAN_LOAD_INTERVAL; }
    this.emit({ type: 'vanPhase', phase, t0: this.time, manifest: phase === 'loading' ? V.manifest.length : undefined });
  }

  vanPose() { return vanPose(this.van, this.time); }

  _stepVan() {
    const V = this.van;
    const t = this.time - V.t0;
    const iv = V.interval || VAN_LOAD_INTERVAL;
    switch (V.phase) {
      case 'dispatch': if (t >= VAN_TIME.dispatch) this._setVan('inbound'); break;
      case 'inbound': if (t >= VAN_TIME.inbound) this._setVan('loading'); break;
      case 'loading': {
        while (V.loaded < V.manifest.length && t >= 0.8 + V.loaded * iv) this._loadVan(V.manifest[V.loaded++]);
        if (t >= vanLoadDuration(V.manifest.length, iv)) {
          this.stats.vanTrips++;
          this.emit({ type: 'vanPaid', total: V.payout, stacks: V.manifest.length, bonus: this.perks().saleBonus });
          this._setVan('reversing');
        }
        break;
      }
      case 'reversing': if (t >= VAN_TIME.reversing) this._setVan('outbound'); break;
      case 'outbound':
        if (t >= VAN_TIME.outbound) { V.trips++; this._setVan('idle'); }
        break;
    }
  }

  _loadVan(stack) {
    const def = ITEMS[stack.type];
    // Level bonus + XP only for goods the factory made — reselling bought raw stock or
    // kits must never turn a profit or farm levels.
    const made = def.cat === 'part' || def.cat === 'product';
    const value = Math.round(def.value * stack.count * (made ? this.saleMultiplier() : 1));
    this._pay(value, stack.owner);
    if (made) { this.stats.madeValue += value; this._gainXp(value); }
    this.van.payout += value;
    this.stats.shipped += stack.count;
    this.stats.shippedValue += value;
    const door = vanDoor(this.vanPose());
    const c = FACTORY.cage;
    this.emit({ type: 'vanLoad', item: stack.type, count: stack.count, value, from: [(c.x0 + c.x1) / 2, 0.6, (c.z0 + c.z1) / 2], to: [door.x, 1.1, door.z] });
    this._creditContracts(stack.type, stack.count);
  }

  // ------------------------------------------------------------------ contracts
  _tier() { return this.stats.shippedValue < 1500 ? 0 : this.stats.shippedValue < 6000 ? 1 : 2; }

  _newOffer() {
    const tier = this._tier();
    const pool = [['bracket', 24, 45], ['housing', 10, 20], ['harness', 3, 6], ['ammo_box', 4, 8]];
    if (tier >= 1) pool.push(['motor', 3, 6], ['motor', 3, 6]);
    if (tier >= 2) pool.push(['control_unit', 2, 5], ['control_unit', 2, 5]);
    const [item, lo, hi] = pool[Math.floor(this.rand() * pool.length)];
    const gov = this.rand() < 0.4;
    const names = gov ? BUYERS.government : BUYERS.private;
    const qty = lo + Math.floor(this.rand() * (hi - lo + 1));
    const bonus = gov ? 0.35 + this.rand() * 0.15 : 0.18 + this.rand() * 0.14;
    const minutes = gov ? 10 + this.rand() * 6 : 6 + this.rand() * 4;
    return {
      id: `c${this.contracts.nextId++}`, kind: gov ? 'government' : 'private', buyer: names[Math.floor(this.rand() * names.length)],
      item, qty, bonus: Math.round(bonus * 100) / 100, duration: Math.round(minutes * 60), offerExpires: this.time + 480, delivered: 0,
    };
  }

  contractBonus(c) { return Math.round(ITEMS[c.item].value * c.qty * c.bonus); }

  _accept(p, id) {
    const C = this.contracts;
    const i = C.offers.findIndex((o) => o.id === id);
    if (i < 0) return { ok: false, error: 'That offer is gone' };
    const slots = this.perks().contractSlots;
    if (C.active.length >= slots) return { ok: false, error: `You can run ${slots} contracts at a time` };
    const c = C.offers.splice(i, 1)[0];
    c.deadline = this.time + c.duration;
    c.owner = p.id;
    C.active.push(c);
    this.emit({ type: 'contracts' });
    return { ok: true, contract: c };
  }

  _creditContracts(type, count) {
    const C = this.contracts;
    for (const c of C.active) {
      if (c.item !== type || count <= 0) continue;
      const take = Math.min(count, c.qty - c.delivered);
      c.delivered += take;
      count -= take;
      if (c.delivered >= c.qty && !c.done) {
        c.done = true;
        const bonus = this.contractBonus(c);
        this._pay(bonus, c.owner);
        this._gainXp(bonus);
        this.stats.contracts++;
        this.emit({ type: 'contractDone', contract: c.id, buyer: c.buyer, bonus });
      }
    }
    C.active = C.active.filter((c) => !c.done);
    this.emit({ type: 'contracts' });
  }

  _stepContracts() {
    const C = this.contracts;
    let changed = false;
    for (const c of C.active) if (this.time > c.deadline) { c.failed = true; changed = true; this.emit({ type: 'contractFailed', contract: c.id, buyer: c.buyer }); }
    C.active = C.active.filter((c) => !c.failed);
    const before = C.offers.length;
    C.offers = C.offers.filter((o) => o.offerExpires > this.time);
    if (C.offers.length !== before) changed = true;
    if (this.time >= C.nextOfferAt && C.offers.length < 3) {
      C.offers.push(this._newOffer());
      C.nextOfferAt = this.time + (C.offers.length < 2 ? 5 : 45);
      changed = true;
    }
    if (changed) this.emit({ type: 'contracts' });
  }

  // ------------------------------------------------------------------ truck
  _setTruck(phase) {
    this.truck.phase = phase;
    this.truck.t0 = this.time;
    if (phase === 'dumping') { this.truck.manifest = this.pending.splice(0, this.pending.length); this.truck.dumped = 0; }
    this.emit({ type: 'truckPhase', phase, t0: this.time, manifest: phase === 'dumping' ? this.truck.manifest.length : undefined });
  }

  truckPose() { return truckPose(this.truck, this.time); }

  _stepTruck() {
    const T = this.truck;
    const t = this.time - T.t0;
    switch (T.phase) {
      case 'loading': if (t >= PHASE_TIME.loading) this._setTruck('inbound'); break;
      case 'inbound': if (t >= PHASE_TIME.inbound) this._setTruck('reversing'); break;
      case 'reversing': if (t >= PHASE_TIME.reversing) this._setTruck('opening'); break;
      case 'opening': if (t >= PHASE_TIME.opening) this._setTruck('dumping'); break;
      case 'dumping':
        while (T.dumped < T.manifest.length && t >= 0.2 + T.dumped * DUMP_INTERVAL) this._chuck(T.manifest[T.dumped++]);
        if (t >= dumpDuration(T.manifest.length)) this._setTruck('closing');
        break;
      case 'closing': if (t >= PHASE_TIME.closing) this._setTruck('outbound'); break;
      case 'outbound':
        if (t >= PHASE_TIME.outbound) { T.trips++; this._setTruck(this.pending.length ? 'loading' : 'idle'); }
        break;
    }
  }

  _chuck(stack) {
    const pose = this.truckPose();
    const rear = truckRear(pose);
    const k = this.nextItemId;
    const spread = (hash01(this.seed + 11, k) - 0.5) * 1.1;
    const cs = Math.cos(spread), sn = Math.sin(spread);
    const bx = rear.bx * cs - rear.bz * sn, bz = rear.bx * sn + rear.bz * cs;
    const heavy = ITEMS[stack.type].cat === 'kit' && stack.type !== 'conveyor';
    const sp = (heavy ? 1.6 : 2.4) + hash01(this.seed + 12, k) * 2.2;
    this.spawnItem(stack.type, stack.count, [rear.x, TRUCK.bedHeight + 0.2, rear.z],
      [bx * sp, 3.6 + hash01(this.seed + 13, k) * 1.8, bz * sp],
      { puff: true, owner: stack.owner, tumble: (hash01(this.seed + 14, k) - 0.5) * (heavy ? 5 : 14), spin: (hash01(this.seed + 15, k) - 0.5) * 10 });
    this.stats.delivered += stack.count;
    this.emit({ type: 'chuck', x: rear.x, y: TRUCK.bedHeight + 0.2, z: rear.z });
  }

  // ------------------------------------------------------------------ save / load
  serialize() {
    const players = {};
    for (const [id, p] of this.players) players[id] = { inv: p.inventory.toJSON(), wallet: p.wallet };
    // Goods in transit are saved where they'd end up, so quitting never loses anything:
    // stacks the truck hasn't dropped yet go back in the order queue, and stacks the
    // van hasn't loaded (and so hasn't paid for) go back in the cage.
    const T = this.truck, V = this.van;
    const pending = [...(T.phase === 'dumping' ? T.manifest.slice(T.dumped) : []), ...this.pending];
    const cage = [...this.cage, ...(V.phase === 'loading' ? V.manifest.slice(V.loaded) : [])];
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      v: 3, funds: this.funds, stats: this.stats, progress: this.progress, cage, players, pending,
      machines: [...this.machines.values()].map((m) => ({ type: m.type, x: m.x, z: m.z, q: m.q, auto: m.auto, outMode: m.outMode, buffer: m.buffer })),
      belts: [...this.belts.values()].map((b) => ({ x: b.x, z: b.z, q: b.q })),
      items: [...this.items.values()].map((it) => [it.type, it.count, r2(it.x), r2(it.y), r2(it.z), it.owner || null]),
    };
  }

  /** Restore machines, belts, funds and the cage from serialize() output. */
  load(data) {
    if (!data || data.v !== 3) return false;
    for (const id of [...this.machines.keys()]) this.removeMachine(id);
    for (const id of [...this.belts.keys()]) this.removeBelt(id);
    this.beltKeys.clear();
    this.funds = Number.isFinite(data.funds) ? data.funds : this.funds;
    this.stats = Object.assign(freshStats(), data.stats || {});
    this.progress = { xp: Number(data.progress?.xp) || 0, goals: Array.isArray(data.progress?.goals) ? data.progress.goals.filter((g) => GOALS.some((x) => x.id === g)) : [] };
    this.cage = Array.isArray(data.cage) ? data.cage.filter((s) => ITEMS[s.type]) : [];
    for (const m of data.machines || []) {
      if (!MACHINES[m.type] || !this.canPlace(m.type, m.x, m.z, m.q).ok) continue;
      const inst = this._createMachine(m.type, m.x, m.z, m.q);
      inst.auto = m.auto || null;
      inst.outMode = m.outMode === 'belt' ? 'belt' : 'tray';
      inst.buffer = m.buffer || {};
    }
    for (const b of data.belts || []) if (this.canPlace('conveyor', b.x, b.z, b.q).ok) this._createBelt(b.x, b.z, b.q);
    for (const id of [...this.items.keys()]) this._removeItem(id);
    for (const a of Array.isArray(data.items) ? data.items.slice(0, 2000) : []) {
      if (!Array.isArray(a) || !ITEMS[a[0]] || !(a[1] > 0)) continue;
      // items settle again from just above where they were (belts pick them back up)
      this.spawnItem(a[0], a[1] | 0, [a[2], a[3] + 0.05, a[4]], [0, 0, 0], { owner: a[5] || null, spin: 0 });
    }
    this.pending = Array.isArray(data.pending) ? data.pending.filter((st) => st && ITEMS[st.type] && st.count > 0) : [];
    if (this.pending.length && this.truck.phase === 'idle') this._setTruck('loading');
    return true;
  }

  /** Back to a brand-new factory (keeps connected players, empties their pockets). */
  reset() {
    this.load({ v: 3, funds: ECON.startFunds, stats: freshStats(), progress: { xp: 0, goals: [] }, cage: [], machines: FACTORY.starter, belts: [] });
    this.emit({ type: 'xp', xp: 0 });
    for (const p of this.players.values()) { p.inventory = new Inventory(24); p.wallet = 0; this.emit({ type: 'inventory', player: p.id }); this.emit({ type: 'wallet', player: p.id, wallet: 0, delta: 0 }); }
    for (const id of [...this.items.keys()]) this._removeItem(id);
    this.contracts.active = [];
    this.contracts.offers = [];
    this.contracts.nextOfferAt = this.time + 5;
    // Cancel anything already paid for / already sold that's still in transit — otherwise
    // a delivery truck or pickup van finishes its trip after the reset and either hands
    // over a paid order for free, or pays out cage value a second time (a money dupe).
    this.pending = [];
    this.truck = { phase: 'idle', t0: this.time, manifest: [], dumped: 0, trips: 0 };
    this.van = { phase: 'idle', t0: this.time, manifest: [], loaded: 0, trips: 0 };
    this.emit({ type: 'truckPhase', phase: 'idle', t0: this.time });
    this.emit({ type: 'vanPhase', phase: 'idle', t0: this.time });
    this.emit({ type: 'funds', funds: this.funds, delta: 0 });
  }

  // ------------------------------------------------------------------ tick
  tick(dt) {
    this.time += dt;
    this._stepTruck();
    this._stepVan();
    this._stepMachines();
    this._stepItems(dt);
    this._stepContracts();
    this._goalT += dt;
    if (this._goalT >= 0.25) { this._goalT = 0; this._checkGoals(); }
    const ev = this.events;
    this.events = [];
    return ev;
  }
}
