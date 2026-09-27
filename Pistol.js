// "Foundry P9" service pistol. Real-world scale (metres), bore along -Z, up +Y.
// Built from extruded side profiles + detail parts. Moving parts: slide, hammer,
// trigger, magazine (detachable, slides out along the raked grip axis).
import * as THREE from 'three';
import { chamferBox, batchStatic } from '../gfx/geometry.js';
import * as T from '../gfx/textures.js';

const mm = (v) => v / 1000;
const DEG = Math.PI / 180;
export const GRIP_RAKE = 18 * DEG;

let M = null;
function mats() {
  if (M) return M;
  const stip = T.stipple();
  stip.repeat.set(55, 55);
  const engr = T.textPlate([{ text: 'FOUNDRY  P9', size: 40 }], { w: 512, h: 64, fg: '#b9bcbd', font: 'Barlow Condensed', weight: 600 });
  const cal = T.textPlate([{ text: '9×19', size: 44 }], { w: 128, h: 64, fg: '#b9bcbd' });
  M = {
    frame: new THREE.MeshStandardMaterial({ color: 0x2c2e30, roughness: 0.72, metalness: 0.05 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.9, metalness: 0.02, bumpMap: stip, bumpScale: 1.4 }),
    slide: new THREE.MeshStandardMaterial({ color: 0x1d1f21, roughness: 0.36, metalness: 0.65 }),
    groove: new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.6, metalness: 0.4 }),
    barrel: new THREE.MeshStandardMaterial({ color: 0x8d9092, roughness: 0.28, metalness: 0.92 }),
    bore: new THREE.MeshBasicMaterial({ color: 0x050505 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x3a3c3e, roughness: 0.4, metalness: 0.8 }),
    mag: new THREE.MeshStandardMaterial({ color: 0x34383b, roughness: 0.4, metalness: 0.6 }),
    magBase: new THREE.MeshStandardMaterial({ color: 0xd8641e, roughness: 0.6, metalness: 0.05 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xd4a94f, roughness: 0.28, metalness: 1 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xb8683a, roughness: 0.3, metalness: 1 }),
    follower: new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.6 }),
    dotGreen: new THREE.MeshStandardMaterial({ color: 0x9dff9a, emissive: 0x4dff5a, emissiveIntensity: 1.6 }),
    dotWhite: new THREE.MeshStandardMaterial({ color: 0xe8f5e0, emissive: 0x9fe8a0, emissiveIntensity: 0.9 }),
    engraving: new THREE.MeshStandardMaterial({ map: engr, transparent: true, roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
    caliber: new THREE.MeshStandardMaterial({ map: cal, transparent: true, roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
  return M;
}

/** Side profile (u = forward mm, v = up mm) → THREE.Shape in metres (x=u, y=v). */
function profile(points) {
  const s = new THREE.Shape();
  points.forEach(([u, v], i) => (i ? s.lineTo(mm(u), mm(v)) : s.moveTo(mm(u), mm(v))));
  s.closePath();
  return s;
}
function holePath(points) {
  const p = new THREE.Path();
  points.forEach(([u, v], i) => (i ? p.lineTo(mm(u), mm(v)) : p.moveTo(mm(u), mm(v))));
  p.closePath();
  return p;
}

/** Extrude a side profile across X (width, metres) centred on x=0, forward = -Z. */
function sideExtrude(shape, width, bevel = 0.0008) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 2, curveSegments: 6,
  });
  g.rotateY(Math.PI / 2); // shape x(u) -> -z, extrusion z -> +x
  g.translate(-(width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, mat, x, y, z, parent, c = 0) {
  const g = c > 0 ? chamferBox(w, h, d, c) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Wrist anchor: palm centre + hand basis (X = across knuckles, Y = back of hand, Z = toward wrist). */
export function handAnchor(parent, palm, xAxis, yAxis, name) {
  const X = new THREE.Vector3(...xAxis).normalize();
  const Y = new THREE.Vector3(...yAxis).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
  Y.crossVectors(Z, X).normalize(); // re-orthogonalise
  const o = new THREE.Object3D();
  o.name = name;
  o.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  o.position.set(...palm).addScaledVector(Z, 0.045);
  parent.add(o);
  return o;
}

export function buildCartridge(m) {
  const g = new THREE.Group();
  const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.00495, 0.00495, 0.0192, 10), m.brass);
  caseM.rotation.x = Math.PI / 2;
  caseM.position.z = 0.0053;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0049, 0.0049, 0.0012, 10), m.brass);
  rim.rotation.x = Math.PI / 2;
  rim.position.z = 0.0149;
  const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0045, 0.0092, 10), m.copper);
  bullet.rotation.x = -Math.PI / 2;
  bullet.position.z = -0.0085;
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0017, 8, 4), m.copper);
  tip.position.z = -0.0131;
  g.add(caseM, rim, bullet, tip);
  return g;
}

export class PistolModel {
  constructor() {
    const m = mats();
    this.mats = m;
    this.root = new THREE.Group();
    this.root.name = 'pistol';
    const frame = new THREE.Group();
    frame.name = 'frame';
    this.root.add(frame);

    // ------------------------------------------------------------ frame
    const receiver = profile([
      [-40, -8], [152, -8], [154.5, -12], [154, -26], [150, -28.5], [64, -29], [0, -29], [-32, -26], [-45, -18], [-48, -12],
    ]);
    frame.add(new THREE.Mesh(sideExtrude(receiver, 0.0242), m.frame));

    const guard = profile([[64, -27], [63, -48], [57, -56.5], [15, -58.5], [4, -51], [4, -27]]);
    guard.holes.push(holePath([[57.5, -30], [57.5, -47.5], [52.5, -52.5], [17, -53.5], [10.5, -48], [10.5, -30]]));
    frame.add(new THREE.Mesh(sideExtrude(guard, 0.011, 0.0006), m.frame));

    const gripShape = profile([
      [6, -27.5], [2, -47], [-4.7, -60], [-6.5, -73], [-13.2, -86], [-15, -99], [-23.6, -118], [-27, -125],
      [-72, -124.5], [-70.5, -115], [-45, -29], [-38, -25],
    ]);
    frame.add(new THREE.Mesh(sideExtrude(gripShape, 0.0296, 0.0018), m.frame));

    // Stippled grip panels on both sides
    const panelPts = [[0.5, -36], [-20.5, -111], [-64, -111], [-44.5, -34]];
    for (const side of [1, -1]) {
      const shp = new THREE.Shape();
      panelPts.forEach(([u, v], i) => {
        const uu = side > 0 ? mm(u) : -mm(u);
        i ? shp.lineTo(uu, mm(v)) : shp.moveTo(uu, mm(v));
      });
      const g = new THREE.ShapeGeometry(shp);
      g.rotateY(side * Math.PI / 2);
      g.translate(side * 0.0149, 0, 0);
      frame.add(new THREE.Mesh(g, m.grip));
    }
    // Backstrap stipple (thin panel following the back strap)
    // Accessory rail slots under the dust cover
    for (const z of [-0.084, -0.099, -0.114, -0.129]) box(0.0205, 0.0022, 0.0034, m.groove, 0, -0.0285, z, frame);
    // Controls on the left side
    box(0.0026, 0.0042, 0.019, m.steel, -0.0133, -0.0128, -0.036, frame, 0.0008); // slide stop
    box(0.0022, 0.0034, 0.009, m.steel, -0.0128, -0.021, -0.058, frame, 0.0007); // takedown
    const magRel = new THREE.Mesh(new THREE.CylinderGeometry(0.0032, 0.0032, 0.004, 10), m.frame);
    magRel.rotation.z = Math.PI / 2;
    magRel.position.set(-0.0158, -0.035, 0.0);
    frame.add(magRel);
    // Pins
    for (const [y, z] of [[-0.016, -0.02], [-0.02, 0.012]]) {
      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0014, 0.0014, 0.0248, 8), m.steel);
      pin.rotation.z = Math.PI / 2;
      pin.position.set(0, y, z);
      frame.add(pin);
    }
    // Recoil spring guide rod face at the front of the dust cover
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.004, 10), m.steel);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(0, -0.0165, -0.1545);
    frame.add(rod);
    // Mag well opening (visible only while the magazine is out)
    this.magWell = box(0.021, 0.0006, 0.03, m.bore, 0, 0, 0, this.root);
    this.magWell.rotation.x = -GRIP_RAKE;
    this.magWell.position.set(0, mm(-124.8), mm(49.5));
    this.magWell.visible = false;

    // ------------------------------------------------------------ slide
    const slide = new THREE.Group();
    slide.name = 'slide';
    this.slide = slide;
    this.root.add(slide);
    const sec = new THREE.Shape();
    [[-11.4, -11.4], [11.4, -11.4], [11.4, 10.6], [8.6, 15.4], [-8.6, 15.4], [-11.4, 10.6]].forEach(([x, y], i) =>
      i ? sec.lineTo(mm(x), mm(y)) : sec.moveTo(mm(x), mm(y)));
    sec.closePath();
    const L = 0.186;
    const sg = new THREE.ExtrudeGeometry(sec, { depth: L, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0006, bevelSegments: 2 });
    sg.translate(0, 0, -0.156);
    sg.computeVertexNormals();
    slide.add(new THREE.Mesh(sg, m.slide));
    // Nose chamfer block
    // Rear + front cocking serrations
    for (let i = 0; i < 8; i++) box(0.0252, 0.0165, 0.0011, m.groove, 0, 0.0005, 0.0035 + i * 0.003, slide);
    for (let i = 0; i < 5; i++) box(0.0252, 0.0135, 0.0011, m.groove, 0, 0.0, -0.126 - i * 0.003, slide);
    // Ejection port + barrel hood
    box(0.0022, 0.0135, 0.047, m.groove, 0.0114, 0.0085, -0.034, slide);
    box(0.0105, 0.0032, 0.045, m.barrel, 0.0034, 0.0151, -0.034, slide);
    // Extractor
    box(0.0016, 0.0035, 0.014, m.steel, 0.0118, 0.004, -0.006, slide);
    // Rear sight
    box(0.019, 0.0052, 0.0075, m.steel, 0, 0.0184, 0.021, slide, 0.001);
    for (const sx of [-1, 1]) {
      box(0.0062, 0.0042, 0.0072, m.steel, sx * 0.00615, 0.0225, 0.021, slide, 0.0006);
      box(0.0019, 0.0019, 0.0006, m.dotWhite, sx * 0.00615, 0.0225, 0.0249, slide);
    }
    // Front sight (tritium dot)
    box(0.0036, 0.0086, 0.0062, m.steel, 0, 0.0202, -0.146, slide, 0.0006);
    box(0.0021, 0.0021, 0.0006, m.dotGreen, 0, 0.0225, -0.1426, slide);
    // Engraving
    const eng = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.007), m.engraving);
    eng.rotation.y = -Math.PI / 2;
    eng.position.set(-0.01152, 0.0035, -0.078);
    slide.add(eng);
    const cal = new THREE.Mesh(new THREE.PlaneGeometry(0.014, 0.007), m.caliber);
    cal.rotation.y = Math.PI / 2;
    cal.position.set(0.01152, 0.003, -0.075);
    slide.add(cal);

    // Barrel crown (static; slide moves around it)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0068, 0.0068, 0.016, 14), m.barrel);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, -0.151);
    this.root.add(barrel);
    const bore = new THREE.Mesh(new THREE.CircleGeometry(0.0046, 12), m.bore);
    bore.position.set(0, 0, -0.1592);
    this.root.add(bore);

    // ------------------------------------------------------------ hammer
    this.hammer = new THREE.Group();
    this.hammer.position.set(0, -0.0085, 0.0335);
    this.root.add(this.hammer);
    box(0.0062, 0.017, 0.0052, m.steel, 0, 0.0082, 0, this.hammer, 0.0012);
    box(0.0068, 0.0028, 0.0062, m.steel, 0, 0.0158, 0.0012, this.hammer, 0.0008);

    // ------------------------------------------------------------ trigger
    this.trigger = new THREE.Group();
    this.trigger.position.set(0, -0.0292, -0.036);
    this.root.add(this.trigger);
    const tb = box(0.0056, 0.0135, 0.0042, m.frame, 0, -0.0066, 0, this.trigger, 0.0012);
    tb.rotation.x = 0.12;
    const tl = box(0.0058, 0.0075, 0.004, m.frame, 0, -0.0158, -0.0018, this.trigger, 0.0012);
    tl.rotation.x = 0.45;
    box(0.0016, 0.0085, 0.0022, m.steel, 0, -0.0125, -0.0022, this.trigger);

    // ------------------------------------------------------------ magazine
    // magPivot sits at the top of the magazine on the grip centre line, rotated so
    // its local -Y runs down the raked grip. Mag offset = metres pulled out.
    this.magPivot = new THREE.Group();
    this.magPivot.position.set(0, mm(-18), mm(15.1));
    this.magPivot.rotation.x = -GRIP_RAKE;
    this.root.add(this.magPivot);
    this.magazine = this.buildMagazine();
    this.magPivot.add(this.magazine.root);

    // ------------------------------------------------------------ reference points
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0, -0.162);
    this.root.add(this.muzzle);
    this.ejectPort = new THREE.Object3D();
    this.ejectPort.position.set(0.012, 0.012, -0.03);
    slide.add(this.ejectPort);
    this.sightHeight = 0.0225; // centre of front dot above bore
    this.rearSightZ = 0.025;

    // Hand anchors (wrist transforms), see handAnchor(): basis = knuckle axis X, back-of-hand Y.
    const ga = [0, -Math.cos(GRIP_RAKE), Math.sin(GRIP_RAKE)]; // down the grip
    this.anchorRight = handAnchor(this.root, [0.0215, -0.06, 0.034], ga, [1, 0, 0], 'rightGrip');
    this.anchorLeft = handAnchor(this.root, [-0.031, -0.07, 0.006], [0, 0.92, -0.4], [-1, 0, 0], 'leftSupport');
    // Overhand slide-rack grip; moved along z by the reload animation
    this.anchorRack = handAnchor(this.root, [0, 0.033, 0.012], [0, 0, 1], [0, 1, 0], 'rack');
    this.rackBaseZ = this.anchorRack.position.z;
    this.trigPoint = new THREE.Vector3(0, -0.037, -0.037);

    // Merge static parts per material to keep draw calls low.
    batchStatic(frame);
    batchStatic(slide);

    this.state = { slideBack: 0, hammer: 1, trigger: 0, magOffset: 0 };
    this.setHammer(1);
  }

  buildMagazine() {
    const m = this.mats;
    const root = new THREE.Group();
    root.name = 'magazine';
    const body = new THREE.Group();
    root.add(body);
    box(0.0218, 0.1065, 0.0305, m.mag, 0, -0.05325, 0.0005, body, 0.0015);
    // feed lips
    for (const sx of [-1, 1]) box(0.0035, 0.004, 0.022, m.mag, sx * 0.0085, 0.0005, 0.003, body, 0.0006);
    // witness holes on the back
    for (let i = 0; i < 6; i++) {
      const h = new THREE.Mesh(new THREE.CircleGeometry(0.0014, 8), m.bore);
      h.position.set(0, -0.026 - i * 0.0125, 0.0161);
      body.add(h);
    }
    // base plate (with finger lip)
    box(0.0265, 0.0092, 0.0365, m.magBase, 0, -0.1102, -0.0015, body, 0.0022);
    box(0.019, 0.004, 0.006, m.magBase, 0, -0.1072, -0.0205, body, 0.0012);
    batchStatic(body);

    // Rounds (top two visible) + follower
    const rounds = [];
    for (let i = 0; i < 2; i++) {
      const r = buildCartridge(m);
      r.rotation.x = GRIP_RAKE; // parallel to bore
      r.position.set(i ? 0.0042 : -0.0012, i ? -0.0112 : -0.0038, 0.0015);
      r.userData.dynamic = true;
      root.add(r);
      rounds.push(r);
    }
    const follower = box(0.0172, 0.006, 0.026, m.follower, 0, -0.005, 0.001, root, 0.0015);
    follower.visible = false;
    const baseAnchor = handAnchor(root, [0, -0.129, 0.004], [-1, 0, 0], [0, -1, 0], 'magBase');
    return {
      root, rounds, follower, baseAnchor,
      setRounds(n) {
        rounds[0].visible = n >= 1;
        rounds[1].visible = n >= 2;
        follower.visible = n <= 0;
      },
    };
  }

  /** Detached copy of the magazine for physics (dropped mags). */
  cloneMagazine(rounds) {
    const clone = this.magazine.root.clone(true);
    const rs = clone.children.filter((c) => c.type === 'Group' && c.children.length === 4);
    rs.forEach((r, i) => (r.visible = rounds > i));
    clone.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return clone;
  }

  setSlide(back) {
    this.state.slideBack = back;
    this.slide.position.z = back;
    // slide travel cocks the hammer
    if (back > 0.012) this.setHammer(1);
  }
  setHammer(c) {
    this.state.hammer = c;
    this.hammer.rotation.x = 0.06 + c * 0.95;
  }
  setTrigger(t) {
    this.state.trigger = t;
    this.trigger.rotation.x = -0.32 * t;
  }
  /** Metres the magazine is withdrawn along the grip axis (0 = seated). */
  setMagOffset(o) {
    this.state.magOffset = o;
    this.magazine.root.position.set(0, -o, 0);
    this.magWell.visible = o > 0.004 || !this.magazine.root.visible;
  }
  setMagVisible(v) {
    this.magazine.root.visible = v;
    this.magWell.visible = !v || this.state.magOffset > 0.004;
  }
  setShadows(cast) {
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = cast; } });
  }
}
