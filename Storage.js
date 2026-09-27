// Per-browser storage: company save slots, settings and career stats. Every access is
// wrapped because storage can be missing (private windows, blocked site data); the game
// then just runs without persistence.
import { levelFor } from '../shared/factory/progression.js';

const get = (k) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (_) { return null; } };
const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
const del = (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } };

export const MAX_SLOTS = 3;
const INDEX = 'foundry-line-slots';
const LEGACY = 'foundry-line-save-v3';
const slotKey = (id) => `foundry-line-slot-${id}`;

export const COMPANY_COLORS = [0xf2b01e, 0x2fb5c9, 0xe5483b, 0x7fd18b, 0xb07cff, 0xff8a3d];

export class Saves {
  constructor() {
    this.index = get(INDEX) || [];
    // 0.3 kept a single save — adopt it as the first company
    if (!this.index.length) {
      const legacy = get(LEGACY);
      if (legacy && legacy.v === 3) {
        const meta = this._meta('s1', 'Plant 07', COMPANY_COLORS[0], legacy);
        this.index = [meta];
        put(slotKey('s1'), legacy);
        put(INDEX, this.index);
      }
    }
  }

  list() { return this.index.slice().sort((a, b) => (b.played || 0) - (a.played || 0)); }
  get(id) { return this.index.find((s) => s.id === id) || null; }
  load(id) { return get(slotKey(id)); }
  last() { return this.list()[0] || null; }
  get full() { return this.index.length >= MAX_SLOTS; }

  _meta(id, name, color, data, prev = {}) {
    const lvl = levelOf(data);
    return {
      id, name, color, created: prev.created || Date.now(), played: Date.now(),
      playtime: prev.playtime || 0,
      funds: data ? data.funds : 0, level: lvl,
      machines: data && data.machines ? data.machines.length : 1,
      earned: data && data.stats ? data.stats.madeValue || data.stats.shippedValue || 0 : 0,
    };
  }

  create(name, color) {
    const used = new Set(this.index.map((s) => s.id));
    let n = 1;
    while (used.has(`s${n}`)) n++;
    const id = `s${n}`;
    const meta = this._meta(id, cleanCompany(name), color, null);
    this.index.push(meta);
    put(INDEX, this.index);
    return meta;
  }

  /** Store a factory snapshot for a slot (and refresh the card shown on the menu). */
  write(id, data, addPlaytime = 0) {
    const i = this.index.findIndex((s) => s.id === id);
    if (i < 0) return false;
    const prev = this.index[i];
    this.index[i] = { ...this._meta(id, prev.name, prev.color, data, prev), playtime: (prev.playtime || 0) + addPlaytime };
    put(INDEX, this.index);
    return put(slotKey(id), data);
  }

  rename(id, name) {
    const s = this.get(id);
    if (!s) return;
    s.name = cleanCompany(name);
    put(INDEX, this.index);
  }

  remove(id) {
    this.index = this.index.filter((s) => s.id !== id);
    put(INDEX, this.index);
    del(slotKey(id));
  }
}

export const cleanCompany = (s) => String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 24) || 'New Company';

function levelOf(data) {
  return levelFor(data && data.progress ? data.progress.xp || 0 : 0).level;
}

// ------------------------------------------------------------------ settings
export const DEFAULT_SETTINGS = {
  name: '', color: 0xff6b1a,
  sens: 1, adsSens: 0.6, invertY: false,
  fov: 74, bob: 1, renderScale: 1, shadows: 'high', showFps: true,
  master: 0.8, sfx: 1, music: 0.45,
  crosshair: 'cross', crossColor: '#ede8df', hints: true, damageNumbers: true,
  server: '',
};

export function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...(get('foundry-line-settings') || {}) };
  if (!s.name) { s.name = `Worker${Math.floor(100 + Math.random() * 900)}`; put('foundry-line-settings', s); }
  return s;
}
export const saveSettings = (s) => put('foundry-line-settings', s);

// ------------------------------------------------------------------ career
export const DEFAULT_CAREER = { shots: 0, hits: 0, headshots: 0, plates: 0, earned: 0, levels: 0, goals: 0, distance: 0, playtime: 0, hosted: 0, joined: 0, vans: 0 };
export const loadCareer = () => ({ ...DEFAULT_CAREER, ...(get('foundry-line-career') || {}) });
export const saveCareer = (c) => put('foundry-line-career', c);
