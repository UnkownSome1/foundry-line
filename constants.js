// Tunables shared by client prediction and the authoritative server.
// Units: metres, seconds, radians unless the name says otherwise.

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const PLAYER = {
  radius: 0.32,
  height: 1.8,
  crouchHeight: 1.22,
  eye: 1.62,
  crouchEye: 1.06,
  walkSpeed: 4.6,
  sprintSpeed: 7.1,
  crouchSpeed: 2.3,
  adsSpeedMul: 0.62,
  accelGround: 55,
  accelAir: 9,
  friction: 9,
  gravity: 21,
  jumpVel: 7.0,
  airMaxSpeed: 7.1, // air control can never push horizontal speed past this (or your take-off speed)
  hopWindow: 0.2, // jumping within this long after landing counts as a chained hop …
  hopPenalty: 0.8, // … and caps take-off speed to 80 % of your run speed
  stepHeight: 0.52,
  maxHealth: 100,
};

// Hitboxes are relative to the player's feet position.
export const HITBOX = {
  headY: 1.6,
  headR: 0.15,
  bodyHalf: 0.3,
  bodyTop: 1.46,
};

export const MAP = {
  seed: 20260927,
  size: 256, // terrain edge length
  segments: 128, // grid cells per side (2 m cells)
  yardHalfX: 52,
  yardHalfZ: 42,
  bound: 118, // playable half-extent
};
