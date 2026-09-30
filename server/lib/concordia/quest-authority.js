// server/lib/concordia/quest-authority.js
//
// Server-authored quest interact outcomes for Concordia.
// Source of truth: content/quests/*.json via content-seeder `_authoredQuests`
// (or filesystem fallback when seeder is cold). Unity offline LoreStone text
// must not be the only place branching prose lives — Connected clients POST
// /api/quests/interact and get the same authored strings.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { _authoredQuests } from "../content-seeder.js";
import { getMoralBranch } from "../quests/moral-branch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_QUESTS = join(__dirname, "../../../content/quests");

/** @type {Map<string, object>} */
const fileCache = new Map();

function loadFromDisk(questId) {
  if (fileCache.has(questId)) return fileCache.get(questId);
  const files = [
    join(REPO_QUESTS, "sealed-record.json"),
    join(REPO_QUESTS, "brackish-trust.json"),
    join(REPO_QUESTS, "main-arc.json"),
    join(REPO_QUESTS, "onboarding.json"),
    join(REPO_QUESTS, "faction-quests.json"),
  ];
  for (const f of files) {
    if (!existsSync(f)) continue;
    try {
      const arr = JSON.parse(readFileSync(f, "utf8"));
      if (!Array.isArray(arr)) continue;
      for (const q of arr) {
        if (q?.id) fileCache.set(q.id, q);
      }
    } catch { /* skip bad file */ }
  }
  return fileCache.get(questId) || null;
}

export function getAuthoredQuest(questId) {
  const id = String(questId || "").trim();
  if (!id) return null;
  const seeded = _authoredQuests.get(id);
  if (seeded?.raw) return seeded.raw;
  return loadFromDisk(id);
}

/** Aliases Unity waystones / LoreStone titles may send. */
const ALIASES = {
  "the sealed record — three paths": "sealed_04_choice",
  "the sealed record - three paths": "sealed_04_choice",
  "sealed record": "sealed_04_choice",
  "sealed_record": "sealed_04_choice",
  "waystone_sealed_record": "sealed_04_choice",
  "three paths": "sealed_04_choice",
  sealed_04: "sealed_04_choice",
  sealed_04_choice: "sealed_04_choice",
  sealed_01_notice: "sealed_01_notice",
  sealed_02_isa: "sealed_02_isa",
  sealed_03_cavity: "sealed_03_cavity",
};

export function resolveQuestId(questIdOrTitle) {
  const raw = String(questIdOrTitle || "").trim();
  if (!raw) return null;
  if (_authoredQuests.has(raw) || loadFromDisk(raw)) return raw;
  const key = raw.toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // Title match against known sealed-record stages
  for (const id of ["sealed_04_choice", "sealed_03_cavity", "sealed_02_isa", "sealed_01_notice"]) {
    const q = getAuthoredQuest(id);
    if (q?.title && q.title.toLowerCase() === key) return id;
  }
  return raw;
}

function formatBranchingText(quest) {
  const lines = [];
  if (quest.title) lines.push(quest.title);
  if (quest.description) lines.push(quest.description);
  const branch = quest.moral_branch;
  if (branch?.description) lines.push(branch.description);
  if (Array.isArray(branch?.options) && branch.options.length) {
    lines.push("Paths:");
    for (const opt of branch.options) {
      const label = opt.id || "path";
      const c = opt.consequence || "";
      lines.push(`- ${label}: ${c}`);
    }
  } else if (Array.isArray(quest.breadcrumbs) && quest.breadcrumbs.length) {
    for (const b of quest.breadcrumbs) {
      if (b?.content) lines.push(b.content);
    }
  }
  return lines.filter(Boolean).join("\n");
}

/**
 * Server-authority quest interact.
 * @returns {{ok:boolean, authority?:string, questId?:string, title?:string, text?:string, options?:array, optionId?:string, consequence?:string, refused?:boolean, reason?:string, error?:string}}
 */
export function interactQuest({
  questId,
  optionId = null,
  worldId = "concordia-hub",
  targetId = null,
} = {}) {
  const resolved = resolveQuestId(questId || targetId);
  if (!resolved) {
    return { ok: false, error: "missing_quest", reason: "questId_required" };
  }
  const quest = getAuthoredQuest(resolved);
  if (!quest) {
    return { ok: false, error: "quest_not_found", reason: `unknown_quest:${resolved}`, questId: resolved };
  }

  const branch = quest.moral_branch || getMoralBranch(resolved);
  const optKey = optionId ? String(optionId).trim() : null;

  if (optKey && branch?.options) {
    const option = branch.options.find(
      (o) => o.id === optKey || o.trigger === optKey || (o.trigger && o.trigger.endsWith(`:${optKey}`)),
    );
    if (!option) {
      return {
        ok: false,
        error: "unknown_option",
        reason: `option_not_in_branch:${optKey}`,
        questId: resolved,
        title: quest.title,
        options: branch.options.map((o) => ({ id: o.id, trigger: o.trigger || null })),
      };
    }
    return {
      ok: true,
      authority: "server",
      source: "authored-quest-store",
      worldId: String(worldId || "concordia-hub"),
      questId: resolved,
      title: quest.title || resolved,
      optionId: option.id,
      trigger: option.trigger || null,
      consequence: option.consequence || "",
      text: [quest.title, option.consequence].filter(Boolean).join("\n"),
      reputation_change: option.reputation_change || null,
      options: branch.options.map((o) => ({
        id: o.id,
        trigger: o.trigger || null,
        consequence: o.consequence || "",
      })),
    };
  }

  const text = formatBranchingText(quest);
  return {
    ok: true,
    authority: "server",
    source: "authored-quest-store",
    worldId: String(worldId || "concordia-hub"),
    questId: resolved,
    title: quest.title || resolved,
    description: quest.description || "",
    text,
    options: Array.isArray(branch?.options)
      ? branch.options.map((o) => ({
          id: o.id,
          trigger: o.trigger || null,
          consequence: o.consequence || "",
        }))
      : [],
    moralBranchDescription: branch?.description || null,
  };
}

export default { getAuthoredQuest, resolveQuestId, interactQuest };
