// Server load check: a busy host save + two clients streaming inputs at 60 Hz.
// Reports the server's CPU use (Render's free plan gives 0.1 CPU).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { World } from '../src/shared/World.js';
import { FactorySim } from '../src/shared/factory/FactorySim.js';
import { encodeInput } from '../src/shared/net/protocol.js';

const PORT = 8990;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// busy factory: several machines on auto, a long belt loop feeding the sell corner, lots of loose items
const sim = new FactorySim(new World(), { seed: 7 });
const p = sim.addPlayer('local');
p.pos = [0, 0, -12];
for (const [kit, x, z] of [['kit_press', 10, -6.5], ['kit_moulder', -3, -13], ['kit_ammo', 6, -20], ['kit_electronics', -12, -20]]) {
  p.inventory.add(kit, 1);
  p.pos = [x - 3, 0, z - 4];
  const r = sim.apply('local', { type: 'place', slot: p.inventory.slots.findIndex((s) => s && s.type === kit), x, z, q: 0 });
  if (!r.ok) console.log('place', kit, r.error);
}
p.inventory.add('conveyor', 50);
let belts = 0;
for (let x = -14; x < 15; x++) { p.pos = [x, 0, -24.5]; if (sim.apply('local', { type: 'place', slot: p.inventory.slots.findIndex((s) => s && s.type === 'conveyor'), x: x + 0.5, z: -26, q: 1 }).ok) belts++; }
for (let i = 0; i < 120; i++) sim.spawnItem(['steel_plate', 'bracket', 'pellets', 'housing'][i % 4], 1, [-14 + (i % 28), 1 + (i % 3), -26 + ((i * 7) % 5) * 0.2], [0, 0, 0]);
for (let i = 0; i < 600; i++) sim.tick(1 / 60);
const save = sim.serialize();
console.log(`save: ${sim.machines.size} machines, ${belts} belts, ${sim.items.size} items, ${JSON.stringify(save).length} bytes`);

const srv = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await sleep(900);
const cpu = () => { const f = fs.readFileSync(`/proc/${srv.pid}/stat`, 'utf8').split(') ')[1].split(' '); return (+f[11] + +f[12]) / 100; };

function client(first) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, bytes: 0, code: null };
  ws.addEventListener('open', () => ws.send(JSON.stringify(first())));
  ws.addEventListener('message', (e) => { c.bytes += e.data.length; const m = JSON.parse(e.data); if (m.t === 'welcome') c.code = m.code; });
  return c;
}
const host = client(() => ({ t: 'host', save, name: 'Load', color: 1 }));
while (!host.code) await sleep(20);
const guest = client(() => ({ t: 'join', code: host.code, name: 'Guest', color: 2 }));
await sleep(500);

let seq = 0;
const iv = setInterval(() => {
  for (const c of [host, guest]) {
    const b = [];
    for (let i = 0; i < 2; i++) { seq++; b.push(encodeInput(seq, { forward: 1, strafe: Math.sin(seq / 60), jump: seq % 90 === 0, sprint: true, crouch: false, aim: false, yaw: seq / 120, pitch: 0 })); }
    c.ws.send(JSON.stringify({ t: 'in', b }));
  }
}, 33);

const c0 = cpu(), t0 = Date.now(), b0 = host.bytes;
await sleep(10000);
const used = cpu() - c0, wall = (Date.now() - t0) / 1000;
clearInterval(iv);
console.log(`server CPU: ${(used / wall * 100).toFixed(1)}% of one core over ${wall.toFixed(1)} s`);
console.log(`downstream to one client: ${((host.bytes - b0) / wall / 1024).toFixed(1)} KB/s`);
srv.kill();
process.exit(0);
