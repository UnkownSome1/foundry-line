// Foundry Line — client bootstrap + game loop.
// Fixed 60 Hz simulation (shared, server-reusable code) with interpolated rendering.
// A Session supplies the factory: solo (authoritative here) or co-op (replica of the
// server's). Online, our own movement is predicted locally and reconciled with the server.
import * as THREE from 'three';
import { World } from '../shared/World.js';
import { SPAWN, HALL } from '../shared/mapLayout.js';
import { SIM_DT, PLAYER } from '../shared/constants.js';
import { createPlayerState, stepPlayer } from '../shared/PlayerMovement.js';
import { pushFromVehicles } from '../shared/vehiclePush.js';
import { WeaponState } from '../shared/WeaponState.js';
import { WEAPONS } from '../shared/weapons.js';
import { rayVsCharacter } from '../shared/hitscan.js';
import { DEG, damp, clamp, lerp } from '../shared/math.js';
import { applySelf } from '../shared/net/protocol.js';
import { buildEnvironment } from './gfx/environment.js';
import { setMaxAnisotropy } from './gfx/textures.js';
import { MapBuilder } from './world/MapBuilder.js';
import { Viewmodel } from './fp/Viewmodel.js';
import { Effects } from './fx/Effects.js';
import { Audio } from './fx/Audio.js';
import { HUD } from './ui/HUD.js';
import { Input } from './Input.js';
import { Operator } from './Operators.js';
import { Character } from './models/Character.js';
import { ITEMS, ECON } from '../shared/factory/items.js';
import { FactoryView } from './factory/FactoryView.js';
import { renderIcons } from './factory/ItemModels.js';
import { Panels } from './ui/Panels.js';
import { Menu } from './ui/Menu.js';
import { BuildMode } from './factory/BuildMode.js';
import { LocalSession, NetSession, probeServer, defaultServerUrl } from './net/Session.js';
import { RemotePlayers } from './net/RemotePlayers.js';
import { Saves, loadSettings, saveSettings, loadCareer, saveCareer } from './Storage.js';

const v = () => new THREE.Vector3();
const PREVIEW = { x: SPAWN.x + 2.2, z: SPAWN.z - 5.5 };

class Game {
  constructor() {
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.02;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    setMaxAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    this.world = new World();
    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0xd6c6aa, 80, 560);
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.04, 2600);
    this.baseFov = 74;
    this.sunDir = new THREE.Vector3(-0.58, 0.42, 0.36).normalize();
    const env = buildEnvironment(r, { sunDir: this.sunDir });
    scene.environment = env;
    scene.environmentIntensity = 0.42;
    scene.add(new THREE.HemisphereLight(0xbfd2ea, 0x5b5140, 0.95));
    const sun = (this.sun = new THREE.DirectionalLight(0xffe0b4, 2.7));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 320;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    this.map = new MapBuilder(scene, this.world, { sunDir: this.sunDir });
    this.audio = new Audio();
    this.effects = new Effects(scene, this.world, this.audio);
    this.vm = new Viewmodel({ environment: env });
    this.hud = new HUD(WEAPONS.p9.magSize);
    this.input = new Input(canvas);

    // persistent bits: companies, settings, career
    this.saves = new Saves();
    this.settings = loadSettings();
    this.career = loadCareer();
    this.serverInfo = null;

    // factory session: start on the last company (it runs behind the menu)
    const last = this.saves.last();
    this.slot = last ? last.id : null;
    const firstSave = last ? this.saves.load(last.id) : null;
    this.session = new LocalSession(this.world, firstSave);
    this.factoryView = new FactoryView(scene, this.session.sim, this.effects, this.audio);
    this.icons = renderIcons();
    const game = this;
    this.panels = new Panels({
      get sim() { return game.factory; },
      get playerId() { return game.playerId; },
      icons: this.icons, audio: this.audio, hud: this.hud,
      locked: () => this.input.locked,
      command: (c, cb) => this.factoryCommand(c, cb),
      onUse: (eff) => this.applyItemEffect(eff),
      onPlace: (slot) => this.build.start(slot),
      dropAt: () => this.dropPoint(),
      truckStatus: () => this.factoryView.truckStatus(),
      vanStatus: () => this.factoryView.vanStatus(),
    });
    this.build = new BuildMode(this);
    this.remotes = new RemotePlayers(this);
    this.focus = null;
    this.saveT = 10;
    this.playSince = 0;
    addEventListener('beforeunload', () => this.saveNow());

    // local player (uses exactly the shared movement + weapon code)
    this.player = createPlayerState(SPAWN.x, 0, SPAWN.z, SPAWN.yaw);
    this.prev = { ...this.player };
    this.corr = new THREE.Vector3(); // visual smoothing of server corrections
    this.weapon = new WeaponState(WEAPONS.p9, 0x51f7);
    if (firstSave && Number.isFinite(firstSave.reserve)) this.weapon.reserve = Math.min(WEAPONS.p9.reserveMax, firstSave.reserve);
    this.health = PLAYER.maxHealth;
    this.yaw = SPAWN.yaw;
    this.pitch = -0.02;
    this.recoilOff = 0; this.recoilYawOff = 0; this.recoilRoll = 0;
    this.recoilVel = 0; this.recoilYawVel = 0; this.recoilRollVel = 0; this.recoilClimb = 0;
    this.stepOff = 0;
    this.landDip = 0; this.landVel = 0;
    this.bobDist = 0;
    this.stepAcc = 0;
    this.simTime = 0;
    this.time = 0;
    this.acc = 0;
    this.view = 'fp';
    this.state = 'menu';
    this.pendingReload = false;
    this.smokeT = 0;
    this.hintT = 0;
    this.goalT = 0;

    this.playerChar = new Character({ name: 'You', team: this.settings.color });
    this.playerChar.tag.visible = false;
    this.playerChar.root.visible = false;
    scene.add(this.playerChar.root);
    this._buildPreview();

    this.vm.onMagDrop = (kind, rounds) => this._dropPlayerMag(kind, rounds);

    this.ops = [
      new Operator(this, { name: 'Okafor', team: 0x2fb5c9, x: -35.5, z: 20.5, yaw: Math.PI / 2, behavior: 'shooter', seed: 11 }),
      new Operator(this, { name: 'Reyes', team: 0x2fb5c9, x: -20, z: 8, yaw: 0, behavior: 'patrol', seed: 23, waypoints: [[-20, 8], [-20, 30], [-12, 33], [-13, 18]] }),
      new Operator(this, { name: 'Lindqvist', team: 0x2fb5c9, x: 6.4, z: -1.2, yaw: Math.PI, behavior: 'guard', seed: 37 }),
    ];

    // menu camera
    this.shot = 'home';
    this.camPos = new THREE.Vector3(30, 20, 40);
    this.camLook = new THREE.Vector3(0, 3, -15);
    this.camSnap = true;

    this.menu = new Menu(this);
    this._bindUI();
    this.applySettings();
    this.syncHud();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    this.probe();
  }

  get factory() { return this.session.sim; }
  get playerId() { return this.session.playerId; }

  // ------------------------------------------------------------------ menu + flow
  _bindUI() {
    // any first click wakes the audio (browsers need a gesture) and starts menu music
    addEventListener('pointerdown', () => { if (!this.audio.enabled) { this.audio.start(); this.audio.setVolumes(this.settings); if (this.state !== 'playing') this.audio.music(true); } }, { capture: true });
    this.canvas.addEventListener('click', () => { if (this.state === 'paused') this.deploy(); });
    this.input.onLockChange = (locked) => {
      if (locked) {
        if (this.state !== 'playing') { this.hintT = 0; this.playSince = performance.now(); }
        this.state = 'playing';
        this.menu.hidePause();
        this.menu.busy(null);
        this.audio.music(false);
        this.session.paused = false;
      } else if (this.state === 'playing') {
        this.state = 'paused';
        this.panels.close();
        this.build.stop();
        if (!this.session.online) this.session.paused = true;
        this.menu.showPause('main');
        this.saveNow();
      }
      document.body.dataset.state = this.state;
    };
    document.body.dataset.state = this.state;
  }

  /** Enter the game (must run inside a click so pointer lock is allowed). */
  deploy() {
    this.audio.start();
    this.audio.setVolumes(this.settings);
    if (!this._humStarted && this.audio.enabled) { this.audio.addHum(new THREE.Vector3(HALL.x, 3, HALL.z)); this._humStarted = true; }
    this.input.lock();
  }

  async probe() {
    this.serverInfo = await probeServer();
    this.menu.render();
  }

  setMenuShot(name) { this.shot = name; }

  _buildPreview() {
    if (this.previewChar) this.scene.remove(this.previewChar.root);
    this.previewChar = new Character({ name: this.settings.name, team: this.settings.color });
    this.previewChar.tag.visible = false;
    this.scene.add(this.previewChar.root);
    this.previewKey = `${this.settings.name}|${this.settings.color}`;
  }

  /** Swap the factory session (solo save ↔ co-op), keeping the view and world in step. */
  setSession(session, slot) {
    const old = this.session;
    this.session = session;
    this.slot = slot;
    this.factoryView.rebind(session.sim);
    if (old && old !== session) old.dispose();
    this.remotes.clear();
    this.panels.close();
    this.build.stop();
    this.hud.mode = session.online ? (session.isHost ? 'HOST' : 'CO-OP') : 'SOLO';
    this.syncHud();
    this.respawn(session.spawn);
  }

  respawn(spawn) {
    const p = createPlayerState(SPAWN.x, 0, SPAWN.z, SPAWN.yaw);
    if (spawn) applySelf(p, spawn);
    Object.assign(this.player, p);
    Object.assign(this.prev, p);
    this.yaw = SPAWN.yaw;
    this.pitch = -0.02;
    this.corr.set(0, 0, 0);
  }

  syncHud() {
    const sim = this.factory;
    this.hud.shownFunds = null;
    this.hud.setFunds(sim.funds);
    const me = sim.players.get(this.playerId);
    this.hud.setWallet(me ? me.wallet : 0);
    this.hud.setLevel(sim.levelInfo());
  }

  playSolo(slotId) {
    this.menu.message(null);
    if (this.session.online || this.slot !== slotId) {
      if (this.session.online) this._leaveOnline(true);
      else this.saveNow();
      const data = this.saves.load(slotId);
      this.setSession(new LocalSession(this.world, data), slotId);
      this.weapon.reserve = data && Number.isFinite(data.reserve) ? Math.min(WEAPONS.p9.reserveMax, data.reserve) : WEAPONS.p9.reserveStart;
    }
    this.deploy();
  }

  newCompany(name, color) {
    if (this.saves.full) return;
    this.saveNow();
    const meta = this.saves.create(name, color);
    const s = new LocalSession(this.world, null);
    this.setSession(s, meta.id);
    this.weapon.reserve = WEAPONS.p9.reserveStart;
    this.saveNow();
    this.deploy();
  }

  deleteCompany(id) {
    this.saves.remove(id);
    if (this.slot === id && !this.session.online) {
      const next = this.saves.last();
      this.setSession(new LocalSession(this.world, next ? this.saves.load(next.id) : null), next ? next.id : null);
    }
  }

  _netCallbacks(s) {
    s.onSnapSelf = (me, ack, pending) => this._reconcile(me, pending);
    s.onFx = (m) => this.remotes.onFx(m);
    s.onPeer = (kind, m) => {
      this.hud.toast(`${m.name} ${kind === 'joined' ? 'joined your plant' : 'left the session'}`, kind === 'joined' ? 'ok' : '');
      this.audio.ui(kind === 'joined' ? 'confirm' : 'close');
      if (kind === 'left') this.remotes.remove(m.id);
      if (!this.menu.pauseEl.hidden) this.menu.renderPause();
    };
    s.onSave = (data) => {
      if (!this.slot) return;
      const add = this.state === 'playing' ? (performance.now() - this.playSince) / 1000 : 0;
      this.playSince = performance.now();
      this.saves.write(this.slot, data, add);
      if (this._finalSave) { const f = this._finalSave; this._finalSave = null; f(); }
    };
    s.onClosed = (reason) => this._leaveOnline(false, reason);
  }

  async hostCoop(slotId) {
    if (!this.serverInfo) return;
    this.saveNow();
    const data = this.saves.load(slotId) || new LocalSession(new World(), null).serialize();
    data.reserve = this.weapon.reserve;
    this.menu.busy('Starting your co-op session…');
    const s = new NetSession(this.world, { url: this.settings.server || defaultServerUrl(), host: data, name: this.settings.name, color: this.settings.color });
    this._netCallbacks(s);
    try { await s.connect(); } catch (e) { this.menu.busy(null); this.menu.message(e.message, 'warn'); s.dispose(); return; }
    this.setSession(s, slotId);
    if (Number.isFinite(data.reserve)) this.weapon.reserve = data.reserve;
    this.career.hosted++; saveCareer(this.career);
    this.menu.ready(`Session ${s.code} is live`, `Your friend picks <b>Co-op → Join</b> and types <b>${s.code}</b>. You'll see it in the Esc menu too.`);
  }

  async joinCoop(code) {
    if (!this.serverInfo) return;
    this.saveNow();
    this.menu.busy(`Joining ${code}…`);
    const s = new NetSession(this.world, { url: this.settings.server || defaultServerUrl(), code, name: this.settings.name, color: this.settings.color });
    this._netCallbacks(s);
    try { await s.connect(); } catch (e) { this.menu.busy(null); this.menu.message(e.message, 'warn'); s.dispose(); return; }
    this.setSession(s, null);
    this.weapon.reserve = WEAPONS.p9.reserveStart;
    this.career.joined++; saveCareer(this.career);
    const host = [...s.remotes.values()][0];
    this.menu.ready(`Joined ${host ? host.name : 'the'}'s plant`, 'Company money is shared. Goods you drop in the cage pay 20% to your own wallet.');
  }

  /** Back to a solo session after co-op ends (we left, the host left, or the link dropped). */
  _leaveOnline(byUs, reason = null) {
    if (!this.session.online) return;
    const s = this.session;
    s.onClosed = null;
    if (byUs) s.leave();
    const slot = s.isHost ? this.slot : this.saves.last()?.id || null;
    const data = slot ? this.saves.load(slot) : null;
    this.setSession(new LocalSession(this.world, data), slot);
    if (!byUs) {
      if (document.pointerLockElement) document.exitPointerLock();
      this.state = 'menu';
      document.body.dataset.state = 'menu';
      this.menu.hidePause();
      this.menu.busy(null);
      this.menu.show('home');
      this.menu.message(reason || 'The co-op session ended.', 'warn');
      this.audio.music(true);
    }
  }

  quitToMenu() {
    const finish = () => {
      if (document.pointerLockElement) document.exitPointerLock();
      this.state = 'menu';
      document.body.dataset.state = 'menu';
      this.menu.hidePause();
      this.menu.busy(null);
      this.menu.show('home');
      this.audio.music(true);
      this.session.paused = false;
    };
    const s = this.session;
    if (s.online && s.isHost) {
      // ask the server for a final save, then leave
      this.menu.busy('Saving your company…');
      const t = setTimeout(() => { this._finalSave = null; this._leaveOnline(true); finish(); }, 2500);
      this._finalSave = () => { clearTimeout(t); this._leaveOnline(true); finish(); };
      s.sendReserve(this.weapon.reserve);
      s.leave();
      return;
    }
    if (s.online) this._leaveOnline(true);
    else this.saveNow();
    finish();
  }

  // ------------------------------------------------------------------ settings
  applySettings() {
    const s = this.settings;
    this.input.sensitivity = 0.0022 * s.sens;
    this.baseFov = s.fov;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75) * s.renderScale);
    const shadows = s.shadows !== 'off';
    if (this.sun.castShadow !== shadows) this.sun.castShadow = shadows;
    const size = s.shadows === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    document.getElementById('perf').style.display = s.showFps ? '' : 'none';
    this.audio.setVolumes(s);
    const cross = document.getElementById('crosshair');
    cross.dataset.style = s.crosshair;
    cross.style.setProperty('--cross', s.crossColor);
    this.hud.showDamage = s.damageNumbers;
    this.resize();
    if (this.previewKey && this.previewKey !== `${s.name}|${s.color}`) {
      this._buildPreview();
      this.scene.remove(this.playerChar.root);
      this.playerChar = new Character({ name: 'You', team: s.color });
      this.playerChar.tag.visible = false;
      this.playerChar.root.visible = false;
      this.scene.add(this.playerChar.root);
    }
  }

  saveSettings(live = false) {
    if (!live) saveSettings(this.settings);
    else { clearTimeout(this._setT); this._setT = setTimeout(() => saveSettings(this.settings), 400); }
    this.applySettings();
  }

  /** Test hook: play without pointer lock (headless checks). */
  debugStart() {
    this.state = 'playing';
    this.input.locked = true;
    this.menu.hidePause();
    this.menu.busy(null);
    document.body.dataset.state = 'playing';
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
  }

  // ------------------------------------------------------------------ loop
  frame(nowMs) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (nowMs - this.last) / 1000);
    this.last = nowMs;
    if (!this.manual) this.step(dt);
  }

  step(dt, draw = true) {
    const inp = this.input;
    let look = { dx: 0, dy: 0 };
    if (this.state === 'playing') {
      look = inp.takeLook();
      if (this.settings.invertY) look.dy = -look.dy;
      const ui = this.panels.isOpen;
      const tabKey = inp.consume('Tab'), iKey = inp.consume('KeyI');
      if (tabKey || iKey) this.panels.toggleInventory();
      if (ui) {
        // the mouse drives the virtual cursor; the view holds still
        this.panels.moveCursor(look.dx, look.dy);
        if (inp.mousePressed.left) this.panels.virtualClick(0);
        if (inp.mousePressed.right) this.panels.virtualClick(2);
        inp.mousePressed.left = inp.mousePressed.right = false;
        if (inp.consume('KeyE') || inp.consume('Escape')) this.panels.close();
        look = { dx: 0, dy: 0 };
        inp.clearEdges();
      } else if (this.build.active) {
        const sens = inp.sensitivity;
        this.yaw -= look.dx * sens;
        this.pitch = clamp(this.pitch - look.dy * sens, -1.5, 1.5);
        if (inp.mousePressed.left) this.build.confirm();
        if (inp.mousePressed.right || inp.consume('KeyQ') || inp.consume('Escape')) this.build.stop();
        inp.mousePressed.left = inp.mousePressed.right = false;
        if (inp.consume('KeyR')) this.build.rotate();
        if (inp.consume('KeyB')) this.build.cycle();
        if (inp.consume('KeyE')) this.interact();
      } else {
        inp.mousePressed.left = inp.mousePressed.right = false;
        const sens = inp.sensitivity * (1 - (1 - this.settings.adsSens) * this.vm.aim);
        this.yaw -= look.dx * sens;
        this.pitch = clamp(this.pitch - look.dy * sens, -1.5, 1.5);
        if (inp.consume('KeyE')) this.interact();
        if (inp.consume('KeyB')) this.build.start();
        if (inp.consume('KeyV')) this.view = this.view === 'fp' ? 'tp' : 'fp';
        if (inp.consume('KeyF') && this.weapon.action === 'idle') { this.vm.playInspect(); this.audio.inspectRattle(); }
        if (inp.consume('KeyR')) this.pendingReload = true;
        if (inp.consume('KeyH')) document.body.classList.toggle('show-help');
      }
      this.acc += dt;
      let n = 0;
      while (this.acc >= SIM_DT && n < 5) { this.tick(); this.acc -= SIM_DT; n++; }
      if (n === 5) this.acc = 0;
      this.career.playtime += dt;
    } else {
      inp.clearEdges();
      inp.takeLook();
      // the plant keeps running behind the menu (solo), so the background is alive
      if (!this.session.online && !this.session.paused) {
        this.acc += dt;
        let n = 0;
        while (this.acc >= SIM_DT && n < 5) { for (const e of this.session.tick([this.player.x, this.player.y, this.player.z])) this.onFactoryEvent(e); this.acc -= SIM_DT; n++; }
        if (n === 5) this.acc = 0;
      }
    }
    // online: replica clock + server events
    for (const e of this.session.update(dt)) this.onFactoryEvent(e);
    this.render(dt, this.acc / SIM_DT, look, draw);
  }

  tick() {
    const inp = this.input, p = this.player;
    this.simTime += SIM_DT;
    Object.assign(this.prev, p);
    const ui = this.panels.isOpen;
    const k = (c) => !ui && inp.down(c);
    const reloading = this.weapon.action === 'reload';
    const cmd = {
      forward: (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0),
      strafe: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      jump: k('Space'),
      sprint: (k('ShiftLeft') || k('ShiftRight')) && !inp.mouse.left,
      crouch: k('KeyC') || k('ControlLeft'),
      aim: !ui && inp.mouse.right && !reloading,
      yaw: this.yaw,
      pitch: this.pitch,
    };
    this.aimCmd = cmd.aim;
    if (this.session.online) this.session.input(cmd);
    stepPlayer(p, cmd, this.world, SIM_DT);
    pushFromVehicles(p, this.factory);
    if (p.landSpeed > 3.5) { this.landVel -= p.landSpeed * 0.06; this.audio.land(p.landSpeed / 10); }
    if (p.stepUp > 0) this.stepOff -= p.stepUp;

    // footsteps + career distance
    const sp = Math.hypot(p.vx, p.vz);
    if (p.grounded && sp > 0.8) {
      this.career.distance += sp * SIM_DT;
      this.stepAcc += sp * SIM_DT;
      const len = p.sprinting ? 2.5 : p.crouch > 0.5 ? 1.3 : 1.95;
      if (this.stepAcc > len) {
        this.stepAcc = 0;
        if (p.crouch < 0.5) this.audio.footstep(p.surface, p.sprinting);
      }
    }

    const drawing = this.vm.clip && this.vm.clip.name === 'draw';
    const events = this.weapon.update(this.simTime, SIM_DT, { fire: !ui && !this.build.active && inp.mouse.left && !drawing, reload: this.pendingReload });
    this.pendingReload = false;
    for (const ev of events) this.onWeaponEvent(ev);

    for (const op of this.ops) op.update(SIM_DT, this.simTime);

    // solo: the factory simulation runs here (same code the server runs)
    if (!this.session.online) for (const e of this.session.tick([p.x, p.y, p.z])) this.onFactoryEvent(e);
  }

  /** Server says where we really are: rewind to that, replay unacknowledged inputs. */
  _reconcile(me, pending) {
    const p = this.player;
    const s = { ...p };
    applySelf(s, me);
    for (const inp of pending) { stepPlayer(s, inp.cmd, this.world, SIM_DT); pushFromVehicles(s, this.factory); }
    const dx = s.x - p.x, dy = s.y - p.y, dz = s.z - p.z;
    const err = Math.hypot(dx, dy, dz);
    if (err < 0.0005) return;
    if (err < 2) this.corr.set(this.corr.x - dx, this.corr.y - dy, this.corr.z - dz); // glide, don't pop
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'crouch', 'groundTime']) p[key] = s[key];
    p.grounded = s.grounded;
    p.sprinting = s.sprinting;
    this.prev.x += dx; this.prev.y += dy; this.prev.z += dz;
  }

  // ------------------------------------------------------------------ factory glue
  factoryCommand(c, cb) {
    const p = this.player;
    return this.session.command(c, cb, [p.x, p.y, p.z]);
  }

  onFactoryEvent(e) {
    this.factoryView.onEvent(e);
    this.panels.onEvent(e);
    const sim = this.factory;
    switch (e.type) {
      case 'funds': this.hud.setFunds(e.funds, e.delta); this.dirtySave = true; break;
      case 'wallet': if (e.player === this.playerId) this.hud.setWallet(e.wallet); this.dirtySave = true; break;
      case 'state': this.hud.setFunds(sim.funds); { const me = sim.players.get(this.playerId); if (me) this.hud.setWallet(me.wallet); } break;
      case 'inventory': case 'placed': case 'machineRemoved': case 'beltRemoved': case 'deposit': this.dirtySave = true; break;
      case 'vanPhase': {
        const msg = { dispatch: 'Pickup van dispatched — it collects from the cage outside the east wall', loading: 'Pickup van loading the cage' }[e.phase];
        if (msg) this.hud.toast(msg, e.phase === 'loading' ? 'ok' : '');
        break;
      }
      case 'vanPaid':
        if (e.total) {
          this.hud.toast(`Pickup paid $${e.total.toLocaleString('en-US')} · company +$${Math.round(e.total * ECON.companyShare).toLocaleString('en-US')}${e.bonus ? ` · includes +${Math.round(e.bonus * 100)}% level bonus` : ''}`, 'ok');
          this.career.earned += e.total;
          this.career.vans++;
        }
        break;
      case 'levelUp':
        this.hud.banner(`Company level ${e.level}`, `Promotion · +$${e.grant.toLocaleString('en-US')} grant`, [`Sales bonus now +${Math.round(e.saleBonus * 100)}%`, ...e.unlocks]);
        this.audio.levelUp();
        this.career.levels++;
        break;
      case 'goalDone':
        this.hud.toast(`Goal reached · ${e.name} · +$${e.reward.toLocaleString('en-US')}`, 'ok');
        this.audio.goal();
        this.career.goals++;
        break;
      case 'contractDone': this.hud.toast(`Contract complete · ${e.buyer} paid a $${e.bonus.toLocaleString('en-US')} bonus`, 'ok'); break;
      case 'contractFailed': this.hud.toast(`Contract expired · ${e.buyer}`, 'warn'); break;
      case 'truckPhase': {
        const msg = {
          loading: 'Truck D-07 is loading your order at the depot',
          inbound: 'Delivery truck on the way — watch the south gate',
          dumping: 'Truck unloading at the south delivery bay',
          outbound: 'Delivery dropped — collect it at the bay',
        }[e.phase];
        if (msg && this.state === 'playing') this.hud.toast(msg, e.phase === 'dumping' ? 'ok' : '');
        break;
      }
      case 'machineIdle': { const m = sim.machines.get(e.id); if (m && this.state === 'playing') this.hud.toast(`${m.def.name} finished — collect from its output tray`, 'ok'); break; }
    }
  }

  applyItemEffect(eff) {
    if (eff && eff.ammo) {
      const added = this.weapon.addReserve(eff.ammo);
      this.audio.ammoRefill();
      this.hud.toast(added < eff.ammo ? `Reserve full · +${added} rounds` : `+${added} rounds`, 'ok');
    }
  }

  dropPoint() {
    const p = this.player;
    const o = this.eyePosition(v());
    const f = v().set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const at = o.clone().addScaledVector(f, 0.7);
    at.y = Math.max(at.y, p.y + 0.4);
    return { at: at.toArray(), vel: [f.x * 2.2 + p.vx, 1.6 + f.y, f.z * 2.2 + p.vz] };
  }

  interact() {
    const f = this.focus;
    if (!f) return;
    const fail = (r) => { this.audio.ui('error'); this.hud.toast(r.error, 'warn'); };
    if (f.kind === 'item') {
      this.factoryCommand({ type: 'pickup', itemId: f.id }, (r) => {
        if (!r.ok) return fail(r);
        this.audio.pickup();
        this.vm.pickupDip();
        this.hud.toast(`+${r.taken} ${ITEMS[f.type].name}${r.full ? ' · inventory full' : ''}`, r.full ? 'warn' : '');
      });
    } else if (f.kind === 'terminal') {
      this.panels.show('terminal');
    } else if (f.kind === 'machine') {
      this.panels.show('machine', f.id);
    } else if (f.kind === 'belt') {
      this.factoryCommand({ type: 'packBelt', id: f.id }, (r) => { if (r.ok) this.audio.pickup(); else fail(r); });
    } else if (f.kind === 'deposit') {
      this.factoryCommand({ type: 'deposit' }, (r) => {
        if (r.ok) this.hud.toast(`Deposited ${r.units} item${r.units > 1 ? 's' : ''} — call the pickup van to sell`, 'ok');
        else fail(r);
      });
    } else if (f.kind === 'callVan') {
      this.factoryCommand({ type: 'callVan' }, (r) => { if (r.ok) this.audio.ui('confirm'); else fail(r); });
    } else if (f.kind === 'ammo') {
      const added = this.weapon.refill();
      if (added > 0) { this.audio.ammoRefill(); this.vm.pickupDip(); this.hud.toast(`Ammo crate · +${added} rounds (reserve full)`, 'ok'); }
      else this.hud.toast('Reserve already full', '');
    }
  }

  /** What the player is looking at (within reach) → focus + prompt. */
  updateFocus() {
    const o = this.eyePosition(v());
    const d = v().set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const REACH = 3.0;
    let best = null;
    const test = (c, r, cand) => {
      const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - cc;
      if (disc < 0) return;
      const t = Math.max(0, b - Math.sqrt(disc));
      if (t < REACH && (!best || t < best.t)) best = { ...cand, t };
    };
    for (const it of this.factory.items.values()) test({ x: it.x, y: it.y + it.r * 0.6, z: it.z }, Math.max(0.3, it.r + 0.1), { kind: 'item', id: it.id, type: it.type, count: it.count });
    for (const i of this.factoryView.interactables()) test(i.pos, i.r, i);
    if (best) {
      const hit = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, best.t);
      if (hit && hit.t < best.t - 0.3) best = null;
    }
    this.focus = best;
    let text = '';
    if (best) {
      const label = best.kind === 'item' ? `Pick up ${ITEMS[best.type].name} <b>×${best.count}</b>` : best.label;
      text = `<kbd>E</kbd><span>${label}</span>`;
    }
    if (!this.build.active) this.hud.prompt(this.panels.isOpen ? '' : text);
  }

  saveNow() {
    if (this.session.online || !this.slot) return;
    try {
      const add = this.state === 'playing' ? (performance.now() - this.playSince) / 1000 : 0;
      this.playSince = performance.now();
      this.saves.write(this.slot, { ...this.session.serialize(), reserve: this.weapon.reserve }, add);
    } catch (_) { /* storage unavailable: progress lasts for this session only */ }
    saveCareer(this.career);
  }

  eyePosition(out) {
    const p = this.player;
    return out.set(p.x, p.y + lerp(PLAYER.eye, PLAYER.crouchEye, p.crouch), p.z);
  }

  onWeaponEvent(ev) {
    const vm = this.vm;
    const net = this.session.online ? this.session : null;
    switch (ev.type) {
      case 'fire': {
        const shot = this.firePlayerShot(ev);
        vm.onEvent(ev, this.weapon);
        this.playerChar.fire();
        if (ev.lastRound) this.playerChar.slideLocked = true;
        if (net) net.fx({ k: 'shot', o: shot.o, p: shot.p, s: shot.s, n: shot.n, last: ev.lastRound ? 1 : 0 });
        break;
      }
      case 'dryFire': this.audio.dryFire(); vm.onEvent(ev, this.weapon); break;
      case 'reloadStart': vm.onEvent(ev, this.weapon, this.simTime - ev.t); this.playerChar.startReload(ev.kind); if (net) net.fx({ k: 'reload', kind: ev.kind }); break;
      case 'magOut': this.audio.magRelease(); break;
      case 'magIn': this.audio.magInsert(); break;
      case 'slideRelease': this.audio.slideRelease(); vm.onEvent(ev, this.weapon); this.playerChar.slideLocked = false; if (net) net.fx({ k: 'slide' }); break;
    }
  }

  firePlayerShot(ev) {
    const p = this.player;
    const w = this.weapon;
    const def = w.def;
    const aim = this.vm.aim;
    const moveFrac = clamp(Math.hypot(p.vx, p.vz) / PLAYER.walkSpeed, 0, 1.5);
    const cone = w.spread(aim, moveFrac, !p.grounded);
    const s = w.spreadSample(ev.shot, cone);
    const yaw = this.yaw + this.recoilYawOff + s.yaw;
    const pitch = this.pitch + this.recoilOff + s.pitch;
    const o = this.eyePosition(v());
    const d = v().set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.career.shots++;

    // world, characters, steel plates → nearest wins
    const hit = this.world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, def.range);
    let best = hit ? { t: hit.t, kind: 'world', hit } : { t: def.range, kind: 'none' };
    for (const op of this.ops) {
      if (!op.alive) continue;
      const h = rayVsCharacter(o.x, o.y, o.z, d.x, d.y, d.z, op.pos.x, op.pos.y, op.pos.z, op.crouch, best.t);
      if (h && h.t < best.t) best = { t: h.t, kind: 'op', op, part: h.part };
    }
    for (const pl of this.map.steelPlates) {
      const c = pl.center;
      const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z;
      const b = ox * d.x + oy * d.y + oz * d.z;
      const cc = ox * ox + oy * oy + oz * oz - pl.r * pl.r;
      const disc = b * b - cc;
      if (disc > 0) {
        const t = b - Math.sqrt(disc);
        if (t > 0 && t < best.t) best = { t, kind: 'plate', plate: pl };
      }
    }
    const point = o.clone().addScaledVector(d, best.t);
    const out = { o: [o.x, o.y - 0.1, o.z].map((x) => Math.round(x * 100) / 100), p: point.toArray().map((x) => Math.round(x * 100) / 100), s: null, n: null };
    if (best.kind === 'world') {
      this.effects.impact(best.hit.point, best.hit.normal, best.hit.surface);
      this.audio.impact(point, best.hit.surface);
      out.s = best.hit.surface; out.n = best.hit.normal;
    } else if (best.kind === 'plate') {
      best.plate.vel += 3.2;
      this.effects.impact(point.toArray(), [-d.x, -d.y, -d.z], 'steel', { decal: false });
      this.audio.impact(point, 'steel');
      this.hud.hitmarker('plate', 'DING');
      this.career.hits++; this.career.plates++;
      out.s = 'steel';
    } else if (best.kind === 'op') {
      const dmg = w.damageAt(best.part, best.t);
      const killed = best.op.damage(dmg, best.part, d);
      this.effects.impact(point.toArray(), [-d.x, -d.y, -d.z], 'flesh', { decal: false });
      this.hud.hitmarker(killed ? 'kill' : best.part === 'head' ? 'head' : 'body', dmg);
      this.audio.hitMarker(best.part === 'head' || killed);
      this.career.hits++;
      if (best.part === 'head') this.career.headshots++;
      if (killed) this.hud.feed(`You  ▸  ${best.op.name}${best.part === 'head' ? '  (headshot)' : ''}  ·  ${best.t.toFixed(0)} m`, 'kill');
      out.s = 'flesh';
    }
    this.audio.gunshot(null);

    // camera recoil: a sharp muzzle snap that peaks ~60 ms after the shot, then springs
    // back with a little settle. Part of the rise is permanent (muzzle climb you have to
    // pull down), fed in over the same few frames so there is no instant jump.
    const R = def.recoil;
    const mult = (1 - 0.3 * aim) * (p.crouch > 0.5 ? 0.8 : 1) * (p.grounded ? 1 : 1.3) * (0.9 + Math.random() * 0.2);
    // impulse that makes the (under-damped) spring peak at exactly the requested angle
    const z = Math.min(R.damping, 0.999), zd = Math.sqrt(1 - z * z);
    const snap = R.spring / Math.exp((-z / zd) * Math.atan2(zd, z));
    const rp = R.pitch * DEG * mult;
    this.recoilClimb += rp * R.climb;
    this.recoilVel += rp * (1 - R.climb) * snap;
    const side = (Math.random() - 0.5) * 2 - R.bias; // + yaw is left, so the bias pulls right
    this.recoilYawVel += side * R.yaw * DEG * mult * snap;
    this.recoilRollVel += ((Math.random() - 0.5) * 2 - 0.4) * R.roll * DEG * mult * snap;

    // brass + light
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const ej = v().set(0.11, -0.075, -0.34).applyQuaternion(q).add(o);
    const right = v().set(1, 0, 0).applyQuaternion(q), up = v().set(0, 1, 0).applyQuaternion(q), fwd = v().set(0, 0, -1).applyQuaternion(q);
    const vel = right.multiplyScalar(1.9 + Math.random() * 0.7).addScaledVector(up, 1.7 + Math.random() * 0.8).addScaledVector(fwd, -0.4).add(v().set(p.vx, 0, p.vz));
    this.effects.ejectCasing(ej, vel);
    this.effects.playerFlash(o.clone().addScaledVector(d, 0.8));
    return out;
  }

  /** Camera recoil springs (pitch / yaw / roll) + feeding in the permanent muzzle climb. */
  _stepRecoil(dt) {
    const R = this.weapon.def.recoil;
    const w = R.spring, c = 2 * R.damping * w, k = w * w;
    // sub-step so a long frame can't make the stiff spring blow up
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.recoilVel += (-k * this.recoilOff - c * this.recoilVel) * h;
      this.recoilOff += this.recoilVel * h;
      this.recoilYawVel += (-k * this.recoilYawOff - c * this.recoilYawVel) * h;
      this.recoilYawOff += this.recoilYawVel * h;
      // roll settles faster so the horizon never feels drunk
      this.recoilRollVel += (-k * 1.6 * this.recoilRoll - c * 1.3 * this.recoilRollVel) * h;
      this.recoilRoll += this.recoilRollVel * h;
    }
    const tr = this.recoilClimb * (1 - Math.exp(-dt * 24));
    this.recoilClimb -= tr;
    this.pitch = clamp(this.pitch + tr, -1.5, 1.5);
  }

  _dropPlayerMag(kind, rounds) {
    const p = this.player;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch * 0.3 - 0.3, this.yaw, -0.5, 'YXZ'));
    const obj = this.vm.pistol.cloneMagazine(kind === 'tactical' ? rounds : 0);
    obj.position.copy(this.eyePosition(v())).add(v().set(-0.05, -0.3, -0.32).applyQuaternion(q));
    obj.quaternion.copy(q);
    this.effects.dropMagazine(obj, v().set(p.vx * 0.8, -1.2, p.vz * 0.8));
  }

  // ------------------------------------------------------------------ menu camera
  /** Slow cinematic shots around the plant for each menu screen. */
  _menuCamera(dt) {
    const t = this.time;
    const pos = v(), look = v();
    switch (this.shot) {
      case 'solo': case 'new':
        pos.set(-13 + Math.sin(t * 0.05) * 5, 5.2, -7.2); look.set(4 + Math.sin(t * 0.07) * 4, 0.8, -18); break;
      case 'coop':
        pos.set(22 + Math.sin(t * 0.04) * 6, 6.5, 26); look.set(4, 1.5, -2); break;
      case 'profile': {
        // camera south of the operator looking north at them (the hall behind); the look
        // point sits to their left so they stand in the free right half of the screen
        const a = Math.sin(t * 0.25) * 0.25;
        pos.set(PREVIEW.x + Math.sin(a) * 3.4, 1.5, PREVIEW.z + Math.cos(a) * 3.4);
        look.set(PREVIEW.x - 1.7, 1.15, PREVIEW.z);
        break;
      }
      case 'settings': case 'career': case 'news': {
        const a = t * 0.02;
        pos.set(Math.sin(a) * 95, 34, Math.cos(a) * 95); look.set(0, 0, -10); break;
      }
      default: { // home / continue
        const a = 0.6 + t * 0.035;
        pos.set(HALL.x + Math.sin(a) * 46, 17, HALL.z + Math.cos(a) * 46); look.set(HALL.x, 2, HALL.z);
      }
    }
    const k = this.camSnap ? 1 : 1 - Math.exp(-dt * 1.6);
    this.camSnap = false;
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    const cam = this.camera;
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ render
  render(dt, alpha, look, draw = true) {
    this.time += dt;
    const inMenu = this.state === 'menu';
    const p = this.player, pr = this.prev;
    this.corr.multiplyScalar(Math.exp(-dt * 10));
    const x = lerp(pr.x, p.x, alpha) + this.corr.x, y = lerp(pr.y, p.y, alpha) + this.corr.y, z = lerp(pr.z, p.z, alpha) + this.corr.z;
    const crouch = lerp(pr.crouch, p.crouch, alpha);
    const speed = Math.hypot(p.vx, p.vz);
    const speedFrac = clamp(speed / PLAYER.walkSpeed, 0, 1.6);

    // camera smoothing layers
    this.stepOff = damp(this.stepOff, 0, 14, dt);
    this.landVel += (-this.landDip * 120 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;
    this._stepRecoil(dt);
    if (p.grounded) this.bobDist += speed * dt * 1.9;
    const bob = p.grounded ? Math.abs(Math.sin(this.bobDist)) * 0.022 * Math.min(1, speedFrac) * (1 - this.vm.aim * 0.8) * this.settings.bob : 0;

    const eye = lerp(PLAYER.eye, PLAYER.crouchEye, crouch);
    const cam = this.camera;
    const tp = this.view === 'tp';
    if (inMenu) {
      this._menuCamera(dt);
    } else {
      this.camSnap = true;
      cam.rotation.set(this.pitch + this.recoilOff, this.yaw + this.recoilYawOff, this.recoilRoll, 'YXZ');
      const eyePos = v().set(x, y + eye + this.stepOff + this.landDip + bob, z);
      const aim = this.vm.aim;
      const fov = lerp(this.baseFov, Math.min(58, this.baseFov - 12), aim) + (p.sprinting ? 4 : 0) * (1 - aim);
      this.curFov = damp(this.curFov || fov, fov, 14, dt);
      if (Math.abs(cam.fov - this.curFov) > 0.01) { cam.fov = this.curFov; cam.updateProjectionMatrix(); }
      if (tp) {
        const q = cam.quaternion;
        const back = v().set(0.55, 0.25, 2.8).applyQuaternion(q);
        const dist = back.length();
        back.normalize();
        const h = this.world.raycast(eyePos.x, eyePos.y, eyePos.z, back.x, back.y, back.z, dist + 0.3);
        const d2 = h ? Math.max(0.3, h.t - 0.3) : dist;
        cam.position.copy(eyePos).addScaledVector(back, d2);
      } else {
        cam.position.copy(eyePos);
      }
      cam.updateMatrixWorld();
    }

    // the player's own body (visible in third person)
    const pc = this.playerChar;
    pc.root.visible = tp && !inMenu;
    if (pc.root.visible) {
      pc.root.position.set(x, y, z);
      pc.update(dt, { vx: p.vx, vz: p.vz, yaw: this.yaw, pitch: this.pitch + this.recoilOff, grounded: p.grounded, crouch: p.crouch, sprint: p.sprinting, ready: 1 });
    }
    // menu: your operator stands in the yard for the profile shot
    const pv = this.previewChar;
    pv.root.visible = inMenu;
    if (inMenu) {
      pv.root.position.set(PREVIEW.x, this.world.heightAt(PREVIEW.x, PREVIEW.z), PREVIEW.z);
      pv.update(dt, { vx: 0, vz: 0, yaw: Math.PI + 0.25 + Math.sin(this.time * 0.4) * 0.25, pitch: -0.05, grounded: true, crouch: 0, sprint: false, ready: 0.35 });
    }
    // co-op partners
    if (this.session.online) this.remotes.update(dt, this.session.remoteStates());

    // sun + shadow frustum follow the camera focus (snapped to avoid shimmer)
    const fx = inMenu ? this.camLook.x : x, fz = inMenu ? this.camLook.z : z;
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx, 0, sz).addScaledVector(this.sunDir, 150);

    // world animation + fx
    this.map.update(dt, this.time);
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.map.smokeSource) {
      this.smokeT = 0.3;
      const s = this.map.smokeSource;
      this.effects.puff(s.clone().add(v().set((Math.random() - 0.5) * 1.2, 0, (Math.random() - 0.5) * 1.2)),
        v().set(1.2 + Math.random(), 2.4 + Math.random(), 0.6), 0x8d8a86, 2.8, 7, 0.45, 4.5);
    }
    this.effects.update(dt);
    this.factoryView.update(dt, this.time, cam);
    this.panels.update(dt);
    if (this.state === 'playing') { this.updateFocus(); this.build.update(); } else this.hud.prompt('');

    // progression HUD (cheap, throttled)
    this.goalT -= dt;
    if (this.goalT <= 0) {
      this.goalT = 0.4;
      const sim = this.factory;
      this.hud.setLevel(sim.levelInfo());
      this.hud.setGoals(sim, this.settings.hints);
      const s = this.session;
      this.hud.setRoster(s.online ? { host: s.isHost, code: s.code, ping: (s.rtt || 0) * 1000, players: [{ name: this.settings.name, color: this.settings.color, you: true }, ...[...s.remotes.values()].map((r) => ({ name: r.name, color: r.color }))] } : null);
    }

    // autosave (solo) / reserve sync (host) + career
    this.saveT -= dt;
    if (this.saveT <= 0) {
      this.saveT = 10;
      if (this.dirtySave && !this.session.online) { this.dirtySave = false; this.saveNow(); }
      if (this.session.online && this.session.isHost) this.session.sendReserve(this.weapon.reserve);
      saveCareer(this.career);
    }

    // audio listener
    const fwd = v().set(0, 0, -1).applyQuaternion(cam.quaternion);
    const upv = v().set(0, 1, 0).applyQuaternion(cam.quaternion);
    this.audio.setListener(cam.position, fwd, upv);

    // viewmodel
    this.vm.update(dt, {
      aim: this.state === 'playing' && this.input.mouse.right,
      sprint: p.sprinting,
      speedFrac,
      grounded: p.grounded,
      landSpeed: p.landSpeed,
      lookDX: look.dx, lookDY: look.dy,
      trigger: this.state === 'playing' && this.input.mouse.left,
      weapon: this.weapon,
      camQuat: cam.quaternion,
      sunDir: this.sunDir,
      bobDist: this.bobDist,
    });

    // HUD
    this.hintT += dt;
    const aim = this.vm.aim;
    const cone = this.weapon.spread(aim, clamp(speed / PLAYER.walkSpeed, 0, 1.5), !p.grounded);
    const spreadPx = Math.tan(cone) / Math.tan((cam.fov * DEG) / 2) * (innerHeight / 2);
    const fresh = this.factory.machines.size <= 1 && this.factory.belts.size === 0;
    this.hud.update(dt, {
      weapon: this.weapon,
      health: this.health,
      stance: p.sprinting ? 'SPRINT' : p.crouch > 0.5 ? 'CROUCHED' : p.grounded ? 'STANDING' : 'AIRBORNE',
      spreadPx,
      aim,
      sprint: p.sprinting,
      headingDeg: -this.yaw / DEG,
      hint: this.settings.hints && this.hintT < 20 && fresh ? 'Your hall is empty: order parts at the supply terminal, craft machine kits at the fab bench, then place them (B)' : '',
      view: tp ? 'THIRD PERSON' : 'FIRST PERSON',
    });

    // draw
    if (!draw) return;
    const r = this.renderer;
    r.clear();
    r.render(this.scene, cam);
    if (!tp && !inMenu) {
      r.clearDepth();
      r.render(this.vm.scene, this.vm.camera);
    }
  }
}

// Canvas signage uses the web fonts; give them a moment to arrive before textures are drawn.
try {
  await Promise.race([
    Promise.all([
      document.fonts.load('700 40px "Barlow Condensed"'),
      document.fonts.load('600 40px "Barlow Condensed"'),
      document.fonts.load('500 20px "IBM Plex Mono"'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
} catch (_) { /* fall back to system fonts */ }

try {
  window.__game = new Game();
} catch (err) {
  console.error(err);
  const el = document.getElementById('boot-error');
  if (el) { el.hidden = false; el.textContent = `The game failed to start: ${err.message}. WebGL may be disabled in this browser.`; }
}
