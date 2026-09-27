// Data-driven weapon definitions. The client animates against the same reload
// timeline the server uses to commit ammo, so visuals and state never disagree.

export const WEAPONS = {
  p9: {
    id: 'p9',
    name: 'Foundry P9',
    caliber: '9×19mm',
    slot: 'secondary',
    price: 0,
    fireMode: 'semi',
    rpm: 420, // cap for how fast the trigger can be worked
    magSize: 15,
    reserveStart: 60,
    reserveMax: 150,
    damage: { head: 92, body: 34, falloffStart: 20, falloffEnd: 50, falloffMin: 0.65 },
    range: 160,
    // Spread in degrees
    spread: { hip: 1.1, ads: 0.12, move: 1.6, air: 3.5, perShot: 0.7, max: 4.5, recover: 7 },
    // Camera kick. pitch/yaw/roll are the peak kick in degrees; `climb` is the share of
    // the muzzle rise that stays (you pull it back down), the rest springs back.
    // `bias` pushes the sideways kick right (+) for a right-handed grip.
    // `spring` is the return stiffness (rad/s natural frequency), `damping` its ratio.
    recoil: { pitch: 3.4, yaw: 0.9, roll: 1.4, climb: 0.38, bias: 0.3, spring: 15, damping: 0.72, recover: 10 },
    // First-person gun kick: rearward shove (m/s impulse) and muzzle flip around the
    // wrist (rad/s impulse), scaled down while aiming down sights.
    kick: { back: 2.4, flip: 5.4, adsScale: 0.55 },
    // All event times are seconds from reload start.
    reload: {
      tactical: { duration: 1.75, magOut: 0.3, magIn: 1.12 },
      empty: { duration: 2.2, magOut: 0.3, magIn: 1.12, slideRelease: 1.62 },
    },
    drawTime: 0.45,
    adsTime: 0.16,
  },
};
