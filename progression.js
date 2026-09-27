// Company progression: levels (XP = money earned selling goods you made + contract bonuses) and
// goals (one-off milestones that pay a cash reward). Pure data + helpers; FactorySim
// owns the state so the server stays authoritative.

// XP needed to go from level L to L+1 (index L-1). Early levels come quickly so the
// first sales feel rewarding; later ones stretch out.
export const LEVEL_XP = [300, 600, 1000, 1600, 2500, 3800, 5500, 8000, 11500, 16000, 22000, 30000, 40000, 55000];
export const MAX_LEVEL = LEVEL_XP.length + 1;

/** Cash the company receives on reaching `level`. */
export const levelGrant = (level) => 100 + level * 75 + Math.max(0, level - 5) * 150;

/** Perks active at `level` (cumulative). */
export function perksAt(level) {
  return {
    saleBonus: Math.min(0.5, (level - 1) * 0.05), // +5 % sale price per level, capped at +50 %
    freeDelivery: level >= 3,
    scrapRate: level >= 5 ? 0.65 : 0.5,
    vanFast: level >= 4, // van loads twice as fast
    contractSlots: level >= 6 ? 3 : 2,
  };
}

/** Human-readable unlocks for the level-up banner and the Company tab. */
export const LEVEL_UNLOCKS = {
  2: ['+5% on every sale'],
  3: ['Free truck delivery'],
  4: ['Pickup van loads twice as fast'],
  5: ['Scrap buyer pays 65%'],
  6: ['Run 3 contracts at once'],
};

/** Level info for a given XP total. */
export function levelFor(xp) {
  let level = 1, rest = xp;
  while (level < MAX_LEVEL && rest >= LEVEL_XP[level - 1]) { rest -= LEVEL_XP[level - 1]; level++; }
  const need = level < MAX_LEVEL ? LEVEL_XP[level - 1] : 0;
  return { level, into: rest, need, frac: need ? rest / need : 1 };
}

// Goals are checked against FactorySim stats; each pays once. `target` + `value(sim)` give
// the progress bar. Ordered roughly by when a new player reaches them.
export const GOALS = [
  { id: 'order', name: 'Place an order', desc: 'Buy parts at the supply terminal', reward: 60, target: 1, value: (s) => s.stats.orders },
  { id: 'craft', name: 'First craft', desc: 'Craft anything at the fab bench', reward: 60, target: 1, value: (s) => s.stats.crafted },
  { id: 'place', name: 'Set up shop', desc: 'Place a machine on the floor', reward: 120, target: 1, value: (s) => s.stats.placed },
  { id: 'belts', name: 'Belt it', desc: 'Lay 6 conveyor sections', reward: 80, target: 6, value: (s) => s.stats.beltsLaid },
  { id: 'deposit', name: 'Stock the cage', desc: 'Put goods in the sell corner', reward: 80, target: 1, value: (s) => s.stats.deposited },
  { id: 'paid', name: 'Payday', desc: 'Get paid by the pickup van', reward: 150, target: 1, value: (s) => s.stats.vanTrips },
  { id: 'auto', name: 'Hands free', desc: 'Set a machine to auto-run', reward: 120, target: 1, value: (s) => s.stats.autoSet },
  { id: 'earn1k', name: 'Four figures', desc: 'Earn $1,000 selling goods you made', reward: 250, target: 1000, value: (s) => s.stats.madeValue },
  { id: 'machines3', name: 'Growing plant', desc: 'Own 3 machines', reward: 250, target: 3, value: (s) => s.machines.size },
  { id: 'contract', name: 'Under contract', desc: 'Complete a buyer contract', reward: 300, target: 1, value: (s) => s.stats.contracts },
  { id: 'advanced', name: 'High-end goods', desc: 'Build a motor or control unit', reward: 400, target: 1, value: (s) => s.stats.advanced },
  { id: 'earn5k', name: 'Real business', desc: 'Earn $5,000 selling goods you made', reward: 600, target: 5000, value: (s) => s.stats.madeValue },
  { id: 'machines6', name: 'Full floor', desc: 'Own 6 machines', reward: 600, target: 6, value: (s) => s.machines.size },
  { id: 'belts40', name: 'Belt baron', desc: 'Lay 40 conveyor sections', reward: 400, target: 40, value: (s) => s.stats.beltsLaid },
  { id: 'earn25k', name: 'Industrialist', desc: 'Earn $25,000 selling goods you made', reward: 2000, target: 25000, value: (s) => s.stats.madeValue },
];
