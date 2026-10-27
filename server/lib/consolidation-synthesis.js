// Consolidation: which megas/hypers the tier budget may demote, what a
// consolidated node says about its members, and growing an existing node.
//
// Live finding (2026-10-27): enforceTierBudgets caps megas at sqrt(n)/2
// (22 at n≈2,060) and hypers at log2(n)/5 (2). Every commit demoted every
// consolidation mega above the cap to regular in memory (the SQLite row
// kept tier=mega). New megas have zero uses, so they were demoted on commit
// ("downgraded_on_commit:regular"); the demoted node kept its clusterKey and
// title, so the same cluster then hit "cluster_exists" / "duplicate_blocked"
// every cycle, and hypers had too few live megas ("too_few_ids").

/** A mega/hyper built by consolidation (it has members), not by usage placement. */
export function isConsolidatedNode(d) {
  if (!d || (d.tier !== "mega" && d.tier !== "hyper")) return false;
  const parents = d.lineage?.parents;
  return (Array.isArray(parents) && parents.length > 0) || Number(d.meta?.promotedFrom) > 0 || !!d.meta?.clusterKey;
}

/**
 * The nodes of one tier the budget may demote: consolidated nodes are
 * structure (their members were archived into them) and are never demoted;
 * they still count against the budget for usage-placed nodes.
 */
export function budgetDemotions(nodes, max, byUtility) {
  const list = Array.isArray(nodes) ? nodes : [];
  const structural = list.filter(isConsolidatedNode);
  const placed = list.filter((d) => !isConsolidatedNode(d));
  const room = Math.max(0, max - structural.length);
  if (placed.length <= room) return [];
  const sorted = typeof byUtility === "function" ? [...placed].sort(byUtility) : placed;
  return sorted.slice(room);
}

const STOP = new Set("the and for with that this from into over under about their there these those which while where when what have has had been being are was were will would could should can may might not but its it's they them than then also such each other more most some any all one two three per via using use used based within between across without your our his her who whom whose how why very much many few".split(" "));

const _text = (d) => [
  ...(Array.isArray(d?.core?.definitions) ? d.core.definitions : []),
  ...(Array.isArray(d?.core?.claims) ? d.core.claims : []),
  d?.human?.summary, d?.summary, d?.cretiHuman, d?.creti,
].filter((x) => typeof x === "string").join(" ");

/** First real sentence of a member: its gist. */
export function memberGist(d, max = 160) {
  const raw = [d?.human?.summary, d?.summary, ...(Array.isArray(d?.core?.definitions) ? d.core.definitions : []), ...(Array.isArray(d?.core?.claims) ? d.core.claims : []), d?.cretiHuman]
    .find((x) => typeof x === "string" && x.replace(/[*#_`>\-\s]/g, "").length >= 20) || "";
  const clean = String(raw).replace(/\*\*[^*]+\*\*:\s*/g, "").replace(/[#*_`>]+/g, "").replace(/\s+/g, " ").trim();
  const sentence = (clean.match(/^.{20,}?[.!?](?=\s|$)/) || [clean])[0];
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Terms shared by the most members (document frequency), most common first. */
export function sharedThemes(members, k = 6) {
  const df = new Map();
  for (const m of members || []) {
    const words = new Set(String(`${m?.title || ""} ${_text(m)}`).toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) || []);
    for (const w of words) if (!STOP.has(w)) df.set(w, (df.get(w) || 0) + 1);
  }
  const min = Math.max(2, Math.ceil((members || []).length * 0.3));
  return [...df.entries()].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k).map(([w]) => w);
}

/**
 * The body of a consolidated node: an explicit member count, what the
 * members have in common, and one line per member (distinct gists), instead
 * of the old boilerplate ("Cluster representative for ids …").
 */
export function synthesizeConsolidatedBody({ tier = "mega", childTier = "regular", titleSeed = "", members = [], total = null, tags = [] } = {}) {
  const n = Number.isFinite(total) && total > 0 ? total : members.length;
  const themes = sharedThemes(members);
  const seen = new Set();
  const gists = [];
  for (const m of members) {
    const g = memberGist(m);
    const key = g.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
    if (!g || seen.has(key)) continue;
    seen.add(key);
    gists.push({ title: String(m?.title || "").replace(/\s+/g, " ").slice(0, 80), gist: g });
    if (gists.length >= 8) break;
  }
  const summary = `${n} ${childTier} DTUs on ${titleSeed || "one topic"}${themes.length ? `, sharing ${themes.slice(0, 4).join(", ")}` : ""}.`;
  const parts = [
    `Members: ${n} ${childTier} DTUs.`,
    `**Summary**: ${summary}${gists.length ? ` Together they cover: ${gists.slice(0, 4).map((g) => g.gist.replace(/[.!?…]+$/, "")).join("; ")}.` : ""}`,
    themes.length ? `**Common themes**: ${themes.join(", ")}` : "",
    gists.length ? `**Members**:\n${gists.map((g) => `- ${g.title ? `${g.title}: ` : ""}${g.gist}`).join("\n")}${n > gists.length ? `\n- …and ${n - gists.length} more` : ""}` : "",
    tags.length ? `**Tags**: ${tags.slice(0, 16).join(", ")}` : "",
    `**Lineage**: a ${String(tier).toUpperCase()} consolidated from its ${n} member DTUs, which are archived into it.`,
  ];
  return { text: parts.filter(Boolean).join("\n\n"), summary, themes, gists };
}

/**
 * Where a cluster that already has a consolidated node goes: into that node
 * (same tier, live, same scope envelope) with only the members it lacks.
 * Returns null when the cluster must be skipped instead.
 */
export function absorbTarget(node, { targetTier, members = [], scopeKey = null } = {}) {
  if (!node || node.tier !== targetTier || !isConsolidatedNode(node)) return null;
  if ((node.status || "active") !== "active") return null;
  if (typeof scopeKey === "function" && members[0] && scopeKey(node) !== scopeKey(members[0])) return null;
  const have = new Set(Array.isArray(node.lineage?.parents) ? node.lineage.parents : []);
  const fresh = members.filter((m) => m?.id && m.id !== node.id && !have.has(m.id));
  return { megaId: node.id, members: fresh };
}

/**
 * Grow a consolidated node by new members in place: lineage, member count,
 * claims (so the coverage gate still holds) and the body. Returns an undo.
 */
export function growConsolidatedNode(node, fresh, { childTier = "regular", titleSeed = "", now = () => new Date().toISOString() } = {}) {
  const before = {
    parents: [...(node.lineage?.parents || [])],
    promotedFrom: node.meta?.promotedFrom,
    claims: [...(node.core?.claims || [])],
    cretiHuman: node.cretiHuman,
    definitions: [...(node.core?.definitions || [])],
  };
  node.lineage = { ...(node.lineage || {}), parents: [...before.parents, ...fresh.map((m) => m.id)] };
  const total = node.lineage.parents.length;
  node.meta = { ...(node.meta || {}), promotedFrom: total, absorbedAt: now(), lastAbsorbed: fresh.length };
  const claims = new Set(before.claims.map(String));
  for (const m of fresh) for (const c of (Array.isArray(m?.core?.claims) ? m.core.claims : [])) claims.add(String(c));
  node.core = { ...(node.core || {}), claims: [...claims] };
  const defs = [...before.definitions];
  defs[0] = `A compressed synthesis of ${total} ${childTier} DTUs around: ${titleSeed || String(node.title || "").replace(/^\s*(?:MEGA|HYPER)\s*[—–-]\s*/i, "")}.`;
  node.core.definitions = defs;
  const tail = synthesizeConsolidatedBody({ tier: node.tier, childTier, titleSeed, members: fresh, total }).gists;
  let body = String(before.cretiHuman || "");
  body = /^Members: \d+ /m.test(body) ? body.replace(/^Members: \d+ [a-z]+ DTUs\./m, `Members: ${total} ${childTier} DTUs.`) : `Members: ${total} ${childTier} DTUs.\n\n${body}`;
  body = body.replace(/\b\d+ (related )?(regular|mega) DTUs\b/, (_m, rel, t) => `${total} ${rel || ""}${t} DTUs`);
  if (tail.length) body += `\n\n**Absorbed ${now().slice(0, 10)}**:\n${tail.map((g) => `- ${g.title ? `${g.title}: ` : ""}${g.gist}`).join("\n")}`;
  node.cretiHuman = body;
  node.updatedAt = now();
  return () => {
    node.lineage = { ...(node.lineage || {}), parents: before.parents };
    node.meta = { ...(node.meta || {}), promotedFrom: before.promotedFrom };
    node.core = { ...(node.core || {}), claims: before.claims, definitions: before.definitions };
    node.cretiHuman = before.cretiHuman;
  };
}
