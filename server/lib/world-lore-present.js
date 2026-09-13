/**
 * Authored Concordia lore for Unity/Godot presentation.
 * Reads content/world + content/codex. Never invents beats, secrets, or NPCs.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTENT = join(ROOT, "content");

const FOLDER = Object.freeze({
  "concordia-hub": "concordia-hub",
  hub: "concordia-hub",
  "sovereign-ruins": "sovereign-ruins",
  ruins: "sovereign-ruins",
  tunya: "tunya",
  fantasy: "fantasy",
  crime: "crime",
  cyber: "cyber",
  "concord-link-frontier": "concord-link-frontier",
  frontier: "concord-link-frontier",
  superhero: "superhero",
  "lattice-crucible": "lattice-crucible",
  crucible: "lattice-crucible",
  sere: "sere",
});

const cache = new Map();

function clip(s, n = 480) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).trim();
}

function firstSentence(s) {
  const t = clip(s, 420);
  if (!t) return "";
  const cut = t.search(/[.!?](?:\s|$)/);
  return cut > 24 && cut < 280 ? t.slice(0, cut + 1) : t;
}

function readJson(rel) {
  const key = rel;
  if (cache.has(key)) return cache.get(key);
  const p = join(CONTENT, rel);
  if (!existsSync(p)) {
    cache.set(key, null);
    return null;
  }
  try {
    const v = JSON.parse(readFileSync(p, "utf8"));
    cache.set(key, v);
    return v;
  } catch {
    cache.set(key, null);
    return null;
  }
}

export function folderForWorld(worldId) {
  const raw = String(worldId || "").trim();
  if (!raw) return "concordia-hub";
  return FOLDER[raw] || FOLDER[raw.toLowerCase()] || raw;
}

export function listLoreLandmarks(worldId) {
  const folder = folderForWorld(worldId);
  const lore = readJson(`world/${folder}/lore.json`);
  const history = Array.isArray(lore?.history) ? lore.history : [];
  return history
    .filter((e) => e && e.id && e.title)
    .map((e) => ({
      id: e.id,
      title: e.title,
      era: e.era || null,
      type: e.type || null,
      text: clip(e.description, 480),
    }));
}

export function refusalForWorld(worldId) {
  const folder = folderForWorld(worldId);
  const codex = readJson("codex/eight-refusals.json");
  if (!codex) return null;
  const refusals = Array.isArray(codex.refusals) ? codex.refusals : [];
  const hit = refusals.find((r) => r && r.world_id === folder);
  if (hit) {
    return {
      id: hit.id,
      name: hit.name,
      worldId: hit.world_id,
      theNo: hit.the_no || null,
      cost: clip(hit.the_cost, 280),
    };
  }
  if (folder === "concordia-hub" && codex.the_ninth) {
    return {
      id: "the_ninth",
      name: codex.the_ninth.name,
      worldId: "concordia-hub",
      theNo: codex.the_ninth.the_no || null,
      cost: clip(codex.the_ninth.explanation, 280),
    };
  }
  return null;
}

function asNpcList(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

function publicNpc(npc) {
  if (!npc || !npc.id) return null;
  const schedule = Array.isArray(npc.daily_schedule) ? npc.daily_schedule : [];
  const nowHour = new Date().getUTCHours();
  const slot = schedule.find((s) => {
    const hours = Array.isArray(s?.phase_hours) ? s.phase_hours : [];
    if (hours.length >= 2) return nowHour >= hours[0] && nowHour < hours[1];
    return false;
  }) || schedule.find((s) => s?.interactable_by_player) || schedule[0] || null;
  return {
    id: npc.id,
    name: npc.name || npc.id,
    title: npc.title || npc.role || null,
    personality: clip(npc.personality || (Array.isArray(npc.personality_traits) ? npc.personality_traits.join(", ") : ""), 240),
    line: firstSentence(npc.personality || npc.background || npc.backstory || npc.dialogue_style || ""),
    activity: slot?.activity || null,
    location: slot?.location || null,
    interactable: slot ? slot.interactable_by_player !== false : true,
    // secrets stay on disk — never copied here
  };
}

function npcsIn(rel) {
  return asNpcList(readJson(rel));
}

function foundingDayPlazaLine(npcId) {
  const quests = readJson("quests/founding-day-reading.json");
  const list = Array.isArray(quests) ? quests : [];
  const q = list.find((x) => x && x.giver_npc_id === npcId);
  const bc = Array.isArray(q?.breadcrumbs) ? q.breadcrumbs[0] : null;
  const content = String(bc?.content || "");
  const quoted = content.match(/'([^']+)'/g);
  if (quoted && quoted.length)
    return clip(quoted.map((s) => s.slice(1, -1)).join(" "), 280);
  return firstSentence(content);
}

export function authoredNpcPublic(npcId, worldId = "concordia-hub") {
  const id = String(npcId || "").trim();
  if (!id) return null;
  const folder = folderForWorld(worldId);
  const pools = [
    ...npcsIn(`world/${folder}/npcs.json`),
    ...npcsIn(`world/${folder}/npcs-extra.json`),
    ...npcsIn("world/npcs.json"),
  ];
  const hit = pools.find((n) => n && (n.id === id || String(n.name || "").toLowerCase() === id.toLowerCase()));
  const pub = hit ? publicNpc(hit) : null;
  if (folder === "concordia-hub") {
    const plazaId = pub?.id || id;
    if (plazaId === "archivist_maren" || String(pub?.name || "").toLowerCase() === "maren ashveil") {
      const plaza = foundingDayPlazaLine("archivist_maren");
      if (plaza) {
        return {
          ...(pub || { id: "archivist_maren", name: "Maren Ashveil", title: "Archivist", interactable: true }),
          line: plaza,
        };
      }
    }
  }
  return pub;
}

function questsFrom(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return list
    .filter((q) => q && q.id && q.title)
    .map((q) => ({
      id: q.id,
      title: q.title,
      origin: "authored",
      status: "offered",
      giver: q.giver_npc_id || null,
    }));
}

export function listAuthoredQuests(worldId) {
  const folder = folderForWorld(worldId);
  const out = [];
  if (folder === "concordia-hub") {
    out.push(...questsFrom(readJson("quests/founding-day-reading.json")));
  }
  const dir = join(CONTENT, "world", folder, "quests");
  if (existsSync(dir)) {
    try {
      for (const name of readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        out.push(...questsFrom(readJson(`world/${folder}/quests/${name}`)));
      }
    } catch { /* */ }
  }
  const seen = new Set();
  return out.filter((q) => seen.has(q.id) ? false : (seen.add(q.id), true)).slice(0, 16);
}
