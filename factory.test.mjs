// Node tests for the shared factory simulation (build 0.3).
import assert from 'node:assert/strict';
import { World } from '../src/shared/World.js';
import { FactorySim, machineGeometry } from '../src/shared/factory/FactorySim.js';
import { FACTORY } from '../src/shared/factory/layout.js';
import { LEGS, PHASE_TIME, VAN_TIME } from '../src/shared/factory/truck.js';
import { Inventory } from '../src/shared/factory/Inventory.js';
import { ECON, ITEMS, MACHINES } from '../src/shared/factory/items.js';
import { GOALS, LEVEL_XP, levelFor, levelGrant, perksAt } from '../src/shared/factory/progression.js';

// Inventory basics
const inv = new Inventory(4);
assert.equal(inv.add('steel_plate', 45), 0);
assert.equal(inv.add('motor', 30), 20);
assert.ok(inv.remove('steel_plate', 30));
assert.deepEqual(Inventory.fromJSON(inv.toJSON(), 4).toJSON(), inv.toJSON());

const world = new World();
const nColliders = world.colliders.length;
const sim = new FactorySim(world, { seed: 5 });
const pl = sim.addPlayer('p1');
const I = pl.inventory;
const DT = 1 / 60;
let log = [];
const run = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) for (const e of sim.tick(DT)) log.push(e); };
const at = (pos) => { pl.pos = [pos[0], 0, pos[2] ?? pos[1]]; };
const A = (cmd, pos) => { if (pos) at(pos); return sim.apply('p1', cmd); };

// Fresh factory: only the fab bench (free), starting cash
assert.equal(sim.machines.size, 1);
const fab = [...sim.machines.values()][0];
assert.equal(fab.type, 'fabricator');
assert.equal(sim.funds, ECON.startFunds);
assert.equal(world.colliders.length, nColliders + 1, 'fab bench collider added');

// Craft a press kit at the fab bench (slow, cheap)
I.add('steel_plate', 20); I.add('fasteners', 10);
let r = A({ type: 'run', machine: fab.id, recipe: 'kit_press' }, fab.geo.panel);
assert.ok(r.ok, r.error);
run(MACHINES.press.kit.time + 2);
const kitItem = [...sim.items.values()].find((it) => it.type === 'kit_press');
assert.ok(kitItem, 'kit lands on the bench');
assert.ok(A({ type: 'pickup', itemId: kitItem.id }, [kitItem.x, 0, kitItem.z + 1]).ok);
assert.equal(I.count('kit_press'), 1);

// Placement rules
const kitSlot = I.slots.findIndex((s) => s && s.type === 'kit_press');
assert.equal(A({ type: 'place', slot: kitSlot, x: 0, z: -6, q: 0 }, [0, 0, -12]).ok, false, 'main door is reserved');
assert.equal(A({ type: 'place', slot: kitSlot, x: -12.5, z: -6, q: 0 }, [-8, 0, -12]).ok, false, 'overlaps fab bench');
assert.equal(A({ type: 'place', slot: kitSlot, x: 10, z: -22, q: 0 }, [4, 0, -16]).ok, false, 'column in the way');
r = A({ type: 'place', slot: kitSlot, x: 10, z: -6.5, q: 0 }, [6, 0, -12]);
assert.ok(r.ok, r.error);
const press = sim.machines.get(r.id);
assert.equal(I.count('kit_press'), 0);

// Manual run from inventory → tray
assert.ok(A({ type: 'run', machine: press.id, recipe: 'brackets', times: 2 }, press.geo.panel).ok);
run(9);
let trayItems = [...sim.items.values()].filter((it) => it.type === 'bracket');
assert.equal(trayItems.reduce((a, it) => a + it.count, 0), 6, 'brackets on the tray');
for (const it of trayItems) assert.ok(A({ type: 'pickup', itemId: it.id }, [it.x, 0, it.z]).ok);

// Belts: craft 8 conveyors, feed the press from the west, output east into the sell corner
assert.ok(A({ type: 'run', machine: fab.id, recipe: 'conveyor', times: 2 }, fab.geo.panel).ok);
run(18);
for (const it of [...sim.items.values()].filter((i) => i.type === 'conveyor')) A({ type: 'pickup', itemId: it.id }, [it.x, 0, it.z]);
assert.equal(I.count('conveyor'), 12);
const g = press.geo; // q=0: input cell west, output cell east
const beltSlot = () => I.slots.findIndex((s) => s && s.type === 'conveyor');
const placeBelt = (x, z, q) => { const rr = A({ type: 'place', slot: beltSlot(), x, z, q }, [x, 0, z - 2.5]); assert.ok(rr.ok, `${x},${z}: ${rr.error}`); };
placeBelt(g.in.x - 2, g.in.z, 1);
placeBelt(g.in.x - 1, g.in.z, 1); // points +X into the input port
for (let x = g.out.x; x < 15.5; x += 1) placeBelt(x, g.out.z, 1);
assert.ok(A({ type: 'auto', machine: press.id, recipe: 'brackets' }, press.geo.panel).ok);
assert.ok(A({ type: 'output', machine: press.id, mode: 'belt' }, press.geo.panel).ok);
// drop 4 plates onto the feeding belt
const s0 = I.slots.findIndex((s) => s && s.type === 'steel_plate');
assert.ok(A({ type: 'drop', slot: s0, count: 4, at: [g.in.x - 2, 1.4, g.in.z], vel: [0, 0, 0] }).ok);
log = [];
run(30);
const fed = log.filter((e) => e.type === 'machineFed').reduce((a, e) => a + e.count, 0);
const deposits = log.filter((e) => e.type === 'deposit').reduce((a, e) => a + e.count, 0);
console.log(`belt: fed ${fed} plates, deposited ${deposits} brackets, cage value $${sim.cageValue()}`);
assert.equal(fed, 4);
assert.equal(deposits, 12, '4 plates → 12 brackets ride the belt into the sell corner');

// Hand-deposit the 6 brackets from inventory too
assert.ok(A({ type: 'deposit' }, [17.5, 0, -7.5]).ok);
assert.equal(sim.cage.reduce((a, s) => a + s.count, 0), 18);

// Contracts: accept a bracket offer if one exists (seeded)
run(1);
const offer = sim.contracts.offers.find((o) => o.item === 'bracket') || sim.contracts.offers[0];
assert.ok(offer, 'offers are posted');
assert.ok(A({ type: 'accept', contract: offer.id }).ok);

// Van pickup: pays 80 % company / 20 % depositor
const f0 = sim.funds, w0 = pl.wallet, value = sim.cageValue();
assert.ok(A({ type: 'callVan' }).ok);
assert.equal(A({ type: 'callVan' }).ok, false, 'one van at a time');
log = [];
run(VAN_TIME.dispatch + VAN_TIME.inbound + 10);
const paid = log.find((e) => e.type === 'vanPaid');
assert.ok(paid, 'van paid');
assert.equal(paid.total, value);
console.log(`van paid $${paid.total}: company +$${sim.funds - f0}, wallet +$${pl.wallet - w0}`);
assert.equal(sim.cage.length, 0);
if (offer.item === 'bracket' && offer.qty <= 18) assert.ok(log.some((e) => e.type === 'contractDone'));
run(VAN_TIME.reversing + VAN_TIME.outbound + 1);
assert.equal(sim.van.phase, 'idle');

// Buy an ammo press kit through the truck and place it
assert.ok(A({ type: 'order', items: { kit_ammo: 1 } }).ok);
run(PHASE_TIME.loading + PHASE_TIME.inbound + PHASE_TIME.reversing + 5);
const ak = [...sim.items.values()].find((it) => it.type === 'kit_ammo');
assert.ok(ak, 'kit delivered to the bay');
assert.ok(A({ type: 'pickup', itemId: ak.id }, [ak.x, 0, ak.z]).ok);

// Pack up the press (must be idle) → kit back
run(2);
assert.ok(A({ type: 'auto', machine: press.id, recipe: null }, press.geo.panel).ok);
r = A({ type: 'pack', id: press.id }, press.geo.panel);
assert.ok(r.ok, r.error);
assert.equal(I.count('kit_press'), 1);

// Save / load round trip
const saved = JSON.parse(JSON.stringify(sim.serialize()));
const w2 = new World();
const sim2 = new FactorySim(w2, { seed: 9 });
sim2.load(saved);
assert.equal(sim2.machines.size, sim.machines.size);
assert.equal(sim2.belts.size, sim.belts.size);
assert.equal(sim2.funds, sim.funds);
console.log('stats', JSON.stringify(sim.stats), 'funds', sim.funds, 'wallet', pl.wallet);
console.log('ALL FACTORY TESTS PASSED');

// Contract completion pays the bonus
{
  const s3 = new FactorySim(new World(), { seed: 3 });
  const p3 = s3.addPlayer('p1');
  s3.contracts.offers = [{ id: 'cX', kind: 'government', buyer: 'Ministry of Works', item: 'bracket', qty: 10, bonus: 0.4, duration: 600, offerExpires: 1e9, delivered: 0 }];
  s3.contracts.nextOfferAt = 1e9;
  assert.ok(s3.apply('p1', { type: 'accept', contract: 'cX' }).ok);
  p3.inventory.add('bracket', 12);
  p3.pos = [17.5, 0, -7.5];
  assert.ok(s3.apply('p1', { type: 'deposit' }).ok);
  assert.ok(s3.apply('p1', { type: 'callVan' }).ok);
  const ev = [];
  for (let i = 0; i < 60 * 30; i++) ev.push(...s3.tick(1 / 60));
  const done = ev.find((e) => e.type === 'contractDone');
  assert.ok(done, 'contract completed');
  const bv = ITEMS.bracket.value;
  assert.equal(done.bonus, Math.round(bv * 10 * 0.4));
  const goalCash = GOALS.filter((g) => s3.progress.goals.includes(g.id)).reduce((a, g) => a + g.reward, 0);
  assert.ok(s3.progress.goals.includes('contract') && s3.progress.goals.includes('paid'), 'goals paid out');
  assert.equal(s3.funds, ECON.startFunds + Math.round(12 * bv * 0.8) + Math.round(done.bonus * 0.8) + goalCash);
  console.log('contract bonus ok: $' + done.bonus + ' · wallet $' + p3.wallet);
}
console.log('CONTRACT TEST PASSED');

// Reset must cancel an in-flight truck/van — otherwise a paid order still delivers
// for free (or a sold cage still gets paid out) after funds have been wiped back to
// the starting amount, which is a money duplication exploit.
{
  const s4 = new FactorySim(new World(), { seed: 11 });
  const p4 = s4.addPlayer('p1');
  const run4 = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) s4.tick(1 / 60); };

  const f0 = s4.funds;
  assert.ok(s4.apply('p1', { type: 'order', items: { steel_plate: 10 } }).ok);
  assert.ok(s4.funds < f0, 'order spent funds');
  assert.equal(s4.truck.phase, 'loading');
  run4(2); // truck is on its way, nowhere near dumping yet
  s4.reset();
  assert.equal(s4.funds, ECON.startFunds, 'reset restores starting funds');
  assert.equal(s4.truck.phase, 'idle', 'reset cancels the in-flight truck');
  assert.equal(s4.pending.length, 0, 'the paid order cannot still arrive');
  run4(120); // well past when the old truck would have dumped its load
  assert.equal(s4.items.size, 0, 'no free delivery appeared after reset');
  assert.equal(s4.funds, ECON.startFunds, 'no funds appeared out of nowhere');

  s4._deposit('bracket', 5, 'p1', [0, 0, 0]);
  assert.ok(s4.apply('p1', { type: 'callVan' }).ok);
  run4(1);
  s4.reset();
  assert.equal(s4.van.phase, 'idle', 'reset cancels the in-flight van');
  assert.equal(s4.cage.length, 0, 'reset clears the cage');
  const fb = s4.funds, wb = p4.wallet;
  run4(120);
  assert.equal(s4.funds, fb, 'no late van payout after reset');
  assert.equal(s4.players.get('p1').wallet, wb, 'no late wallet payout after reset');
  console.log('RESET DUPE FIX VERIFIED');
}

// Progression: levels, grants, sale bonus only on goods the factory made, goals pay once.
{
  assert.equal(levelFor(0).level, 1);
  assert.equal(levelFor(LEVEL_XP[0]).level, 2);
  assert.equal(levelFor(LEVEL_XP[0] + LEVEL_XP[1] - 1).level, 2);
  assert.equal(perksAt(1).saleBonus, 0);
  assert.ok(perksAt(3).freeDelivery && !perksAt(2).freeDelivery);

  const s5 = new FactorySim(new World(), { seed: 21 });
  const p5 = s5.addPlayer('p1');
  const ev = [];
  const run5 = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) ev.push(...s5.tick(1 / 60)); };
  const sellViaVan = () => { assert.ok(s5.apply('p1', { type: 'callVan' }).ok); run5(VAN_TIME.dispatch + VAN_TIME.inbound + 30); run5(VAN_TIME.reversing + VAN_TIME.outbound + 1); };

  // Jump to level 3 through XP from made goods and check grants arrive once each.
  s5._gainXp(LEVEL_XP[0] + LEVEL_XP[1]);
  const ups = s5.events.filter((e) => e.type === 'levelUp');
  assert.deepEqual(ups.map((e) => e.level), [2, 3]);
  assert.equal(s5.levelInfo().level, 3);
  assert.equal(s5.quote({ steel_plate: 5 }).fee, 0, 'free delivery from level 3');

  // Made goods get the level bonus; raw stock does not (no buy-low/sell-high loop).
  s5._deposit('bracket', 10, 'p1', [0, 0, 0]);
  s5._deposit('steel_plate', 10, 'p1', [0, 0, 0]);
  const xp0 = s5.progress.xp;
  ev.length = 0;
  sellViaVan();
  const loads = ev.filter((e) => e.type === 'vanLoad');
  const br = loads.find((e) => e.item === 'bracket'), st = loads.find((e) => e.item === 'steel_plate');
  assert.equal(br.value, Math.round(ITEMS.bracket.value * 10 * 1.1), 'level 3 = +10% on made goods');
  assert.equal(st.value, ITEMS.steel_plate.value * 10, 'raw stock sells at base value');
  assert.ok(st.value < ITEMS.steel_plate.buy * 10, 'selling bought stock is always a loss');
  assert.equal(s5.progress.xp - xp0, br.value, 'only made goods earn XP');

  // Goals pay once, even if the condition stays true.
  const paidOnce = ev.filter((e) => e.type === 'goalDone' && e.goal === 'paid').length;
  run5(5);
  assert.equal(paidOnce, 1);
  assert.equal(s5.events.filter((e) => e.type === 'goalDone' && e.goal === 'paid').length, 0);

  // Save/load keeps progress; reset clears it.
  const s6 = new FactorySim(new World(), { seed: 2 });
  s6.load(JSON.parse(JSON.stringify(s5.serialize())));
  assert.equal(s6.progress.xp, s5.progress.xp);
  assert.deepEqual(s6.progress.goals, s5.progress.goals);
  s5.reset();
  assert.equal(s5.progress.xp, 0);
  assert.equal(s5.progress.goals.length, 0);
  console.log('PROGRESSION TEST PASSED');
}

// Saves keep goods in transit: undelivered orders, un-loaded van stacks and floor items.
{
  const s7 = new FactorySim(new World(), { seed: 4 });
  const p7 = s7.addPlayer('local');
  p7.pos = [-7, 0, -6];
  assert.ok(s7.apply('local', { type: 'order', items: { steel_plate: 30 } }).ok);
  const run7 = (sec) => { for (let i = 0; i < Math.round(sec * 60); i++) s7.tick(1 / 60); };
  run7(5); // truck still on its way
  const saved = JSON.parse(JSON.stringify(s7.serialize()));
  assert.equal(saved.pending.reduce((a, st) => a + st.count, 0), 30, 'undelivered order is in the save');
  const s8 = new FactorySim(new World(), { seed: 4 });
  s8.addPlayer('local', saved.players.local);
  s8.load(saved);
  assert.equal(s8.truck.phase, 'loading', 'the truck sets off again after loading the save');
  for (let i = 0; i < 60 * 40; i++) s8.tick(1 / 60);
  const onFloor = [...s8.items.values()].filter((it) => it.type === 'steel_plate').reduce((a, it) => a + it.count, 0);
  assert.equal(onFloor, 30, 'the order is delivered after reloading');
  // floor items survive a save/load round trip
  const s9 = new FactorySim(new World(), { seed: 4 });
  s9.load(JSON.parse(JSON.stringify(s8.serialize())));
  assert.equal([...s9.items.values()].reduce((a, it) => a + it.count, 0), onFloor, 'floor items saved');
  // van mid-load: stacks it hasn't loaded go back to the cage, loaded ones are paid for once
  s9._deposit('bracket', 10, null, [0, 0, 0]);
  s9._deposit('housing', 10, null, [0, 0, 0]);
  s9._deposit('bracket', 25, null, [0, 0, 0]);
  const cageUnits = s9.cage.reduce((a, st) => a + st.count, 0);
  s9.addPlayer('local');
  assert.ok(s9.apply('local', { type: 'callVan' }).ok);
  let n = 0;
  while (!(s9.van.phase === 'loading' && s9.van.loaded === 1) && n++ < 60 * 60) s9.tick(1 / 60);
  const mid = JSON.parse(JSON.stringify(s9.serialize()));
  const loadedUnits = s9.van.manifest.slice(0, s9.van.loaded).reduce((a, st) => a + st.count, 0);
  assert.equal(mid.cage.reduce((a, st) => a + st.count, 0), cageUnits - loadedUnits, 'unpaid van stacks saved back into the cage');
  console.log('TRANSIT SAVE TEST PASSED');
}
