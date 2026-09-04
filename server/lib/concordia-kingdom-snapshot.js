// server/lib/concordia-kingdom-snapshot.js
//
// Authoritative Concordia graph for Unity /unity-ws `kingdom:request`.
// Derived from content/world authored JSON + the same Canon identity the
// Unity client already uses. Never invents a settlement, faction, or staple.
//
// Stock / need / caravan floats live on the Unity WorldMemory slice until a
// persist-sync exists — those arrays stay honestly empty here, not fabricated.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const WORLD_ROOT = join(ROOT, "content", "world");

export const KINGDOM_FORMAT = "concord-kingdom/v1";

/** Folder on disk + Canon identity. Keys accept folder, enum, or short alias. */
const WORLDS = {
  "concordia-hub": {
    folder: "concordia-hub",
    enumId: "Hub",
    title: "The Unburned Court",
    refusal: "You cannot own the heart.",
    law: "No live steel in the Court. Blades die as flowers except in the Arena.",
    staple: "lanterns",
    hub: true,
    sere: false,
  },
  "sovereign-ruins": {
    folder: "sovereign-ruins",
    enumId: "Ruins",
    title: "Sovereign Ruins",
    refusal: "We will not allow our ending to be final.",
    law: "Death is unstable. Catalogue, do not conquer.",
    staple: "remnants",
  },
  tunya: {
    folder: "tunya",
    enumId: "Tunya",
    title: "Tunya",
    refusal: "We will not be reaped.",
    law: "Grove restores poise if you are not striking.",
    staple: "harvest",
  },
  fantasy: {
    folder: "fantasy",
    enumId: "Fantasy",
    title: "The Sundering",
    refusal: "I will not become the thing destroying me.",
    law: "Hostility turns inward — your own poise pays the curse.",
    staple: "ward",
  },
  crime: {
    folder: "crime",
    enumId: "Crime",
    title: "Crime World",
    refusal: "What we do will not catch up to us.",
    law: "The bill always arrives. Witnesses remember.",
    staple: "invoices",
  },
  cyber: {
    folder: "cyber",
    enumId: "Cyber",
    title: "The Grid",
    refusal: "I will not be counted.",
    law: "Damage hides until you let it exist.",
    staple: "census",
  },
  "concord-link-frontier": {
    folder: "concord-link-frontier",
    enumId: "Frontier",
    title: "The Frontier",
    refusal: "The road is our door.",
    law: "Drop the dome; wind will do the rest.",
    staple: "road",
  },
  superhero: {
    folder: "superhero",
    enumId: "Superhero",
    title: "The Permanent Dawn",
    refusal: "I will not take the final victory.",
    law: "Mercy. They stand. The dawn does not end.",
    staple: "mercy",
  },
  "lattice-crucible": {
    folder: "lattice-crucible",
    enumId: "Crucible",
    title: "The Crucible",
    refusal: "A system that refuses to close can never rest.",
    law: "If it would end, un-end it.",
    staple: "drift",
  },
  sere: {
    folder: "sere",
    enumId: "Sere",
    title: "Sere",
    refusal: "No Refusal ever held here.",
    law: "The Mark is the only law that compounds. Live steel is allowed. Flower-law is the Court only.",
    staple: "marks",
    sere: true,
  },
};

const ALIAS = {
  hub: "concordia-hub",
  Hub: "concordia-hub",
  "concordia-hub": "concordia-hub",
  ruins: "sovereign-ruins",
  Ruins: "sovereign-ruins",
  "sovereign-ruins": "sovereign-ruins",
  tunya: "tunya",
  Tunya: "tunya",
  fantasy: "fantasy",
  Fantasy: "fantasy",
  crime: "crime",
  Crime: "crime",
  cyber: "cyber",
  Cyber: "cyber",
  frontier: "concord-link-frontier",
  Frontier: "concord-link-frontier",
  "concord-link-frontier": "concord-link-frontier",
  superhero: "superhero",
  Superhero: "superhero",
  crucible: "lattice-crucible",
  Crucible: "lattice-crucible",
  "lattice-crucible": "lattice-crucible",
  sere: "sere",
  Sere: "sere",
};

/** Same eight Ring doors as Unity Canon.Gates. Sere is a waystone, not a ninth. */
const RING_GATES = [
  { worldId: "cyber", name: "The Grid", refusal: "Refusal of Numbers", ownerFaction: "Concordant Watch" },
  { worldId: "sovereign-ruins", name: "Sovereign Ruins", refusal: "Refusal of Death", ownerFaction: "Concordant Watch" },
  { worldId: "fantasy", name: "The Sundering", refusal: "Refusal of Hostility", ownerFaction: "Concordant Watch" },
  { worldId: "tunya", name: "Tunya", refusal: "Refusal of Harvest", ownerFaction: "Concordant Watch" },
  { worldId: "concord-link-frontier", name: "The Frontier", refusal: "Refusal of the Dome", ownerFaction: "Concordant Watch" },
  { worldId: "crime", name: "Crime World", refusal: "Refusal of Consequence", ownerFaction: "Concordant Watch" },
  { worldId: "superhero", name: "The Permanent Dawn", refusal: "Refusal of the Win", ownerFaction: "Concordant Watch" },
  { worldId: "lattice-crucible", name: "The Crucible", refusal: "The Eighth Refusal", ownerFaction: "Concordant Watch" },
];

export function resolveWorldKey(worldId) {
  if (typeof worldId !== "string" || !worldId.trim()) return null;
  return ALIAS[worldId.trim()] || null;
}

function readJson(folder, stem) {
  const path = join(WORLD_ROOT, folder, `${stem}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function asArray(raw, ...keys) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    for (const k of keys) {
      if (Array.isArray(raw[k])) return raw[k];
    }
  }
  return [];
}

function loadPeople(folder) {
  const seen = new Set();
  const out = [];
  for (const stem of ["npcs", "npcs-extra"]) {
    for (const p of asArray(readJson(folder, stem), "items", "npcs")) {
      if (!p || typeof p !== "object" || !p.name) continue;
      const key = p.id || p.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: p.id || p.name,
        name: p.name,
        title: p.title || p.archetype || "",
        factionId: p.faction_id || "",
      });
    }
  }
  return out;
}

function loadFactions(folder) {
  const seen = new Set();
  const out = [];
  for (const stem of ["factions", "factions-extra"]) {
    for (const f of asArray(readJson(folder, stem), "items", "factions")) {
      if (!f || typeof f !== "object" || !f.name) continue;
      const key = f.id || f.name;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: f.id || f.name,
        name: f.name,
        motto: f.motto || "",
        districts: Array.isArray(f.controlled_districts) ? f.controlled_districts : [],
      });
    }
  }
  return out;
}

function loadCountries(folder) {
  return asArray(readJson(folder, "countries"), "countries");
}

function settlementsFromAuthored(folder, worldKey, canon) {
  if (canon.hub) return [];
  const list = [];
  const seen = new Set();
  for (const c of loadCountries(folder)) {
    if (!c || !c.name) continue;
    const id = c.country_id || c.name;
    if (seen.has(id.toLowerCase()) || seen.has(c.name.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    seen.add(c.name.toLowerCase());
    const cap = c.capital && c.capital.name ? c.capital.name : c.name;
    list.push({
      id,
      name: cap,
      factionId: c.faction_id || "",
      districts: [cap],
      source: "countries",
    });
  }
  for (const f of loadFactions(folder)) {
    if (!f.districts.length) continue;
    if (f.id && seen.has(f.id.toLowerCase())) continue;
    if (seen.has(f.name.toLowerCase())) continue;
    seen.add((f.id || f.name).toLowerCase());
    seen.add(f.name.toLowerCase());
    list.push({
      id: f.id || f.districts[0],
      name: f.name,
      factionId: f.id || "",
      districts: f.districts,
      source: "faction",
    });
  }
  return list;
}

function gatesFor(canon, worldKey) {
  if (canon.sere) {
    return [{
      id: "waystone-sere",
      name: "The First Launch Cradle",
      worldId: "sere",
      ownerFaction: "",
      waystone: true,
      ninthRefusal: false,
      note: "Court waystone — not a ninth Refusal gate",
      tariffRate: 0,
      inspectionLevel: 0,
    }];
  }
  if (canon.hub) {
    return RING_GATES.map((g) => ({
      id: `ring-${g.worldId}`,
      name: g.name,
      worldId: g.worldId,
      ownerFaction: g.ownerFaction,
      waystone: false,
      ninthRefusal: false,
      refusal: g.refusal,
      tariffRate: 0.05,
      inspectionLevel: 1,
      note: "Ring door. Ownership is Concordant Watch, not a Unity boolean.",
    }));
  }
  const door = RING_GATES.find((g) => g.worldId === worldKey);
  const factions = loadFactions(canon.folder);
  const owner = factions[0]?.name || "";
  return [{
    id: `return-${worldKey}`,
    name: "The Unburned Court",
    worldId: "concordia-hub",
    ownerFaction: owner || "Concordant Watch",
    waystone: false,
    ninthRefusal: false,
    tariffRate: 0.05,
    inspectionLevel: 1,
    note: door ? `Return through ${door.name}.` : "Return to the Ring.",
  }];
}

/**
 * @param {any} _db  unused — the graph is authored JSON, not a SQLite invention
 * @param {string} worldId  folder, enum, or alias
 */
export function buildKingdomSnapshot(_db, worldId) {
  const key = resolveWorldKey(worldId);
  if (!key) {
    return { ok: false, reason: "unknown_world", worldId: worldId || "" };
  }
  const canon = WORLDS[key];
  const folder = canon.folder;
  const factions = loadFactions(folder);
  const actors = loadPeople(folder);
  const settlements = settlementsFromAuthored(folder, key, canon);
  const lore = readJson(folder, "lore");
  const notes = [];
  if (canon.hub) {
    notes.push("The Court is the city (unpaved). CityAtlas is empty on purpose.");
  }
  if (canon.sere) {
    notes.push("Sere is reached by the Court waystone. It is not a ninth Refusal gate.");
  }
  notes.push("stock/need live on the client WorldMemory slice until persist-sync.");
  notes.push("caravans/tariffs stay empty here until the Ring economy persists them.");

  const regionName = canon.hub
    ? "The Unburned Court"
    : (settlements[0]?.name || canon.title);

  return {
    ok: true,
    format: KINGDOM_FORMAT,
    worldId: key,
    enumId: canon.enumId,
    title: canon.title,
    refusal: canon.refusal,
    law: canon.law,
    loreName: lore && typeof lore.world_name === "string" ? lore.world_name : canon.title,
    kingdom: {
      staple: canon.staple,
      stock: null,
      need: null,
      population: actors.length,
      stockNote: "slice_lives_on_client",
    },
    regions: [{
      id: key,
      name: regionName,
      capital: canon.hub ? "The Court" : (settlements[0]?.name || canon.title),
      settlementCount: settlements.length,
    }],
    settlements,
    districts: settlements.flatMap((s) => (s.districts || []).map((d) => ({ settlementId: s.id, id: d }))),
    buildings: [],
    actors,
    activities: ["open", "patrol", "deliver", "talk", "inside", "hunt"],
    roads: [],
    gates: gatesFor(canon, key),
    caravans: [],
    tariffs: [],
    markets: [],
    factions,
    notes,
  };
}

export default { buildKingdomSnapshot, resolveWorldKey, KINGDOM_FORMAT };
