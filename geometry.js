// Low-poly geometry builders + static batching.
import * as THREE from 'three';

const _v = new THREE.Vector3();

/**
 * Chamfered box: a box whose 12 edges are bevelled flat (26 faces). Built as a
 * polygon soup; winding is fixed per face by checking against the centroid, which
 * is valid because the shape is convex and centred on the origin.
 * Optional taper scales X/Z of the top (+Y) and bottom (-Y) rings.
 */
export function chamferBox(w, h, d, c = 0.1, { top = 1, bottom = 1, topZ = null, bottomZ = null } = {}) {
  c = Math.min(c, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const A = w / 2, B = h / 2, E = d / 2;
  const P = {};
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const k = `${sx}${sy}${sz}`;
    P[k] = {
      x: [sx * A, sy * (B - c), sz * (E - c)],
      y: [sx * (A - c), sy * B, sz * (E - c)],
      z: [sx * (A - c), sy * (B - c), sz * E],
    };
  }
  const faces = [];
  const S = [-1, 1];
  // 6 main faces
  for (const s of S) {
    faces.push([P[`${s}-1-1`].x, P[`${s}1-1`].x, P[`${s}11`].x, P[`${s}-11`].x]);
    faces.push([P[`-1${s}-1`].y, P[`1${s}-1`].y, P[`1${s}1`].y, P[`-1${s}1`].y]);
    faces.push([P[`-1-1${s}`].z, P[`1-1${s}`].z, P[`11${s}`].z, P[`-11${s}`].z]);
  }
  // 12 edge bevels
  for (const a of S) for (const b of S) {
    // edges parallel to Z (between X and Y faces)
    faces.push([P[`${a}${b}-1`].x, P[`${a}${b}1`].x, P[`${a}${b}1`].y, P[`${a}${b}-1`].y]);
    // parallel to X (between Y and Z faces)
    faces.push([P[`-1${a}${b}`].y, P[`1${a}${b}`].y, P[`1${a}${b}`].z, P[`-1${a}${b}`].z]);
    // parallel to Y (between X and Z faces)
    faces.push([P[`${a}-1${b}`].x, P[`${a}1${b}`].x, P[`${a}1${b}`].z, P[`${a}-1${b}`].z]);
  }
  // 8 corner triangles
  for (const k in P) faces.push([P[k].x, P[k].y, P[k].z]);

  const tz = topZ ?? top, bz = bottomZ ?? bottom;
  const shape = (p) => {
    const t = (p[1] + B) / (2 * B);
    const sx = bottom + (top - bottom) * t;
    const sz = bz + (tz - bz) * t;
    return [p[0] * sx, p[1], p[2] * sz];
  };
  return polySoup(faces.map((f) => f.map(shape)));
}

/** Build a flat-shaded non-indexed geometry from convex polygons (auto-oriented). */
export function polySoup(polys) {
  const pos = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), cen = new THREE.Vector3();
  for (const poly of polys) {
    cen.set(0, 0, 0);
    for (const p of poly) cen.x += p[0], cen.y += p[1], cen.z += p[2];
    cen.multiplyScalar(1 / poly.length);
    a.fromArray(poly[0]); b.fromArray(poly[1]); c.fromArray(poly[2]);
    n.subVectors(b, a).cross(_v.subVectors(c, a));
    const flip = n.dot(cen) < 0;
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = flip ? [poly[0], poly[i + 1], poly[i]] : [poly[0], poly[i], poly[i + 1]];
      for (const p of tri) pos.push(p[0], p[1], p[2]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  boxProjectUV(g, 1);
  return g;
}

/** Replace UVs with a box (tri-planar) projection in the geometry's own space. */
export function boxProjectUV(g, tile = 1) {
  const geo = g.index ? g.toNonIndexed() : g;
  const p = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const uv = new Float32Array(p.count * 2);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    va.fromBufferAttribute(p, i); vb.fromBufferAttribute(p, i + 1); vc.fromBufferAttribute(p, i + 2);
    fn.subVectors(vb, va).cross(_v.subVectors(vc, va));
    const ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? va : k === 1 ? vb : vc;
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z * Math.sign(fn.x || 1); w = v.y; }
      else if (ay >= az) { u = v.x; w = v.z * Math.sign(fn.y || 1); }
      else { u = -v.x * Math.sign(fn.z || 1); w = v.y; }
      uv[(i + k) * 2] = u / tile;
      uv[(i + k) * 2 + 1] = w / tile;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Cylinder helper with optional flat shading-friendly low segment count. */
export function cyl(rTop, rBot, h, seg = 8, open = false) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, open);
}

/** Make a mesh with shadows on. */
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent = null, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = cast;
  m.receiveShadow = receive;
  if (parent) parent.add(m);
  return m;
}

/**
 * Merge every static Mesh under `root` into one mesh per material.
 * Materials with userData.worldUV get tri-planar world-space UVs so textures
 * keep a constant texel density across walls of any size.
 */
export function batchStatic(root, { keep = () => false, shallow = false } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  const visit = (o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || keep(o) || o.userData.dynamic) return;
    if (Array.isArray(o.material)) return;
    const key = o.material.uuid + (o.castShadow ? 'c' : '') + (o.receiveShadow ? 'r' : '');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, items: [] });
    buckets.get(key).items.push(o);
    remove.push(o);
  };
  if (shallow) root.children.slice().forEach(visit);
  else root.traverse(visit);
  for (const o of remove) o.parent.remove(o);

  const out = new THREE.Group();
  out.name = 'static-batch';
  for (const { mat, cast, receive, items } of buckets.values()) {
    let total = 0;
    const geos = items.map((o) => {
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      if (mat.userData.worldUV) g = boxProjectUV(g, mat.userData.worldUV);
      total += g.attributes.position.count;
      return g;
    });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    const hasColor = geos.every((g) => g.attributes.color);
    const col = hasColor ? new Float32Array(total * 3) : null;
    let off = 0;
    for (const g of geos) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, off * 2);
      if (col) col.set(g.attributes.color.array, off * 3);
      off += n;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    out.add(m);
  }
  root.add(out);
  return out;
}
