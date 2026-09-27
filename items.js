// Item + machine data. Everything the economy does is driven from these tables,
// so balancing (or adding new items and machines) never touches game code.

export const ITEMS = {
  // ---- raw materials (ordered from the supply terminal)
  steel_plate: { name: 'Steel Plate', cat: 'raw', stack: 20, buy: 20, value: 14, r: 0.3, desc: 'Cold-rolled 3 mm sheet. Feeds the stamping press and the fab bench.' },
  copper_wire: { name: 'Copper Wire Spool', cat: 'raw', stack: 10, buy: 30, value: 21, r: 0.22, desc: 'Enamelled magnet wire for harnesses and machine wiring.' },
  pellets: { name: 'Polymer Pellets', cat: 'raw', stack: 10, buy: 16, value: 11, r: 0.28, desc: '25 kg sack of PP pellets for the moulder.' },
  brass: { name: 'Brass Stock', cat: 'raw', stack: 20, buy: 24, value: 17, r: 0.22, desc: 'Cartridge brass rod, drawn into casings.' },
  powder: { name: 'Propellant Tin', cat: 'raw', stack: 10, buy: 32, value: 22, r: 0.16, desc: 'Smokeless pistol powder. Keep away from sparks.' },
  lead: { name: 'Lead Ingot', cat: 'raw', stack: 20, buy: 14, value: 10, r: 0.18, desc: 'Cast for 9 mm projectile cores.' },
  circuit: { name: 'Circuit Board', cat: 'raw', stack: 10, buy: 45, value: 32, r: 0.2, desc: 'Pre-populated controller PCB.' },
  fasteners: { name: 'Fastener Box', cat: 'raw', stack: 20, buy: 10, value: 7, r: 0.16, desc: 'M6 bolts, nuts and washers.' },
  // ---- parts (made in the factory)
  bracket: { name: 'Steel Bracket', cat: 'part', stack: 30, value: 16, r: 0.18, desc: 'Stamped mounting bracket.' },
  housing: { name: 'Polymer Housing', cat: 'part', stack: 20, value: 26, r: 0.2, desc: 'Injection-moulded enclosure.' },
  harness: { name: 'Wiring Harness', cat: 'part', stack: 20, value: 90, r: 0.2, desc: 'Loomed, crimped and tested.' },
  // ---- products
  motor: { name: 'Electric Motor', cat: 'product', stack: 10, value: 260, r: 0.24, desc: '1.5 kW induction motor. Sells well.' },
  control_unit: { name: 'Control Unit', cat: 'product', stack: 10, value: 340, r: 0.22, desc: 'Line controller with display. Top seller.' },
  ammo_box: { name: '9×19mm Ammo Box', cat: 'product', stack: 20, value: 115, r: 0.18, use: { ammo: 30 }, desc: '30 rounds. Use it to refill your P9 reserve, or sell it.' },
  // ---- equipment (kits are filled in below from MACHINES)
  conveyor: { name: 'Conveyor Section', cat: 'kit', stack: 50, buy: 12, value: 8, r: 0.3, place: 'conveyor', desc: '1 m belt section. Place several to carry items between machines and to the sell corner.' },
};

// Machine footprints are whole metres so edges and ports land on the 0.5 m build grid.
// Local frame: operator side (panel) faces +Z. Colliders: [cx, cz, w, d, h].
// Ports: `in` = the cell a feeding belt points into; `out` = the cell where an output belt sits.
export const MACHINES = {
  fabricator: {
    name: 'Fab Bench', size: [3, 1], buy: 350, desc: 'Crafts machine kits and conveyor sections from raw parts. Cheap but slow.',
    kit: { inputs: { steel_plate: 5, fasteners: 3 }, time: 36 },
    colliders: [[0, 0, 2.8, 0.95, 0.95]], panel: [0, 1.2, 0.85], tray: [1.0, 0, 1.05],
    ports: { in: { cell: [-1, 0], dir: [1, 0] }, out: { cell: [2, 0], dir: [1, 0] } },
    recipes: [], // filled below with every kit + conveyors
  },
  press: {
    name: 'Stamping Press', size: [4, 3], buy: 600, desc: 'Stamps steel plate into brackets or fastener boxes.',
    kit: { inputs: { steel_plate: 8, fasteners: 4 }, time: 40 },
    colliders: [[-0.4, -0.2, 3.2, 2.6, 4.4], [1.55, 0.5, 0.72, 0.62, 0.86]], panel: [1.55, 1.3, 1.9], tray: [1.55, 0.5, 0.9],
    ports: { in: { cell: [-1.5, 0], dir: [1, 0] }, out: { cell: [2.5, 0.5], dir: [1, 0] } },
    recipes: [
      { id: 'brackets', name: 'Stamp brackets', inputs: { steel_plate: 1 }, outputs: { bracket: 3 }, time: 4 },
      { id: 'fasteners', name: 'Punch fasteners', inputs: { steel_plate: 1 }, outputs: { fasteners: 2 }, time: 5 },
    ],
  },
  moulder: {
    name: 'Injection Moulder', size: [5, 2], buy: 700, desc: 'Moulds polymer pellets into housings.',
    kit: { inputs: { steel_plate: 6, copper_wire: 2, circuit: 1 }, time: 50 },
    colliders: [[-0.4, -0.2, 4.2, 1.4, 2.3], [2.1, 0.5, 0.72, 0.62, 0.86]], panel: [0.8, 1.3, 1.35], tray: [2.1, 0.5, 0.9],
    ports: { in: { cell: [-2, -0.5], dir: [1, 0] }, out: { cell: [3, 0.5], dir: [1, 0] } },
    recipes: [{ id: 'housing', name: 'Mould housings', inputs: { pellets: 1 }, outputs: { housing: 2 }, time: 5 }],
  },
  electronics: {
    name: 'Electronics Bench', size: [4, 1], buy: 750, desc: 'Builds wiring harnesses.',
    kit: { inputs: { steel_plate: 3, copper_wire: 2, circuit: 2, fasteners: 2 }, time: 50 },
    colliders: [[-0.6, 0, 2.6, 0.9, 0.95], [1.3, 0, 0.72, 0.62, 0.86]], panel: [-0.6, 1.2, 0.85], tray: [1.3, 0, 0.9],
    ports: { in: { cell: [-1.5, 0], dir: [1, 0] }, out: { cell: [2.5, 0], dir: [1, 0] } },
    recipes: [{ id: 'harness', name: 'Build wiring harness', inputs: { copper_wire: 1, pellets: 1 }, outputs: { harness: 1 }, time: 6 }],
  },
  assembler: {
    name: 'Assembly Cell', size: [6, 5], buy: 1500, desc: 'Robot cell that assembles motors and control units.',
    kit: { inputs: { steel_plate: 10, copper_wire: 3, circuit: 3, fasteners: 4 }, time: 80 },
    colliders: [[-0.6, -0.4, 4.4, 4.0, 2.6], [2.4, 1.0, 0.72, 0.62, 0.86]], panel: [-0.6, 1.3, 2.95], tray: [2.4, 1.0, 0.9],
    ports: { in: { cell: [-2.5, 0], dir: [1, 0] }, out: { cell: [3.5, 1.0], dir: [1, 0] } },
    recipes: [
      { id: 'motor', name: 'Assemble electric motor', inputs: { bracket: 2, harness: 1, fasteners: 1 }, outputs: { motor: 1 }, time: 8 },
      { id: 'control_unit', name: 'Assemble control unit', inputs: { circuit: 1, harness: 1, housing: 1, fasteners: 1 }, outputs: { control_unit: 1 }, time: 9 },
    ],
  },
  ammo: {
    name: 'Ammo Press', size: [3, 1], buy: 450, desc: 'Loads 9×19mm ammunition for the P9.',
    kit: { inputs: { steel_plate: 4, fasteners: 2 }, time: 30 },
    colliders: [[0, 0, 2.2, 0.8, 0.95]], panel: [-0.35, 1.25, 0.75], tray: [0.8, 0, 1.05],
    ports: { in: { cell: [-1, 0], dir: [1, 0] }, out: { cell: [2, 0], dir: [1, 0] } },
    recipes: [{ id: 'ammo', name: 'Load 9×19mm (30)', inputs: { brass: 1, powder: 1, lead: 1 }, outputs: { ammo_box: 1 }, time: 5 }],
  },
};

export const CONVEYOR = { size: [1, 1], top: 0.42, speed: 1.25 };

// Kit items + fab-bench recipes are generated from the machine table.
const partsCost = (inputs) => Object.entries(inputs).reduce((a, [t, n]) => a + ITEMS[t].buy * n, 0);
for (const [id, m] of Object.entries(MACHINES)) {
  ITEMS[`kit_${id}`] = {
    name: `${m.name} Kit`, cat: 'kit', stack: 1, buy: m.buy, value: partsCost(m.kit.inputs), r: 0.5, place: id,
    desc: `Flat-packed ${m.name.toLowerCase()}. Place it anywhere on the factory floor. ${m.desc}`,
  };
  MACHINES.fabricator.recipes.push({ id: `kit_${id}`, name: `Craft ${m.name} kit`, inputs: m.kit.inputs, outputs: { [`kit_${id}`]: 1 }, time: m.kit.time });
}
MACHINES.fabricator.recipes.push({ id: 'conveyor', name: 'Craft conveyor sections ×6', inputs: { steel_plate: 1, fasteners: 1 }, outputs: { conveyor: 6 }, time: 6 });

export const ITEM_IDS = Object.keys(ITEMS);
export const CATALOG = ITEM_IDS.filter((id) => ITEMS[id].buy != null && ITEMS[id].cat === 'raw');
export const EQUIPMENT = ITEM_IDS.filter((id) => ITEMS[id].buy != null && ITEMS[id].cat === 'kit');

export const ECON = {
  startFunds: 900, // enough to craft a couple of machines and lay a first belt line
  deliveryFee: 15, // waived from company level 3
  scrapRate: 0.5, // the terminal's instant scrap buyer pays half (65 % from level 5)
  companyShare: 0.8, // sales: 80 % company funds, 20 % to whoever deposited the goods
  maxQueue: 10,
  bufferCap: 40, // per input type held by a machine fed from a belt
  vanFee: 0,
};

export const BUYERS = {
  government: ['Ministry of Works', 'Defence Logistics Agency', 'National Rail Authority', 'Civil Defence Depot'],
  private: ['Hallett Motors', 'Brightline Robotics', 'Kestrel Security', 'Northgate Appliances', 'Orbis Automation'],
};
