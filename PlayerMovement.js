// Deterministic player movement. stepPlayer(state, cmd, world, dt) is a pure
// function of its inputs, so the server can replay client commands exactly and
// the client can re-simulate unacknowledged commands after a correction.

import { PLAYER, MAP } from './constants.js';
import { MASK } from './mapLayout.js';
import { clamp, approach } from './math.js';

const scratch = [];
const EPS = 1e-4;

export function createPlayerState(x = 0, y = 0, z = 0, yaw = 0) {
  return {
    x, y, z, vx: 0, vy: 0, vz: 0,
    yaw, pitch: 0,
    grounded: true,
    crouch: 0, // 0 standing … 1 crouched
    sprinting: false,
    landSpeed: 0, // impact speed of the last landing (for camera/animation)
    surface: 'concrete',
    stepUp: 0, // height of the last step-up (camera smoothing)
    groundTime: 1, // seconds on the ground since the last landing (bunny-hop tax)
  };
}

/**
 * @param cmd {forward, strafe, jump, sprint, crouch, aim, yaw, pitch}
 */
export function stepPlayer(s, cmd, world, dt) {
  const P = PLAYER;
  s.yaw = cmd.yaw;
  s.pitch = cmd.pitch;
  s.landSpeed = 0;
  s.stepUp = 0;

  // --- crouch (cannot stand up under something)
  let wantCrouch = cmd.crouch ? 1 : 0;
  if (!wantCrouch && s.crouch > 0 && blockedAbove(s, world, P.height)) wantCrouch = 1;
  s.crouch = approach(s.crouch, wantCrouch, dt * 7);
  const height = P.height + (P.crouchHeight - P.height) * s.crouch;

  // --- wish direction (camera forward is -Z at yaw 0)
  let f = clamp(cmd.forward, -1, 1), r = clamp(cmd.strafe, -1, 1);
  const len = Math.hypot(f, r);
  if (len > 1) { f /= len; r /= len; }
  const sin = Math.sin(s.yaw), cos = Math.cos(s.yaw);
  const wx = -sin * f + cos * r;
  const wz = -cos * f - sin * r;
  const wishLen = Math.hypot(wx, wz);

  s.sprinting = !!cmd.sprint && f > 0.5 && s.crouch < 0.3 && !cmd.aim;
  let speed = s.sprinting ? P.sprintSpeed : P.walkSpeed;
  speed = speed + (P.crouchSpeed - speed) * s.crouch;
  if (cmd.aim) speed *= P.adsSpeedMul;

  if (s.grounded) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, 1.5) * P.friction * dt;
      const k = Math.max(sp - drop, 0) / sp;
      s.vx *= k; s.vz *= k;
    }
    accelerate(s, wx, wz, wishLen, speed, P.accelGround, dt);
    s.groundTime = (s.groundTime ?? 1) + dt;
    if (cmd.jump && s.crouch < 0.5) {
      // Take-off speed can't exceed what you could reach on foot, and chaining hops
      // straight off a landing costs speed, so bunny hopping is never faster than running.
      const cap = s.groundTime < P.hopWindow ? speed * P.hopPenalty : speed;
      clampHorizontal(s, cap);
      s.vy = P.jumpVel;
      s.grounded = false;
    }
  } else {
    // Air control can steer but never add speed: strafing sideways used to pile on
    // velocity every tick (Quake-style air accel) with no upper limit.
    const before = Math.hypot(s.vx, s.vz);
    accelerate(s, wx, wz, wishLen, speed, P.accelAir, dt);
    clampHorizontal(s, Math.max(before, Math.min(speed, P.airMaxSpeed)));
  }
  s.vy -= P.gravity * dt;

  // --- horizontal moves, one axis at a time
  const wasGrounded = s.grounded;
  moveHorizontal(s, world, s.vx * dt, 0, height, wasGrounded);
  moveHorizontal(s, world, 0, s.vz * dt, height, wasGrounded);

  // --- map bounds
  const B = MAP.bound;
  if (s.x < -B) { s.x = -B; s.vx = 0; } else if (s.x > B) { s.x = B; s.vx = 0; }
  if (s.z < -B) { s.z = -B; s.vz = 0; } else if (s.z > B) { s.z = B; s.vz = 0; }

  // --- vertical
  const R = P.radius;
  const yPrev = s.y;
  s.y += s.vy * dt;
  // ceiling
  if (s.vy > 0) {
    for (const c of world.query(s.x - R, s.z - R, s.x + R, s.z + R, MASK.PLAYER, scratch)) {
      if (c.min[1] >= yPrev + height - 0.05 && s.y + height > c.min[1] && overlapsXZ(s, c, R)) {
        s.y = c.min[1] - height;
        s.vy = 0;
      }
    }
  }
  const ground = world.groundHeight(s.x, s.z, R - 0.05, Math.max(yPrev, s.y) + 0.05, scratch);
  if (s.y <= ground) {
    if (!wasGrounded) { s.landSpeed = -s.vy; s.groundTime = 0; }
    s.y = ground;
    s.vy = 0;
    s.grounded = true;
  } else if (wasGrounded && s.vy <= 0 && s.y - ground < 0.4) {
    s.y = ground; // stick to slopes and small drops
    s.vy = 0;
    s.grounded = true;
  } else {
    s.grounded = false;
  }
  // failsafe
  const th = world.heightAt(s.x, s.z);
  if (s.y < th - 0.5) { s.y = th; s.vy = 0; }

  s.surface = world.heightAt(s.x, s.z) < s.y - 0.3 ? 'metal'
    : Math.abs(s.x) < MAP.yardHalfX - 2 && Math.abs(s.z) < MAP.yardHalfZ - 2 ? 'concrete' : 'grass';
  s.height = height;
  return s;
}

function accelerate(s, wx, wz, wishLen, speed, accel, dt) {
  if (wishLen < 1e-5) return;
  const dx = wx / wishLen, dz = wz / wishLen;
  const target = speed * Math.min(wishLen, 1);
  const cur = s.vx * dx + s.vz * dz;
  const add = target - cur;
  if (add <= 0) return;
  const a = Math.min(accel * target * dt, add);
  s.vx += dx * a;
  s.vz += dz * a;
}

function clampHorizontal(s, max) {
  const sp = Math.hypot(s.vx, s.vz);
  if (sp > max && sp > 0) { const k = max / sp; s.vx *= k; s.vz *= k; }
}

function overlapsXZ(s, c, R) {
  return s.x + R > c.min[0] && s.x - R < c.max[0] && s.z + R > c.min[2] && s.z - R < c.max[2];
}

function blockedAbove(s, world, height) {
  const R = PLAYER.radius;
  for (const c of world.query(s.x - R, s.z - R, s.x + R, s.z + R, MASK.PLAYER, scratch)) {
    if (overlapsXZ(s, c, R) && c.min[1] > s.y + 0.1 && c.min[1] < s.y + height) return true;
  }
  return false;
}

function moveHorizontal(s, world, dx, dz, height, grounded) {
  if (dx === 0 && dz === 0) return;
  const R = PLAYER.radius;
  s.x += dx;
  s.z += dz;
  const list = world.query(s.x - R, s.z - R, s.x + R, s.z + R, MASK.PLAYER, scratch);
  for (const c of list) {
    if (!overlapsXZ(s, c, R)) continue;
    if (c.max[1] <= s.y + 0.01 || c.min[1] >= s.y + height) continue; // not at our height
    // Step up onto low obstacles
    const rise = c.max[1] - s.y;
    if (grounded && rise <= PLAYER.stepHeight && !headBlocked(s, world, c.max[1], height)) {
      s.y = c.max[1];
      s.stepUp += rise;
      continue;
    }
    if (dx > 0) s.x = c.min[0] - R - EPS;
    else if (dx < 0) s.x = c.max[0] + R + EPS;
    if (dz > 0) s.z = c.min[2] - R - EPS;
    else if (dz < 0) s.z = c.max[2] + R + EPS;
    if (dx) s.vx = 0;
    if (dz) s.vz = 0;
  }
}

function headBlocked(s, world, newY, height) {
  const R = PLAYER.radius;
  for (const c of world.query(s.x - R, s.z - R, s.x + R, s.z + R, MASK.PLAYER, [])) {
    if (overlapsXZ(s, c, R) && c.min[1] >= newY - 0.01 && c.min[1] < newY + height) return true;
  }
  return false;
}
