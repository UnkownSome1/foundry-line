// Players get shoved out of the delivery truck's and pickup van's footprint (oriented
// boxes). Shared so client prediction and the server produce the same position.
import { PLAYER } from './constants.js';

function pushOBB(p, pose, bx, bz) {
  if (!pose.visible || p.y > 3.4) return;
  const R = PLAYER.radius, hx = bx + R, hz = bz + R;
  const c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
  const dx = p.x - pose.x, dz = p.z - pose.z;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (Math.abs(lx) >= hx || Math.abs(lz) >= hz) return;
  let nx = lx, nz = lz;
  if (hx - Math.abs(lx) < hz - Math.abs(lz)) nx = Math.sign(lx || 1) * hx; else nz = Math.sign(lz || 1) * hz;
  p.x = pose.x + nx * c + nz * s;
  p.z = pose.z - nx * s + nz * c;
}

/** @param sim FactorySim (or replica) — only truckPose()/vanPose() are used */
export function pushFromVehicles(p, sim) {
  pushOBB(p, sim.truckPose(), 1.3, 3.75);
  pushOBB(p, sim.vanPose(), 1.1, 2.65);
}
