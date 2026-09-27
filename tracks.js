// Keyframe tracks + authored weapon animations. Times are seconds and line up with
// the reload timeline in shared/weapons.js (magOut 0.30, magIn 1.12, slideRelease 1.62),
// so the moment the mag seats on screen is the moment the server commits ammo.

export const ease = {
  linear: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - (1 - u) ** 3,
  inout: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  back: (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; },
};

/**
 * track([[t, value, easeName?], ...]) → sampler(t). The ease on a key shapes the
 * segment that ENDS at that key. Duplicate times make an instant step.
 */
export function track(keys) {
  const isArr = Array.isArray(keys[0][1]);
  const out = isArr ? new Array(keys[0][1].length).fill(0) : 0;
  return function sample(t, target = isArr ? out.slice() : 0) {
    if (t <= keys[0][0]) return copy(keys[0][1], target, isArr);
    const last = keys[keys.length - 1];
    if (t >= last[0]) return copy(last[1], target, isArr);
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
    const [t0, v0] = keys[i];
    const [t1, v1, e] = keys[i + 1];
    if (t1 <= t0) return copy(v1, target, isArr);
    const u = (ease[e] || ease.inout)((t - t0) / (t1 - t0));
    if (!isArr) return v0 + (v1 - v0) * u;
    for (let k = 0; k < v0.length; k++) target[k] = v0[k] + (v1[k] - v0[k]) * u;
    return target;
  };
}
function copy(v, target, isArr) {
  if (!isArr) return v;
  for (let k = 0; k < v.length; k++) target[k] = v[k];
  return target;
}

const Z3 = [0, 0, 0];

// ------------------------------------------------------------------ reloads
const shared = {
  magOffset: [[0, 0], [0.3, 0], [0.36, 0.02, 'in'], [0.5, 0.21, 'in'], [0.62, 0.3, 'linear'], [0.9, 0.055, 'out'], [1.03, 0.032, 'inout'], [1.12, 0, 'in']],
  magPos: [[0, Z3], [0.62, Z3], [0.62, [-0.055, -0.13, 0.05]], [0.9, Z3, 'out']],
  magRot: [[0, Z3], [0.62, Z3], [0.62, [0.55, 0.25, 0.7]], [0.88, Z3, 'out']],
  wFree: [[0, 0], [0.05, 0], [0.34, 1, 'inout'], [0.62, 1], [0.62, 0]],
  thumb: [[0, 0], [0.23, 0], [0.29, 1, 'out'], [0.42, 0, 'inout']],
};

export const RELOAD = {
  tactical: {
    duration: 1.75,
    dropAt: 0.5,
    gunRot: track([[0, Z3], [0.22, [0.22, 0.18, -0.62], 'out'], [0.3, [0.26, 0.18, -0.66]], [1.04, [0.2, 0.14, -0.56]],
      [1.12, [0.28, 0.14, -0.6], 'in'], [1.2, [0.19, 0.12, -0.5], 'out'], [1.56, Z3, 'inout']]),
    gunPos: track([[0, Z3], [0.22, [-0.035, 0.025, 0.025], 'out'], [1.1, [-0.035, 0.028, 0.025]],
      [1.13, [-0.035, 0.04, 0.025], 'out'], [1.22, [-0.035, 0.026, 0.025]], [1.56, Z3, 'inout']]),
    magOffset: track(shared.magOffset),
    magPos: track(shared.magPos),
    magRot: track(shared.magRot),
    wFree: track(shared.wFree),
    wMag: track([[0, 0], [0.62, 0], [0.62, 1], [1.14, 1], [1.44, 0, 'inout']]),
    wRack: track([[0, 0], [1, 0]]),
    rackPull: track([[0, 0], [1, 0]]),
    slide: null,
    leftCurl: track([[0, 0.78], [0.3, 0.45], [0.62, 0.86], [1.14, 0.8], [1.44, 0.78]]),
    thumb: track(shared.thumb),
  },
  empty: {
    duration: 2.2,
    dropAt: 0.5,
    gunRot: track([[0, Z3], [0.22, [0.22, 0.18, -0.62], 'out'], [0.3, [0.26, 0.18, -0.66]], [1.04, [0.2, 0.14, -0.56]],
      [1.12, [0.28, 0.14, -0.6], 'in'], [1.22, [0.16, 0.1, -0.42], 'out'], [1.4, [0.1, 0.06, -0.26]], [1.6, [0.12, 0.05, -0.22]],
      [1.67, [0.24, 0.03, -0.18], 'out'], [1.82, [0.08, 0.02, -0.1]], [2.12, Z3, 'inout']]),
    gunPos: track([[0, Z3], [0.22, [-0.035, 0.025, 0.025], 'out'], [1.1, [-0.035, 0.028, 0.025]],
      [1.13, [-0.035, 0.04, 0.025], 'out'], [1.22, [-0.035, 0.026, 0.025]], [1.4, [-0.02, 0.012, 0.018]],
      [1.62, [-0.018, 0.01, 0.02]], [1.67, [-0.018, 0.024, 0.03], 'out'], [2.12, Z3, 'inout']]),
    magOffset: track(shared.magOffset),
    magPos: track(shared.magPos),
    magRot: track(shared.magRot),
    wFree: track(shared.wFree),
    wMag: track([[0, 0], [0.62, 0], [0.62, 1], [1.14, 1], [1.34, 0, 'inout']]),
    wRack: track([[0, 0], [1.14, 0], [1.34, 1, 'inout'], [1.62, 1], [1.96, 0, 'inout']]),
    rackPull: track([[0, 0.028], [1.34, 0.028], [1.58, 0.037, 'inout'], [1.66, 0.058, 'out'], [1.96, 0.058]]),
    // slide position override (m back): locked, pulled a hair further, then slams home
    slide: track([[0, 0.028], [1.36, 0.028], [1.58, 0.037, 'inout'], [1.62, 0.037], [1.648, 0, 'in']]),
    leftCurl: track([[0, 0.78], [0.3, 0.45], [0.62, 0.86], [1.14, 0.8], [1.34, 0.92], [1.62, 0.92], [1.66, 0.25, 'out'], [1.96, 0.78]]),
    thumb: track(shared.thumb),
  },
};

export const INSPECT = {
  duration: 3.4,
  gunRot: track([[0, Z3], [0.5, [0.2, 0.95, 0.55], 'inout'], [1.5, [0.28, 1.05, 0.6]], [2.05, [-0.12, -0.85, -0.55], 'inout'],
    [2.85, [-0.08, -0.9, -0.5]], [3.4, Z3, 'inout']]),
  gunPos: track([[0, Z3], [0.5, [-0.075, 0.035, 0.035], 'inout'], [2.85, [-0.06, 0.03, 0.03]], [3.4, Z3, 'inout']]),
  wFree: track([[0, 0], [0.35, 1, 'inout'], [3.0, 1], [3.4, 0, 'inout']]),
};

export const DRAW = {
  duration: 0.5,
  gunRot: track([[0, [-0.9, 0.3, 0.4]], [0.5, Z3, 'out']]),
  gunPos: track([[0, [0.03, -0.22, 0.05]], [0.5, Z3, 'out']]),
};
