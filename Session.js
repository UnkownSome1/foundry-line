// Sessions give the game one interface whether the factory runs here (solo) or on the
// co-op server (host / guest):
//   sim            FactorySim to read from (authoritative locally, a replica online)
//   playerId       our id in that sim
//   command(c, cb) factory command; cb(result) runs now (solo) or when the server answers
//   update(dt)     advance; returns factory events for the view/HUD
import { FactorySim } from '../../shared/factory/FactorySim.js';
import { SIM_DT } from '../../shared/constants.js';
import {
  PROTO, INTERP_DELAY, encodeInput, applySelf, applyFull, applySlow, applyEvent, applyItems, applyInv, decodeRemote,
} from '../../shared/net/protocol.js';

export class LocalSession {
  constructor(world, save) {
    this.mode = 'solo';
    this.online = false;
    this.playerId = 'local';
    this.sim = new FactorySim(world, { seed: 7 });
    if (save && save.v === 3) this.sim.load(save);
    this.sim.addPlayer('local', save && save.players ? save.players.local : null);
    this.sim.events.length = 0; // the view builds from current state
    this.paused = false;
  }

  command(c, cb, pos) {
    const r = this.sim.apply(this.playerId, { ...c, pos });
    if (cb) cb(r);
    return r;
  }

  /** Solo: the factory ticks here at the fixed rate. */
  tick(playerPos) {
    if (this.paused) return [];
    this.sim.players.get(this.playerId).pos = playerPos;
    return this.sim.tick(SIM_DT);
  }

  update() { return []; }
  serialize() { return this.sim.serialize(); }
  dispose() { this.sim.dispose(); }
}

/** Where the co-op server lives: same origin when the page is served by it. */
export function defaultServerUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

/** Is this page being served by the Foundry Line server (so co-op can work)? */
export async function probeServer(timeoutMs = 2500) {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch('/api/info', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.server === 'foundry-line' ? j : null;
  } catch (_) { return null; }
}

export class NetSession {
  /**
   * @param world  client World (machine/belt colliders are mirrored into it)
   * @param opts   {url, host: save | null, code, name, color}
   */
  constructor(world, opts) {
    this.world = world;
    this.opts = opts;
    this.mode = opts.host ? 'host' : 'guest';
    this.online = true;
    this.sim = new FactorySim(world, { fresh: false });
    this.events = [];
    this.remotes = new Map(); // id → {name, color, buf:[{st, s}], lastFx}
    this.pendingInputs = [];
    this.outInputs = [];
    this.seq = 0;
    this.cmdId = 1;
    this.callbacks = new Map();
    this.clockOffset = null; // server time − local time
    this.localT = 0;
    this.rtt = 0.1;
    this.onSnapSelf = null; // (serverState, ack) → reconcile
    this.onFx = null;
    this.onPeer = null; // ('joined'|'left', info)
    this.onSave = null;
    this.onClosed = null;
    this.onInv = null;
    this.closed = false;
  }

  connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(to); fn(v); } };
      const to = setTimeout(() => { done(reject, new Error('The server did not answer. If it was asleep it can take about a minute to wake up — try again.')); try { this.ws.close(); } catch (_) { /* */ } }, timeoutMs);
      let ws;
      try { ws = this.ws = new WebSocket(this.opts.url); } catch (e) { done(reject, new Error('Could not open a connection to the co-op server.')); return; }
      ws.addEventListener('open', () => {
        const hello = { name: this.opts.name, color: this.opts.color, proto: PROTO };
        if (this.opts.host) this.send({ t: 'host', save: this.opts.host, ...hello });
        else this.send({ t: 'join', code: this.opts.code, ...hello });
      });
      ws.addEventListener('message', (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (_) { return; }
        if (m.t === 'welcome') { this._welcome(m); done(resolve, m); return; }
        if (m.t === 'err') { done(reject, new Error(m.msg)); return; }
        this._message(m);
      });
      ws.addEventListener('close', () => {
        if (!settled) done(reject, new Error('Connection to the co-op server failed.'));
        else if (!this.closed) { this.closed = true; if (this.onClosed) this.onClosed(this.closeReason || 'Lost connection to the co-op server'); }
      });
    });
  }

  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  _welcome(m) {
    this.playerId = m.you;
    this.code = m.code;
    this.isHost = m.host;
    this.spawn = m.spawn;
    this.sim.addPlayer(m.you);
    applyFull(this.sim, m.full);
    applyInv(this.sim, m.you, m.inv);
    this.clockOffset = m.st - this.localT;
    for (const p of m.players) this.remotes.set(p.id, { ...p, buf: [] });
    this._pingT = 0;
  }

  _message(m) {
    switch (m.t) {
      case 'snap': {
        this._clock(m.st);
        applyItems(this.sim, m.it, !!m.full);
        const drop = this.pendingInputs.findIndex((p) => p.seq > m.ack);
        this.pendingInputs = drop < 0 ? [] : this.pendingInputs.slice(drop);
        if (this.onSnapSelf) this.onSnapSelf(m.me, m.ack, this.pendingInputs);
        for (const a of m.ps) {
          const s = decodeRemote(a);
          const r = this.remotes.get(s.id);
          if (!r) continue;
          r.buf.push({ st: m.st, s });
          if (r.buf.length > 30) r.buf.shift();
        }
        break;
      }
      case 'ev':
        for (const e of m.e) { applyEvent(this.sim, e); this.events.push(e); }
        break;
      case 'fs': applySlow(this.sim, m.s); this.events.push({ type: 'state' }); break;
      case 'inv': applyInv(this.sim, this.playerId, m); this.events.push({ type: 'inventory', player: this.playerId }); if (this.onInv) this.onInv(); break;
      case 'res': { const cb = this.callbacks.get(m.id); this.callbacks.delete(m.id); if (cb) cb(m.r || { ok: false, error: 'No answer' }); break; }
      case 'fx': if (this.onFx) this.onFx(m); break;
      case 'joined': this.remotes.set(m.id, { id: m.id, name: m.name, color: m.color, buf: [] }); if (this.onPeer) this.onPeer('joined', m); break;
      case 'left': this.remotes.delete(m.id); if (this.onPeer) this.onPeer('left', m); break;
      case 'save': if (this.onSave) this.onSave(m.data); break;
      case 'pong': {
        const rtt = (performance.now() - m.ts) / 1000;
        this.rtt = this.rtt * 0.8 + rtt * 0.2;
        break;
      }
      case 'closed': this.closeReason = m.reason; break;
    }
  }

  /** Keep a smoothed estimate of the server clock. */
  _clock(st) {
    const off = st + this.rtt / 2 - this.localT;
    if (this.clockOffset == null || Math.abs(off - this.clockOffset) > 1) this.clockOffset = off;
    else this.clockOffset += (off - this.clockOffset) * 0.05;
  }

  get serverTime() { return this.localT + (this.clockOffset || 0); }

  command(c, cb) {
    const id = this.cmdId++;
    if (cb) this.callbacks.set(id, cb);
    this.send({ t: 'cmd', id, c });
    return { ok: true, pending: true };
  }

  /** Record one predicted movement input; sent in small batches. */
  input(cmd) {
    const seq = ++this.seq;
    this.pendingInputs.push({ seq, cmd: { ...cmd } });
    if (this.pendingInputs.length > 240) this.pendingInputs.shift();
    this.outInputs.push(encodeInput(seq, cmd));
    if (this.outInputs.length >= 2) this.flushInputs();
    return seq;
  }

  flushInputs() {
    if (!this.outInputs.length) return;
    this.send({ t: 'in', b: this.outInputs });
    this.outInputs = [];
  }

  fx(msg) { this.send({ t: 'fx', ...msg }); }

  tick() { return []; }

  /** Per frame: advance the replica clock, glide items to their server positions. */
  update(dt) {
    this.localT += dt;
    this.sim.time = this.serverTime;
    const k = 1 - Math.exp(-dt * 18);
    for (const it of this.sim.items.values()) {
      if (it.tx === undefined) continue;
      if (it.isNew) { it.x = it.tx; it.y = it.ty; it.z = it.tz; it.isNew = false; continue; }
      const dx = it.tx - it.x, dy = it.ty - it.y, dz = it.tz - it.z;
      if (dx * dx + dy * dy + dz * dz > 9) { it.x = it.tx; it.y = it.ty; it.z = it.tz; }
      else { it.x += dx * k; it.y += dy * k; it.z += dz * k; }
    }
    this._pingT = (this._pingT || 0) - dt;
    if (this._pingT <= 0) { this._pingT = 2; this.send({ t: 'ping', ts: performance.now() }); }
    const ev = this.events;
    this.events = [];
    return ev;
  }

  /** Interpolated state of each remote player, INTERP_DELAY behind the server. */
  remoteStates() {
    const t = this.serverTime - INTERP_DELAY;
    const out = [];
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let a = b[0], c = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].st <= t && b[i + 1].st >= t) { a = b[i]; c = b[i + 1]; break; }
      const u = c.st > a.st ? Math.max(0, Math.min(1, (t - a.st) / (c.st - a.st))) : 1;
      const L = (p, q) => p + (q - p) * u;
      let dyaw = c.s.yaw - a.s.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      out.push({
        id: r.id, name: r.name, color: r.color,
        x: L(a.s.x, c.s.x), y: L(a.s.y, c.s.y), z: L(a.s.z, c.s.z),
        yaw: a.s.yaw + dyaw * u, pitch: L(a.s.pitch, c.s.pitch), crouch: L(a.s.crouch, c.s.crouch),
        vx: c.s.vx, vz: c.s.vz, grounded: c.s.grounded, sprint: c.s.sprint,
      });
    }
    return out;
  }

  sendReserve(n) { this.send({ t: 'reserve', n }); }

  leave() {
    this.flushInputs();
    this.send({ t: 'leave' });
    this.closed = true;
    // the server sends the host's final save and then closes the socket itself;
    // this is only a fallback if it never does
    setTimeout(() => { try { this.ws.close(); } catch (_) { /* */ } }, 4000);
  }

  dispose() {
    this.closed = true;
    try { this.ws && this.ws.close(); } catch (_) { /* */ }
    this.sim.dispose();
  }
}

export { applySelf };
