// Main menu + pause menu. Plain DOM over the live 3D scene (the menu camera flies
// shots around your plant). The game object supplies saves, settings and actions.
import { MAX_SLOTS, COMPANY_COLORS, DEFAULT_SETTINGS } from '../Storage.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const ago = (t) => {
  if (!t) return 'never';
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const hms = (s) => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };

export const PLAYER_COLORS = [0xff6b1a, 0x2fb5c9, 0xf2b01e, 0x7fd18b, 0xe5483b, 0xb07cff, 0xede8df, 0x4a78ff];

const TIPS = [
  'Belts that run into the sell corner drop goods straight down the chute.',
  'Crafting a machine kit at the fab bench costs about a third of buying it.',
  'Company levels raise the price the van pays for everything your factory makes.',
  'Goals pay cash the moment you reach them. Check the Company tab at the terminal.',
  'Set a machine to auto-run and feed its green input arrow with a belt.',
  'The ammo crates by the door and on the range never run dry.',
  'In co-op, whoever drops goods in the cage gets 20% of their sale.',
  'Press B to cycle through every kit you are carrying in build mode.',
  'From level 3 the delivery truck is free. From level 4 the van loads twice as fast.',
  'Government contracts pay bigger bonuses but take longer.',
];

const NEWS = [
  { v: '0.4', title: 'Co-op update', date: 'Sep 2026', items: [
    'Two-player co-op: host your company, share a 4-letter code, and a friend joins your plant.',
    'Dedicated game server with client prediction, so movement stays smooth online.',
    'New main menu: company save slots, profile colours, settings, career stats.',
    'Company levels + goals: cash grants, a sales bonus that grows, free delivery, faster vans.',
    'Easier start: $900, better prices for made goods, faster crafting, 6 belts per craft.',
  ] },
  { v: '0.3.1', title: 'Fixes', date: 'Sep 2026', items: [
    'Resetting progress no longer refunds orders that are still being delivered.',
    'Bunny hopping and air strafing can no longer build up speed.',
    'The SELL sign sits flat on the wall again.',
    'Heavier pistol recoil: muzzle flip around the wrist and climb you pull down.',
  ] },
  { v: '0.3', title: 'Build your factory', date: 'Sep 2026', items: [
    'Empty hall, buy or craft every machine, free grid placement.',
    'Conveyors with input/output ports and auto-run.',
    'Sell corner, pickup cage, Hallett Freight van, buyer contracts.',
  ] },
  { v: '0.2', title: 'Factory', date: 'Sep 2026', items: ['Supply terminal, delivery truck, items, inventory, machines, unlimited ammo crates.'] },
  { v: '0.1', title: 'First build', date: 'Sep 2026', items: ['Operator model, Foundry P9 with magazine and reloads, Plant 07 map.'] },
];

export class Menu {
  constructor(game) {
    this.g = game;
    this.el = document.getElementById('menu');
    this.nav = document.getElementById('m-nav');
    this.screenEl = document.getElementById('m-screen');
    this.tipEl = document.getElementById('m-tip');
    this.chipsEl = document.getElementById('m-chips');
    this.pauseEl = document.getElementById('pause');
    this.overlay = document.getElementById('overlay');
    this.screen = 'home';
    this.setTab = 'controls';
    this.confirmDel = null;
    this.tip = Math.floor(Math.random() * TIPS.length);
    this.el.addEventListener('click', (e) => this._click(e));
    this.el.addEventListener('input', (e) => this._input(e));
    this.el.addEventListener('change', (e) => this._input(e, true));
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[data-enter]')) this._act(e.target.dataset.enter, e.target); });
    this.pauseEl.addEventListener('click', (e) => this._click(e));
    this.pauseEl.addEventListener('input', (e) => this._input(e));
    this.pauseEl.addEventListener('change', (e) => this._input(e, true));
    let lastHover = null;
    const hover = (e) => {
      const b = e.target.closest && e.target.closest('button:not([disabled])');
      if (b && b !== lastHover) this.g.audio.ui('hover');
      lastHover = b;
    };
    this.el.addEventListener('mouseover', hover);
    this.pauseEl.addEventListener('mouseover', hover);
    setInterval(() => this._nextTip(), 7000);
    this._nextTip(true);
    this.render();
  }

  // ------------------------------------------------------------------ public
  show(screen = this.screen) {
    this.screen = screen;
    this.g.setMenuShot(screen);
    this.render();
  }

  render() {
    this._renderNav();
    this.screenEl.innerHTML = this._screen();
    this.screenEl.dataset.screen = this.screen;
    this.screenEl.classList.remove('enter');
    void this.screenEl.offsetWidth;
    this.screenEl.classList.add('enter');
    this._renderChips();
  }

  message(text, tone = '') {
    this.msg = text ? { text, tone } : null;
    this.render();
  }

  busy(text) {
    if (!text) { this.overlay.hidden = true; return; }
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<div class="ov-card"><div class="spin"></div><div>${esc(text)}</div></div>`;
  }

  /** After connecting: pointer lock needs a click, so ask for one. */
  ready(title, sub) {
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<div class="ov-card ready"><div class="ov-title">${esc(title)}</div><div class="ov-sub">${sub}</div>
      <button type="button" class="m-btn primary" id="ov-go">Deploy</button></div>`;
    this.overlay.querySelector('#ov-go').addEventListener('click', () => { this.overlay.hidden = true; this.g.deploy(); }, { once: true });
  }

  // ------------------------------------------------------------------ nav
  _renderNav() {
    const last = this.g.saves.last();
    const srv = this.g.serverInfo;
    const items = [
      last ? ['continue', 'Continue', `${esc(last.name)} · Lv ${last.level}`] : ['new', 'New company', 'Start your plant'],
      ['solo', 'Play solo', `${this.g.saves.list().length} / ${MAX_SLOTS} companies`],
      ['coop', 'Co-op', srv ? 'Host or join · 2 players' : 'Needs the game server'],
      ['profile', 'Profile', esc(this.g.settings.name)],
      ['settings', 'Settings', 'Controls · video · audio'],
      ['career', 'Career', 'Your stats'],
      ['news', "What's new", 'Build 0.4'],
    ];
    if (!this.navDone) { this.nav.classList.add('intro'); setTimeout(() => this.nav.classList.remove('intro'), 1200); this.navDone = true; }
    this.nav.innerHTML = items.map(([k, t, s], i) => `<button type="button" class="m-item${i === 0 ? ' primary' : ''}${this.screen === k || (k === 'continue' && this.screen === 'home') ? ' on' : ''}" data-act="nav" data-screen="${k}" style="--i:${i}">
      <b>${t}</b><small>${s}</small></button>`).join('');
  }

  _renderChips() {
    const s = this.g.settings, srv = this.g.serverInfo;
    this.chipsEl.innerHTML = `<button type="button" class="m-chip" data-act="nav" data-screen="profile"><i style="background:${hex(s.color)}"></i>${esc(s.name)}</button>
      <span class="m-chip ${srv ? 'ok' : ''}"><i></i>${srv ? `Server online · ${srv.rooms} session${srv.rooms === 1 ? '' : 's'}` : 'Offline preview'}</span>`;
  }

  _nextTip(first = false) {
    if (!first) this.tip = (this.tip + 1) % TIPS.length;
    if (!this.tipEl) return;
    this.tipEl.classList.remove('show');
    setTimeout(() => { this.tipEl.innerHTML = `<b>TIP</b>${esc(TIPS[this.tip])}`; this.tipEl.classList.add('show'); }, first ? 0 : 250);
  }

  // ------------------------------------------------------------------ screens
  _screen() {
    const msg = this.msg ? `<div class="m-msg ${this.msg.tone}">${esc(this.msg.text)}</div>` : '';
    switch (this.screen) {
      case 'solo': return msg + this._solo();
      case 'new': return msg + this._new();
      case 'coop': return msg + this._coop();
      case 'profile': return msg + this._profile();
      case 'settings': return msg + this._settings();
      case 'career': return msg + this._career();
      case 'news': return msg + this._news();
      default: return msg + this._home();
    }
  }

  _slotCard(s, { big = false, pick = null } = {}) {
    const del = this.confirmDel === s.id;
    return `<div class="slot-card${big ? ' big' : ''}" style="--c:${hex(s.color)}">
      <div class="sc-top"><span class="sc-lv">LV ${s.level}</span><b class="sc-name">${esc(s.name)}</b></div>
      <dl class="sc-stats"><div><dt>Funds</dt><dd>${money(s.funds)}</dd></div><div><dt>Machines</dt><dd>${s.machines}</dd></div>
        <div><dt>Earned</dt><dd>${money(s.earned)}</dd></div><div><dt>Played</dt><dd>${hms(s.playtime)}</dd></div></dl>
      <div class="sc-foot"><small>Last played ${ago(s.played)}</small>
        ${pick ? `<button type="button" class="m-btn primary" data-act="${pick}" data-id="${s.id}">${pick === 'host' ? 'Host this company' : 'Play'}</button>` : ''}
        ${!big && !pick ? `<button type="button" class="m-btn primary" data-act="play" data-id="${s.id}">Play</button>
          <button type="button" class="m-btn ghost${del ? ' danger' : ''}" data-act="delete" data-id="${s.id}">${del ? 'Click again to delete' : 'Delete'}</button>` : ''}
      </div></div>`;
  }

  _home() {
    const last = this.g.saves.last();
    const news = NEWS[0];
    return `<div class="m-card hero">
      ${last ? `<div class="m-kicker">Continue where you left off</div>${this._slotCard(last, { big: true })}
        <div class="m-actions"><button type="button" class="m-btn primary big" data-act="play" data-id="${last.id}">Deploy</button>
        <button type="button" class="m-btn" data-act="nav" data-screen="coop">Host co-op</button></div>`
      : `<div class="m-kicker">Welcome to Plant 07</div><h2 class="m-h2">Start your company</h2>
        <p class="m-p">An empty hall, a fab bench and $900. Buy or craft machines, run conveyor lines to the sell corner, and grow the business.</p>
        <div class="m-actions"><button type="button" class="m-btn primary big" data-act="nav" data-screen="new">New company</button></div>`}
      </div>
      <div class="m-card news-mini"><div class="m-kicker">Build ${news.v} · ${esc(news.title)}</div>
        <ul>${news.items.slice(0, 3).map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
        <button type="button" class="m-link" data-act="nav" data-screen="news">All patch notes →</button></div>`;
  }

  _solo() {
    const list = this.g.saves.list();
    return `<div class="m-card"><div class="m-kicker">Play solo</div><h2 class="m-h2">Your companies</h2>
      <div class="slots">${list.map((s) => this._slotCard(s)).join('')}
      ${list.length < MAX_SLOTS ? `<button type="button" class="slot-card add" data-act="nav" data-screen="new"><b>+</b><span>New company</span><small>${MAX_SLOTS - list.length} slot${MAX_SLOTS - list.length === 1 ? '' : 's'} free</small></button>` : ''}
      </div><p class="m-note">Progress saves in this browser every few seconds and when you quit to the menu.</p></div>`;
  }

  _new() {
    const full = this.g.saves.full;
    const pick = this.newColor ?? COMPANY_COLORS[this.g.saves.list().length % COMPANY_COLORS.length];
    this.newColor = pick;
    return `<div class="m-card"><div class="m-kicker">New company</div><h2 class="m-h2">Name your plant</h2>
      ${full ? `<p class="m-p">All ${MAX_SLOTS} company slots are in use. Delete one under Play solo first.</p>` : `
      <label class="m-field"><span>Company name</span><input id="new-name" type="text" maxlength="24" placeholder="e.g. Hallett Heavy Industries" data-enter="create" autocomplete="off"></label>
      <div class="m-field"><span>Company colour</span><div class="swatches">${COMPANY_COLORS.map((c) => `<button type="button" class="sw${c === pick ? ' on' : ''}" style="--c:${hex(c)}" data-act="newcolor" data-c="${c}" aria-label="Colour"></button>`).join('')}</div></div>
      <p class="m-p">You start with <b>$900</b>, a supply terminal and a fab bench. Goals pay out as you go — the first few come fast.</p>
      <div class="m-actions"><button type="button" class="m-btn primary big" data-act="create">Create &amp; deploy</button></div>`}</div>`;
  }

  _coop() {
    const srv = this.g.serverInfo;
    const list = this.g.saves.list();
    if (!srv) {
      return `<div class="m-card"><div class="m-kicker">Co-op · 2 players</div><h2 class="m-h2">Co-op needs the game server</h2>
        <p class="m-p">This copy of the game is running without its server (like the preview on claude.ai), so hosting and joining are off here.</p>
        <p class="m-p">Put the game on your free Render server once, then open the game from that address. You and a friend both play from that link: the host picks a company, shares the 4-letter code, and the friend joins with it.</p>
        <ol class="m-steps"><li>Upload the project to a GitHub repository</li><li>On render.com: New → Blueprint → pick the repository (it reads <code>render.yaml</code>)</li><li>Open the <code>…onrender.com</code> address it gives you</li></ol>
        <p class="m-note">Full steps are in <code>DEPLOY.md</code> in the project files. A free Render server sleeps after 15 minutes with nobody on it; the first visit after that takes about a minute to load.</p>
        <button type="button" class="m-btn" data-act="probe">Check again</button></div>`;
    }
    return `<div class="m-card coop"><div class="m-kicker">Co-op · 2 players · server ${esc(srv.version)}</div>
      <div class="coop-cols">
        <section><h2 class="m-h2">Host</h2><p class="m-p">Your company runs on the server; progress saves back to your slot. Share the code with your friend.</p>
          <div class="slots mini">${list.length ? list.map((s) => this._slotCard(s, { pick: 'host' })).join('') : '<p class="m-note">Create a company first (Play solo → New company).</p>'}</div></section>
        <section><h2 class="m-h2">Join</h2><p class="m-p">Enter the code the host sees in their pause menu.</p>
          <label class="m-field"><span>Session code</span><input id="join-code" class="code-in" type="text" maxlength="4" placeholder="ABCD" autocomplete="off" data-enter="join" style="text-transform:uppercase"></label>
          <div class="m-actions"><button type="button" class="m-btn primary big" data-act="join">Join session</button></div>
          <p class="m-note">You'll play as <b style="color:${hex(this.g.settings.color)}">${esc(this.g.settings.name)}</b>. Your inventory and wallet are kept in the host's save for next time.</p></section>
      </div></div>`;
  }

  _profile() {
    const s = this.g.settings;
    return `<div class="m-card"><div class="m-kicker">Profile</div><h2 class="m-h2">How others see you</h2>
      <label class="m-field"><span>Name</span><input id="p-name" type="text" maxlength="16" value="${esc(s.name)}" data-set="name" autocomplete="off"></label>
      <div class="m-field"><span>Suit colour</span><div class="swatches">${PLAYER_COLORS.map((c) => `<button type="button" class="sw${c === s.color ? ' on' : ''}" style="--c:${hex(c)}" data-act="pcolor" data-c="${c}" aria-label="Colour"></button>`).join('')}</div></div>
      <p class="m-note">Your name tag and suit colour show to your co-op partner. The operator in the yard is you.</p></div>`;
  }

  _range(key, label, min, max, step, fmt) {
    const v = this.g.settings[key];
    return `<label class="m-range"><span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-set="${key}" data-num="1"><output>${fmt(v)}</output></label>`;
  }

  _toggle(key, label) {
    const v = this.g.settings[key];
    return `<button type="button" class="m-toggle${v ? ' on' : ''}" data-act="toggle" data-key="${key}"><span>${label}</span><i></i></button>`;
  }

  _choice(key, label, opts) {
    const v = this.g.settings[key];
    return `<div class="m-choice"><span>${label}</span><div class="seg">${opts.map(([val, name]) => `<button type="button" class="${String(v) === String(val) ? 'on' : ''}" data-act="choice" data-key="${key}" data-v="${val}">${name}</button>`).join('')}</div></div>`;
  }

  _settingsBody() {
    const pct = (v) => `${Math.round(v * 100)}%`;
    switch (this.setTab) {
      case 'video': return this._range('fov', 'Field of view', 60, 100, 1, (v) => `${v}°`)
        + this._choice('renderScale', 'Resolution', [[0.6, '60%'], [0.8, '80%'], [1, '100%']])
        + this._choice('shadows', 'Shadows', [['off', 'Off'], ['low', 'Low'], ['high', 'High']])
        + this._range('bob', 'View bob', 0, 1.5, 0.05, pct)
        + this._toggle('showFps', 'Show FPS counter');
      case 'audio': return this._range('master', 'Master volume', 0, 1, 0.05, pct)
        + this._range('sfx', 'Effects', 0, 1, 0.05, pct) + this._range('music', 'Menu music', 0, 1, 0.05, pct);
      case 'game': return this._choice('crosshair', 'Crosshair', [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle']])
        + `<div class="m-choice"><span>Crosshair colour</span><div class="swatches sm">${['#ede8df', '#7fd18b', '#2fb5c9', '#f2b01e', '#ff5ad1', '#e5483b'].map((c) => `<button type="button" class="sw${this.g.settings.crossColor === c ? ' on' : ''}" style="--c:${c}" data-act="crosscolor" data-c="${c}" aria-label="Colour"></button>`).join('')}</div></div>`
        + this._toggle('hints', 'Show hints') + this._toggle('damageNumbers', 'Damage numbers');
      default: return this._range('sens', 'Mouse sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))
        + this._range('adsSens', 'Aiming sensitivity', 0.2, 1.2, 0.05, (v) => `${Math.round(v * 100)}%`)
        + this._toggle('invertY', 'Invert mouse Y')
        + `<div class="keys-list">${[['W A S D', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['C / Ctrl', 'Crouch'], ['LMB / RMB', 'Fire / aim'], ['R', 'Reload · rotate in build mode'], ['E', 'Interact · pick up'], ['Tab / I', 'Inventory'], ['B', 'Build mode'], ['F', 'Inspect'], ['V', 'Third person'], ['H', 'Help'], ['Esc', 'Pause menu']].map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('')}</div>`;
    }
  }

  _settings(inPause = false) {
    const tabs = [['controls', 'Controls'], ['video', 'Video'], ['audio', 'Audio'], ['game', 'Gameplay']];
    return `<div class="m-card settings"><div class="m-kicker">Settings</div>
      <nav class="m-tabs">${tabs.map(([k, n]) => `<button type="button" class="${this.setTab === k ? 'on' : ''}" data-act="settab" data-tab="${k}">${n}</button>`).join('')}</nav>
      <div class="m-set">${this._settingsBody()}</div>
      <div class="m-actions"><button type="button" class="m-btn ghost" data-act="resetsettings">Restore defaults</button>${inPause ? '<button type="button" class="m-btn" data-act="pauseback">Back</button>' : ''}</div></div>`;
  }

  _career() {
    const c = this.g.career;
    const acc = c.shots ? Math.round((c.hits / c.shots) * 100) : 0;
    const tiles = [
      ['Money earned', money(c.earned)], ['Company levels', c.levels], ['Goals reached', c.goals], ['Van pickups', c.vans],
      ['Shots fired', c.shots.toLocaleString('en-US')], ['Accuracy', `${acc}%`], ['Headshots', c.headshots], ['Plates rung', c.plates],
      ['Distance walked', `${(c.distance / 1000).toFixed(1)} km`], ['Time played', hms(c.playtime)], ['Sessions hosted', c.hosted], ['Sessions joined', c.joined],
    ];
    return `<div class="m-card"><div class="m-kicker">Career</div><h2 class="m-h2">${esc(this.g.settings.name)}</h2>
      <div class="tiles">${tiles.map(([k, v]) => `<div class="tile"><small>${k}</small><b>${v}</b></div>`).join('')}</div>
      <p class="m-note">Across every company on this browser.</p></div>`;
  }

  _news() {
    return `<div class="m-card news"><div class="m-kicker">What's new</div>
      ${NEWS.map((n) => `<article><header><b>Build ${n.v}</b><span>${esc(n.title)}</span><small>${n.date}</small></header><ul>${n.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></article>`).join('')}</div>`;
  }

  // ------------------------------------------------------------------ pause
  showPause(view = 'main') {
    this.pauseView = view;
    this.pauseEl.hidden = false;
    this.renderPause();
  }

  hidePause() { this.pauseEl.hidden = true; }

  renderPause() {
    const g = this.g, s = g.session;
    if (this.pauseView === 'settings') { this.pauseEl.innerHTML = `<div class="p-wrap">${this._settings(true)}</div>`; return; }
    const online = s && s.online;
    const me = { name: g.settings.name, color: g.settings.color };
    const roster = online ? [{ ...me, you: true, host: s.isHost }, ...[...s.remotes.values()].map((r) => ({ name: r.name, color: r.color, host: r.id === 'local' }))] : [];
    const slot = g.slot ? g.saves.get(g.slot) : null;
    this.pauseEl.innerHTML = `<div class="p-wrap"><div class="m-card pause">
      <div class="m-kicker">${online ? (s.isHost ? 'Hosting co-op' : 'Co-op guest') : 'Solo'}${slot ? ` · ${esc(slot.name)}` : ''}</div>
      <h2 class="m-h2">${online ? 'Session menu' : 'Paused'}</h2>
      ${online ? `<p class="m-note">The factory keeps running while you're in this menu.</p>` : ''}
      ${online && s.code ? `<div class="invite"><small>Invite code</small><b id="invite-code">${esc(s.code)}</b><button type="button" class="m-btn" data-act="copycode">Copy</button>
        <p class="m-note">Your friend opens the same game address, picks Co-op → Join, and types this code.</p></div>` : ''}
      ${online ? `<ul class="roster">${roster.map((p) => `<li><i style="background:${hex(p.color)}"></i>${esc(p.name)}${p.you ? ' <em>you</em>' : ''}${p.host ? ' <em>host</em>' : ''}</li>`).join('')}
        ${roster.length < 2 ? '<li class="wait">Waiting for a friend to join…</li>' : ''}</ul><p class="m-note">Ping ${Math.round((s.rtt || 0) * 1000)} ms</p>` : ''}
      <div class="p-btns">
        <button type="button" class="m-btn primary big" data-act="resume">Resume</button>
        <button type="button" class="m-btn" data-act="pausesettings">Settings</button>
        <button type="button" class="m-btn" data-act="quit">${online ? (s.isHost ? 'End session & save' : 'Leave session') : 'Save & quit to menu'}</button>
      </div></div></div>`;
  }

  // ------------------------------------------------------------------ events
  _click(e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    this._act(b.dataset.act, b);
  }

  _act(act, b) {
    const g = this.g;
    switch (act) {
      case 'nav': {
        const sc = b.dataset.screen;
        this.msg = null;
        this.confirmDel = null;
        g.audio.ui();
        if (sc === 'continue') { const l = g.saves.last(); if (l) g.playSolo(l.id); return; }
        this.show(sc);
        if (sc === 'new') setTimeout(() => this.el.querySelector('#new-name')?.focus(), 30);
        if (sc === 'coop') setTimeout(() => this.el.querySelector('#join-code')?.focus(), 30);
        return;
      }
      case 'play': g.audio.ui('deploy'); g.playSolo(b.dataset.id); return;
      case 'host': g.audio.ui('confirm'); g.hostCoop(b.dataset.id); return;
      case 'join': {
        const code = (this.el.querySelector('#join-code')?.value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 4) { g.audio.ui('error'); this.message('Session codes are 4 characters.', 'warn'); return; }
        g.audio.ui('confirm');
        g.joinCoop(code);
        return;
      }
      case 'delete': {
        const id = b.dataset.id;
        if (this.confirmDel !== id) { this.confirmDel = id; g.audio.ui('error'); this.render(); return; }
        this.confirmDel = null;
        g.deleteCompany(id);
        this.render();
        return;
      }
      case 'newcolor': this.newColor = +b.dataset.c; g.audio.ui(); this.render(); return;
      case 'create': {
        const name = this.el.querySelector('#new-name')?.value || '';
        g.audio.ui('deploy');
        g.newCompany(name, this.newColor);
        this.newColor = null;
        return;
      }
      case 'pcolor': g.settings.color = +b.dataset.c; g.saveSettings(); g.audio.ui(); this.render(); return;
      case 'probe': g.probe(); return;
      case 'settab': this.setTab = b.dataset.tab; g.audio.ui(); this._rerender(); return;
      case 'toggle': g.settings[b.dataset.key] = !g.settings[b.dataset.key]; g.saveSettings(); g.audio.ui(); this._rerender(); return;
      case 'choice': {
        const k = b.dataset.key, v = b.dataset.v;
        g.settings[k] = typeof DEFAULT_SETTINGS[k] === 'number' ? +v : v;
        g.saveSettings(); g.audio.ui(); this._rerender(); return;
      }
      case 'crosscolor': g.settings.crossColor = b.dataset.c; g.saveSettings(); g.audio.ui(); this._rerender(); return;
      case 'resetsettings': {
        const keep = { name: g.settings.name, color: g.settings.color };
        Object.assign(g.settings, DEFAULT_SETTINGS, keep);
        g.saveSettings(); g.audio.ui('confirm'); this._rerender(); return;
      }
      case 'resume': g.audio.ui(); g.deploy(); return;
      case 'pausesettings': g.audio.ui(); this.showPause('settings'); return;
      case 'pauseback': g.audio.ui(); this.showPause('main'); return;
      case 'quit': g.audio.ui(); g.quitToMenu(); return;
      case 'copycode': {
        const code = g.session && g.session.code;
        try { navigator.clipboard.writeText(code); b.textContent = 'Copied'; } catch (_) { b.textContent = code; }
        g.audio.ui('confirm');
        return;
      }
    }
  }

  _rerender() {
    if (!this.pauseEl.hidden && this.pauseView === 'settings') this.renderPause(); else this.render();
  }

  _input(e, commit = false) {
    const t = e.target;
    const key = t.dataset && t.dataset.set;
    if (!key) return;
    const v = t.dataset.num ? +t.value : t.value;
    this.g.settings[key] = v;
    if (t.type === 'range') {
      const out = t.parentElement.querySelector('output');
      if (out) {
        const pct = ['master', 'sfx', 'music', 'bob', 'adsSens'].includes(key);
        out.textContent = key === 'fov' ? `${v}°` : pct ? `${Math.round(v * 100)}%` : (+v).toFixed(2);
      }
    }
    this.g.saveSettings(!commit);
    if (key === 'name' && commit) this._renderChips();
  }
}
