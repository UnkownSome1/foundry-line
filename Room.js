// One co-op session: the host's factory running authoritatively at 60 Hz, plus up to
// MAX_PLAYERS connected players. Clients predict their own movement and send inputs;
// the room replays them with the same shared code and sends back where they really are.
import { World } from '../src/shared/World.js';
import { FactorySim } from '../src/shared/factory/FactorySim.js';
import { createPlayerState, stepPlayer } from '../src/shared/PlayerMovement.js';
import { pushFromVehicles } from '../src/shared/vehiclePush.js';
import { SPAWN } from '../src/shared/mapLayout.js';
import { SIM_DT } from '../src/shared/constants.js';
import {
  PROTO, MAX_PLAYERS, SNAP_EVERY, SLOW_EVERY, SAVE_EVERY, cleanName, cleanColor,
  encodeSelf, encodeRemote, decodeInput, encodeItem, encodeSlow, encodeFull, encodeInv,
} from '../src/shared/net/protocol.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const STRUCTURAL = new Set(['machinePlaced', 'machineRemoved', 'beltPlaced', 'beltRemoved', 'machineStart', 'machineDone', 'machineIdle', 'machineState', 'machineFed',
  'truckPhase', 'vanPhase', 'contracts', 'contractDone', 'contractFailed', 'deposit', 'vanPaid', 'levelUp', 'goalDone', 'ordered']);
const ALLOWED_CMDS = new Set(['order', 'pickup', 'drop', 'run', 'scrap', 'use', 'move', 'place', 'pack', 'packBelt', 'auto', 'output', 'unload', 'deposit', 'callVan', 'accept']);

export function makeCode(taken) {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!taken.has(c)) return c;
  }
}

export class Room {
  constructor(code, hostSocket, hello, log = () => {}) {
    this.code = code;
    this.log = log;
    this.world = new World();
    this.sim = new FactorySim(this.world, { seed: 7 });
    const save = hello.save && hello.save.v === 3 ? hello.save : null;
    if (save) this.sim.load(save);
    // Saved players are keyed 'local' (the host) and 'guest:<name>'.
    this.savedPlayers = (save && save.players) || {};
    this.players = new Map();
    this.tickN = 0;
    this.saveT = SAVE_EVERY;
    this.dirty = true;
    this.slowDirty = true;
    this.closed = false;
    this.hostId = 'local';
    this.hostReserve = save && Number.isFinite(save.reserve) ? save.reserve : null;
    this.sim.events.length = 0;
    this.add(hostSocket, { ...hello, id: 'local' });
  }

  get size() { return this.players.size; }

  /** Connect a socket as player `id` (host = 'local', guests = 'guest:<name>'). */
  add(ws, hello) {
    const name = cleanName(hello.name);
    let id = hello.id;
    if (!id) {
      id = `guest:${name}`;
      let n = 2;
      while (this.players.has(id)) id = `guest:${name}${n++}`;
    }
    if (!this.sim.players.has(id)) this.sim.addPlayer(id, this.savedPlayers[id] || null);
    const st = createPlayerState(SPAWN.x + (this.players.size ? 1.5 : 0), 0, SPAWN.z, SPAWN.yaw);
    const pl = { id, ws, name, color: cleanColor(hello.color), st, queue: [], ack: -1, budget: 4, invDirty: true, lastIn: Date.now() };
    this.players.set(id, pl);
    this.sim.players.get(id).pos = [st.x, st.y, st.z];
    ws.send({
      t: 'welcome', proto: PROTO, you: id, code: this.code, host: id === this.hostId, st: this.sim.time,
      spawn: encodeSelf(st), full: encodeFull(this.sim), inv: encodeInv(this.sim.players.get(id)),
      players: [...this.players.values()].filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name, color: p.color })),
    });
    this.broadcast({ t: 'joined', id, name, color: pl.color }, id);
    ws.on('message', (m) => this.onMessage(pl, m));
    ws.on('close', () => this.remove(pl, 'disconnected'));
    this.log(`room ${this.code}: ${name} joined as ${id} (${this.players.size}/${MAX_PLAYERS})`);
    return pl;
  }

  remove(pl, why) {
    if (!this.players.has(pl.id)) return;
    this.players.delete(pl.id);
    this.broadcast({ t: 'left', id: pl.id, name: pl.name });
    this.log(`room ${this.code}: ${pl.name} left (${why})`);
    if (pl.id === this.hostId) this.close('The host left the session');
    else this.dirty = true;
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.players.values()) { p.ws.send({ t: 'closed', reason }); p.ws.close(1000, 'room closed'); }
    this.players.clear();
    this.sim.dispose();
    this.log(`room ${this.code} closed: ${reason}`);
  }

  broadcast(msg, except = null) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.id !== except) p.ws.send(s);
  }

  // ------------------------------------------------------------------ messages
  onMessage(pl, m) {
    switch (m.t) {
      case 'in':
        if (!Array.isArray(m.b)) return;
        pl.lastIn = Date.now();
        for (const a of m.b.slice(0, 30)) {
          const inp = decodeInput(a);
          if (inp && inp.seq > pl.ack && (pl.queue.length === 0 || inp.seq > pl.queue[pl.queue.length - 1].seq)) pl.queue.push(inp);
        }
        if (pl.queue.length > 90) pl.queue.splice(0, pl.queue.length - 90); // hopelessly behind: drop the oldest
        return;
      case 'cmd': this.onCommand(pl, m); return;
      case 'fx':
        if (JSON.stringify(m).length < 600) this.broadcast({ ...m, from: pl.id }, pl.id);
        return;
      case 'ping': pl.ws.send({ t: 'pong', ts: m.ts, st: this.sim.time }); return;
      case 'reserve': if (pl.id === this.hostId && Number.isFinite(m.n)) this.hostReserve = m.n; return;
      case 'leave':
        if (pl.id === this.hostId) { this.sendSave(); this.close('The host ended the session'); }
        else { this.remove(pl, 'left'); pl.ws.close(1000, 'bye'); }
        return;
    }
  }

  onCommand(pl, m) {
    const c = m.c;
    let r;
    if (!c || typeof c !== 'object' || !ALLOWED_CMDS.has(c.type)) r = { ok: false, error: 'Unknown command' };
    else {
      const cmd = { ...c };
      delete cmd.pos; // positions come from the server's own copy of the player, never the client
      const s = pl.st;
      if (cmd.type === 'drop') {
        // keep dropped items near the player and thrown at a sane speed
        const eye = [s.x, s.y + 1.3, s.z];
        const at = Array.isArray(cmd.at) ? cmd.at.map(Number) : eye;
        const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
        cmd.at = d > 2 || at.some((v) => !Number.isFinite(v)) ? eye : at;
        const v = Array.isArray(cmd.vel) ? cmd.vel.map(Number) : [0, 1, 0];
        const sp = Math.hypot(...v) || 1;
        cmd.vel = v.map((x) => (Number.isFinite(x) ? x * Math.min(1, 6 / sp) : 0));
      }
      this.sim.players.get(pl.id).pos = [s.x, s.y, s.z];
      try { r = this.sim.apply(pl.id, cmd); } catch (err) { r = { ok: false, error: 'Server error' }; this.log(`cmd error ${err.stack}`); }
      this.dirty = true;
      this.slowDirty = true;
    }
    pl.ws.send({ t: 'res', id: m.id, r });
  }

  // ------------------------------------------------------------------ tick
  tick() {
    if (this.closed) return;
    this.tickN++;
    // movement: replay each player's inputs with the shared movement code
    for (const pl of this.players.values()) {
      pl.budget = Math.min(pl.budget + 1, 8); // never faster than real time (+ a little jitter slack)
      while (pl.queue.length && pl.budget >= 1) {
        const inp = pl.queue.shift();
        stepPlayer(pl.st, inp.cmd, this.world, SIM_DT);
        pushFromVehicles(pl.st, this.sim);
        pl.ack = inp.seq;
        pl.budget -= 1;
      }
      pl.st.yaw = pl.st.yaw ?? 0;
      this.sim.players.get(pl.id).pos = [pl.st.x, pl.st.y, pl.st.z];
    }
    // factory
    const events = this.sim.tick(SIM_DT);
    const relay = [];
    for (const e of events) {
      if (e.type === 'inventory') { const p = this.players.get(e.player); if (p) p.invDirty = true; continue; }
      relay.push(e);
      if (STRUCTURAL.has(e.type)) this.slowDirty = true;
      if (e.type !== 'itemBounce') this.dirty = true;
    }
    if (relay.length) this.broadcast({ t: 'ev', st: this.sim.time, e: relay });
    for (const pl of this.players.values()) {
      if (pl.invDirty) { pl.invDirty = false; pl.ws.send(encodeInv(this.sim.players.get(pl.id))); }
    }
    if (this.tickN % SNAP_EVERY === 0) this.sendSnapshots();
    if (this.tickN % SLOW_EVERY === 0 || (this.slowDirty && this.tickN % SNAP_EVERY === 0)) {
      this.slowDirty = false;
      this.broadcast({ t: 'fs', s: encodeSlow(this.sim) });
    }
    this.saveT -= SIM_DT;
    if (this.saveT <= 0) { this.saveT = SAVE_EVERY; if (this.dirty) this.sendSave(); }
  }

  sendSnapshots() {
    // items: everything that moved since the last snapshot, plus a full list every 2 s
    const full = this.tickN % 120 === 0;
    const items = [];
    for (const it of this.sim.items.values()) {
      const moved = it._sx !== it.x || it._sy !== it.y || it._sz !== it.z || it._sc !== it.count;
      if (full || moved) items.push(encodeItem(it));
      it._sx = it.x; it._sy = it.y; it._sz = it.z; it._sc = it.count;
    }
    const others = [...this.players.values()].map((p) => encodeRemote(p.id, p.st));
    for (const pl of this.players.values()) {
      pl.ws.send({
        t: 'snap', st: this.sim.time, ack: pl.ack, me: encodeSelf(pl.st),
        ps: others.filter((o) => o[0] !== pl.id), it: items, full: full ? 1 : 0,
      });
    }
  }

  /** The host keeps the save: serialize with saved-player keys and send it to them. */
  sendSave() {
    const host = this.players.get(this.hostId);
    if (!host) return;
    const data = this.sim.serialize();
    data.players = { ...this.savedPlayers, ...data.players };
    if (this.hostReserve != null) data.reserve = this.hostReserve;
    host.ws.send({ t: 'save', data });
    this.dirty = false;
  }
}
