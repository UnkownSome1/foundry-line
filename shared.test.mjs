// Node tests for the shared (server-reusable) simulation core.
import assert from 'node:assert/strict';
import { World } from '../src/shared/World.js';
import { WeaponState } from '../src/shared/WeaponState.js';
import { WEAPONS } from '../src/shared/weapons.js';
import { createPlayerState, stepPlayer } from '../src/shared/PlayerMovement.js';
import { SIM_DT } from '../src/shared/constants.js';
import { SPAWN, HALL } from '../src/shared/mapLayout.js';
import { rayVsCharacter } from '../src/shared/hitscan.js';

let t0 = performance.now();
const w = new World();
const w2 = new World();
console.log(`world build ${(performance.now() - t0).toFixed(1)}ms, colliders=${w.colliders.length}, maxH=${w.maxHeight.toFixed(1)}`);
assert.equal(w.heights.length, w2.heights.length);
for (let i = 0; i < w.heights.length; i += 97) assert.equal(w.heights[i], w2.heights[i], 'deterministic terrain');
assert.equal(w.heightAt(0, 0), 0, 'yard is flat');
assert.ok(w.heightAt(110, 110) > 3, 'hills at edge');

// raycast straight down in the yard hits terrain at 0
let hit = w.raycast(5, 10, 5, 0, -1, 0, 50);
assert.ok(hit && Math.abs(hit.point[1]) < 0.02, 'down ray hits ground ' + JSON.stringify(hit?.point));
// ray toward the hall's west wall from inside
hit = w.raycast(-15, 1.5, -8, -1, 0, 0, 50);
assert.ok(hit && Math.abs(hit.point[0] - (HALL.x - HALL.w / 2 + HALL.wall / 2)) < 0.01, 'hits west wall inner face ' + hit?.point);
assert.equal(hit.normal[0], 1);

// Player: spawn, fall to ground, walk forward (north, -Z) into the hall
const p = createPlayerState(SPAWN.x, 3, SPAWN.z, 0);
const cmd = { forward: 0, strafe: 0, jump: false, sprint: false, crouch: false, aim: false, yaw: 0, pitch: 0 };
for (let i = 0; i < 120; i++) stepPlayer(p, cmd, w, SIM_DT);
assert.ok(p.grounded && Math.abs(p.y) < 1e-6, 'lands on yard ' + p.y);
cmd.forward = 1;
for (let i = 0; i < 60 * 4; i++) stepPlayer(p, cmd, w, SIM_DT);
console.log('after 4s walking north:', p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2));
assert.ok(p.z < SPAWN.z - 15, 'moved north');
// walk west into the wall; must stop at wall
cmd.yaw = Math.PI / 2; // facing -X
for (let i = 0; i < 60 * 8; i++) stepPlayer(p, cmd, w, SIM_DT);
console.log('after walking west:', p.x.toFixed(2), p.z.toFixed(2));
assert.ok(p.x > -20, 'blocked by west wall');

// Jump onto conveyor (1.0 m high) — should be able to mount it via jump
const q = createPlayerState(-5, 0, -12.5, 0);
const c2 = { ...cmd, yaw: 0, forward: 1, jump: true };
for (let i = 0; i < 40; i++) stepPlayer(q, c2, w, SIM_DT);
console.log('conveyor mount y=', q.y.toFixed(2), 'z=', q.z.toFixed(2));

// Bunny hop + air strafe exploit: holding jump, strafing and turning into the strafe
// every tick used to gain speed without limit. Horizontal speed must never beat running.
{
  const b = createPlayerState(40, 0, 20, 0);
  const bc = { forward: 1, strafe: 1, jump: true, sprint: true, crouch: false, aim: false, yaw: 0, pitch: 0 };
  let maxSp = 0;
  for (let i = 0; i < 60 * 12; i++) {
    // classic air-strafe: sweep the view toward the strafe side, flip sides each hop
    const hop = Math.floor(i / 25) % 2;
    bc.strafe = hop ? 1 : -1;
    bc.forward = b.grounded ? 1 : 0;
    bc.yaw += (hop ? -1 : 1) * 0.045;
    stepPlayer(b, bc, w, SIM_DT);
    maxSp = Math.max(maxSp, Math.hypot(b.vx, b.vz));
  }
  console.log(`bhop strafe max speed ${maxSp.toFixed(2)} m/s (sprint ${7.1})`);
  assert.ok(maxSp <= 7.1 + 1e-6, 'air strafing / bunny hopping cannot exceed sprint speed');
}

// Step-up onto a 0.85 barrier should NOT happen without jump; crate stack blocks.
// Weapon: fire through a mag, get locked slide, auto empty reload
const ws = new WeaponState(WEAPONS.p9, 7);
let now = 0;
const evs = [];
const tick = (input) => { now += SIM_DT; evs.push(...ws.update(now, SIM_DT, input)); };
assert.equal(ws.rounds, 16);
let fired = 0;
for (let i = 0; i < 200 && !ws.slideLocked; i++) {
  tick({ fire: i % 2 === 0, reload: false });
}
fired = evs.filter((e) => e.type === 'fire').length;
assert.equal(fired, 16, '15+1 rounds');
assert.equal(ws.slideLocked, true);
tick({ fire: false, reload: false });
tick({ fire: true, reload: false }); // pull trigger on empty -> auto reload
assert.equal(ws.action, 'reload');
assert.equal(ws.reloadKind, 'empty');
for (let i = 0; i < 60 * 3; i++) tick({ fire: false, reload: false });
assert.equal(ws.action, 'idle');
assert.equal(ws.rounds, 15, 'empty reload gives 14+1');
assert.equal(ws.reserve, 60 - 15);
const types = evs.map((e) => e.type).filter((t) => t !== 'fire');
assert.deepEqual(types, ['reloadStart', 'magOut', 'magIn', 'slideRelease', 'reloadEnd']);
// tactical
tick({ fire: true, reload: false });
tick({ fire: false, reload: true });
assert.equal(ws.reloadKind, 'tactical');
for (let i = 0; i < 60 * 2; i++) tick({ fire: false, reload: false });
assert.equal(ws.rounds, 16, 'tactical reload keeps chambered round');
// spread sample reproducible
const s1 = ws.spreadSample(5, 0.02), s2 = new WeaponState(WEAPONS.p9, 7).spreadSample(5, 0.02);
assert.deepEqual(s1, s2);

// Hitscan
const h1 = rayVsCharacter(0, 1.6, 10, 0, 0, -1, 0, 0, 0, 0, 100);
assert.equal(h1.part, 'head');
const h2 = rayVsCharacter(0, 1.0, 10, 0, 0, -1, 0, 0, 0, 0, 100);
assert.equal(h2.part, 'body');

// perf: 1000 raycasts
t0 = performance.now();
for (let i = 0; i < 1000; i++) w.raycast(0, 1.6, 17, Math.sin(i), -0.05, -Math.cos(i), 150);
console.log(`1000 raycasts ${(performance.now() - t0).toFixed(1)}ms`);
console.log('ALL SHARED TESTS PASSED');
