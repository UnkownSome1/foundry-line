// Synthesised sound (Web Audio): no sample downloads. One-shots can be 3D-positioned
// with HRTF panners that follow the camera, so other players' shots have direction.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volume = 0.8;
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    // buses: effects (this.master, kept for every existing one-shot) + music → output
    this.out = ctx.createGain();
    this.out.gain.value = this.volume;
    this.master = ctx.createGain();
    this.master.gain.value = this.vols ? this.vols.sfx : 1;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp);
    this.musicBus.connect(comp);
    comp.connect(this.out).connect(ctx.destination);
    if (this.vols) this.setVolumes(this.vols);
    if (this.wantMusic) this.music(true);
    // outdoor slap-back reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(1.6, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.28;
    this.reverb.connect(this.wet).connect(this.master);
    this.noiseBuf = this._noise(1.5);
    this.enabled = true;
    this._ambience();
  }

  _noise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec, decay) {
    const len = this.ctx.sampleRate * sec;
    const b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflection cluster + diffuse tail
        const early = i > this.ctx.sampleRate * 0.03 && i < this.ctx.sampleRate * 0.06 ? 0.6 : 0;
        d[i] = (Math.random() * 2 - 1) * ((1 - t) ** decay + early * (1 - t));
      }
    }
    return b;
  }

  /** {master, sfx, music} each 0..1 */
  setVolumes(v) {
    this.vols = { master: 0.8, sfx: 1, music: 0.45, ...v };
    this.volume = this.vols.master;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(this.vols.master, t, 0.05);
    this.master.gain.setTargetAtTime(this.vols.sfx, t, 0.05);
    if (this.musicOn) this.musicBus.gain.setTargetAtTime(this.vols.music * 0.55, t, 0.3);
  }

  // ---------------------------------------------------------------- music
  // A small procedural loop for the menus: kick, clanky hats, an anvil hit, a plucked
  // bass line and a pad over Am – F – C – G. Scheduled ahead on the audio clock.
  music(on) {
    this.wantMusic = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicOn = on;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setTargetAtTime(on ? (this.vols ? this.vols.music : 0.45) * 0.55 : 0, t, on ? 0.8 : 0.4);
    if (on && !this._musicIv) {
      this._step = 0;
      this._next = this.ctx.currentTime + 0.1;
      this._musicIv = setInterval(() => this._schedule(), 50);
    } else if (!on && this._musicIv) {
      const iv = this._musicIv;
      this._musicIv = null;
      setTimeout(() => clearInterval(iv), 1500);
    }
  }

  _schedule() {
    const ctx = this.ctx;
    if (!ctx || !this._musicIv) return;
    const spb = 60 / 96 / 4; // 16th notes at 96 BPM
    const roots = [55, 43.65, 65.41, 49]; // A1 F1 C2 G1
    const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [261.6, 329.6, 392], [196, 246.9, 293.7]];
    const scale = [440, 523.3, 587.3, 659.3, 784, 880];
    const bus = this.musicBus;
    while (this._next < ctx.currentTime + 0.25) {
      const t = this._next, st = this._step % 16, bar = Math.floor(this._step / 16) % 4, phrase = Math.floor(this._step / 64) % 4;
      // kick
      if (st === 0 || st === 8 || (st === 10 && phrase % 2)) this._tone(bus, t, 0.32, { f0: 120, f1: 42, gain: 0.9 });
      // hats (softer on the beat) + anvil on 2 and 4
      if (st % 2 === 1) this._noiseBurst(bus, t, 0.05, { type: 'highpass', f0: 7000, gain: st % 4 === 3 ? 0.16 : 0.08 });
      if (st === 4 || st === 12) { this._noiseBurst(bus, t, 0.12, { type: 'bandpass', f0: 1800, q: 2, gain: 0.35 }); this._tone(bus, t, 0.35, { type: 'triangle', f0: 1245, gain: 0.05 }); }
      // bass pluck
      if ([0, 3, 6, 10, 12].includes(st)) {
        const f = roots[bar] * (st === 10 ? 1.5 : st === 6 ? 2 : 1);
        const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = f;
        lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.25);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.connect(lp).connect(g).connect(bus); o.start(t); o.stop(t + 0.35);
      }
      // pad, once per bar
      if (st === 0) for (const f of chords[bar]) for (const d of [-4, 4]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = f; o.detune.value = d;
        const dur = spb * 16;
        g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.035, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.2);
        o.connect(g).connect(bus); o.start(t); o.stop(t + dur + 0.3);
      }
      // sparse lead in the second half of each phrase
      if (phrase >= 2 && [2, 7, 11, 14].includes(st)) {
        const f = scale[(this._step * 7 + bar * 3) % scale.length];
        this._tone(bus, t, 0.22, { type: 'square', f0: f, gain: 0.03 });
      }
      this._step++;
      this._next += spb;
    }
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02); l.upY.setTargetAtTime(up.y, t, 0.02); l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** Output node for a one-shot: positional (panner) or direct. */
  _out(pos, gain = 1, wet = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF';
      p.distanceModel = 'inverse';
      p.refDistance = 2;
      p.rolloffFactor = 1.1;
      p.maxDistance = 400;
      p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z);
      g.connect(p).connect(this.master);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; p.connect(w).connect(this.reverb); }
    } else {
      g.connect(this.master);
      if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; g.connect(w).connect(this.reverb); }
    }
    return g;
  }

  _noiseBurst(out, t, dur, { type = 'bandpass', f0 = 2000, f1 = null, q = 1, gain = 1, attack = 0.001 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  _tone(out, t, dur, { type = 'sine', f0 = 440, f1 = null, gain = 0.5, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------------------------------------------------------------- weapons
  gunshot(pos = null, dist = 0) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const far = Math.min(1, dist / 60);
    const out = this._out(pos, pos ? 1.4 : 0.95, 1.2 + far);
    this._noiseBurst(out, t, 0.24, { type: 'lowpass', f0: 7000 - far * 5000, f1: 700, q: 0.7, gain: 1.0 });
    this._noiseBurst(out, t, 0.05, { type: 'highpass', f0: 2500, q: 0.5, gain: 0.7 * (1 - far) });
    this._tone(out, t, 0.16, { f0: 150, f1: 42, gain: 0.95 });
    this._tone(out, t, 0.03, { type: 'square', f0: 1800, f1: 600, gain: 0.12 * (1 - far) });
    // slide cycling
    if (!pos) this._noiseBurst(out, t + 0.035, 0.035, { f0: 3800, q: 3, gain: 0.18 });
  }

  dryFire() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.6, 0.1);
    this._noiseBurst(out, t, 0.02, { type: 'highpass', f0: 4000, gain: 0.5 });
    this._tone(out, t, 0.03, { f0: 3100, gain: 0.08 });
  }

  magRelease(pos = null) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5, 0.1);
    this._noiseBurst(out, t, 0.025, { f0: 5200, q: 4, gain: 0.45 });
    this._noiseBurst(out, t + 0.05, 0.08, { f0: 1800, f1: 900, q: 2, gain: 0.25 });
  }

  magInsert(pos = null) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.6, 0.1);
    this._noiseBurst(out, t - 0.06, 0.07, { f0: 2400, f1: 3600, q: 2, gain: 0.25, attack: 0.03 });
    this._noiseBurst(out, t, 0.03, { f0: 3000, q: 5, gain: 0.7 });
    this._tone(out, t, 0.05, { f0: 1250, gain: 0.12 });
  }

  slideRelease(pos = null) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.7, 0.2);
    this._noiseBurst(out, t, 0.05, { f0: 2600, q: 2.5, gain: 0.8 });
    this._tone(out, t, 0.09, { type: 'triangle', f0: 920, f1: 760, gain: 0.18 });
    this._tone(out, t, 0.06, { f0: 2350, gain: 0.08 });
  }

  inspectRattle() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.3, 0.05);
    this._noiseBurst(out, t + 0.1, 0.06, { f0: 2000, q: 3, gain: 0.2 });
    this._noiseBurst(out, t + 1.6, 0.06, { f0: 2400, q: 3, gain: 0.18 });
  }

  casingTink(pos, strength = 1) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.25 * strength, 0.15);
    const base = 3600 + Math.random() * 1600;
    for (const [mul, g] of [[1, 0.5], [1.51, 0.3], [2.23, 0.2]]) this._tone(out, t, 0.18 + Math.random() * 0.1, { f0: base * mul, gain: g });
  }

  magClatter(pos, strength = 1) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.55 * strength, 0.15);
    this._noiseBurst(out, t, 0.06, { f0: 1500, q: 1.5, gain: 0.6 });
    this._tone(out, t, 0.12, { type: 'triangle', f0: 640 + Math.random() * 120, gain: 0.2 });
    this._noiseBurst(out, t + 0.07, 0.04, { f0: 2200, q: 2, gain: 0.25 });
  }

  impact(pos, surface) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5, 0.3);
    if (surface === 'metal' || surface === 'steel') {
      this._noiseBurst(out, t, 0.04, { f0: 3500, q: 2, gain: 0.5 });
      const f = surface === 'steel' ? 820 : 1300 + Math.random() * 900;
      for (const [m, g, d] of [[1, 0.35, 0.9], [1.58, 0.22, 0.7], [2.41, 0.16, 0.5], [3.3, 0.08, 0.35]]) {
        this._tone(out, t, (surface === 'steel' ? 1.1 : 0.25) * d, { f0: f * m, gain: g });
      }
    } else if (surface === 'wood') {
      this._noiseBurst(out, t, 0.08, { f0: 900, q: 1.2, gain: 0.7 });
      this._tone(out, t, 0.08, { f0: 260, f1: 180, gain: 0.3 });
    } else if (surface === 'flesh') {
      this._noiseBurst(out, t, 0.07, { type: 'lowpass', f0: 700, gain: 0.8 });
    } else {
      this._noiseBurst(out, t, 0.09, { f0: 1400, f1: 500, q: 0.8, gain: 0.6 });
    }
  }

  hitMarker(head = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.35, 0);
    this._tone(out, t, 0.06, { type: 'triangle', f0: head ? 2600 : 1700, gain: 0.5 });
    if (head) this._tone(out, t + 0.04, 0.12, { f0: 3900, gain: 0.25 });
  }

  footstep(surface = 'concrete', sprint = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, sprint ? 0.32 : 0.22, 0.05);
    if (surface === 'grass') {
      this._noiseBurst(out, t, 0.11, { type: 'bandpass', f0: 2200, q: 0.6, gain: 0.35, attack: 0.01 });
      this._noiseBurst(out, t, 0.06, { type: 'lowpass', f0: 400, gain: 0.3 });
    } else if (surface === 'metal') {
      this._noiseBurst(out, t, 0.05, { f0: 1100, q: 2, gain: 0.5 });
      this._tone(out, t, 0.12, { type: 'triangle', f0: 180 + Math.random() * 40, gain: 0.2 });
    } else {
      this._noiseBurst(out, t, 0.06, { type: 'lowpass', f0: 900 + Math.random() * 300, gain: 0.7 });
      this._noiseBurst(out, t + 0.01, 0.03, { f0: 3500, q: 1, gain: 0.12 });
    }
  }

  land(strength) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.4 * Math.min(1, strength), 0.1);
    this._noiseBurst(out, t, 0.12, { type: 'lowpass', f0: 600, gain: 0.9 });
  }

  // ---------------------------------------------------------------- factory
  /** Cartoon "pomf" for the truck chucking crates out. */
  puff(pos) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 1.1, 0.35);
    this._noiseBurst(out, t, 0.32, { type: 'lowpass', f0: 1800, f1: 160, q: 1.2, gain: 0.9, attack: 0.006 });
    this._tone(out, t, 0.22, { f0: 320, f1: 70, gain: 0.55, attack: 0.004 });
    this._tone(out, t + 0.01, 0.12, { type: 'triangle', f0: 620, f1: 240, gain: 0.12 });
  }

  /** Goods sliding down the wall chute. */
  deposit(pos) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5, 0.2);
    this._noiseBurst(out, t, 0.45, { type: 'bandpass', f0: 900, f1: 2600, q: 1.5, gain: 0.5, attack: 0.05 });
    this._tone(out, t + 0.35, 0.12, { type: 'triangle', f0: 420, f1: 300, gain: 0.2 });
  }

  place() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.5, 0.2);
    this._noiseBurst(out, t, 0.15, { type: 'lowpass', f0: 900, gain: 0.8 });
    this._tone(out, t, 0.2, { f0: 120, f1: 60, gain: 0.5 });
    this._tone(out, t + 0.05, 0.25, { type: 'triangle', f0: 700, gain: 0.08 });
  }

  itemThud(pos, strength = 1, metal = false) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5 * strength, 0.15);
    this._noiseBurst(out, t, 0.09, { type: 'lowpass', f0: 700, gain: 0.8 });
    this._tone(out, t, 0.1, { f0: 140, f1: 70, gain: 0.35 });
    if (metal) this._tone(out, t, 0.25, { type: 'triangle', f0: 900 + Math.random() * 500, gain: 0.08 });
  }

  pickup() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.35, 0.05);
    this._noiseBurst(out, t, 0.06, { f0: 900, q: 1, gain: 0.5 });
    this._tone(out, t + 0.02, 0.08, { type: 'triangle', f0: 520, f1: 780, gain: 0.25 });
  }

  chaChing(pos = null) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5, 0.25);
    this._noiseBurst(out, t, 0.05, { f0: 3000, q: 2, gain: 0.35 });
    for (const [dt, f] of [[0.06, 1568], [0.13, 2093], [0.13, 2637]]) this._tone(out, t + dt, 0.5, { type: 'triangle', f0: f, gain: 0.22 });
  }

  horn(pos) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.9, 0.4);
    for (const [st, d] of [[0, 0.22], [0.3, 0.45]]) {
      this._tone(out, t + st, d, { type: 'square', f0: 311, gain: 0.18, attack: 0.02 });
      this._tone(out, t + st, d, { type: 'square', f0: 392, gain: 0.14, attack: 0.02 });
    }
  }

  beep(pos) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.45, 0.2);
    this._tone(out, t, 0.28, { type: 'square', f0: 1180, gain: 0.2, attack: 0.005 });
  }

  /** Positional diesel loop; returns a controller {set(pos, speed), stop()}. */
  engine() {
    if (!this.enabled) return null;
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 42;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 21;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 180; nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.5;
    o1.connect(lp); o2.connect(g2).connect(lp); n.connect(nf).connect(ng).connect(lp);
    lp.connect(g).connect(p).connect(this.master);
    o1.start(); o2.start(); n.start();
    const setPos = (v) => {
      if (p.positionX) { p.positionX.value = v.x; p.positionY.value = v.y; p.positionZ.value = v.z; } else p.setPosition(v.x, v.y, v.z);
    };
    return {
      set: (pos, speed, on) => {
        const t = ctx.currentTime;
        setPos(pos);
        const rpm = 1 + Math.min(1.6, speed / 5);
        o1.frequency.setTargetAtTime(38 * rpm, t, 0.2);
        o2.frequency.setTargetAtTime(19 * rpm, t, 0.2);
        lp.frequency.setTargetAtTime(300 + speed * 90, t, 0.2);
        g.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.3);
      },
    };
  }

  machine(kind, pos) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.6, 0.3);
    switch (kind) {
      case 'press':
        this._tone(out, t, 0.25, { f0: 90, f1: 40, gain: 0.9 });
        this._noiseBurst(out, t, 0.12, { type: 'lowpass', f0: 1200, gain: 0.7 });
        this._tone(out, t, 0.4, { type: 'triangle', f0: 610, gain: 0.07 });
        break;
      case 'moulder':
        this._noiseBurst(out, t, 0.6, { type: 'highpass', f0: 3000, gain: 0.25, attack: 0.08 });
        this._tone(out, t, 0.15, { f0: 180, gain: 0.3 });
        break;
      case 'assembler':
        this._tone(out, t, 0.5, { type: 'sawtooth', f0: 220, f1: 420, gain: 0.07, attack: 0.05 });
        break;
      case 'electronics':
        this._noiseBurst(out, t, 0.25, { f0: 5000, q: 6, gain: 0.12, attack: 0.02 });
        break;
      case 'ammo':
        this._noiseBurst(out, t, 0.05, { f0: 2400, q: 3, gain: 0.6 });
        this._tone(out, t, 0.08, { type: 'triangle', f0: 1400, gain: 0.1 });
        break;
      case 'done':
        this._tone(out, t, 0.12, { type: 'triangle', f0: 880, gain: 0.25 });
        this._tone(out, t + 0.12, 0.2, { type: 'triangle', f0: 1320, gain: 0.25 });
        break;
    }
  }

  ui(kind = 'click') {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.25, 0);
    if (kind === 'error') { this._tone(out, t, 0.18, { type: 'square', f0: 160, gain: 0.25 }); return; }
    if (kind === 'open') { this._tone(out, t, 0.08, { type: 'triangle', f0: 660, f1: 990, gain: 0.3 }); return; }
    if (kind === 'close') { this._tone(out, t, 0.08, { type: 'triangle', f0: 880, f1: 520, gain: 0.25 }); return; }
    if (kind === 'confirm') { this._tone(out, t, 0.09, { type: 'square', f0: 740, gain: 0.12 }); this._tone(out, t + 0.09, 0.14, { type: 'square', f0: 1110, gain: 0.12 }); return; }
    if (kind === 'hover') { this._tone(out, t, 0.02, { type: 'triangle', f0: 2200, gain: 0.05 }); return; }
    if (kind === 'deploy') {
      this._noiseBurst(out, t, 0.25, { type: 'lowpass', f0: 900, gain: 0.5 });
      this._tone(out, t, 0.4, { type: 'sawtooth', f0: 110, f1: 220, gain: 0.15 });
      return;
    }
    this._tone(out, t, 0.03, { type: 'square', f0: 1400, gain: 0.08 });
  }

  /** Company level-up fanfare: rising arpeggio + shimmer + a coin shower. */
  levelUp() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.55, 0.35);
    [523.3, 659.3, 784, 1046.5].forEach((f, i) => {
      this._tone(out, t + i * 0.09, 0.5, { type: 'square', f0: f, gain: 0.12 });
      this._tone(out, t + i * 0.09, 0.5, { type: 'triangle', f0: f * 2, gain: 0.06 });
    });
    this._tone(out, t + 0.36, 1.1, { type: 'triangle', f0: 1318.5, gain: 0.14 });
    for (let i = 0; i < 12; i++) this._tone(out, t + 0.4 + i * 0.05, 0.08, { type: 'triangle', f0: 2400 + Math.random() * 2000, gain: 0.07 });
    this._noiseBurst(out, t + 0.36, 0.8, { type: 'highpass', f0: 6000, gain: 0.12, attack: 0.05 });
  }

  /** Goal reached: short two-note chime. */
  goal() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.4, 0.3);
    this._tone(out, t, 0.25, { type: 'triangle', f0: 988, gain: 0.2 });
    this._tone(out, t + 0.1, 0.45, { type: 'triangle', f0: 1480, gain: 0.2 });
  }

  ammoRefill() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const out = this._out(null, 0.5, 0.1);
    for (let i = 0; i < 7; i++) this._tone(out, t + i * 0.045, 0.06, { type: 'triangle', f0: 2600 + Math.random() * 1200, gain: 0.12 });
    this._noiseBurst(out, t, 0.3, { f0: 1500, q: 1, gain: 0.25 });
  }

  // ---------------------------------------------------------------- ambience
  _ambience() {
    const ctx = this.ctx;
    // wind: looping noise through a slowly wandering low-pass
    const src = ctx.createBufferSource();
    src.buffer = this._noise(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 180;
    lfo.connect(lfoG).connect(lp.frequency);
    src.connect(lp).connect(g).connect(this.master);
    src.start(); lfo.start();
  }

  /** Low machine hum anchored to a point in the world (the factory hall). */
  addHum(pos) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 6;
    p.rolloffFactor = 1.4;
    p.positionX ? (p.positionX.value = pos.x, p.positionY.value = pos.y, p.positionZ.value = pos.z) : p.setPosition(pos.x, pos.y, pos.z);
    const g = ctx.createGain();
    g.gain.value = 0.09;
    for (const [f, a] of [[50, 0.6], [100, 0.3], [150.5, 0.12]]) {
      const o = ctx.createOscillator();
      o.type = f === 50 ? 'sawtooth' : 'sine';
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      o.start();
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    // rhythmic press "thump" via gain LFO
    const trem = ctx.createOscillator();
    trem.frequency.value = 0.5;
    const tg = ctx.createGain();
    tg.gain.value = 0.04;
    trem.connect(tg).connect(g.gain);
    trem.start();
    g.connect(lp).connect(p).connect(this.master);
  }
}
