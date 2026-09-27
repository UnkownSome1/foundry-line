// Builds the visual world from the shared World (heightfield + prop descriptors).
// Static geometry is batched per material; foliage is instanced; a handful of
// things animate (conveyor, press rams, chimney smoke, beacon, grass, steel plates).
import * as THREE from 'three';
import { materials } from '../gfx/materials.js';
import { chamferBox, batchStatic, cyl, polySoup } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';
import { MAP } from '../../shared/constants.js';
import { roadX, yardDistance, HALL } from '../../shared/mapLayout.js';
import { mulberry32, smoothstep, clamp } from '../../shared/math.js';
import { createNoise2D } from '../../shared/noise.js';

const C = (hex) => new THREE.Color(hex);

function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = cast;
  m.receiveShadow = receive;
  parent.add(m);
  return m;
}
const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);

export class MapBuilder {
  constructor(scene, world, { sunDir }) {
    this.scene = scene;
    this.world = world;
    this.M = materials();
    this.root = new THREE.Group();
    this.root.name = 'map';
    scene.add(this.root);
    this.static = new THREE.Group();
    this.root.add(this.static);
    this.dynamic = new THREE.Group();
    this.root.add(this.dynamic);
    this.updaters = [];
    this.steelPlates = [];
    this.rand = mulberry32(world.seed ^ 0x1234);
    this.sunDir = sunDir;
    this.pointLights = [];

    this.buildSky();
    this.buildTerrain();
    this.buildOuterTerrain();
    this.buildYard();
    for (const p of world.props) this.buildProp(p);
    this.buildGrass();
    batchStatic(this.static);
  }

  // ------------------------------------------------------------------ sky
  buildSky() {
    const geo = new THREE.SphereGeometry(1500, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenith: { value: C(0x5f87b5) },
        horizon: { value: C(0xdcc9ab) },
        ground: { value: C(0x8b8272) },
        sunDir: { value: this.sunDir.clone().normalize() },
        sunColor: { value: C(0xfff0d4) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform vec3 zenith, horizon, ground, sunDir, sunColor; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 col = h > 0.0 ? mix(horizon, zenith, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, pow(clamp(-h,0.0,1.0), 0.35));
          float s = max(dot(vDir, normalize(sunDir)), 0.0);
          col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.35 + pow(s, 6.0) * 0.12);
          // faint high cloud banding
          float band = sin(vDir.x * 9.0 + vDir.z * 5.0) * sin(vDir.z * 13.0 - vDir.x * 3.0);
          col += vec3(0.05) * smoothstep(0.3, 0.9, band) * smoothstep(0.05, 0.35, h) * (1.0 - smoothstep(0.35, 0.8, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    this.root.add(sky);
  }

  // ------------------------------------------------------------------ terrain
  terrainColor(x, z, h, ny, rnd) {
    const d = yardDistance(x, z);
    const n = this.world.n3(x * 0.05, z * 0.05);
    let c;
    if (ny < 0.72) c = rnd < 0.5 ? 0x7a746b : 0x6b665e; // rock face
    else if (ny < 0.83) c = rnd < 0.5 ? 0x7b6a4c : 0x8a7652; // scree / dirt slope
    else if (n > 0.45) c = rnd < 0.5 ? 0xa39a5c : 0x958d52; // dry grass patch
    else c = [0x6d8d3f, 0x789a45, 0x648437, 0x7fa04a][Math.floor(rnd * 4)];
    if (d < 7) c = rnd < 0.5 ? 0x7c6a4e : 0x86735a; // trampled dirt ring around the fence
    if (z > MAP.yardHalfZ - 4 && Math.abs(x - roadX(z)) < 4.2) c = rnd < 0.5 ? 0x8a8070 : 0x7d7465; // gravel road
    if (h > 20 && ny > 0.8) c = rnd < 0.6 ? 0x8a8a6a : 0x7c7d62;
    return C(c);
  }

  buildTerrain() {
    const w = this.world;
    const N = w.seg, cs = w.cell, H = w.half;
    const pos = [], col = [];
    const r = mulberry32(99);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    const tri = (x0, z0, x1, z1, x2, z2) => {
      const h0 = w.heightAt(x0, z0), h1 = w.heightAt(x1, z1), h2 = w.heightAt(x2, z2);
      const cx = (x0 + x1 + x2) / 3, cz = (z0 + z1 + z2) / 3;
      if (yardDistance(x0, z0) < 1e-3 && yardDistance(x1, z1) < 1e-3 && yardDistance(x2, z2) < 1e-3) return; // under the slab
      a.set(x0, h0, z0); b.set(x1, h1, z1); c.set(x2, h2, z2);
      n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const color = this.terrainColor(cx, cz, (h0 + h1 + h2) / 3, n.y, r());
      pos.push(x0, h0, z0, x1, h1, z1, x2, h2, z2);
      for (let k = 0; k < 3; k++) col.push(color.r, color.g, color.b);
    };
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x0 = -H + ix * cs, z0 = -H + iz * cs, x1 = x0 + cs, z1 = z0 + cs;
        tri(x0, z0, x0, z1, x1, z0);
        tri(x0, z1, x1, z1, x1, z0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.M.terrain);
    m.receiveShadow = true;
    m.castShadow = true;
    this.root.add(m);
    this.terrain = m;
  }

  /** Coarse far terrain so the horizon is mountains, not the edge of the world. */
  buildOuterTerrain() {
    const w = this.world;
    const size = 1536, N = 96, cs = size / N, H = size / 2; // 16 m cells; ±128 lies on grid lines
    const mn = createNoise2D(mulberry32(7));
    const height = (x, z) => {
      const m = Math.max(Math.abs(x), Math.abs(z));
      if (m < w.half - 1e-6) return -40;
      const base = w.sampleHeight(clamp(x, -w.half, w.half), clamp(z, -w.half, w.half));
      const k = smoothstep(w.half, w.half + 140, m);
      const ridge = 1 - Math.abs(mn(x * 0.004, z * 0.004));
      const far = 26 + ridge * ridge * 95 + mn(x * 0.012, z * 0.012) * 12;
      return base * (1 - k) + far * k;
    };
    const pos = [], col = [];
    const r = mulberry32(5);
    const push = (pts) => {
      if (pts.every(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) < w.half - 1e-6)) return;
      const hs = pts.map(([x, z]) => height(x, z));
      const a = new THREE.Vector3(pts[0][0], hs[0], pts[0][1]);
      const b = new THREE.Vector3(pts[1][0], hs[1], pts[1][1]);
      const c = new THREE.Vector3(pts[2][0], hs[2], pts[2][1]);
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      const hh = (hs[0] + hs[1] + hs[2]) / 3;
      let cc = n.y < 0.62 ? (r() < 0.5 ? 0x78746b : 0x6b675f) : hh > 95 ? (r() < 0.5 ? 0x8d8e80 : 0x7f8272) : n.y < 0.8 ? [0x6d7a44, 0x75803f][Math.floor(r() * 2)] : [0x5f7d3a, 0x6a8840, 0x58743a][Math.floor(r() * 3)];
      const color = C(cc);
      pts.forEach(([x, z], i) => { pos.push(x, hs[i], z); col.push(color.r, color.g, color.b); });
    };
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const x0 = -H + ix * cs, z0 = -H + iz * cs, x1 = x0 + cs, z1 = z0 + cs;
        push([[x0, z0], [x0, z1], [x1, z0]]);
        push([[x0, z1], [x1, z1], [x1, z0]]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.M.terrain);
    m.receiveShadow = false;
    this.root.add(m);
  }

  // ------------------------------------------------------------------ yard
  buildYard() {
    const M = this.M, S = this.static;
    // concrete slab (terrain under it is culled). Slight thickness at the edge.
    const slab = add(S, BOX(MAP.yardHalfX * 2, 0.3, MAP.yardHalfZ * 2), M.concrete, 0, -0.15, 0, 0, 0, 0, { cast: false });
    slab.receiveShadow = true;
    const paintY = new THREE.MeshStandardMaterial({ color: 0xe0a92a, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    const paintW = new THREE.MeshStandardMaterial({ color: 0xdedbd2, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    const line = (x, z, w, d, mat) => add(S, new THREE.PlaneGeometry(w, d), mat, x, 0.003, z, -Math.PI / 2, 0, 0, { cast: false });
    // walkway from gate to hall door
    line(-2.2, 18, 0.12, 40, paintY); line(2.2, 18, 0.12, 40, paintY);
    // forklift lane
    line(18, 14, 0.15, 30, paintW); line(14, 14, 0.15, 30, paintW);
    // loading bay boxes in front of containers
    for (const x of [-36, -30, -24]) line(x, 8, 0.12, 5, paintY);
    line(-30, 5.5, 12, 0.12, paintY);
    // stop line at the gate
    line(0, 37.5, 10, 0.4, paintW);
    // oil stains
    const stainMat = new THREE.MeshStandardMaterial({ map: T.radial('rgba(20,18,15,0.55)', 'rgba(20,18,15,0)'), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 });
    for (let i = 0; i < 14; i++) {
      const s = 0.8 + this.rand() * 2.2;
      add(this.dynamic, new THREE.PlaneGeometry(s, s * (0.6 + this.rand() * 0.6)), stainMat, (this.rand() - 0.5) * 90, 0.004, (this.rand() - 0.5) * 70, -Math.PI / 2, 0, this.rand() * 3, { cast: false });
    }
    // Gate sign on the fence
    const signMat = new THREE.MeshStandardMaterial({
      map: T.textPlate([{ text: 'PLANT 07', size: 64 }, { text: 'AUTHORISED PERSONNEL ONLY', size: 28 }, { text: 'PPE REQUIRED BEYOND THIS POINT', size: 22, color: '#1d1d1b' }], { w: 512, h: 256, bg: '#e8e3d6', fg: '#b3261e', border: '#1d1d1b' }),
      roughness: 0.6,
    });
    add(S, BOX(2.4, 1.2, 0.04), signMat, 9.5, 1.6, 39.9);
  }

  // ------------------------------------------------------------------ props
  buildProp(p) {
    const fn = this['prop_' + p.type];
    if (fn) fn.call(this, p);
  }

  prop_hall(p) {
    const M = this.M, S = this.static;
    const x0 = p.x - p.w / 2, x1 = p.x + p.w / 2, z0 = p.z - p.d / 2, z1 = p.z + p.d / 2;
    const t = p.wall, H = p.h, band = 1.2;
    const g = new THREE.Group();
    S.add(g);
    // wall segment builder along X or Z with brick base + cladding
    const seg = (axis, fixed, a, b, y0, y1) => {
      const len = b - a;
      if (len <= 0.01) return;
      const mid = (a + b) / 2;
      const put = (ya, yb, mat) => {
        if (yb <= ya) return;
        const h = yb - ya, cy = (ya + yb) / 2;
        if (axis === 'x') add(g, BOX(len, h, t), mat, mid, cy, fixed);
        else add(g, BOX(t, h, len), mat, fixed, cy, mid);
      };
      put(y0, Math.min(band, y1), M.brick);
      put(Math.max(band, y0), y1, M.wallPanel);
    };
    const d = p.doors;
    seg('x', z1, x0, d.south.from, 0, H); seg('x', z1, d.south.to, x1, 0, H); seg('x', z1, d.south.from, d.south.to, d.south.h, H);
    seg('x', z0, x0, d.north.from, 0, H); seg('x', z0, d.north.to, x1, 0, H); seg('x', z0, d.north.from, d.north.to, d.north.h, H);
    seg('z', x0, z0, z1, 0, H);
    seg('z', x1, z0, d.east.from, 0, H); seg('z', x1, d.east.to, z1, 0, H); seg('z', x1, d.east.from, d.east.to, d.east.h, H);
    // corner trims + top flashing
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) add(g, BOX(0.55, H + 0.1, 0.55), M.steelDark, cx, H / 2, cz);
    add(g, BOX(p.w + 0.6, 0.25, 0.6), M.steelDark, p.x, H, z1); add(g, BOX(p.w + 0.6, 0.25, 0.6), M.steelDark, p.x, H, z0);
    add(g, BOX(0.6, 0.25, p.d + 0.6), M.steelDark, x0, H, p.z); add(g, BOX(0.6, 0.25, p.d + 0.6), M.steelDark, x1, H, p.z);
    // clerestory windows (both faces) on long walls and west wall
    const winMat = new THREE.MeshStandardMaterial({ color: 0x324049, roughness: 0.15, metalness: 0.6, emissive: 0x1a2530, emissiveIntensity: 0.4 });
    const mullion = M.steelDark;
    const winRow = (axis, fixed, a, b, out) => {
      for (let u = a + 1.5; u < b - 1.5; u += 3.2) {
        for (const side of [-1, 1]) {
          const off = fixed + side * (t / 2 + 0.01);
          if (axis === 'x') { add(g, BOX(2.6, 1.1, 0.02), winMat, u, 6.2, off, 0, 0, 0, { cast: false }); add(g, BOX(0.08, 1.1, 0.04), mullion, u, 6.2, off); }
          else { add(g, BOX(0.02, 1.1, 2.6), winMat, off, 6.2, u, 0, 0, 0, { cast: false }); add(g, BOX(0.04, 1.1, 0.08), mullion, off, 6.2, u); }
        }
        void out;
      }
    };
    winRow('x', z1, x0, x1); winRow('x', z0, x0, x1); winRow('z', x0, z0, z1);
    // door frames with hazard stripes
    const frame = (axis, fixed, a, b, h) => {
      for (const u of [a, b]) {
        if (axis === 'x') add(g, BOX(0.3, h, t + 0.12), M.hazard, u, h / 2, fixed);
        else add(g, BOX(t + 0.12, h, 0.3), M.hazard, fixed, h / 2, u);
      }
      if (axis === 'x') add(g, BOX(b - a + 0.3, 0.3, t + 0.12), M.hazard, (a + b) / 2, h, fixed);
      else add(g, BOX(t + 0.12, 0.3, b - a + 0.3), M.hazard, fixed, h, (a + b) / 2);
    };
    frame('x', z1, d.south.from, d.south.to, d.south.h);
    frame('x', z0, d.north.from, d.north.to, d.north.h);
    frame('z', x1, d.east.from, d.east.to, d.east.h);
    // roller door drums + part-lowered north door
    add(g, cyl(0.35, 0.35, d.south.to - d.south.from + 0.4, 12).rotateZ(Math.PI / 2), M.steelDark, 0, d.south.h + 0.45, z1 - 0.5);
    add(g, cyl(0.35, 0.35, d.north.to - d.north.from + 0.4, 12).rotateZ(Math.PI / 2), M.steelDark, (d.north.from + d.north.to) / 2, d.north.h + 0.45, z0 + 0.5);
    add(g, BOX(d.north.to - d.north.from, 0.9, 0.06), M.roofPanel, (d.north.from + d.north.to) / 2, d.north.h - 0.35, z0 + 0.1);

    // sawtooth roof: 5 teeth along Z, glazing faces north
    const teeth = 5, tl = p.d / teeth, rise = 2.2;
    const slopeLen = Math.hypot(tl, rise), ang = Math.atan2(rise, tl);
    for (let i = 0; i < teeth; i++) {
      const za = z1 - i * tl, zb = za - tl;
      add(g, new THREE.PlaneGeometry(p.w + 0.4, slopeLen), M.roofPanel, p.x, H + rise / 2 + 0.12, (za + zb) / 2, -Math.PI / 2 + ang, 0, 0);
      add(g, new THREE.PlaneGeometry(p.w, rise), M.skylight, p.x, H + rise / 2 + 0.12, zb, 0, Math.PI, 0, { cast: false });
      add(g, BOX(p.w + 0.4, 0.15, 0.2), M.steelDark, p.x, H + rise + 0.12, zb);
      // gable triangles on the end walls
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(tl, 0), new THREE.Vector2(tl, rise)]);
      const tg = new THREE.ExtrudeGeometry(tri, { depth: t, bevelEnabled: false });
      for (const ex of [x0 - t / 2, x1 - t / 2]) {
        const m = add(g, tg, M.wallPanel, ex, H + 0.12, za, 0, Math.PI / 2, 0);
        m.scale.set(1, 1, 1);
      }
    }
    // ceiling truss chords (visible from inside)
    for (let i = 0; i <= teeth; i++) add(g, BOX(p.w, 0.25, 0.14), M.steelBlue, p.x, H - 0.1, z1 - i * tl);

    // Facade sign + safety board
    const sign = new THREE.MeshStandardMaterial({
      map: T.textPlate([{ text: 'FOUNDRY LINE', size: 84 }, { text: 'PLANT 07 · STAMPING & ASSEMBLY', size: 34, color: '#f2b01e' }], { w: 1024, h: 256, bg: '#1d2328', fg: '#ede8df' }),
      roughness: 0.5, metalness: 0.2,
    });
    add(g, BOX(12, 1.8, 0.12), sign, p.x, 7.0, z1 + 0.28);
    const board = new THREE.MeshStandardMaterial({
      map: T.textPlate([{ text: 'THIS SITE HAS WORKED', size: 30 }, { text: '214', size: 110, color: '#ffffff' }, { text: 'DAYS WITHOUT A LOST-TIME INJURY', size: 26 }], { w: 512, h: 320, bg: '#1f6b3a', fg: '#e9f2e6', border: '#e9f2e6' }),
      roughness: 0.6,
    });
    add(g, BOX(2.4, 1.5, 0.08), board, 7.2, 2.3, z1 + 0.26);
    const ppe = new THREE.MeshStandardMaterial({
      map: T.textPlate([{ text: 'HEARING &', size: 38 }, { text: 'EYE PROTECTION', size: 38 }, { text: 'MUST BE WORN', size: 30 }], { w: 256, h: 256, bg: '#1d4f9c', fg: '#ffffff' }),
      roughness: 0.6,
    });
    add(g, BOX(1.0, 1.0, 0.06), ppe, -5.6, 2.2, z1 + 0.24);

    // interior lighting
    const lampShade = new THREE.MeshStandardMaterial({ color: 0x2f4a3c, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide });
    for (const lx of [-12, 0, 12]) for (const lz of [-22, -10]) {
      add(g, cyl(0.12, 0.55, 0.45, 10, true), lampShade, lx, 6.3, lz + 3.5, 0, 0, 0, { cast: false });
      add(g, new THREE.CircleGeometry(0.42, 10), M.lampOn, lx, 6.1, lz + 3.5, Math.PI / 2, 0, 0, { cast: false });
      add(g, cyl(0.01, 0.01, 1.6, 4), M.steelDark, lx, 7.3, lz + 3.5, 0, 0, 0, { cast: false });
    }
    for (const [lx, lz] of [[-10, -16], [10, -16], [0, -24]]) {
      const L = new THREE.PointLight(0xffd9a0, 22, 22, 1.6);
      L.position.set(lx, 5.8, lz);
      this.dynamic.add(L);
      this.pointLights.push(L);
    }
  }

  prop_column(p) {
    const M = this.M, S = this.static;
    add(S, BOX(0.36, p.h, 0.05), M.steelBlue, p.x, p.h / 2, p.z - 0.17);
    add(S, BOX(0.36, p.h, 0.05), M.steelBlue, p.x, p.h / 2, p.z + 0.17);
    add(S, BOX(0.05, p.h, 0.3), M.steelBlue, p.x, p.h / 2, p.z);
    add(S, BOX(0.46, 1.1, 0.46), M.hazard, p.x, 0.55, p.z);
    add(S, BOX(0.6, 0.05, 0.6), M.steelDark, p.x, 0.025, p.z);
  }

  prop_craneBeam(p) {
    const M = this.M, S = this.static;
    for (const z of [-24.5, -7.5]) {
      add(S, BOX(p.len, 0.5, 0.22), M.steelYellow, p.x, p.y, z);
    }
    // bridge girder spanning the rails + hoist
    const bx = -4;
    add(S, BOX(0.5, 0.6, 17.4), M.steelYellow, bx, p.y - 0.05, -16);
    add(S, BOX(0.9, 0.5, 0.9), M.steelDark, bx, p.y - 0.55, -13);
    add(S, cyl(0.02, 0.02, 3.2, 4), M.steelDark, bx - 0.15, p.y - 2.4, -13);
    add(S, cyl(0.02, 0.02, 3.2, 4), M.steelDark, bx + 0.15, p.y - 2.4, -13);
    add(S, chamferBox(0.36, 0.5, 0.3, 0.05), M.steelYellow, bx, p.y - 4.2, -13);
    add(S, new THREE.TorusGeometry(0.14, 0.035, 6, 10, Math.PI * 1.4), M.steelDark, bx, p.y - 4.62, -13, 0, 0, 2.2);
  }

  prop_press(p) {
    const M = this.M, S = this.static;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.rot;
    S.add(g);
    add(g, chamferBox(3.2, 0.9, 2.6, 0.08), M.machineGreen, 0, 0.45, 0);
    add(g, BOX(2.6, 0.18, 2.0), M.steelDark, 0, 0.99, 0); // bolster
    for (const sx of [-1, 1]) add(g, chamferBox(0.6, 3.0, 2.2, 0.06), M.machineGreen, sx * 1.3, 2.4, 0);
    add(g, chamferBox(3.3, 1.0, 2.5, 0.08), M.machineGreen, 0, 3.9, 0);
    add(g, BOX(3.32, 0.18, 0.1), M.hazard, 0, 3.5, -1.26);
    add(g, BOX(2.0, 0.12, 0.05), M.hazard, 0, 1.1, -1.03);
    // flywheel on top
    add(g, cyl(0.7, 0.7, 0.25, 16).rotateZ(Math.PI / 2), M.steelDark, 1.4, 4.7, 0.4);
    // control pedestal
    add(g, BOX(0.35, 1.2, 0.3), M.steelYellow, 2.0, 0.6, -1.5);
    add(g, BOX(0.45, 0.35, 0.3), M.steelYellow, 2.0, 1.3, -1.5);
    add(g, cyl(0.045, 0.045, 0.05, 10).rotateX(Math.PI / 2), M.ledGreen, 1.9, 1.33, -1.66, 0, 0, 0, { cast: false });
    add(g, cyl(0.06, 0.06, 0.05, 10).rotateX(Math.PI / 2), M.ledRed, 2.1, 1.33, -1.66, 0, 0, 0, { cast: false });
    add(g, cyl(0.1, 0.1, 0.18, 10), M.ledAmber, 1.2, 4.5, -1.0, 0, 0, 0, { cast: false });
    // animated ram
    const ram = add(this.dynamic, chamferBox(2.1, 0.7, 1.7, 0.06), M.steelDark, 0, 0, 0);
    const plate = add(ram, BOX(2.12, 0.14, 0.05), M.hazard, 0, -0.15, -0.86);
    void plate;
    const base = new THREE.Vector3(p.x, 0, p.z);
    const phase = this.rand() * 4;
    this.updaters.push((dt, t) => {
      const c = ((t + phase) % 4) / 4;
      const stroke = c < 0.15 ? c / 0.15 : c < 0.3 ? 1 - (c - 0.15) / 0.15 : 0;
      ram.position.set(base.x, 3.0 - stroke * stroke * 1.55, base.z);
    });
  }

  prop_conveyor(p) {
    const M = this.M, S = this.static;
    const x0 = p.x - p.len / 2;
    for (const sz of [-1, 1]) add(S, BOX(p.len, 0.16, 0.08), M.steelYellow, p.x, p.h - 0.08, p.z + sz * (p.w / 2));
    for (let x = x0 + 0.8; x < x0 + p.len; x += 2.4) {
      for (const sz of [-1, 1]) add(S, BOX(0.08, p.h - 0.1, 0.08), M.steelDark, x, (p.h - 0.1) / 2, p.z + sz * (p.w / 2 - 0.05));
      add(S, BOX(0.08, 0.06, p.w), M.steelDark, x, 0.3, p.z);
    }
    const belt = add(this.dynamic, new THREE.PlaneGeometry(p.len, p.w - 0.1), M.belt, p.x, p.h - 0.02, p.z, -Math.PI / 2, 0, 0, { cast: false });
    void belt;
    // guard rail motor at the head end
    add(S, chamferBox(0.6, 0.5, 0.5, 0.05), M.machineGreen, x0 - 0.1, p.h - 0.35, p.z + p.w / 2 + 0.3);
    // cartons riding the belt
    const cartons = [];
    const cartonMat = M.cardboard;
    const tape = new THREE.MeshStandardMaterial({ color: 0xc9a46a, roughness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const s = 0.45 + this.rand() * 0.2;
      const c = add(this.dynamic, BOX(s, s * 0.8, s * 0.9), cartonMat, 0, p.h + s * 0.4, p.z);
      add(c, BOX(s * 1.01, 0.01, 0.08), tape, 0, s * 0.4, 0);
      cartons.push({ m: c, off: (i / 6) * p.len });
    }
    const speed = 0.9;
    this.updaters.push((dt, t) => {
      M.beltMap.offset.x = -(t * speed) / 1 % 1;
      for (const c of cartons) c.m.position.x = x0 + ((c.off + t * speed) % p.len);
    });
  }

  prop_rack(p) {
    const M = this.M, S = this.static;
    const z0 = p.z - p.len / 2;
    const beamMat = new THREE.MeshStandardMaterial({ color: 0xd9621e, roughness: 0.55, metalness: 0.3 });
    for (let z = z0; z <= z0 + p.len + 0.01; z += p.len / 3) {
      for (const sx of [-1, 1]) add(S, BOX(0.08, p.h, 0.08), M.steelBlue, p.x + sx * p.depth / 2, p.h / 2, z);
    }
    for (const y of [0.15, 1.3, 2.45]) {
      for (const sx of [-1, 1]) add(S, BOX(0.06, 0.12, p.len), beamMat, p.x + sx * p.depth / 2, y, p.z);
      // pallets + goods per bay
      for (let b = 0; b < 3; b++) {
        const bz = z0 + (b + 0.5) * (p.len / 3);
        add(S, BOX(p.depth - 0.1, 0.12, 2.6), M.wood, p.x, y + 0.12, bz);
        const kind = (b + Math.round(y * 3)) % 3;
        if (kind === 0) add(S, BOX(p.depth - 0.2, 0.8, 2.4), M.cardboard, p.x, y + 0.6, bz);
        else if (kind === 1) for (const dz of [-0.6, 0.6]) add(S, cyl(0.28, 0.28, 0.85, 12), M.steelBlue, p.x, y + 0.62, bz + dz);
        else add(S, chamferBox(p.depth - 0.2, 0.7, 2.3, 0.12), M.sackWhite, p.x, y + 0.55, bz);
      }
    }
  }

  prop_bench(p) {
    const M = this.M, S = this.static;
    add(S, BOX(2.4, 0.06, 0.9), M.wood, p.x, 0.93, p.z);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(S, BOX(0.06, 0.9, 0.06), M.steelDark, p.x + sx * 1.1, 0.45, p.z + sz * 0.38);
    add(S, BOX(2.3, 0.04, 0.8), M.steelDark, p.x, 0.25, p.z);
    add(S, chamferBox(0.2, 0.14, 0.14, 0.02), M.steelBlue, p.x - 0.9, 1.03, p.z - 0.3); // vise
    add(S, BOX(2.4, 1.2, 0.04), new THREE.MeshStandardMaterial({ color: 0x55606a, roughness: 0.8 }), p.x, 1.7, p.z + 0.44); // tool board
    for (let i = 0; i < 7; i++) add(S, BOX(0.05, 0.25 + (i % 3) * 0.08, 0.03), M.steelDark, p.x - 1 + i * 0.32, 1.75, p.z + 0.4);
    add(S, BOX(0.5, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, metalness: 0.3 }), p.x + 0.8, 1.11, p.z - 0.1); // toolbox
  }

  prop_chimney(p) {
    const M = this.M, S = this.static;
    const brickMat = new THREE.MeshStandardMaterial({ map: M.brick.map.clone(), roughness: 0.9 });
    brickMat.map.repeat.set(7, 14);
    brickMat.map.needsUpdate = true;
    add(S, cyl(p.r1, p.r0, p.h, 14), brickMat, p.x, p.h / 2, p.z);
    add(S, cyl(p.r0 + 0.3, p.r0 + 0.35, 1.6, 14), M.concreteDark, p.x, 0.8, p.z);
    for (const y of [p.h * 0.4, p.h * 0.7, p.h - 0.6]) {
      const r = p.r0 + (p.r1 - p.r0) * (y / p.h) + 0.06;
      add(S, cyl(r, r, 0.35, 14), M.steelDark, p.x, y, p.z);
    }
    // aviation beacon
    const beacon = add(this.dynamic, new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff1a0a, emissiveIntensity: 3 }), p.x, p.h + 0.25, p.z, 0, 0, 0, { cast: false });
    this.updaters.push((dt, t) => { beacon.material.emissiveIntensity = Math.sin(t * 3) > 0.3 ? 4 : 0.2; });
    this.smokeSource = new THREE.Vector3(p.x, p.h + 0.5, p.z);
  }

  prop_silo(p) {
    const M = this.M, S = this.static;
    add(S, cyl(p.r + 0.4, p.r + 0.4, 0.5, 16), M.concreteDark, p.x, 0.25, p.z);
    add(S, cyl(p.r, p.r, p.h, 18), M.steelGalv, p.x, p.h / 2 + 0.5, p.z);
    add(S, cyl(0.6, p.r, 2.4, 18), M.steelGalv, p.x, p.h + 1.7, p.z);
    for (let y = 2; y < p.h; y += 2.4) add(S, cyl(p.r + 0.05, p.r + 0.05, 0.12, 18), M.steelDark, p.x, y, p.z);
    // walkway ring + railing at the top
    add(S, cyl(p.r + 0.9, p.r + 0.9, 0.08, 18), M.steelDark, p.x, p.h + 0.5, p.z);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) add(S, BOX(0.05, 1.0, 0.05), M.steelYellow, p.x + Math.cos(a) * (p.r + 0.85), p.h + 1.0, p.z + Math.sin(a) * (p.r + 0.85));
    add(S, new THREE.TorusGeometry(p.r + 0.85, 0.03, 4, 24), M.steelYellow, p.x, p.h + 1.5, p.z, Math.PI / 2);
    // caged ladder on the west face
    const lx = p.x - p.r - 0.35;
    for (const dz of [-0.25, 0.25]) add(S, BOX(0.05, p.h, 0.05), M.steelDark, lx, p.h / 2 + 0.5, p.z + dz);
    for (let y = 1; y < p.h; y += 0.35) add(S, BOX(0.03, 0.03, 0.5), M.steelDark, lx, y, p.z);
    for (let y = 3; y < p.h; y += 1.2) add(S, new THREE.TorusGeometry(0.4, 0.025, 4, 12, Math.PI), M.steelDark, lx - 0.1, y, p.z, Math.PI / 2, 0, Math.PI / 2);
    // stencil
    const label = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: `SILO ${p.z < -25 ? 1 : 2}`, size: 90 }, { text: 'POLYMER PELLETS', size: 40 }], { w: 512, h: 256, fg: '#2a2e33' }), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });
    add(this.dynamic, new THREE.CylinderGeometry(p.r + 0.02, p.r + 0.02, 1.6, 10, 1, true, Math.PI * 1.5 - 0.5, 1.0), label, p.x, 7, p.z, 0, 0, 0, { cast: false });
  }

  prop_pipeRack(p) {
    const M = this.M, S = this.static;
    const len = p.toX - p.fromX, cx = (p.fromX + p.toX) / 2;
    const red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5, metalness: 0.4 });
    for (const z of p.zs) {
      add(S, cyl(0.28, 0.28, len, 12).rotateZ(Math.PI / 2), M.steelGalv, cx, p.y + 0.3, z);
      add(S, cyl(0.14, 0.14, len, 10).rotateZ(Math.PI / 2), red, cx, p.y + 0.2, z + 0.5);
      for (const px of [24.5, 29]) {
        add(S, BOX(0.25, p.y, 0.25), M.steelDark, px, p.y / 2, z);
        add(S, BOX(0.25, 0.25, 1.4), M.steelDark, px, p.y, z + 0.2);
      }
      // drop into the silo
      add(S, cyl(0.28, 0.28, 6, 12), M.steelGalv, p.toX + 0.3, p.y + 3.3, z);
    }
  }

  prop_generator(p) {
    const M = this.M, S = this.static;
    add(S, chamferBox(3.2, 2.1, 1.8, 0.08), new THREE.MeshStandardMaterial({ color: 0x3f6b4a, roughness: 0.6, metalness: 0.3 }), p.x, 1.05, p.z);
    for (let i = 0; i < 8; i++) add(S, BOX(0.02, 1.2, 0.8), M.steelDark, p.x - 1.2 + i * 0.12, 1.2, p.z - 0.9);
    add(S, cyl(0.1, 0.1, 1.4, 8), M.steelDark, p.x + 1.1, 2.7, p.z + 0.4);
    const warn = new THREE.MeshStandardMaterial({ map: T.textPlate([{ text: '⚡ DANGER', size: 44 }, { text: 'HIGH VOLTAGE', size: 34 }], { w: 256, h: 128, bg: '#f2b01e', fg: '#1d1d1b' }), roughness: 0.6 });
    add(S, BOX(0.6, 0.3, 0.02), warn, p.x + 0.8, 1.5, p.z - 0.91);
  }

  prop_container(p) {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rot;
    this.static.add(g);
    const body = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.62, metalness: 0.3 });
    add(g, BOX(p.w - 0.02, p.h - 0.02, p.d - 0.02), body, 0, p.h / 2, 0);
    const sideTex = T.containerSide(p.color, p.code);
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, bumpMap: M.wallPanel.bumpMap, bumpScale: 3, roughness: 0.6, metalness: 0.3 });
    add(g, new THREE.PlaneGeometry(p.w - 0.2, p.h - 0.2), sideMat, 0, p.h / 2, p.d / 2 + 0.005);
    add(g, new THREE.PlaneGeometry(p.w - 0.2, p.h - 0.2), sideMat, 0, p.h / 2, -p.d / 2 - 0.005, 0, Math.PI, 0);
    // corner castings + rails
    const dark = M.steelDark;
    for (const sx of [-1, 1]) for (const sy of [0, 1]) for (const sz of [-1, 1]) {
      add(g, BOX(0.18, 0.12, 0.16), dark, sx * (p.w / 2 - 0.09), sy * (p.h - 0.06) + 0.06 * (1 - sy), sz * (p.d / 2 - 0.08));
    }
    for (const sy of [0.05, p.h - 0.05]) for (const sz of [-1, 1]) add(g, BOX(p.w, 0.1, 0.06), body, 0, sy, sz * (p.d / 2 - 0.02));
    // door end with locking bars
    const ex = p.w / 2 + 0.01;
    for (const dz of [-0.85, -0.35, 0.35, 0.85]) {
      add(g, cyl(0.022, 0.022, p.h - 0.3, 6), dark, ex + 0.03, p.h / 2, dz);
      add(g, BOX(0.05, 0.08, 0.12), dark, ex + 0.03, p.h * 0.45, dz + 0.06);
    }
    add(g, BOX(0.01, p.h - 0.25, 0.02), dark, ex, p.h / 2, 0);
  }

  prop_forklift(p) {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.rot;
    this.static.add(g);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe0a21e, roughness: 0.5, metalness: 0.2 });
    add(g, chamferBox(1.15, 0.7, 1.9, 0.08), yellow, 0, 0.65, 0.1);
    add(g, chamferBox(1.2, 0.75, 0.55, 0.1), M.steelDark, 0, 0.7, 1.05); // counterweight
    add(g, chamferBox(0.5, 0.12, 0.45, 0.04), M.rubber, 0, 1.1, 0.35); // seat
    add(g, chamferBox(0.5, 0.5, 0.1, 0.03), M.rubber, 0, 1.35, 0.6);
    add(g, cyl(0.16, 0.16, 0.03, 12).rotateX(0.9), M.rubber, 0, 1.35, -0.25);
    for (const sx of [-1, 1]) {
      add(g, BOX(0.06, 1.3, 0.06), M.steelDark, sx * 0.5, 1.65, 0.75); // guard posts
      add(g, BOX(0.06, 1.3, 0.06), M.steelDark, sx * 0.5, 1.65, -0.5);
      add(g, BOX(0.1, 2.3, 0.12), M.steelDark, sx * 0.35, 1.15, -0.95); // mast
      add(g, BOX(0.1, 0.05, 1.1), M.steelGalv, sx * 0.3, 0.1, -1.55); // forks
      for (const wz of [-0.55, 0.75]) add(g, cyl(0.3, 0.3, 0.25, 12).rotateZ(Math.PI / 2), M.rubber, sx * 0.55, 0.3, wz);
    }
    add(g, BOX(1.1, 0.06, 1.35), M.steelDark, 0, 2.3, 0.12); // overhead guard
    add(g, BOX(0.8, 0.5, 0.06), M.steelDark, 0, 0.45, -1.0); // carriage
    add(g, BOX(0.12, 0.1, 0.12), M.ledAmber, 0, 2.4, 0.5, 0, 0, 0, { cast: false });
    // pallet on the forks
    add(g, BOX(1.0, 0.14, 1.1), M.wood, 0, 0.21, -1.55);
    add(g, BOX(0.9, 0.6, 1.0), M.cardboard, 0, 0.58, -1.55);
  }

  prop_crate(p) {
    const mat = this.M.crates[p.variant % 3];
    add(this.static, BOX(p.s, p.s, p.s), mat, p.x, p.y + p.s / 2, p.z, 0, p.rot, 0);
  }

  prop_drum(p) {
    const M = this.M;
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.5, metalness: 0.4 });
    this._drumMats = this._drumMats || {};
    const m = this._drumMats[p.color] || (this._drumMats[p.color] = mat);
    add(this.static, cyl(0.29, 0.29, 0.88, 14), m, p.x, 0.44, p.z, 0, p.tilt * 6, 0);
    for (const y of [0.3, 0.6]) add(this.static, cyl(0.3, 0.3, 0.03, 14), m, p.x, y, p.z);
    add(this.static, cyl(0.27, 0.27, 0.012, 14), M.steelDark, p.x, 0.885, p.z);
    add(this.static, cyl(0.03, 0.03, 0.02, 8), M.steelGalv, p.x + 0.15, 0.9, p.z + 0.05);
  }

  prop_palletLoad(p) {
    const M = this.M, S = this.static;
    add(S, BOX(1.2, 0.14, 1.0), M.wood, p.x, 0.07, p.z);
    for (let l = 0; l < 3; l++) for (const [dx, dz] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
      add(S, chamferBox(0.56, 0.3, 0.46, 0.08), M.sackWhite, p.x + dx, 0.29 + l * 0.3, p.z + dz, 0, (l % 2) * 0.1, 0);
    }
  }

  prop_barrier(p) {
    const M = this.M;
    const shape = new THREE.Shape([new THREE.Vector2(-0.32, 0), new THREE.Vector2(0.32, 0), new THREE.Vector2(0.2, 0.25), new THREE.Vector2(0.1, 0.85), new THREE.Vector2(-0.1, 0.85), new THREE.Vector2(-0.2, 0.25)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
    geo.translate(0, 0, -1.1);
    const m = add(this.static, geo, M.concreteDark, p.x, 0, p.z, 0, Math.PI / 2 + p.rot, 0);
    void m;
    for (const dx of [-0.6, 0.6]) add(this.static, BOX(0.4, 0.12, 0.66), M.hazard, p.x + dx, 0.6, p.z);
  }

  prop_steelTarget(p) {
    const M = this.M;
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = p.facing;
    this.static.add(g);
    for (const sx of [-0.55, 0.55]) {
      add(g, BOX(0.08, 1.7, 0.08), M.steelDark, sx, 0.85, 0, 0, 0, 0.08 * Math.sign(sx));
      add(g, BOX(0.08, 0.08, 0.7), M.steelDark, sx * 1.05, 0.04, 0);
    }
    add(g, BOX(1.2, 0.08, 0.08), M.steelDark, 0, 1.68, 0);
    // swinging plate (dynamic)
    const pivot = new THREE.Group();
    pivot.position.set(p.x, 1.62, p.z);
    pivot.rotation.y = p.facing;
    this.dynamic.add(pivot);
    const plateMat = new THREE.MeshStandardMaterial({ color: p.id % 2 ? 0xf2f0ea : 0xff6b1a, roughness: 0.55, metalness: 0.3 });
    const r = p.size;
    for (const sx of [-0.12, 0.12]) add(pivot, cyl(0.008, 0.008, 0.3, 4), M.steelDark, sx, -0.15, 0);
    const plate = add(pivot, cyl(r, r, 0.02, 20).rotateX(Math.PI / 2), plateMat, 0, -0.3 - r, 0);
    const state = { pivot, plate, angle: 0, vel: 0, center: new THREE.Vector3(p.x, 1.62 - 0.3 - r, p.z), r, normalYaw: p.facing };
    this.steelPlates.push(state);
    this.updaters.push((dt) => {
      state.vel += (-state.angle * 30 - state.vel * 1.6) * dt;
      state.angle += state.vel * dt;
      pivot.rotation.x = state.angle;
    });
  }

  prop_fence(p) {
    const M = this.M, S = this.static;
    const len = p.to - p.from;
    const mid = (p.from + p.to) / 2;
    const isX = p.axis === 'x';
    const at = (u, y, v = 0) => (isX ? [u, y, p.fixed + v] : [p.fixed + v, y, u]);
    // mesh
    const plane = new THREE.PlaneGeometry(len, p.h - 0.1);
    const [mx, my, mz] = at(mid, p.h / 2);
    const m = add(S, plane, M.fence, mx, my, mz, 0, isX ? 0 : Math.PI / 2, 0, { cast: true });
    M.fence.userData.worldUV = 1.4;
    void m;
    // posts + rails
    const n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const u = p.from + (len * i) / n;
      const [px, , pz] = at(u, 0);
      add(S, cyl(0.04, 0.04, p.h + 0.5, 6), M.steelGalv, px, (p.h + 0.5) / 2, pz);
      // barbed-wire arm angled outward
      const [ax, , az] = at(u, 0, this._outSign(p) * 0.18);
      add(S, BOX(0.03, 0.45, 0.03), M.steelGalv, ax, p.h + 0.55, az, isX ? this._outSign(p) * -0.7 : 0, 0, isX ? 0 : this._outSign(p) * 0.7);
    }
    for (const [y, off] of [[p.h, 0], [0.1, 0], [p.h + 0.4, 0.12], [p.h + 0.6, 0.26]]) {
      const [rx, , rz] = at(mid, 0, this._outSign(p) * off);
      const g = cyl(off ? 0.008 : 0.025, off ? 0.008 : 0.025, len, 5);
      if (isX) g.rotateZ(Math.PI / 2); else g.rotateX(Math.PI / 2);
      add(S, g, M.steelGalv, rx, y, rz, 0, 0, 0, { cast: false });
    }
  }

  _outSign(p) { return Math.sign(p.fixed) || 1; }

  prop_boomGate(p) {
    const M = this.M;
    add(this.static, chamferBox(0.45, 1.1, 0.45, 0.05), M.steelYellow, p.x, 0.55, p.z);
    const redWhite = new THREE.MeshStandardMaterial({ map: T.hazard('#d8322a', '#f2f0ea', 3), roughness: 0.6 });
    redWhite.map.repeat.set(6, 1);
    const arm = add(this.static, BOX(p.len, 0.1, 0.08), redWhite, 0, 0, 0);
    // raised to ~80° so the gate is open
    arm.position.set(p.x + Math.cos(1.35) * p.len / 2, 1.0 + Math.sin(1.35) * p.len / 2, p.z);
    arm.rotation.z = 1.35;
  }

  prop_lamp(p) {
    const M = this.M, S = this.static;
    add(S, cyl(0.08, 0.12, 7, 8), M.steelGalv, p.x, 3.5, p.z);
    add(S, cyl(0.25, 0.3, 0.3, 8), M.concreteDark, p.x, 0.15, p.z);
    const hx = p.x + Math.sin(p.face) * 1.1, hz = p.z + Math.cos(p.face) * 1.1;
    add(S, BOX(0.08, 0.08, 1.2), M.steelGalv, (p.x + hx) / 2, 7, (p.z + hz) / 2, 0, p.face, 0);
    add(S, chamferBox(0.5, 0.16, 0.8, 0.05), M.steelDark, hx, 6.95, hz, 0, p.face, 0);
    add(S, BOX(0.36, 0.02, 0.6), M.lampOn, hx, 6.86, hz, 0, p.face, 0, { cast: false });
  }

  prop_powerLine(p) {
    const M = this.M, S = this.static;
    const wireMat = new THREE.LineBasicMaterial({ color: 0x222222 });
    const heads = [];
    const insMat = new THREE.MeshStandardMaterial({ color: 0x6b8a7a, roughness: 0.3 });
    for (const q of p.poles) {
      add(S, cyl(0.14, 0.18, 9, 7), M.timber, q.x, q.y + 4.5, q.z);
      add(S, BOX(2.2, 0.14, 0.14), M.timber, q.x, q.y + 8.4, q.z);
      const pts = [];
      for (const dx of [-0.95, 0, 0.95]) {
        add(S, cyl(0.04, 0.05, 0.22, 6), insMat, q.x + dx, q.y + 8.6, q.z);
        pts.push(new THREE.Vector3(q.x + dx, q.y + 8.7, q.z));
      }
      heads.push(pts);
    }
    for (let i = 0; i < heads.length - 1; i++) {
      for (let k = 0; k < 3; k++) {
        const a = heads[i][k], b = heads[i + 1][k];
        const pts = [];
        for (let s = 0; s <= 16; s++) {
          const u = s / 16;
          const v = new THREE.Vector3().lerpVectors(a, b, u);
          v.y -= Math.sin(u * Math.PI) * 0.9; // catenary-ish sag
          pts.push(v);
        }
        this.dynamic.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireMat));
      }
    }
  }

  // ------------------------------------------------------------------ nature
  prop_trees(p) {
    const M = this.M;
    const pine = this._pineGeometry();
    const broad = this._broadleafGeometry();
    const pines = p.items.filter((t) => t.kind === 'pine');
    const broads = p.items.filter((t) => t.kind !== 'pine');
    const make = (geo, list, tints) => {
      const im = new THREE.InstancedMesh(geo, M.pine, list.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      list.forEach((t, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
        s.set(t.s, t.s * (0.9 + t.tint * 0.3), t.s);
        mtx.compose(new THREE.Vector3(t.x, t.y - 0.1, t.z), q, s);
        im.setMatrixAt(i, mtx);
        im.setColorAt(i, C(tints[Math.floor(t.tint * tints.length) % tints.length]));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    };
    M.pine.vertexColors = true;
    make(pine, pines, [0xffffff, 0xe6f0d8, 0xd6e4c8, 0xf2f2e0]);
    make(broad, broads, [0xffffff, 0xf0e6c8, 0xe0ecd0]);
  }

  _pineGeometry() {
    const parts = [];
    const colorize = (g, hex) => {
      g = g.index ? g.toNonIndexed() : g;
      const c = C(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    parts.push(colorize(cyl(0.12, 0.2, 2.2, 6).translate(0, 1.1, 0), 0x5a4332));
    const tiers = [[2.0, 3.0, 1.4], [1.6, 2.6, 3.0], [1.15, 2.2, 4.5], [0.7, 1.7, 5.8]];
    tiers.forEach(([r, h, y], i) => parts.push(colorize(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2 - 0.4, 0).rotateY(i * 0.4), [0x2f5a32, 0x346338, 0x3b6b3c, 0x42743f][i])));
    return mergeSimple(parts);
  }

  _broadleafGeometry() {
    const parts = [];
    const colorize = (g, hex) => {
      g = g.index ? g.toNonIndexed() : g;
      const c = C(hex), n = g.attributes.position.count, arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      g.deleteAttribute('uv');
      return g;
    };
    parts.push(colorize(cyl(0.14, 0.24, 2.8, 6).translate(0, 1.4, 0), 0x5e4634));
    parts.push(colorize(new THREE.IcosahedronGeometry(1.7, 0).translate(0, 3.8, 0), 0x557a33));
    parts.push(colorize(new THREE.IcosahedronGeometry(1.25, 0).translate(0.9, 3.2, 0.4), 0x4d7030));
    parts.push(colorize(new THREE.IcosahedronGeometry(1.1, 0).translate(-0.8, 4.4, -0.3), 0x62883a));
    return mergeSimple(parts);
  }

  prop_rocks(p) {
    const M = this.M;
    const variants = [0, 1, 2, 3].map((v) => {
      const r = mulberry32(300 + v);
      const g0 = new THREE.DodecahedronGeometry(1, v % 2);
      const g = g0.index ? g0.toNonIndexed() : g0;
      const pos = g.attributes.position;
      const map = new Map();
      for (let i = 0; i < pos.count; i++) {
        const k = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        if (!map.has(k)) map.set(k, 0.75 + r() * 0.5);
        const f = map.get(k);
        pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.62, pos.getZ(i) * f);
      }
      g.computeVertexNormals();
      return g;
    });
    for (let v = 0; v < 4; v++) {
      const list = p.items.filter((it) => it.variant === v);
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(variants[v], M.rock, list.length);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((it, i) => {
        q.setFromEuler(new THREE.Euler(0, it.rot, (it.tint - 0.5) * 0.3));
        mtx.compose(new THREE.Vector3(it.x, it.y + it.s * 0.15, it.z), q, new THREE.Vector3(it.s, it.s, it.s));
        im.setMatrixAt(i, mtx);
        im.setColorAt(i, C([0x8a867e, 0x7a766e, 0x958f84, 0x6f6c66][Math.floor(it.tint * 4) % 4]));
      });
      im.castShadow = true;
      im.receiveShadow = true;
      this.root.add(im);
    }
  }

  buildGrass() {
    const w = this.world;
    // clump: 5 blades in a fan
    const pos = [], col = [];
    const base = C(0x587a30), tip = C(0xb8d26e);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI + 0.3;
      const h = 0.32 + (i % 3) * 0.1;
      const lean = 0.12;
      const cx = Math.cos(a) * 0.05, cz = Math.sin(a) * 0.05;
      const px = -Math.sin(a) * 0.035, pz = Math.cos(a) * 0.035;
      pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
      col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // normals straight up so blades shade like the ground
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = this.M.grass;
    mat.vertexColors = true;
    this.grassTime = { value: 0 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.grassTime;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 wp = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
          float sway = sin(uTime * 1.8 + wp.x * 0.35 + wp.y * 0.21) + 0.5 * sin(uTime * 3.1 + wp.x * 0.9);
          transformed.x += sway * 0.07 * position.y;
          transformed.z += sway * 0.04 * position.y;
        #endif`);
    };
    const count = 7000;
    const im = new THREE.InstancedMesh(geo, mat, count);
    const r = mulberry32(4242);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), nv = [0, 1, 0];
    let n = 0;
    for (let tries = 0; n < count && tries < count * 6; tries++) {
      // bias toward the yard edge where players look most
      const ang = r() * Math.PI * 2;
      const rad = 45 + Math.pow(r(), 1.6) * 80;
      const x = Math.cos(ang) * rad * 1.1, z = Math.sin(ang) * rad;
      if (Math.abs(x) > MAP.bound || Math.abs(z) > MAP.bound) continue;
      const d = yardDistance(x, z);
      if (d < 1.5) continue;
      if (z > MAP.yardHalfZ - 4 && Math.abs(x - roadX(z)) < 5) continue;
      w.normalAt(x, z, nv);
      if (nv[1] < 0.86) continue;
      const y = w.heightAt(x, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const sc = 0.7 + r() * 0.8;
      s.set(sc, sc * (0.8 + r() * 0.6), sc);
      mtx.compose(new THREE.Vector3(x, y - 0.02, z), q, s);
      im.setMatrixAt(n, mtx);
      im.setColorAt(n, C(d < 7 ? 0xb8b080 : [0xffffff, 0xe8f0d0, 0xf0e8c0, 0xd8e8c8][Math.floor(r() * 4)]));
      n++;
    }
    im.count = n;
    im.receiveShadow = true;
    this.root.add(im);
  }

  update(dt, t) {
    if (this.grassTime) this.grassTime.value = t;
    for (const u of this.updaters) u(dt, t);
  }
}

/** Merge non-indexed geometries sharing position/normal/color attributes. */
function mergeSimple(geos) {
  let total = 0;
  for (const g of geos) { if (!g.attributes.normal) g.computeVertexNormals(); total += g.attributes.position.count; }
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

export { polySoup };
