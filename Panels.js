// Inventory, supply terminal and machine panels. While the mouse is pointer-locked
// a virtual cursor drives the UI, so opening a panel never drops you out of the game.
import { ITEMS, MACHINES, CATALOG, EQUIPMENT, ECON } from '../../shared/factory/items.js';
import { GOALS, LEVEL_UNLOCKS, MAX_LEVEL, levelGrant, perksAt } from '../../shared/factory/progression.js';

const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CAT = { raw: 'Raw material', part: 'Part', product: 'Product', kit: 'Equipment' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Panels {
  /**
   * @param ctx {sim, playerId, icons, audio, hud, locked(), command(c), onUse(effect), onPlace(slot),
   *             dropAt():{at,vel}, truckStatus(), vanStatus()}
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.root = document.getElementById('panel-root');
    this.cursor = document.getElementById('vcursor');
    this.open = null;
    this.tab = 'order';
    this.cart = {};
    this.sel = null;
    this.machine = null;
    this.cx = innerWidth / 2;
    this.cy = innerHeight / 2;
    this.hoverEl = null;
    this.liveT = 0;
    this.root.addEventListener('click', (e) => this.handle(e.target, 0));
    this.root.addEventListener('contextmenu', (e) => { e.preventDefault(); this.handle(e.target, 2); });
    addEventListener('wheel', (e) => {
      if (!this.open || !this.ctx.locked()) return;
      const el = document.elementFromPoint(this.cx, this.cy);
      const sc = el && el.closest('.scroll');
      if (sc) sc.scrollTop += e.deltaY;
    }, { passive: true });
  }

  get isOpen() { return !!this.open; }
  get inv() { return this.ctx.sim.players.get(this.ctx.playerId).inventory; }
  get me() { return this.ctx.sim.players.get(this.ctx.playerId); }

  show(name, arg) {
    const was = this.open;
    this.open = name;
    if (name === 'machine') this.machine = arg;
    if (name === 'terminal' && !was) this.tab = arg || 'order';
    this.cx = innerWidth / 2; this.cy = innerHeight / 2;
    document.body.classList.add('ui-open');
    this.ctx.audio.ui('open');
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = null;
    this.sel = null;
    this.root.innerHTML = '';
    document.body.classList.remove('ui-open');
    this.ctx.audio.ui('close');
  }

  toggleInventory() { if (this.open === 'inventory') this.close(); else this.show('inventory'); }

  // ------------------------------------------------------------------ cursor
  moveCursor(dx, dy) {
    this.cx = Math.max(0, Math.min(innerWidth - 1, this.cx + dx));
    this.cy = Math.max(0, Math.min(innerHeight - 1, this.cy + dy));
    this.cursor.style.transform = `translate(${this.cx}px, ${this.cy}px)`;
    const el = document.elementFromPoint(this.cx, this.cy);
    const h = el && el.closest('[data-act]');
    if (h !== this.hoverEl) {
      if (this.hoverEl) this.hoverEl.classList.remove('hover');
      if (h) h.classList.add('hover');
      this.hoverEl = h;
    }
  }

  virtualClick(button = 0) {
    const el = document.elementFromPoint(this.cx, this.cy);
    if (el) this.handle(el, button);
  }

  // ------------------------------------------------------------------ actions
  /** Send a factory command; `then(r)` runs on success (now in solo, when the server answers online). */
  cmd(c, then) {
    this.ctx.command(c, (r) => {
      if (!r.ok) { this.ctx.audio.ui('error'); this.ctx.hud.toast(r.error, 'warn'); }
      else if (then) then(r);
      this.dirty = true;
    });
  }

  handle(target, button) {
    const el = target.closest && target.closest('[data-act]');
    if (!el || el.disabled || el.classList.contains('disabled')) return;
    const act = el.dataset.act;
    const slot = el.dataset.slot != null ? +el.dataset.slot : null;
    const type = el.dataset.type;
    switch (act) {
      case 'close': this.close(); return;
      case 'tab': this.tab = el.dataset.tab; this.ctx.audio.ui(); break;
      case 'qty': {
        const q = Math.max(0, Math.min(200, (this.cart[type] || 0) + +el.dataset.d));
        if (q) this.cart[type] = q; else delete this.cart[type];
        this.ctx.audio.ui();
        break;
      }
      case 'clearcart': this.cart = {}; this.ctx.audio.ui(); break;
      case 'order': {
        const cart = this.cart;
        this.cmd({ type: 'order', items: cart }, (r) => { if (this.cart === cart) this.cart = {}; this.ctx.audio.ui('confirm'); this.ctx.hud.toast(`Order placed · ${money(r.total)} · truck dispatched`, 'ok'); });
        break;
      }
      case 'slot': {
        if (button === 2) { if (this.inv.slots[slot]) this._drop(slot, 1); break; }
        if (this.sel != null && this.sel !== slot && this.open === 'inventory') {
          this.cmd({ type: 'move', from: this.sel, to: slot });
          this.sel = this.inv.slots[slot] ? slot : null;
        } else this.sel = this.inv.slots[slot] ? (this.sel === slot ? null : slot) : null;
        this.ctx.audio.ui();
        break;
      }
      case 'use': {
        this.cmd({ type: 'use', slot }, (r) => { this.ctx.onUse(r.effect); if (!this.inv.slots[slot]) this.sel = null; });
        break;
      }
      case 'place': this.close(); this.ctx.onPlace(slot); return;
      case 'drop': this._drop(slot, el.dataset.n === 'all' ? Infinity : 1); break;
      case 'scrap':
        this.cmd({ type: 'scrap', slot, count: el.dataset.n === 'all' ? Infinity : 1 }, (r) => { this.ctx.audio.chaChing(); this.ctx.hud.toast(`Scrapped for ${money(r.value)}`, 'ok'); });
        break;
      case 'callVan':
        this.cmd({ type: 'callVan' }, () => { this.ctx.audio.ui('confirm'); this.ctx.hud.toast('Pickup van called — it will collect the cage outside the east wall', 'ok'); });
        break;
      case 'accept':
        this.cmd({ type: 'accept', contract: el.dataset.id }, (r) => { this.ctx.audio.ui('confirm'); this.ctx.hud.toast(`Contract accepted: ${r.contract.qty}× ${ITEMS[r.contract.item].name} for ${r.contract.buyer}`, 'ok'); });
        break;
      case 'run': {
        const n = el.dataset.n === 'max' ? ECON.maxQueue : +el.dataset.n;
        this.cmd({ type: 'run', machine: this.machine, recipe: el.dataset.recipe, times: n }, () => this.ctx.audio.ui('confirm'));
        break;
      }
      case 'auto': this.cmd({ type: 'auto', machine: this.machine, recipe: el.dataset.recipe || null }, () => this.ctx.audio.ui('confirm')); break;
      case 'output': this.cmd({ type: 'output', machine: this.machine, mode: el.dataset.mode }, () => this.ctx.audio.ui()); break;
      case 'unload': this.cmd({ type: 'unload', machine: this.machine }, () => this.ctx.audio.pickup()); break;
      case 'pack':
        this.cmd({ type: 'pack', id: this.machine }, (r) => { this.ctx.audio.pickup(); this.ctx.hud.toast(`${ITEMS[r.kit].name} added to your inventory`, 'ok'); this.close(); });
        break;
      default: return;
    }
    this.render();
  }

  _drop(slot, n) {
    const { at, vel } = this.ctx.dropAt();
    this.cmd({ type: 'drop', slot, count: n, at, vel }, () => { this.ctx.audio.pickup(); if (!this.inv.slots[slot]) this.sel = null; });
  }

  // ------------------------------------------------------------------ render
  onEvent(e) {
    if (!this.open) return;
    if (['inventory', 'funds', 'wallet', 'truckPhase', 'vanPhase', 'machineStart', 'machineIdle', 'machineState', 'deposit', 'contracts', 'state', 'xp', 'levelUp', 'goalDone'].includes(e.type)) this.dirty = true;
  }

  update(dt) {
    if (!this.open) return;
    this.liveT -= dt;
    if (this.dirty) { this.dirty = false; this.render(); return; }
    if (this.liveT <= 0) {
      this.liveT = 0.25;
      const t = this.root.querySelector('[data-live="truck"]');
      if (t) t.textContent = this.ctx.truckStatus().text;
      const v = this.root.querySelector('[data-live="van"]');
      if (v) v.textContent = this.ctx.vanStatus().text;
      const bar = this.root.querySelector('[data-live="progress"]');
      if (bar && this.machine) bar.style.width = `${(this.ctx.sim.machineProgress(this.machine) * 100).toFixed(1)}%`;
      this.root.querySelectorAll('[data-deadline]').forEach((el) => { el.textContent = mmss(Math.max(0, +el.dataset.deadline - this.ctx.sim.time)); });
    }
  }

  render() {
    if (this.open === 'machine' && !this.ctx.sim.machines.get(this.machine)) { this.close(); return; }
    const sc = this.root.querySelector('.scroll');
    const keep = sc ? sc.scrollTop : 0;
    if (this.open === 'inventory') this.root.innerHTML = this._inventory();
    else if (this.open === 'terminal') this.root.innerHTML = this._terminal();
    else if (this.open === 'machine') this.root.innerHTML = this._machine();
    const sc2 = this.root.querySelector('.scroll');
    if (sc2) sc2.scrollTop = keep;
    this.hoverEl = null;
    this.moveCursor(0, 0);
  }

  _icon(type, cls = '') { return `<img class="ico ${cls}" src="${this.ctx.icons[type] || ''}" alt="">`; }

  _header(title, sub = '') {
    return `<header class="pw-head"><div><div class="pw-eyebrow">${esc(sub)}</div><div class="pw-title">${esc(title)}</div></div>
      <div class="pw-funds"><small>Company · you</small><span>${money(this.ctx.sim.funds)} <em>· ${money(this.me.wallet)}</em></span></div>
      <button type="button" class="pw-close" data-act="close">Close</button></header>`;
  }

  _inventory() {
    const inv = this.inv;
    const s = this.sel != null ? inv.slots[this.sel] : null;
    let detail = '<div class="det-empty">Select a stack to see what it is, use it, place it or drop it.</div>';
    if (s) {
      const d = ITEMS[s.type];
      detail = `<div class="det">
        ${this._icon(s.type, 'big')}
        <div class="det-name">${esc(d.name)}</div>
        <div class="chip ${d.cat}">${CAT[d.cat]}</div>
        <p>${esc(d.desc)}</p>
        <dl><dt>In stack</dt><dd>${s.count} / ${d.stack}</dd>
        <dt>Pickup van pays</dt><dd>${money(this._vanValue(s.type))} each</dd>
        <dt>Scrap buyer</dt><dd>${money(d.value * this.ctx.sim.perks().scrapRate)} each</dd></dl>
        <div class="btns">
          ${d.place ? `<button type="button" class="btn primary" data-act="place" data-slot="${this.sel}">Place${d.place === 'conveyor' ? ' belts' : ''}</button>` : ''}
          ${d.use ? `<button type="button" class="btn primary" data-act="use" data-slot="${this.sel}">Use (+${d.use.ammo} rounds)</button>` : ''}
          <button type="button" class="btn" data-act="drop" data-slot="${this.sel}" data-n="1">Drop 1</button>
          <button type="button" class="btn" data-act="drop" data-slot="${this.sel}" data-n="all">Drop stack</button>
        </div></div>`;
    }
    const grid = inv.slots.map((x, i) => `<button type="button" class="slot${x ? '' : ' empty'}${this.sel === i ? ' sel' : ''}${x && ITEMS[x.type].place ? ' placeable' : ''}" data-act="slot" data-slot="${i}" title="${x ? esc(ITEMS[x.type].name) : 'Empty'}">${x ? this._icon(x.type) + `<b>${x.count}</b>` : ''}</button>`).join('');
    const used = inv.slots.filter(Boolean).length;
    return `<div class="pw inv">${this._header('Inventory', `${used} / ${inv.size} slots`)}
      <div class="inv-body"><div class="grid">${grid}</div><aside class="detail">${detail}</aside></div>
      <footer class="pw-foot">Click to select · click another slot to move · right-click drops one · <kbd>B</kbd> build mode · <kbd>Tab</kbd> closes</footer></div>`;
  }

  /** What the van pays for one of `type` right now (level bonus only on goods you make). */
  _vanValue(type) {
    const d = ITEMS[type];
    const made = d.cat === 'part' || d.cat === 'product';
    return Math.round(d.value * (made ? this.ctx.sim.saleMultiplier() : 1));
  }

  _orderRow(t) {
    const d = ITEMS[t], q = this.cart[t] || 0;
    const step = d.stack === 1 ? [1] : [1, 5];
    return `<div class="row">${this._icon(t)}<div class="row-main"><div class="row-name">${esc(d.name)}</div><div class="row-desc">${esc(d.desc)}</div></div>
      <div class="row-price">${money(d.buy)}</div>
      <div class="stepper"><button type="button" data-act="qty" data-type="${t}" data-d="-1">−</button><span>${q}</span>${step.map((n) => `<button type="button" data-act="qty" data-type="${t}" data-d="${n}">+${n === 1 ? '' : n}</button>`).join('')}</div>
      <div class="row-total">${q ? money(q * d.buy) : '—'}</div></div>`;
  }

  _terminal() {
    const sim = this.ctx.sim;
    const lvl = sim.levelInfo();
    const goalsLeft = GOALS.filter((g) => !sim.progress.goals.includes(g.id) && sim.goalProgress(g) >= g.target).length;
    const tabs = [['company', `Company · Lv ${lvl.level}${goalsLeft ? ' •' : ''}`], ['order', 'Parts'], ['machines', 'Machines'], ['pickup', 'Pickup & sales'], ['contracts', `Contracts${sim.contracts.active.length ? ` (${sim.contracts.active.length})` : ''}`], ['recipes', 'Recipes']];
    const perks = sim.perks();
    let body = '';
    let footer = '';
    const q = sim.quote(this.cart);
    const can = q.units > 0 && q.total <= sim.funds;
    const orderFoot = `<div class="cart"><small>${q.units} unit${q.units === 1 ? '' : 's'} + delivery ${perks.freeDelivery ? 'free' : money(ECON.deliveryFee)}</small><span>${money(q.total)}</span></div>
      <button type="button" class="btn" data-act="clearcart">Clear</button>
      <button type="button" class="btn primary${can ? '' : ' disabled'}" data-act="order">${q.total > sim.funds ? 'Not enough funds' : 'Place order'}</button>`;
    const truckLine = `<div class="truck"><small>Delivery truck D-07</small><span data-live="truck">${esc(this.ctx.truckStatus().text)}</span></div>`;

    if (this.tab === 'company') {
      body = this._company(sim, lvl, perks);
      footer = truckLine;
    } else if (this.tab === 'order') {
      body = CATALOG.map((t) => this._orderRow(t)).join('');
      footer = truckLine + orderFoot;
    } else if (this.tab === 'machines') {
      body = `<p class="note">Buy a machine and it arrives flat-packed on the next truck — or craft the kit yourself at the fab bench for the cost of its parts. Place kits from your inventory (<kbd>B</kbd>).</p>` +
        [...EQUIPMENT].map((t) => {
          const d = ITEMS[t];
          const mid = d.place !== 'conveyor' ? d.place : null;
          const convRecipe = MACHINES.fabricator.recipes.find((r) => r.id === 'conveyor');
          const kit = mid ? MACHINES[mid].kit : { inputs: convRecipe.inputs, time: convRecipe.time };
          const parts = Object.entries(kit.inputs).map(([it, n]) => `${n}× ${ITEMS[it].name}`).join(', ');
          const cost = Object.entries(kit.inputs).reduce((a, [it, n]) => a + ITEMS[it].buy * n, 0);
          const craft = mid ? `Craft: ${parts} (${money(cost)} of parts, ${kit.time} s)` : `Craft ×${convRecipe.outputs.conveyor}: ${parts} (${money(cost)}, ${kit.time} s)`;
          return this._orderRow(t).replace(`<div class="row-desc">${esc(d.desc)}</div>`, `<div class="row-desc">${esc(mid ? MACHINES[mid].desc : d.desc)}</div><div class="row-desc craft">${esc(craft)}</div>`);
        }).join('');
      footer = truckLine + orderFoot;
    } else if (this.tab === 'pickup') {
      const cage = sim.cage;
      const val = sim.cageValue();
      const rows = cage.length ? cage.map((s) => `<div class="row">${this._icon(s.type)}<div class="row-main"><div class="row-name">${esc(ITEMS[s.type].name)} ×${s.count}</div></div><div class="row-price">${money(this._vanValue(s.type) * s.count)}</div></div>`).join('')
        : '<p class="note">The cage is empty. Drop parts or products in the sell corner (south-east corner of the hall), run a belt into it, or press <kbd>E</kbd> at the hopper to deposit everything you carry.</p>';
      const scrap = this.inv.slots.map((s, i) => {
        if (!s) return '';
        const d = ITEMS[s.type], unit = Math.round(d.value * perks.scrapRate);
        return `<div class="row">${this._icon(s.type)}<div class="row-main"><div class="row-name">${esc(d.name)} ×${s.count}</div><div class="row-desc">Van pays ${money(this._vanValue(s.type))} each</div></div>
          <div class="row-price">${money(unit)}</div>
          <button type="button" class="btn sm" data-act="scrap" data-slot="${i}" data-n="1">Scrap 1</button>
          <button type="button" class="btn sm" data-act="scrap" data-slot="${i}" data-n="all">Scrap all · ${money(unit * s.count)}</button></div>`;
      }).join('');
      const bonusTxt = perks.saleBonus > 0 ? ` Company level bonus: <b>+${Math.round(perks.saleBonus * 100)}%</b> on parts and products you made.` : '';
      body = `<h3>Pickup cage · ${money(val)} base</h3><p class="note">The van pays ${Math.round(ECON.companyShare * 100)}% to company funds, ${Math.round((1 - ECON.companyShare) * 100)}% to whoever dropped the goods off.${bonusTxt}</p>${rows}
        <h3>Scrap buyer</h3><p class="note">Instant cash for anything in your inventory at ${Math.round(perks.scrapRate * 100)}% of value, all to company funds.</p>${scrap || '<p class="note">Your inventory is empty.</p>'}`;
      const canCall = sim.van.phase === 'idle' && cage.length > 0;
      footer = `<div class="truck"><small>Pickup van</small><span data-live="van">${esc(this.ctx.vanStatus().text)}</span></div>
        <div class="cart"><small>In the cage</small><span>${money(val)}</span></div>
        <button type="button" class="btn primary${canCall ? '' : ' disabled'}" data-act="callVan">Call pickup van</button>`;
    } else if (this.tab === 'contracts') {
      const C = sim.contracts;
      const active = C.active.map((c) => `<div class="contract ${c.kind} on"><div class="c-head"><span class="c-kind">${c.kind === 'government' ? 'Government' : 'Private'}</span><b>${esc(c.buyer)}</b><span class="c-time">⏱ <span data-deadline="${c.deadline}">${mmss(c.deadline - sim.time)}</span></span></div>
        <div class="recipe">${this._icon(c.item, 'xs')}<span>${c.delivered} / ${c.qty} ${esc(ITEMS[c.item].name)}</span><span class="rt">Bonus ${money(sim.contractBonus(c))} (+${Math.round(c.bonus * 100)}%)</span></div>
        <div class="pbar"><i style="width:${(c.delivered / c.qty * 100).toFixed(1)}%"></i></div></div>`).join('');
      const offers = C.offers.map((c) => `<div class="contract ${c.kind}"><div class="c-head"><span class="c-kind">${c.kind === 'government' ? 'Government' : 'Private'}</span><b>${esc(c.buyer)}</b><span class="c-time">${mmss(c.duration)} to deliver</span></div>
        <div class="recipe">${this._icon(c.item, 'xs')}<span>${c.qty}× ${esc(ITEMS[c.item].name)} · base ${money(ITEMS[c.item].value * c.qty)}</span><span class="rt">+${money(sim.contractBonus(c))} bonus (+${Math.round(c.bonus * 100)}%)</span></div>
        <div class="btns"><button type="button" class="btn primary${C.active.length >= perks.contractSlots ? ' disabled' : ''}" data-act="accept" data-id="${c.id}">Accept</button></div></div>`).join('');
      body = `<p class="note">Contracts are optional. Goods still sell at the fixed price; delivering the full amount through the pickup van before the deadline pays the bonus. Up to ${perks.contractSlots} at a time.</p>
        <h3>Active</h3>${active || '<p class="note">No active contracts.</p>'}<h3>Offers</h3>${offers || '<p class="note">No offers right now — check back soon.</p>'}`;
      footer = `<div class="truck"><small>Pickup van</small><span data-live="van">${esc(this.ctx.vanStatus().text)}</span></div>`;
    } else {
      body = Object.entries(MACHINES).map(([, m]) => `<h3>${esc(m.name)}</h3>` + m.recipes.map((r) => {
        const ins = Object.entries(r.inputs).map(([t, n]) => `<span class="chip-i">${this._icon(t, 'xs')}${n}× ${esc(ITEMS[t].name)}</span>`).join('');
        const outs = Object.entries(r.outputs).map(([t, n]) => `<span class="chip-i out">${this._icon(t, 'xs')}${n}× ${esc(ITEMS[t].name)}</span>`).join('');
        const val = Object.entries(r.outputs).reduce((a, [t, n]) => a + ITEMS[t].value * n, 0);
        return `<div class="recipe">${ins}<span class="arrow">→</span>${outs}<span class="rt">${r.time}s · ${money(val)}</span></div>`;
      }).join('')).join('');
      footer = truckLine;
    }
    return `<div class="pw term">${this._header('Foundry Supply Net', 'Terminal 01 · Plant 07')}
      <nav class="tabs">${tabs.map(([k, n]) => `<button type="button" class="tab${this.tab === k ? ' on' : ''}" data-act="tab" data-tab="${k}">${n}</button>`).join('')}</nav>
      <div class="scroll">${body}</div>
      <footer class="pw-foot term-foot">${footer}</footer></div>`;
  }

  _company(sim, lvl, perks) {
    const pct = (lvl.frac * 100).toFixed(1);
    const next = lvl.level < MAX_LEVEL ? lvl.level + 1 : null;
    const nextPerks = next ? perksAt(next) : null;
    const unlocks = next ? [`+${money(levelGrant(next))} company grant`, `Sales bonus +${Math.round(nextPerks.saleBonus * 100)}%`, ...(LEVEL_UNLOCKS[next] || [])] : [];
    const have = [
      `Sales bonus <b>+${Math.round(perks.saleBonus * 100)}%</b> on goods you make`,
      perks.freeDelivery ? 'Free truck delivery' : `Truck delivery ${money(ECON.deliveryFee)} (free from level 3)`,
      perks.vanFast ? 'Pickup van loads twice as fast' : 'Pickup van: normal loading (2× faster from level 4)',
      `Scrap buyer pays ${Math.round(perks.scrapRate * 100)}%`,
      `${perks.contractSlots} contract slots`,
    ];
    const goals = GOALS.map((g) => {
      const done = sim.progress.goals.includes(g.id);
      const v = sim.goalProgress(g);
      const big = g.target >= 100;
      return `<div class="goal${done ? ' done' : ''}"><div class="g-main"><b>${esc(g.name)}</b><span>${esc(g.desc)}</span>
        ${done ? '' : `<div class="pbar"><i style="width:${(v / g.target * 100).toFixed(1)}%"></i></div><small>${big ? money(v) : v} / ${big ? money(g.target) : g.target}</small>`}</div>
        <div class="g-reward">${done ? '✓ Paid' : `+${money(g.reward)}`}</div></div>`;
    }).join('');
    return `<div class="lvl-card"><div class="lvl-badge"><small>Level</small><b>${lvl.level}</b></div>
      <div class="lvl-main"><div class="lvl-row"><span>${next ? `${money(lvl.into)} / ${money(lvl.need)} XP to level ${next}` : 'Top level reached'}</span><span>Lifetime ${money(sim.stats.madeValue || 0)} earned</span></div>
      <div class="pbar big"><i style="width:${pct}%"></i></div>
      <p class="note">XP = money from selling parts and products your factory made, plus contract bonuses.</p></div></div>
      <div class="lvl-cols"><div><h3>Active perks</h3><ul class="perks">${have.map((h) => `<li>${h}</li>`).join('')}</ul></div>
      ${next ? `<div><h3>Level ${next} unlocks</h3><ul class="perks next">${unlocks.map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}</div>
      <h3>Goals · ${sim.progress.goals.length} / ${GOALS.length}</h3><div class="goals">${goals}</div>`;
  }

  _machine() {
    const sim = this.ctx.sim, id = this.machine, m = sim.machines.get(id), def = m.def;
    const inv = this.inv;
    const run = !!m.current;
    const status = run ? `${m.current.recipe.name}${m.current.auto ? ' (auto)' : ''} · ${m.queue.length} queued` : m.auto ? 'Auto-run · waiting for inputs' : 'Idle';
    const cards = def.recipes.map((r) => {
      const ins = Object.entries(r.inputs).map(([t, n]) => {
        const have = inv.count(t);
        return `<span class="chip-i${have >= n ? '' : ' miss'}">${this._icon(t, 'xs')}${n}× ${esc(ITEMS[t].name)} <em>${have}</em></span>`;
      }).join('');
      const outs = Object.entries(r.outputs).map(([t, n]) => `<span class="chip-i out">${this._icon(t, 'xs')}${n}× ${esc(ITEMS[t].name)}</span>`).join('');
      const maxN = Math.min(...Object.entries(r.inputs).map(([t, n]) => Math.floor(inv.count(t) / n)));
      const ok = maxN > 0;
      return `<div class="rcard"><div class="rc-name">${esc(r.name)} <span>${r.time}s each</span></div>
        <div class="recipe">${ins}<span class="arrow">→</span>${outs}</div>
        <div class="btns"><button type="button" class="btn primary${ok ? '' : ' disabled'}" data-act="run" data-recipe="${r.id}" data-n="1">Run ×1</button>
        <button type="button" class="btn${maxN >= 5 ? '' : ' disabled'}" data-act="run" data-recipe="${r.id}" data-n="5">×5</button>
        <button type="button" class="btn${ok ? '' : ' disabled'}" data-act="run" data-recipe="${r.id}" data-n="max">All (${Math.min(maxN, ECON.maxQueue)})</button></div></div>`;
    }).join('');
    const g = m.geo;
    const inBelt = sim.beltAt(g.in.x - g.in.dx, g.in.z - g.in.dz);
    const inOk = inBelt && inBelt.dx === g.in.dx && inBelt.dz === g.in.dz;
    const outBelt = sim.beltAt(g.out.x, g.out.z);
    const buf = Object.entries(m.buffer).map(([t, n]) => `<span class="chip-i">${this._icon(t, 'xs')}${n}× ${esc(ITEMS[t].name)}</span>`).join('') || '<span class="note">Empty</span>';
    const autoBtns = [`<button type="button" class="tab${!m.auto ? ' on' : ''}" data-act="auto" data-recipe="">Off</button>`]
      .concat(def.recipes.map((r) => `<button type="button" class="tab${m.auto === r.id ? ' on' : ''}" data-act="auto" data-recipe="${r.id}">${esc(r.name)}</button>`)).join('');
    const auto = `<div class="rcard auto"><div class="rc-name">Automation</div>
      <div class="auto-row"><small>Auto-run from input belt</small><div class="seg">${autoBtns}</div></div>
      <div class="auto-row"><small>Send output to</small><div class="seg">
        <button type="button" class="tab${m.outMode === 'tray' ? ' on' : ''}" data-act="output" data-mode="tray">Tray (pick up)</button>
        <button type="button" class="tab${m.outMode === 'belt' ? ' on' : ''}" data-act="output" data-mode="belt">Output belt</button></div></div>
      <div class="auto-row"><small>Ports</small><span class="ports"><i class="${inOk ? 'ok' : ''}">Input belt ${inOk ? 'connected' : 'not connected'}</i><i class="${outBelt ? 'ok' : ''}">Output belt ${outBelt ? 'connected' : 'not connected'}</i></span></div>
      <div class="auto-row"><small>Input buffer</small><div class="recipe">${buf}</div>${Object.keys(m.buffer).length ? '<button type="button" class="btn sm" data-act="unload">Unload to inventory</button>' : ''}</div>
      <p class="note">Belts feed the green arrow on the floor; the amber arrow is where output belts start. Anything a belt carries into the sell corner goes down the chute.</p></div>`;
    const busy = run || m.queue.length || m.outBuffer.length;
    return `<div class="pw mach">${this._header(def.name, 'Machine')}
      <div class="mstatus${run ? ' on' : ''}"><span>${esc(status)}</span><div class="pbar"><i data-live="progress" style="width:${(sim.machineProgress(id) * 100).toFixed(1)}%"></i></div></div>
      <div class="scroll">${cards}${auto}</div>
      <footer class="pw-foot"><button type="button" class="btn${busy ? ' disabled' : ''}" data-act="pack">Pack up machine</button><span>Materials for manual runs come out of your inventory. <kbd>E</kbd> closes</span></footer></div>`;
  }
}
