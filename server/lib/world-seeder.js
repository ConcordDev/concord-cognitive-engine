// server/lib/world-seeder.js
// Procedurally seeds a world with resource nodes and a starter city.
// Called once per world on its first visit (idempotent — checks before inserting).
//
// Resource placement uses the same deterministic heightmap formula as TerrainRenderer.tsx
// and npc-simulator.js so positions are consistent across client and server.

import crypto from 'node:crypto';
import logger from '../logger.js';

const WORLD_SIZE = 2000; // metres

// ── Terrain helpers (mirrors _generateHeightmap in npc-simulator.js) ──────────

function getElevation(worldX, worldZ) {
  const nx = worldX / WORLD_SIZE;
  const nz = worldZ / WORLD_SIZE;
  let elev = 0;
  if (nx < 0.1)      elev = 2 + nx * 30;
  else if (nx < 0.2) elev = 5 + Math.pow((nx - 0.1) / 0.1, 2) * 35;
  else if (nx < 0.6) elev = 40 + Math.sin(nx * Math.PI * 3) * 5;
  else {
    elev = 45 + (nx - 0.6) * 80;
    elev += Math.sin(nx * 12 + nz * 8) * 6 + Math.sin(nx * 7 - nz * 5) * 4;
  }
  const creekCenterX = 0.35 + nz * 0.15;
  const distFromCreek = Math.abs(nx - creekCenterX);
  if (distFromCreek < 0.04) elev -= 12 * (1 - distFromCreek / 0.04);
  elev += Math.sin(nx * 47.3 + nz * 31.7) * 0.5 + Math.sin(nx * 97.1 + nz * 73.3) * 0.3;
  return Math.max(0, Math.min(80, elev));
}

function getBiome(elev) {
  if (elev < 5)  return 'water';
  if (elev < 15) return 'plains';
  if (elev < 35) return 'forest';
  if (elev < 55) return 'highland';
  return 'mountain';
}

function isWaterAt(x, z) { return getElevation(x, z) < 5; }

// ── Resource tables per universe type ─────────────────────────────────────────
// Each entry: node_type, resource_id, resource_name, biomes[], qty, diff, quality, respawn_hours, underground?, depth?

const RESOURCE_TABLES = {
  standard: [
    { t:'tree',     r:'wood',          n:'Oak Tree',          b:['forest','plains'],   qty:60, diff:1, q:'common',    rh:48 },
    { t:'tree',     r:'pine-wood',     n:'Pine Tree',         b:['highland'],          qty:50, diff:1, q:'common',    rh:48 },
    { t:'stone',    r:'stone',         n:'Stone Outcrop',     b:['plains','highland'], qty:120,diff:1, q:'common',    rh:72 },
    { t:'herb',     r:'herbs',         n:'Herb Patch',        b:['forest','plains'],   qty:30, diff:1, q:'common',    rh:24 },
    { t:'herb',     r:'rare-herb',     n:'Rare Herb',         b:['highland'],          qty:15, diff:3, q:'uncommon',  rh:48 },
    { t:'soil',     r:'clay',          n:'Clay Deposit',      b:['plains'],            qty:80, diff:1, q:'common',    rh:48 },
    { t:'ore_vein', r:'iron-ore',      n:'Iron Vein',         b:['mountain','highland'],qty:80,diff:3, q:'common',    rh:96 },
    { t:'ore_vein', r:'copper-ore',    n:'Copper Vein',       b:['highland'],          qty:70, diff:2, q:'common',    rh:96 },
    { t:'fuel',     r:'coal',          n:'Coal Seam',         b:['mountain'],          qty:100,diff:2, q:'common',    rh:72 },
    { t:'ore_vein', r:'silver-ore',    n:'Silver Vein',       b:['mountain'],          qty:40, diff:5, q:'uncommon',  rh:120, u:true, d:15 },
    { t:'ore_vein', r:'gold-ore',      n:'Gold Vein',         b:['mountain'],          qty:25, diff:7, q:'rare',      rh:168, u:true, d:35 },
    { t:'crystal',  r:'crystal',       n:'Crystal Cluster',   b:['mountain'],          qty:30, diff:6, q:'uncommon',  rh:120, u:true, d:20 },
    { t:'ore_vein', r:'mythril-ore',   n:'Mythril Deposit',   b:['mountain'],          qty:15, diff:9, q:'legendary', rh:336, u:true, d:55 },
  ],
  fantasy: [
    { t:'tree',     r:'enchanted-wood',n:'Ancient Tree',      b:['forest'],            qty:50, diff:3, q:'uncommon',  rh:72 },
    { t:'tree',     r:'wood',          n:'Oak Tree',          b:['forest','plains'],   qty:60, diff:1, q:'common',    rh:48 },
    { t:'stone',    r:'stone',         n:'Stone Outcrop',     b:['plains','highland'], qty:100,diff:1, q:'common',    rh:72 },
    { t:'herb',     r:'moonbloom',     n:'Moonbloom',         b:['forest'],            qty:20, diff:4, q:'uncommon',  rh:48 },
    { t:'herb',     r:'herbs',         n:'Herb Patch',        b:['forest','plains'],   qty:30, diff:1, q:'common',    rh:24 },
    { t:'soil',     r:'clay',          n:'Clay Deposit',      b:['plains'],            qty:80, diff:1, q:'common',    rh:48 },
    { t:'ore_vein', r:'iron-ore',      n:'Iron Vein',         b:['mountain'],          qty:70, diff:3, q:'common',    rh:96 },
    { t:'crystal',  r:'runestone',     n:'Runestone',         b:['highland','mountain'],qty:20,diff:6, q:'rare',      rh:168 },
    { t:'crystal',  r:'mana-crystal',  n:'Mana Crystal',      b:['mountain'],          qty:25, diff:7, q:'rare',      rh:168, u:true, d:20 },
    { t:'ore_vein', r:'mythril-ore',   n:'Mythril Vein',      b:['mountain'],          qty:20, diff:9, q:'legendary', rh:336, u:true, d:50 },
    { t:'fuel',     r:'ley-essence',   n:'Ley Line Spring',   b:['highland'],          qty:25, diff:5, q:'rare',      rh:96 },
  ],
  post_apocalyptic: [
    { t:'ore_vein', r:'scrap-metal',   n:'Scrap Heap',        b:['plains','highland'], qty:60, diff:1, q:'common',    rh:48 },
    { t:'fuel',     r:'fuel-canister', n:'Fuel Cache',        b:['plains'],            qty:20, diff:2, q:'uncommon',  rh:96 },
    { t:'ore_vein', r:'iron-ore',      n:'Rust Vein',         b:['mountain'],          qty:60, diff:3, q:'common',    rh:96 },
    { t:'herb',     r:'mutant-herb',   n:'Mutant Plant',      b:['plains','forest'],   qty:20, diff:2, q:'uncommon',  rh:36 },
    { t:'crystal',  r:'radioactive-core',n:'Radioactive Core',b:['mountain'],          qty:10, diff:8, q:'rare',      rh:168, u:true, d:25 },
    { t:'stone',    r:'rubble',        n:'Rubble Pile',       b:['plains'],            qty:80, diff:1, q:'common',    rh:72 },
    { t:'tree',     r:'dead-wood',     n:'Dead Tree',         b:['forest','plains'],   qty:40, diff:1, q:'common',    rh:96 },
    { t:'fuel',     r:'coal',          n:'Coal Seam',         b:['mountain'],          qty:80, diff:2, q:'common',    rh:72 },
    { t:'ore_vein', r:'titanium-scrap',n:'Titanium Wreck',    b:['highland'],          qty:25, diff:5, q:'uncommon',  rh:120 },
  ],
  superpowered: [
    { t:'crystal',  r:'quantum-crystal',n:'Quantum Crystal',  b:['mountain','highland'],qty:20,diff:8, q:'rare',      rh:168, u:true, d:30 },
    { t:'ore_vein', r:'titanium-ore',  n:'Titanium Deposit',  b:['mountain'],          qty:40, diff:6, q:'uncommon',  rh:120 },
    { t:'ore_vein', r:'iron-ore',      n:'Iron Ore',          b:['highland'],          qty:70, diff:3, q:'common',    rh:96 },
    { t:'fuel',     r:'plasma-cell',   n:'Plasma Cell',       b:['highland'],          qty:15, diff:7, q:'rare',      rh:168 },
    { t:'herb',     r:'bioenhancer',   n:'Bio-Enhancer Plant',b:['forest'],            qty:20, diff:4, q:'uncommon',  rh:48 },
    { t:'stone',    r:'vibranium-ore', n:'Vibranium Ore',     b:['mountain'],          qty:15, diff:9, q:'legendary', rh:336, u:true, d:40 },
    { t:'stone',    r:'stone',         n:'Stone',             b:['plains'],            qty:100,diff:1, q:'common',    rh:72 },
    { t:'tree',     r:'wood',          n:'Oak Tree',          b:['forest'],            qty:50, diff:1, q:'common',    rh:48 },
    { t:'fuel',     r:'coal',          n:'Coal Seam',         b:['mountain'],          qty:80, diff:2, q:'common',    rh:72 },
  ],
};
RESOURCE_TABLES.urban_crime  = RESOURCE_TABLES.post_apocalyptic;
RESOURCE_TABLES.war_zone     = RESOURCE_TABLES.post_apocalyptic;
RESOURCE_TABLES.standard_hub = RESOURCE_TABLES.standard;

// How many nodes of each entry to place per world
const NODE_COUNTS = {
  tree:     { common: 50, uncommon: 15, rare: 5,  legendary: 1 },
  stone:    { common: 30, uncommon: 8,  rare: 3,  legendary: 0 },
  herb:     { common: 35, uncommon: 12, rare: 3,  legendary: 0 },
  soil:     { common: 20, uncommon: 4,  rare: 0,  legendary: 0 },
  ore_vein: { common: 18, uncommon: 8,  rare: 4,  legendary: 2 },
  crystal:  { common: 5,  uncommon: 6,  rare: 3,  legendary: 1 },
  fuel:     { common: 15, uncommon: 6,  rare: 2,  legendary: 0 },
};

// ── Seed city blueprints per universe type ───────────────────────────────────

const SEED_CITIES = {
  standard: [
    { type:'inn',     name:"The Wanderer's Rest", w:14, d:12, h:8,  mat:'stone', floors:2, ox:0,   oz:0   },
    { type:'market',  name:'Seed Market',          w:16, d:10, h:6,  mat:'wood',  floors:1, ox:28,  oz:8   },
    { type:'forge',   name:'The First Forge',      w:12, d:10, h:7,  mat:'stone', floors:1, ox:-22, oz:14  },
    { type:'well',    name:'Town Well',             w:4,  d:4,  h:4,  mat:'stone', floors:1, ox:6,   oz:22  },
    { type:'house',   name:'Settler House',         w:10, d:8,  h:6,  mat:'wood',  floors:1, ox:32,  oz:-16 },
    { type:'house',   name:'Settler House',         w:10, d:8,  h:6,  mat:'wood',  floors:1, ox:-32, oz:-10 },
    { type:'house',   name:'Settler House',         w:10, d:8,  h:6,  mat:'wood',  floors:1, ox:-14, oz:-32 },
    { type:'warehouse',name:'Community Storehouse', w:18, d:12, h:7,  mat:'wood',  floors:1, ox:18,  oz:-28 },
  ],
  fantasy: [
    { type:'inn',     name:"Dragon's Respite",      w:14, d:12, h:10, mat:'stone', floors:2, ox:0,   oz:0   },
    { type:'market',  name:'Arcane Bazaar',          w:16, d:10, h:7,  mat:'stone', floors:1, ox:28,  oz:8   },
    { type:'forge',   name:"Runesmith's Hall",       w:12, d:10, h:8,  mat:'brick', floors:1, ox:-22, oz:14  },
    { type:'well',    name:'Enchanted Well',          w:4,  d:4,  h:5,  mat:'stone', floors:1, ox:6,   oz:22  },
    { type:'tower',   name:'Mage Tower',              w:8,  d:8,  h:22, mat:'stone', floors:5, ox:-38, oz:4   },
    { type:'house',   name:'Timber Home',             w:10, d:8,  h:7,  mat:'wood',  floors:1, ox:32,  oz:-16 },
    { type:'house',   name:'Timber Home',             w:10, d:8,  h:7,  mat:'wood',  floors:1, ox:-14, oz:-32 },
    { type:'warehouse',name:'Adventurers Vault',      w:16, d:12, h:8,  mat:'stone', floors:1, ox:18,  oz:-28 },
  ],
  post_apocalyptic: [
    { type:'inn',     name:'The Bunker',              w:16, d:14, h:6,  mat:'steel', floors:1, ox:0,   oz:0   },
    { type:'market',  name:'Scrap Market',            w:14, d:10, h:5,  mat:'steel', floors:1, ox:26,  oz:8   },
    { type:'forge',   name:'Repair Bay',              w:12, d:10, h:6,  mat:'steel', floors:1, ox:-20, oz:14  },
    { type:'well',    name:'Water Purifier',           w:5,  d:5,  h:5,  mat:'steel', floors:1, ox:6,   oz:22  },
    { type:'house',   name:'Salvaged Dwelling',        w:10, d:8,  h:5,  mat:'steel', floors:1, ox:30,  oz:-16 },
    { type:'house',   name:'Salvaged Dwelling',        w:10, d:8,  h:5,  mat:'steel', floors:1, ox:-14, oz:-30 },
    { type:'warehouse',name:'Supply Cache',            w:18, d:12, h:6,  mat:'steel', floors:1, ox:16,  oz:-26 },
  ],
  superpowered: [
    { type:'inn',     name:'The Stronghold',          w:16, d:14, h:10, mat:'steel', floors:2, ox:0,   oz:0   },
    { type:'market',  name:'Tech Exchange',           w:16, d:10, h:7,  mat:'steel', floors:1, ox:28,  oz:8   },
    { type:'forge',   name:'Engineering Lab',         w:14, d:12, h:8,  mat:'steel', floors:1, ox:-22, oz:14  },
    { type:'well',    name:'Power Generator',         w:6,  d:6,  h:6,  mat:'steel', floors:1, ox:6,   oz:24  },
    { type:'tower',   name:'Observation Tower',       w:8,  d:8,  h:24, mat:'steel', floors:5, ox:-38, oz:4   },
    { type:'house',   name:'Living Quarter',          w:10, d:8,  h:7,  mat:'steel', floors:1, ox:32,  oz:-16 },
    { type:'house',   name:'Living Quarter',          w:10, d:8,  h:7,  mat:'steel', floors:1, ox:-14, oz:-32 },
    { type:'warehouse',name:'Supply Depot',           w:18, d:12, h:7,  mat:'steel', floors:1, ox:18,  oz:-28 },
  ],
};
SEED_CITIES.urban_crime  = SEED_CITIES.post_apocalyptic;
SEED_CITIES.war_zone     = SEED_CITIES.post_apocalyptic;

// ── Lens-as-Station district ring ───────────────────────────────────────────────
//
// Each of these is a real LENS you walk into: the frontend station-lens registry
// (concord-frontend/lib/station-lens-registry.ts) maps building_type → lens, and
// interacting opens the lens as a persistent overlay over the 3D world. They are
// grouped into purpose DISTRICTS and auto-placed on a two-radius ring around the
// seed city (see _stationOffset) — so adding a station is just one more row, no
// hand-tuned coordinates, and it stays non-overlapping as the set grows.
//
// Names + designs are grounded in Concord's own mythos (the lattice, Concordant
// Law, the royalty cascade, the Concord Link, music→soundscape). Every
// building_type also has a matching interior in lib/building-interiors.js
// ROOM_TEMPLATES, and a row in the frontend station-lens registry.
const STATIONS = [
  // ── Civic & governance ──
  { type: 'courthouse',         district: 'civic',     name: 'The Concordant Court', w: 14, d: 12, h: 11, mat: 'stone', floors: 2, lore: 'Seat of Concordant Law — citation, refusal, and royalty disputes are argued here.' },
  { type: 'assembly_hall',      district: 'civic',     name: 'The Assembly Hall',    w: 16, d: 12, h: 9,  mat: 'stone', floors: 2, lore: 'Where proposals are convened and the governed constants amended.' },
  { type: 'watch_house',        district: 'civic',     name: 'The Watch House',      w: 10, d: 9,  h: 6,  mat: 'stone', floors: 1, lore: 'Keepers of the peace — crimes logged, bounties posted.' },
  // ── Knowledge & science ──
  { type: 'cartographer_table', district: 'knowledge', name: "The Cartographer's Spire", w: 9, d: 9, h: 14, mat: 'stone', floors: 3, lore: 'Charts the lattice from a deck that clears the rooftops.' },
  { type: 'code_terminal',      district: 'knowledge', name: 'The Lattice Terminal', w: 6,  d: 6,  h: 7,  mat: 'steel', floors: 2, lore: 'Jack into the Concord lattice and shape the substrate directly.' },
  { type: 'observatory',        district: 'knowledge', name: 'The Observatory',      w: 10, d: 10, h: 13, mat: 'stone', floors: 3, lore: 'A domed eye on the heavens — ephemerides and apparitions.' },
  { type: 'laboratory',         district: 'knowledge', name: 'The Laboratory',       w: 11, d: 9,  h: 6,  mat: 'brick', floors: 1, lore: 'Run the experiment; let the residuals tell the truth.' },
  { type: 'archive_hall',       district: 'knowledge', name: 'The Archive',          w: 12, d: 10, h: 8,  mat: 'stone', floors: 2, lore: 'The record of what was — read the long memory of the world.' },
  // ── Commerce & economy ──
  { type: 'trading_floor',      district: 'commerce',  name: 'The Concord Exchange', w: 16, d: 12, h: 9,  mat: 'stone', floors: 2, lore: 'The open floor where creations are listed, bid, and sold.' },
  { type: 'ledger_desk',        district: 'commerce',  name: 'The Royalty Ledger',   w: 8,  d: 7,  h: 7,  mat: 'brick', floors: 2, lore: 'The counting house — the royalty cascade reconciled to the coin.' },
  { type: 'bank_house',         district: 'commerce',  name: 'The Concord Bank',     w: 12, d: 10, h: 8,  mat: 'stone', floors: 2, lore: 'Vaulted and deliberate — mind the money, earn the withdrawal.' },
  { type: 'auction_house',      district: 'commerce',  name: 'The Auction House',    w: 12, d: 10, h: 8,  mat: 'wood',  floors: 2, lore: 'Going once — the snipe window and the gavel.' },
  // ── Arts & creative ──
  { type: 'music_booth',        district: 'arts',      name: 'The Resonance Booth',  w: 7,  d: 6,  h: 6,  mat: 'wood',  floors: 1, lore: 'Where a track becomes a district soundscape.' },
  { type: 'atelier',            district: 'arts',      name: 'The Atelier',          w: 10, d: 8,  h: 6,  mat: 'wood',  floors: 1, lore: 'Make something — the open studio floor.' },
  { type: 'writers_room',       district: 'arts',      name: "The Writers' Room",    w: 8,  d: 7,  h: 5,  mat: 'wood',  floors: 1, lore: 'Draft, revise, and mint the page.' },
  { type: 'gallery_hall',       district: 'arts',      name: 'The Gallery',          w: 14, d: 10, h: 7,  mat: 'stone', floors: 1, lore: 'Show the work; let the citations gather.' },
  // ── Craft & industry ──
  { type: 'workshop',           district: 'craft',     name: 'The Workshop',         w: 10, d: 8,  h: 6,  mat: 'wood',  floors: 1, lore: 'Resolve the recipe; the resources decide the potency.' },
  { type: 'engineers_hall',     district: 'craft',     name: "The Engineers' Hall",  w: 12, d: 10, h: 7,  mat: 'steel', floors: 1, lore: 'CAS and the beam-frame solver — engineer it for real.' },
  // ── Care & wellbeing ──
  { type: 'clinic',             district: 'care',      name: 'The Mendery',          w: 10, d: 8,  h: 5,  mat: 'stone', floors: 1, lore: "House of mending — the body's pain-ledger tended." },
  { type: 'sanctuary',          district: 'care',      name: 'The Sanctuary',        w: 10, d: 10, h: 6,  mat: 'stone', floors: 1, lore: 'A quiet place to breathe and find calm.' },
  { type: 'counsel_room',       district: 'care',      name: 'The Counsel Room',     w: 8,  d: 7,  h: 5,  mat: 'wood',  floors: 1, lore: 'Talk it through; the mind has a ledger too.' },
  // ── Communication & social ──
  { type: 'post_office',        district: 'comms',     name: 'The Link Post',        w: 9,  d: 7,  h: 7,  mat: 'stone', floors: 1, lore: 'Relays word across the Concord Link between worlds.' },
  { type: 'forum_hall',         district: 'comms',     name: 'The Forum',            w: 14, d: 12, h: 6,  mat: 'stone', floors: 1, lore: 'The open square — threads, debate, the common voice.' },
  { type: 'newsroom',           district: 'comms',     name: 'The Newsroom',         w: 10, d: 8,  h: 6,  mat: 'brick', floors: 2, lore: 'File the story; the world reads it next.' },
  // ── Learning ──
  { type: 'schoolhouse',        district: 'learning',  name: 'The Schoolhouse',      w: 10, d: 9,  h: 6,  mat: 'wood',  floors: 1, lore: 'Teach and learn — the first cycle and the long curriculum.' },
  { type: 'academy',            district: 'learning',  name: 'The Academy',          w: 12, d: 10, h: 8,  mat: 'stone', floors: 2, lore: 'Study deeply; mastery is tracked and earned.' },
];

// Two-radius ring auto-placement: station i is dropped on a circle around the
// city centre at angle i·(2π/N) starting due north, alternating inner/outer
// radius so even angularly-close neighbours never overlap. Ordered by district,
// so each district occupies a contiguous arc ("quarter"). Adding a station just
// shifts the angles — it stays clear of the core seed-city cluster (±~41).
const STATION_RING_RADII = [58, 78];
function _stationOffset(index, total) {
  const angle = -Math.PI / 2 + index * ((2 * Math.PI) / total);
  const R = STATION_RING_RADII[index % 2];
  return { ox: Math.round(R * Math.cos(angle)), oz: Math.round(R * Math.sin(angle)) };
}

/** The lens-station building types this seeder places (kept in sync with the
 *  frontend station-lens registry + building-interiors ROOM_TEMPLATES). */
export function stationTypes() {
  return STATIONS.map((s) => s.type);
}

// ── Seeder ─────────────────────────────────────────────────────────────────────

function _rk(universeType) {
  if (RESOURCE_TABLES[universeType]) return universeType;
  return 'standard';
}

function _ck(universeType) {
  if (SEED_CITIES[universeType]) return universeType;
  return 'standard';
}

/**
 * Seed city buildings near the world centre.
 * Skipped if any seed buildings already exist for this world.
 */
function _seedCity(db, worldId, universeType) {
  const existing = db.prepare(
    'SELECT COUNT(*) as n FROM world_buildings WHERE world_id = ? AND is_seed = 1'
  ).get(worldId);
  if (existing.n > 0) return 0;

  // City centre: flat plateau at nx=0.4, nz=0.5 → x=800, z=1000
  const cx = 800, cz = 1000;
  const blueprint = SEED_CITIES[_ck(universeType)] || SEED_CITIES.standard;

  const insert = db.prepare(`
    INSERT INTO world_buildings
      (id, world_id, building_type, name, x, y, z, width, depth, height, material, floors, owner_type, is_seed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'world',1)
  `);

  let count = 0;
  for (const b of blueprint) {
    const bx = cx + b.ox;
    const bz = cz + b.oz;
    const by = getElevation(bx, bz);
    insert.run(crypto.randomUUID(), worldId, b.type, b.name, bx, by, bz, b.w, b.d, b.h, b.mat, b.floors);
    count++;
  }
  logger.info('world-seeder', 'seed_city_placed', { worldId, buildingCount: count, cx, cz });
  return count;
}

/**
 * Seed the lens-as-station civic ring around the world centre.
 *
 * Idempotent PER building_type (not gated on the is_seed flag like _seedCity),
 * so this also back-fills existing worlds that already have a seed city — each
 * station is inserted only if a building of that type doesn't already exist for
 * the world. Same centre as _seedCity (x=800, z=1000).
 */
function _seedStations(db, worldId) {
  const cx = 800, cz = 1000; // mirrors _seedCity's centre
  const has = db.prepare(
    'SELECT COUNT(*) AS n FROM world_buildings WHERE world_id = ? AND building_type = ?'
  );
  const insert = db.prepare(`
    INSERT INTO world_buildings
      (id, world_id, building_type, name, x, y, z, width, depth, height, material, floors, owner_type, is_seed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'world',1)
  `);

  let count = 0;
  const total = STATIONS.length;
  const place = db.transaction(() => {
    STATIONS.forEach((b, i) => {
      if (has.get(worldId, b.type).n > 0) return; // already placed — idempotent
      const { ox, oz } = _stationOffset(i, total);
      const bx = cx + ox;
      const bz = cz + oz;
      const by = getElevation(bx, bz);
      insert.run(crypto.randomUUID(), worldId, b.type, b.name, bx, by, bz, b.w, b.d, b.h, b.mat, b.floors);
      count++;
    });
  });
  place();
  if (count > 0) logger.info('world-seeder', 'seed_stations_placed', { worldId, stationCount: count });
  return count;
}

/**
 * Scatter resource nodes across the terrain.
 * Uses a deterministic-ish pattern seeded from the worldId hash so
 * the same world always gets the same nodes.
 * Skipped if nodes already exist.
 */
function _seedNodes(db, worldId, universeType) {
  const existing = db.prepare(
    'SELECT COUNT(*) as n FROM world_resource_nodes WHERE world_id = ? AND seeded = 1'
  ).get(worldId);
  if (existing.n > 0) return 0;

  const table = RESOURCE_TABLES[_rk(universeType)] || RESOURCE_TABLES.standard;
  const insert = db.prepare(`
    INSERT INTO world_resource_nodes
      (id, world_id, node_type, resource_id, resource_name, biome,
       x, y, z, depth, quantity_remaining, max_quantity, quality, difficulty, respawn_hours, seeded)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
  `);

  // Simple seeded PRNG from worldId so placement is reproducible per world
  let seed = worldId.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7);
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0x100000000;
  }

  let placed = 0;
  const stmt = db.transaction(() => {
    for (const def of table) {
      const counts = NODE_COUNTS[def.t] || { common: 10, uncommon: 3, rare: 1, legendary: 0 };
      const count = counts[def.q] ?? 5;

      for (let i = 0; i < count; i++) {
        let attempts = 0, x, z, elev, biome;

        // Find a position in the right biome (max 20 attempts)
        do {
          x    = 50 + rand() * 1900;
          z    = 50 + rand() * 1900;
          elev = getElevation(x, z);
          biome = getBiome(elev);
          attempts++;
        } while (!def.b.includes(biome) && attempts < 20);

        if (!def.b.includes(biome)) continue; // couldn't place — skip
        if (isWaterAt(x, z)) continue;        // never place in river

        const depth = def.u ? (def.d + rand() * 10) : 0;
        const qty   = Math.round(def.qty * (0.7 + rand() * 0.6)); // ±30% variance

        insert.run(
          crypto.randomUUID(), worldId, def.t, def.r, def.n, biome,
          Math.round(x), Math.round(elev), Math.round(z),
          depth, qty, qty, def.q, def.diff, def.rh
        );
        placed++;
      }
    }
  });
  stmt();

  logger.info('world-seeder', 'nodes_seeded', { worldId, nodeCount: placed });
  return placed;
}

/**
 * Seed a world with content if it hasn't been seeded yet.
 * Call on first player visit or at server startup for canonical worlds.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {string} [universeType]  e.g. 'standard', 'fantasy', 'post_apocalyptic'
 * @returns {{ buildings: number, nodes: number }}
 */
export function seedWorldContent(db, worldId, universeType = 'standard') {
  try {
    const buildings = _seedCity(db, worldId, universeType);
    const stations  = _seedStations(db, worldId);
    const nodes     = _seedNodes(db, worldId, universeType);
    return { buildings, stations, nodes };
  } catch (err) {
    logger.warn('world-seeder', 'seed_failed', { worldId, error: err?.message });
    return { buildings: 0, nodes: 0 };
  }
}
