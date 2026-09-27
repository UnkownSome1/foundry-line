// DOM heads-up display. Reads game state each frame; only touches the DOM when a
// value actually changes.
import { GOALS } from '../../shared/factory/progression.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

export class HUD {
  constructor(magSize) {
    this.el = {
      hud: $('hud'), cross: $('crosshair'), hit: $('hitmarker'), ammoMag: $('ammo-mag'), ammoCh: $('ammo-chamber'),
      ammoRes: $('ammo-reserve'), pips: $('ammo-pips'), status: $('ammo-status'), hp: $('hp-val'), hpBar: $('hp-bar'),
      stance: $('stance'), heading: $('heading'), strip: $('compass-strip'), feed: $('killfeed'), hint: $('hint'),
      fps: $('perf'), dmg: $('dmgnum'),
      funds: $('funds-val'), fundsDelta: $('funds-delta'), prompt: $('prompt'), toasts: $('toasts'), wallet: $('wallet-val'),
      lvNum: $('lv-num'), xpBar: $('xp-bar'), xpTxt: $('xp-txt'), goals: $('goals'), roster: $('roster'), banner: $('banner'),
    };
    this.mode = 'SOLO';
    this.showDamage = true;
    this.shownFunds = null;
    this.targetFunds = 0;
    this.cache = {};
    this.pips = [];
    for (let i = 0; i < magSize; i++) {
      const p = document.createElement('i');
      this.el.pips.appendChild(p);
      this.pips.push(p);
    }
    this.hitT = 9;
    this.dmgT = 9;
    this.fpsAcc = 0; this.fpsN = 0;
    this._buildCompass();
  }

  set(key, el, prop, val) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    el[prop] = val;
  }

  _buildCompass() {
    const strip = this.el.strip;
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let d = -180; d <= 540; d += 15) {
      const n = ((d % 360) + 360) % 360;
      const lab = labels[n];
      html += `<span class="${lab ? 'major' : ''}" style="left:${(d + 180) * 4}px">${lab || (n % 45 === 0 ? '' : '·')}</span>`;
    }
    strip.innerHTML = html;
  }

  update(dt, s) {
    const e = this.el;
    // ammo
    const w = s.weapon;
    this.set('mag', e.ammoMag, 'textContent', String(w.mag));
    e.ammoCh.classList.toggle('on', w.chambered);
    this.set('res', e.ammoRes, 'textContent', String(w.reserve));
    const pipKey = `${w.mag}|${w.def.magSize}`;
    if (this.cache.pips !== pipKey) {
      this.cache.pips = pipKey;
      this.pips.forEach((p, i) => p.classList.toggle('spent', i >= w.mag));
    }
    let status = '';
    if (w.action === 'reload') status = w.reloadKind === 'empty' ? 'RELOADING · SLIDE LOCKED' : 'RELOADING';
    else if (w.slideLocked && w.reserve <= 0) status = 'OUT OF AMMO';
    else if (w.slideLocked) status = 'SLIDE LOCKED — PRESS R';
    else if (w.mag <= 3) status = 'LOW — PRESS R';
    this.set('status', e.status, 'textContent', status);
    e.status.dataset.tone = w.slideLocked || w.mag <= 3 ? 'warn' : 'ok';

    // health + stance
    this.set('hp', e.hp, 'textContent', String(Math.round(s.health)));
    this.set('hpw', e.hpBar.style, 'width', `${Math.max(0, s.health)}%`);
    this.set('stance', e.stance, 'textContent', s.stance);

    // crosshair spread (hidden while aiming)
    const gap = 8 + s.spreadPx;
    e.cross.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    e.cross.style.opacity = String(Math.max(0, 1 - s.aim * 1.6) * (s.sprint ? 0.25 : 1));

    // compass
    const deg = ((s.headingDeg % 360) + 360) % 360;
    this.set('hdg', e.heading, 'textContent', String(Math.round(deg)).padStart(3, '0') + '°');
    e.strip.style.transform = `translateX(${-(deg + 180) * 4}px)`;

    // hitmarker + damage number
    this.hitT += dt;
    e.hit.style.opacity = String(Math.max(0, 1 - this.hitT / 0.28));
    this.dmgT += dt;
    e.dmg.style.opacity = String(Math.max(0, 1 - this.dmgT / 0.7));
    e.dmg.style.transform = `translate(-50%, ${-this.dmgT * 30}px)`;

    // hint
    this.set('hint', e.hint, 'textContent', s.hint || '');

    // funds roll toward the target
    if (this.shownFunds !== null) {
      const diff = this.targetFunds - this.shownFunds;
      this.shownFunds = Math.abs(diff) < 1 ? this.targetFunds : this.shownFunds + diff * Math.min(1, dt * 8);
      this.set('funds', e.funds, 'textContent', '$' + Math.round(this.shownFunds).toLocaleString('en-US'));
    }

    // perf
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      e.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · ${this.mode} · SIM 60 Hz · ${s.view}`;
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  /** Company funds with a rolling counter + delta popup. */
  setFunds(n, delta = 0) {
    this.targetFunds = n;
    if (this.shownFunds === null) this.shownFunds = n;
    if (delta) {
      const d = this.el.fundsDelta;
      d.textContent = (delta > 0 ? '+' : '−') + '$' + Math.abs(Math.round(delta)).toLocaleString('en-US');
      d.dataset.tone = delta > 0 ? 'ok' : 'warn';
      d.classList.remove('pop');
      void d.offsetWidth;
      d.classList.add('pop');
    }
  }

  setWallet(n) {
    this.set('wallet', this.el.wallet, 'textContent', '$' + Math.round(n).toLocaleString('en-US'));
  }

  prompt(text) {
    this.set('prompt', this.el.prompt, 'innerHTML', text || '');
  }

  toast(text, tone = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + tone;
    t.textContent = text;
    this.el.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3800);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  hitmarker(kind, dmg) {
    this.hitT = 0;
    this.el.hit.dataset.kind = kind;
    if (!this.showDamage) return;
    this.dmgT = 0;
    this.el.dmg.textContent = String(dmg);
    this.el.dmg.dataset.kind = kind;
  }

  /** Company level badge + XP bar under the funds. */
  setLevel(info) {
    const key = `${info.level}|${Math.round(info.frac * 200)}`;
    if (this.cache.lvl === key) return;
    this.cache.lvl = key;
    this.el.lvNum.textContent = String(info.level);
    this.el.xpBar.style.width = `${(info.frac * 100).toFixed(1)}%`;
    this.el.xpTxt.textContent = info.need ? `${money(info.into)} / ${money(info.need)} XP` : 'MAX LEVEL';
  }

  /** The next few goals with progress bars (top-left). */
  setGoals(sim, show = true) {
    const open = show ? GOALS.filter((g) => !sim.progress.goals.includes(g.id)).slice(0, 3) : [];
    const html = open.length ? `<small>Goals</small>${open.map((g) => {
      const v = sim.goalProgress(g), big = g.target >= 100;
      return `<div class="gl"><div class="gl-top"><b>${esc(g.name)}</b><em>+${money(g.reward)}</em></div><span>${esc(g.desc)}${g.target > 1 ? ` · ${big ? money(v) : v}/${big ? money(g.target) : g.target}` : ''}</span><i style="--p:${(v / g.target * 100).toFixed(1)}%"></i></div>`;
    }).join('')}` : '';
    this.set('goals', this.el.goals, 'innerHTML', html);
  }

  /** Co-op roster: who's here, invite code, ping. */
  setRoster(info) {
    const html = info ? `<small>${info.host ? 'Hosting' : 'Co-op'} · code <b>${esc(info.code || '—')}</b> · ${Math.round(info.ping)} ms</small>${info.players.map((p) => `<div><i style="background:#${(p.color >>> 0).toString(16).padStart(6, '0')}"></i>${esc(p.name)}${p.you ? ' <em>you</em>' : ''}</div>`).join('')}` : '';
    this.set('roster', this.el.roster, 'innerHTML', html);
  }

  /** Big celebratory banner (level up). */
  banner(title, sub, lines = []) {
    const b = this.el.banner;
    b.innerHTML = `<small>${esc(sub)}</small><b>${esc(title)}</b>${lines.length ? `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = setTimeout(() => b.classList.remove('show'), 4800);
  }

  feed(text, tone = '') {
    const row = document.createElement('div');
    row.className = 'feed-row ' + tone;
    row.textContent = text;
    this.el.feed.prepend(row);
    setTimeout(() => row.classList.add('out'), 4200);
    setTimeout(() => row.remove(), 5000);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
  }
}
