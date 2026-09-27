// Wire format shared by the Node server and the browser client. JSON messages with a
// short `t` type field; numbers are rounded to keep packets small.
//
// Client → server
//   {t:'host', save, name, color}        start a room on the host's save
//   {t:'join', code, name, color}        join a room by code
//   {t:'in', b:[input, …]}                movement inputs (one per 60 Hz tick, batched)
//   {t:'cmd', id, c}                      factory command → answered by {t:'res', id, r}
//   {t:'fx', k, …}                        cosmetic weapon events relayed to the others
//   {t:'ping', ts}                        clock sync → {t:'pong', ts, st}
//   {t:'leave'}                           host: final save then close the room
// Server → client
//   welcome · joined · left · snap (20 Hz) · ev (factory events) · fs (factory state, 5 Hz)
//   inv (your inventory) · res · fx · save (to the host) · closed · err
import { ITEMS, MACHINES } from '../factory/items.js';
import { Inventory } from '../factory/Inventory.js';

export const PROTO = 4;
export const MAX_PLAYERS = 2;
export const SNAP_EVERY = 3; // ticks → 20 Hz
export const SLOW_EVERY = 12; // ticks → 5 Hz
export const SAVE_EVERY = 10; // seconds
export const INTERP_DELAY = 0.1; // remote players render 100 ms in the past

const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;

export const cleanName = (s) => String(s || '').replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 16) || 'Worker';
export const cleanColor = (c) => (Number.isInteger(c) && c >= 0 && c <= 0xffffff ? c : 0xff6b1a);

// ------------------------------------------------------------------ players
const PLAYER_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'groundTime'];
/** Full physics state of your own player, for reconciliation. */
export function encodeSelf(s) {
  return [...PLAYER_KEYS.map((k) => r3(s[k] || 0)), s.grounded ? 1 : 0, s.sprinting ? 1 : 0];
}
export function applySelf(s, a) {
  PLAYER_KEYS.forEach((k, i) => { s[k] = a[i]; });
  s.grounded = !!a[PLAYER_KEYS.length];
  s.sprinting = !!a[PLAYER_KEYS.length + 1];
  return s;
}
/** What others need to draw you. */
export function encodeRemote(id, s) {
  return [id, r2(s.x), r2(s.y), r2(s.z), r3(s.yaw), r3(s.pitch), r2(s.crouch), r2(s.vx), r2(s.vz), s.grounded ? 1 : 0, s.sprinting ? 1 : 0];
}
export function decodeRemote(a) {
  return { id: a[0], x: a[1], y: a[2], z: a[3], yaw: a[4], pitch: a[5], crouch: a[6], vx: a[7], vz: a[8], grounded: !!a[9], sprint: !!a[10] };
}

// ------------------------------------------------------------------ inputs
export function encodeInput(seq, c) {
  const f = (c.jump ? 1 : 0) | (c.sprint ? 2 : 0) | (c.crouch ? 4 : 0) | (c.aim ? 8 : 0);
  return [seq, c.forward, c.strafe, f, r3(c.yaw), r3(c.pitch)];
}
export function decodeInput(a) {
  if (!Array.isArray(a) || a.length < 6) return null;
  const n = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
  return {
    seq: a[0] | 0,
    cmd: {
      forward: n(a[1], -1, 1), strafe: n(a[2], -1, 1),
      jump: !!(a[3] & 1), sprint: !!(a[3] & 2), crouch: !!(a[3] & 4), aim: !!(a[3] & 8),
      yaw: n(a[4], -1e6, 1e6), pitch: n(a[5], -1.6, 1.6),
    },
  };
}

// ------------------------------------------------------------------ factory items
export function encodeItem(it) {
  return [it.id, it.type, it.count, r2(it.x), r2(it.y), r2(it.z), r2(it.ry), r2(it.tumble), it.rest ? 1 : 0, it.belt || 0, it.owner || 0];
}

function upsertItem(sim, a) {
  let it = sim.items.get(a[0]);
  if (!it) {
    it = { id: a[0], type: a[1], count: a[2], x: a[3], y: a[4], z: a[5], r: ITEMS[a[1]] ? ITEMS[a[1]].r : 0.2, vx: 0, vy: 0, vz: 0, spin: 0, tumbleV: 0, suck: 0 };
    sim.items.set(it.id, it);
    it.isNew = true;
  }
  it.count = a[2];
  it.tx = a[3]; it.ty = a[4]; it.tz = a[5];
  it.ry = a[6]; it.tumble = a[7]; it.rest = !!a[8]; it.belt = a[9] || null; it.owner = a[10] || null;
  return it;
}

/** Items list → replica. `full` removes anything the server no longer has. */
export function applyItems(sim, list, full = false) {
  const seen = full ? new Set() : null;
  for (const a of list) { upsertItem(sim, a); if (seen) seen.add(a[0]); }
  if (full) for (const id of [...sim.items.keys()]) if (!seen.has(id)) sim.items.delete(id);
}

// ------------------------------------------------------------------ factory state
/** Everything that changes slowly or in bursts: money, progress, vehicles, machine status. */
export function encodeSlow(sim) {
  const machines = {};
  for (const m of sim.machines.values()) {
    const c = m.current;
    machines[m.id] = [c ? c.recipe.id : null, c ? r3(c.start) : 0, c ? r3(c.end) : 0, c && c.auto ? 1 : 0, m.queue.length, m.auto, m.outMode, m.buffer, m.outBuffer.length];
  }
  const wallets = {};
  for (const [id, p] of sim.players) wallets[id] = p.wallet;
  const T = sim.truck, V = sim.van;
  return {
    time: r3(sim.time), funds: sim.funds, stats: sim.stats, progress: sim.progress, cage: sim.cage,
    contracts: { offers: sim.contracts.offers, active: sim.contracts.active },
    truck: { phase: T.phase, t0: r3(T.t0), manifest: T.manifest, dumped: T.dumped, trips: T.trips },
    pending: sim.pending.length,
    van: { phase: V.phase, t0: r3(V.t0), manifest: V.manifest, loaded: V.loaded, interval: V.interval || 0, trips: V.trips },
    machines, wallets,
  };
}

export function applySlow(sim, s) {
  sim.funds = s.funds;
  sim.stats = s.stats;
  sim.progress = s.progress;
  sim.cage = s.cage;
  sim.contracts.offers = s.contracts.offers;
  sim.contracts.active = s.contracts.active;
  Object.assign(sim.truck, s.truck);
  sim.pending = new Array(s.pending).fill(null);
  Object.assign(sim.van, s.van);
  for (const [id, a] of Object.entries(s.machines)) {
    const m = sim.machines.get(id);
    if (!m) continue;
    const recipe = a[0] ? m.def.recipes.find((r) => r.id === a[0]) : null;
    m.current = recipe ? { recipe, start: a[1], end: a[2], auto: !!a[3] } : null;
    m.queue = new Array(a[4]).fill(null);
    m.auto = a[5];
    m.outMode = a[6];
    m.buffer = a[7] || {};
    m.outBuffer = new Array(a[8]).fill(null);
  }
  for (const [id, w] of Object.entries(s.wallets)) {
    if (!sim.players.has(id)) sim.addPlayer(id);
    sim.players.get(id).wallet = w;
  }
}

/** Full picture for a player who just joined. */
export function encodeFull(sim) {
  return {
    machines: [...sim.machines.values()].map((m) => [m.id, m.type, m.x, m.z, m.q]),
    belts: [...sim.belts.values()].map((b) => [b.id, b.x, b.z, b.q]),
    items: [...sim.items.values()].map(encodeItem),
    slow: encodeSlow(sim),
  };
}

export function applyFull(sim, f) {
  sim.dispose();
  for (const [id, type, x, z, q] of f.machines) if (MACHINES[type]) sim._createMachine(type, x, z, q, id);
  for (const [id, x, z, q] of f.belts) sim._createBelt(x, z, q, id);
  applyItems(sim, f.items, true);
  for (const it of sim.items.values()) { it.x = it.tx; it.y = it.ty; it.z = it.tz; }
  applySlow(sim, f.slow);
  sim.time = f.slow.time;
  sim.events.length = 0;
}

/**
 * Apply a relayed server event to the replica before the view sees it, so structural
 * changes (machines, belts, items, money) are already in place when it redraws.
 */
export function applyEvent(sim, e) {
  switch (e.type) {
    case 'machinePlaced': if (!sim.machines.has(e.id) && MACHINES[e.machine]) sim._createMachine(e.machine, e.x, e.z, e.q, e.id); break;
    case 'machineRemoved': sim.removeMachine(e.id); break;
    case 'beltPlaced': if (!sim.belts.has(e.id)) sim._createBelt(e.x, e.z, e.q, e.id); break;
    case 'beltRemoved': sim.removeBelt(e.id); break;
    case 'itemSpawn':
      if (!sim.items.has(e.id)) {
        const it = upsertItem(sim, [e.id, e.item, e.count, e.x, e.y, e.z, 0, 0, 0, 0, 0]);
        it.x = e.x; it.y = e.y; it.z = e.z; it.isNew = false;
      }
      break;
    case 'itemRemove': sim.items.delete(e.id); break;
    case 'itemCount': { const it = sim.items.get(e.id); if (it) it.count = e.count; break; }
    case 'funds': sim.funds = e.funds; break;
    case 'wallet': { const p = sim.players.get(e.player); if (p) p.wallet = e.wallet; break; }
    case 'xp': sim.progress.xp = e.xp; break;
    case 'goalDone': if (!sim.progress.goals.includes(e.goal)) sim.progress.goals.push(e.goal); break;
  }
  sim.events.length = 0; // replica bookkeeping never reaches the view twice
}

/** Inventory message for one player. */
export const encodeInv = (p) => ({ t: 'inv', inv: p.inventory.toJSON(), wallet: p.wallet });
export function applyInv(sim, playerId, msg) {
  if (!sim.players.has(playerId)) sim.addPlayer(playerId);
  const p = sim.players.get(playerId);
  p.inventory = Inventory.fromJSON(msg.inv, 24);
  p.wallet = msg.wallet;
}
