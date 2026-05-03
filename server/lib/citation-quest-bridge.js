/**
 * Citation chains → emergent quest chains.
 *
 * DTU lineage tracks who cited whom. A "deep" chain is one where DTU A is
 * cited by B, B by C, C by D, ... — a knowledge artifact whose impact
 * cascades. These chains are the most pedagogically valuable patterns in
 * the system, and they currently exist only as graph data with no
 * gameplay surface.
 *
 * This bridge converts a deep citation chain into a multi-stage "verify
 * this lineage" quest:
 *   • Step 1: Find the root DTU.
 *   • Step 2: Walk to the next citation.
 *   • Step 3: Identify the claim that links the two.
 *   • ...
 *   • Final: Synthesize a new DTU that completes or extends the chain.
 *
 * Each step is a discoverable challenge step in the quest engine.
 *
 * Trigger: runs when a chain reaches depth >= 4 with at least 2 unique
 * domains crossed (cross-domain breadth makes the chain non-trivial).
 */

import { createQuest, listQuests } from "../emergent/quest-engine.js";

const MIN_CHAIN_DEPTH = 4;
const MIN_DOMAINS = 2;

/**
 * Walk a DTU's citation chain to compute depth + domain set.
 */
export function walkCitationChain(STATE, rootDtuId, maxDepth = 12) {
  if (!STATE?.dtus) return { depth: 0, chain: [], domains: [] };
  const seen = new Set([rootDtuId]);
  const chain = [];
  const domains = new Set();
  let cursor = rootDtuId;

  for (let i = 0; i < maxDepth; i++) {
    const dtu = STATE.dtus.get?.(cursor);
    if (!dtu) break;
    chain.push({
      id: cursor,
      title: dtu.title,
      domain: dtu.domain,
    });
    if (dtu.domain) domains.add(dtu.domain);
    // Find DTUs that cite this one — the next link forward in the chain.
    const next = findNextCiter(STATE, cursor, seen);
    if (!next) break;
    seen.add(next);
    cursor = next;
  }

  return { depth: chain.length, chain, domains: [...domains] };
}

function findNextCiter(STATE, dtuId, seen) {
  // Scan all DTUs whose lineage.parents (or lineage.citations) include dtuId.
  for (const [id, dtu] of STATE.dtus.entries?.() ?? []) {
    if (seen.has(id)) continue;
    const parents = dtu.lineage?.parents ?? [];
    const cites = dtu.lineage?.citations ?? [];
    if (parents.includes?.(dtuId) || cites.some?.(c => c?.dtuId === dtuId || c === dtuId)) {
      return id;
    }
  }
  return null;
}

/**
 * Build quest steps from a citation chain.
 */
export function buildChainQuestSteps(chain) {
  const steps = chain.map((node, i) => ({
    id: `step_${i}`,
    title: i === 0
      ? `Locate the source: "${node.title}"`
      : i === chain.length - 1
        ? `Verify the final claim in "${node.title}"`
        : `Trace the citation that brought us to "${node.title}"`,
    type: i === 0 ? "discover" : i === chain.length - 1 ? "challenge" : "learn",
    content: {
      dtuIds: [node.id],
      prompt: `In the ${node.domain || "general"} domain, identify the claim that connects this DTU to the next link in the chain.`,
      hint: i === chain.length - 1
        ? "The final node should validate or contradict the chain's accumulated claim."
        : "Look for the citation footnote that points forward.",
      successCriteria: i === chain.length - 1
        ? "Synthesize a new DTU that explicitly cites this node and articulates whether the chain's argument holds."
        : "Open the next DTU in the citation chain.",
    },
    rewards: {
      knowledgeUnlock: [],
      badge: i === chain.length - 1 ? "lineage_verifier" : "",
    },
    dependsOn: i === 0 ? [] : [`step_${i - 1}`],
    meta: {
      objective_type: "discover",
      target: node.id,
      required_count: 1,
    },
  }));
  return steps;
}

/**
 * Materialize a citation chain as a quest if it qualifies and one doesn't
 * already exist for the same root.
 */
export function materializeChainQuest(STATE, rootDtuId, opts = {}) {
  const { depth, chain, domains } = walkCitationChain(STATE, rootDtuId);
  if (depth < MIN_CHAIN_DEPTH) return { ok: false, reason: "chain_too_shallow", depth };
  if (domains.length < MIN_DOMAINS) return { ok: false, reason: "needs_more_domains", domains };

  // Don't create duplicate quests for the same root.
  const existing = listQuests({ tag: `chain_root:${rootDtuId}` });
  if (existing?.quests?.length) {
    return { ok: false, reason: "quest_already_exists", questId: existing.quests[0].id };
  }

  const title = `Verify the lineage: ${chain[0].title?.slice(0, 60) ?? "Citation chain"}`;
  const steps = buildChainQuestSteps(chain);

  const created = createQuest(title, {
    description: `A citation chain ${depth} DTUs deep crosses ${domains.length} domains. Walk the chain, verify each link, and finish by synthesizing a new DTU that extends or refutes it.`,
    difficulty: depth >= 6 ? "expert" : depth >= 5 ? "advanced" : "intermediate",
    domain: domains[0] ?? "general",
    estimatedTime: depth * 12, // ~12 minutes per step
    steps,
    tags: [
      `chain_root:${rootDtuId}`,
      "lineage_verification",
      "emergent",
      ...domains.map(d => `domain:${d}`),
    ],
    breadcrumbs: opts.breadcrumbs ?? [],
  });

  return created.ok
    ? { ok: true, questId: created.quest.id, depth, domains }
    : { ok: false, reason: created.error };
}

/**
 * Scan the DTU graph for chain roots that haven't been materialized yet.
 * Run on a slow tick — this is O(N²) in worst case so we cap the scan.
 */
export function scanForChainQuests(STATE, opts = {}) {
  if (!STATE?.dtus) return { ok: false, reason: "no_state", materialized: 0 };
  const maxScan = opts.maxScan ?? 200;
  const candidates = [];

  let scanned = 0;
  for (const [id, dtu] of STATE.dtus.entries?.() ?? []) {
    if (scanned++ >= maxScan) break;
    // Only consider candidates with no parent (likely chain roots) and at
    // least one citation forward.
    if (dtu.lineage?.parents?.length) continue;
    candidates.push(id);
  }

  let materialized = 0;
  const created = [];
  for (const rootId of candidates) {
    const r = materializeChainQuest(STATE, rootId);
    if (r.ok) {
      materialized++;
      created.push({ rootId, questId: r.questId, depth: r.depth });
    }
  }
  return { ok: true, scanned, candidates: candidates.length, materialized, created };
}
