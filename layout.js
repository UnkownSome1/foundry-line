// Fixed pieces of the factory (everything else is placed by players).
// Read by the collision layout, the simulation and the renderer.

export const FACTORY = {
  // Buildable floor: hall interior
  floor: { x0: -19.8, x1: 19.8, z0: -27.8, z1: -4.2 },
  grid: 0.5,
  terminal: { x: -7, z: -4.75, w: 1.8, d: 0.8, panel: [-7, 1.25, -4.95] },
  // The free fab bench every new factory starts with (q = quarter turns)
  starter: [{ type: 'fabricator', x: -12.5, z: -5, q: 2 }],
  // Sell corner (south-east): anything that lands here slides into the wall chute
  sell: {
    zone: { x0: 15.5, x1: 19.8, z0: -9, z1: -4.2 },
    hopper: { x: 19.1, z: -6.3, w: 1.4, d: 1.8, h: 1.1 },
    button: [18.2, 1.35, -8.6],
    chuteY: 1.2,
  },
  // Outdoor pickup cage against the east wall
  cage: { x0: 20.4, x1: 24, z0: -8.6, z1: -4.0 },
  // Keep these clear of machines and belts
  reserved: [
    { x0: -4.5, x1: 4.5, z0: -8.5, z1: -4.2, why: 'main door' },
    { x0: 7.5, x1: 14.5, z0: -27.8, z1: -25.5, why: 'north door' },
    { x0: 17.5, x1: 19.8, z0: -13.2, z1: -9.2, why: 'east door' },
    { x0: -8.3, x1: -5.7, z0: -6.8, z1: -4.2, why: 'supply terminal' },
    { x0: 15.5, x1: 19.8, z0: -9, z1: -4.2, why: 'sell corner' },
  ],
  // Truck unload zone just outside the big south door
  bay: { x0: -4.5, x1: 4.5, z0: -3.6, z1: 3.6 },
  ammoCrates: [
    { x: 11, z: -2.7, rot: 0 },
    { x: -39, z: 16.5, rot: Math.PI / 2 },
  ],
  board: { x: -9, y: 4.6, z: -27.72 },
};
