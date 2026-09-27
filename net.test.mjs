// End-to-end co-op test: starts the real server, connects a host and a guest over
// WebSocket, and checks movement prediction, factory sync, commands and save hand-back.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { World } from '../src/shared/World.js';
import { FactorySim } from '../src/shared/factory/FactorySim.js';
import { createPlayerState, stepPlayer } from '../src/shared/PlayerMovement.js';
import { pushFromVehicles } from '../src/shared/vehiclePush.js';
import { SIM_DT } from '../src/shared/constants.js';
import { encodeInput, applySelf, applyFull, applySlow, applyEvent, applyItems, applyInv, decodeRemote } from '../src/shared/net/protocol.js';

const PORT = 8800 + Math.floor(Math.random() * 100);
const srv = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (e) => { console.error(e); console.error('--- server log ---\n' + srvLog); srv.kill(); process.exit(1); };
process.on('unhandledRejection', fail);

for (let i = 0; i < 50 && !srvLog.includes('server'); i++) await sleep(100);

/** A minimal headless client: socket + factory replica + message log. */
function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, name, msgs: [], replica: null, world: null, id: null, res: new Map(), nextCmd: 1 };
  c.ready = new Promise((resolve) => ws.addEventListener('open', resolve));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    c.msgs.push(m);
    switch (m.t) {
      case 'welcome':
        c.id = m.you; c.code = m.code;
        c.world = new World();
        c.replica = new FactorySim(c.world, { fresh: false });
        c.replica.addPlayer(m.you);
        applyFull(c.replica, m.full);
        applyInv(c.replica, m.you, m.inv);
        c.spawn = m.spawn;
        break;
      case 'ev': if (c.replica) for (const e of m.e) applyEvent(c.replica, e); break;
      case 'fs': if (c.replica) applySlow(c.replica, m.s); break;
      case 'inv': if (c.replica) applyInv(c.replica, c.id, m); break;
      case 'snap': if (c.replica) { applyItems(c.replica, m.it, !!m.full); c.lastSnap = m; } break;
      case 'res': c.res.set(m.id, m.r); break;
    }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.cmd = async (cmd) => {
    const id = c.nextCmd++;
    c.send({ t: 'cmd', id, c: cmd });
    for (let i = 0; i < 100 && !c.res.has(id); i++) await sleep(20);
    return c.res.get(id);
  };
  c.wait = async (pred, ms = 3000) => {
    const t0 = Date.now();
    for (;;) {
      const m = c.msgs.find(pred);
      if (m) return m;
      if (Date.now() - t0 > ms) throw new Error(`${name}: timed out waiting`);
      await sleep(15);
    }
  };
  return c;
}

// --- host with a save that has money and a bit of history
const saveSim = new FactorySim(new World(), { seed: 7 });
saveSim.funds = 5000;
saveSim.addPlayer('local').inventory.add('steel_plate', 12);
saveSim.progress.xp = 350;
const hostSave = { ...saveSim.serialize(), reserve: 77 };

const host = client('host');
await host.ready;
host.send({ t: 'host', save: hostSave, name: 'Hosty', color: 0x2fb5c9 });
const hw = await host.wait((m) => m.t === 'welcome');
assert.equal(hw.host, true);
assert.equal(hw.you, 'local');
assert.match(hw.code, /^[A-Z0-9]{4}$/);
assert.equal(host.replica.funds, 5000, 'host save loaded on the server');
assert.equal(host.replica.progress.xp, 350);
assert.equal(host.replica.machines.size, 1, 'fab bench replicated');
assert.equal(host.replica.players.get('local').inventory.count('steel_plate'), 12, 'host inventory from their save');
console.log(`host room ${hw.code}`);

// --- guest joins by code
const bad = client('lost');
await bad.ready;
bad.send({ t: 'join', code: 'ZZZZ', name: 'Lost' });
const err = await bad.wait((m) => m.t === 'err');
assert.match(err.msg, /No co-op session/);
bad.ws.close();

const guest = client('guest');
await guest.ready;
guest.send({ t: 'join', code: hw.code.toLowerCase(), name: 'Gus', color: 0xff6b1a });
const gw = await guest.wait((m) => m.t === 'welcome');
assert.equal(gw.host, false);
assert.equal(gw.you, 'guest:Gus');
assert.deepEqual(gw.players.map((p) => p.name), ['Hosty']);
await host.wait((m) => m.t === 'joined' && m.name === 'Gus');
assert.equal(guest.replica.funds, 5000);

// a third player is turned away (2-player sessions)
const third = client('third');
await third.ready;
third.send({ t: 'join', code: hw.code, name: 'Tri' });
assert.match((await third.wait((m) => m.t === 'err')).msg, /full/);
third.ws.close();

// --- movement: the host walks forward; client-side prediction must match the server
const pred = applySelf(createPlayerState(), hw.spawn);
const inputs = [];
for (let seq = 1; seq <= 90; seq++) {
  const cmd = { forward: 1, strafe: seq > 45 ? 1 : 0, jump: seq === 30, sprint: true, crouch: false, aim: false, yaw: 0.3, pitch: 0 };
  inputs.push(encodeInput(seq, cmd));
  stepPlayer(pred, cmd, host.world, SIM_DT);
  pushFromVehicles(pred, host.replica);
}
for (let i = 0; i < inputs.length; i += 3) { host.send({ t: 'in', b: inputs.slice(i, i + 3) }); await sleep(8); }
const snap = await host.wait((m) => m.t === 'snap' && m.ack === 90, 4000);
const srvState = applySelf(createPlayerState(), snap.me);
const err2 = Math.hypot(srvState.x - pred.x, srvState.y - pred.y, srvState.z - pred.z);
console.log(`prediction error after 90 inputs: ${err2.toFixed(4)} m (moved ${Math.hypot(pred.x - hw.spawn[0], pred.z - hw.spawn[2]).toFixed(2)} m)`);
assert.ok(err2 < 0.01, 'client prediction matches the authoritative server');
// the guest sees the host where the server has them
const gs = await guest.wait((m) => m.t === 'snap' && m.ps.length && Math.abs(decodeRemote(m.ps[0]).x - srvState.x) < 0.02, 3000);
assert.equal(decodeRemote(gs.ps[0]).id, 'local');

// speed-hack guard: flooding inputs can't move faster than real time
const before = { ...srvState };
const flood = [];
for (let seq = 91; seq <= 400; seq++) flood.push(encodeInput(seq, { forward: 1, strafe: 0, jump: false, sprint: true, crouch: false, aim: false, yaw: 0.3, pitch: 0 }));
host.send({ t: 'in', b: flood.slice(0, 30) });
const t0 = Date.now();
await sleep(250);
const s2 = host.msgs.filter((m) => m.t === 'snap').pop();
const moved = Math.hypot(s2.me[0] - before.x, s2.me[2] - before.z);
const maxMove = 7.2 * ((Date.now() - t0) / 1000 + 0.2);
assert.ok(moved <= maxMove, `no speed hack: moved ${moved.toFixed(2)} m, limit ${maxMove.toFixed(2)} m`);

// --- factory commands from the guest are authoritative and reach both replicas
const f0 = guest.replica.funds;
const r = await guest.cmd({ type: 'order', items: { steel_plate: 5 } });
assert.ok(r.ok, r.error);
await sleep(300);
const goal = guest.msgs.find((m) => m.t === 'ev' && m.e.some((e) => e.type === 'goalDone' && e.goal === 'order'));
assert.ok(goal, 'first order pays the "Place an order" goal');
const expectFunds = f0 - r.total + 60;
assert.equal(guest.replica.funds, expectFunds, 'guest replica updated');
assert.equal(host.replica.funds, expectFunds, 'host replica updated');
assert.notEqual(host.replica.truck.phase, 'idle', 'truck dispatched on both');
// the client can't cheat its position into a command
const far = await guest.cmd({ type: 'deposit', pos: [17.5, 0, -7.5] });
assert.equal(far.ok, false, 'server ignores client-supplied positions');
const junk = await guest.cmd({ type: 'giveMeMoney' });
assert.equal(junk.ok, false);

// --- fx relay (shots) reach the other player only
host.send({ t: 'fx', k: 'shot', o: [0, 1.6, 0], p: [0, 1.6, -10], s: 'concrete' });
const fx = await guest.wait((m) => m.t === 'fx' && m.k === 'shot');
assert.equal(fx.from, 'local');

// --- host inventory command
const hostDrop = await host.cmd({ type: 'drop', slot: 0, count: 2, at: [999, 999, 999], vel: [500, 0, 0] });
assert.ok(hostDrop.ok);
await sleep(200);
assert.equal(host.replica.players.get('local').inventory.count('steel_plate'), 10);
const dropped = [...guest.replica.items.values()].find((it) => it.type === 'steel_plate');
assert.ok(dropped, 'dropped item replicated to the guest');
assert.ok(Math.hypot(dropped.tx - srvState.x, dropped.tz - srvState.z) < 25, 'far-away drop position was clamped');

// --- host ends the session: final save goes to the host, the guest is told
host.send({ t: 'reserve', n: 42 });
host.send({ t: 'leave' });
const save = await host.wait((m) => m.t === 'save');
assert.equal(save.data.v, 3);
assert.equal(save.data.funds, expectFunds);
assert.equal(save.data.reserve, 42);
assert.ok(save.data.players.local && save.data.players['guest:Gus'], 'both players stored in the host save');
assert.equal(save.data.progress.xp, 350);
const closed = await guest.wait((m) => m.t === 'closed');
assert.match(closed.reason, /host/i);

// the saved guest keeps their stuff next time they join the same host save
const sim3 = new FactorySim(new World(), { seed: 7 });
assert.ok(sim3.load(save.data));

srv.kill();
console.log('NET TEST PASSED');
process.exit(0);
