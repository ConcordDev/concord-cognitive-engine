/**
 * Lens grounding for the chat assembly — Analytics (Product Review 4, F1/R1).
 *
 * Why this exists server-side: the Chat workspace panel appends a grounded
 * facts block to the client-composed system prompt (frontend
 * components/chat/lensAccountFacts.ts), but the chat assembly in server.js
 * (chat.respond → __chatRespondImpl, and the WS chat:message streaming path)
 * composes its system prompt server-side and never reads a client-supplied
 * systemPrompt. The client block therefore never reached the model: at the
 * R4 re-review the analyst answered "You have 14 DTUs" against a live
 * surface reading 33 — a number from the pipeline's own context material —
 * and declined a Total Reach the surface displays as 0 (analytics.md §9
 * Addendum 4, A19/A20). Grounding has to be injected where the prompt is
 * actually assembled, from the same stores the surface reads.
 *
 * Contract (one contract, two seams — this module and the FE provider must
 * stay in lockstep): facts are composed live at ask time from the Analytics
 * Overview's own substrate, each citing its card + endpoint; a present 0
 * renders as 0; a source that cannot be read is NAMED, never zero-filled;
 * counts of DTUs retrieved/harvested as conversation context are explicitly
 * disqualified as account totals. The founder's standard (Ramaj, 2026-10-29,
 * §8 Q2 ratified): grounded-or-decline — never an estimate.
 *
 * Lens-gated: callers invoke this only for the analytics lens. Any other
 * lens's assembly behaviour is untouched by this module.
 */

import { getProfile, getFollowers, getCreatorAnalyticsView } from "../emergent/social-layer.js";

const fmt = new Intl.NumberFormat("en-US");

function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Collect the Analytics facts from the surface's own stores.
 * deps: { runMacro, ctx, STATE, userId, sources? } — `sources` is injectable
 * for tests; production uses the social-layer functions imported above and
 * the caller's runMacro (dtu.list — the exact macro the /api/dtus/mine REST
 * route delegates to, with the route's own argument set).
 * Returns { facts: [{label, value, source}], unreadable: [name, ...] }.
 * Never throws: a failing read lands in `unreadable`, named.
 */
export async function collectAnalyticsFacts(deps) {
  const { runMacro, ctx, STATE, userId } = deps || {};
  const sources = deps?.sources || { getProfile, getFollowers, getCreatorAnalyticsView };
  const facts = [];
  const unreadable = [];

  // Total DTUs — the card's substrate: GET /api/dtus/mine delegates to
  // dtu.list (mine:true); the card derives `total || dtus.length` from its
  // limit-100 page. Same macro, same arguments, same derivation.
  try {
    const out = await runMacro("dtu", "list", {
      mine: true, limit: 100, offset: 0, q: "", tag: "", tier: "any",
      scope: null, domain: null, kind: null,
    }, ctx);
    if (out && out.ok !== false) {
      const total = num(out.total) || (Array.isArray(out.dtus) ? out.dtus.length : 0);
      facts.push({
        label: "Total DTUs",
        value: fmt.format(total),
        source: 'Analytics Overview "Total DTUs" card — GET /api/dtus/mine',
      });
    } else {
      unreadable.push("Total DTUs (GET /api/dtus/mine)");
    }
  } catch {
    unreadable.push("Total DTUs (GET /api/dtus/mine)");
  }

  // Profile-derived facts: Citations, and the follower-count fallback the
  // Followers card's chain uses.
  let profile = null;
  try {
    profile = sources.getProfile(STATE, userId) || null;
  } catch {
    profile = null;
  }
  if (profile) {
    // The card renders `stats?.citationCount || 0` — an absent stat on a
    // readable profile IS the displayed 0.
    const citations = num(profile?.stats?.citationCount) ?? 0;
    facts.push({
      label: "Citations",
      value: fmt.format(citations),
      source: 'Analytics Overview "Citations" card — GET /api/social/profile',
    });
  } else {
    unreadable.push("Citations (GET /api/social/profile)");
  }

  // Total CC moved — GET /api/economy/transactions returns
  // { transactions, total } with NO summary field; AnalyticsDeskPanel
  // defaults the absent summary to { total: 0 } and paints 0. The grounded
  // fact is the card's 0, structurally, until that endpoint grows a
  // summary — this is the surface's value, not a filled-in failure.
  facts.push({
    label: "Total CC moved",
    value: fmt.format(0),
    source: 'Analytics Overview "Total CC" card — GET /api/economy/transactions',
  });

  // Followers — the card's chain: the followers endpoint count first
  // (getFollowers' total is that count's store value).
  try {
    const fw = sources.getFollowers(STATE, userId);
    const count = num(fw?.total) ??
      (Array.isArray(fw?.followers) ? fw.followers.length : undefined) ??
      num(profile?.stats?.followerCount) ?? 0;
    facts.push({
      label: "Followers",
      value: fmt.format(count),
      source: 'Analytics Overview "Followers" card — GET /api/social/followers/:userId',
    });
  } catch {
    unreadable.push("Followers (GET /api/social/followers/:userId)");
  }

  // Total Reach + Engagement Rate — the creator view CreatorAnalytics
  // renders (overview.*). A throw means the surface cannot render them
  // either; both are named unreadable together, as the FE provider does.
  try {
    const view = sources.getCreatorAnalyticsView(STATE, userId);
    const reach = num(view?.overview?.totalReach);
    if (reach !== undefined) {
      facts.push({
        label: "Total Reach",
        value: fmt.format(reach),
        source: 'Analytics Overview "Total Reach" card — GET /api/social/analytics/creator',
      });
    } else {
      unreadable.push("Total Reach (GET /api/social/analytics/creator)");
    }
    const rate = num(view?.overview?.engagementRate);
    if (rate !== undefined) {
      facts.push({
        label: "Engagement Rate",
        value: `${rate.toFixed(1)}%`,
        source: 'Analytics Overview "Engagement Rate" card — GET /api/social/analytics/creator',
      });
    } else {
      unreadable.push("Engagement Rate (GET /api/social/analytics/creator)");
    }
  } catch {
    unreadable.push("Total Reach (GET /api/social/analytics/creator)");
    unreadable.push("Engagement Rate (GET /api/social/analytics/creator)");
  }

  // Total DTUs leads: it is the account question the analyst got wrong.
  facts.sort((a, b) => {
    if (a.label === "Total DTUs") return -1;
    if (b.label === "Total DTUs") return 1;
    return 0;
  });

  return { facts, unreadable };
}

const DECLINE_RULE =
  "Rule: answer questions about this account ONLY from the facts above, and name the source you used. " +
  "If a value is not listed above, say the surface doesn't give you that — never estimate, " +
  "never round into an approximation, and never reuse an example or placeholder number. " +
  "Counts of DTUs retrieved or harvested as conversation context are NOT account totals and must " +
  "never be quoted as how many DTUs the user has — for that, the only citable figure is the " +
  "Total DTUs fact above, exactly as stated; do not reconcile it against any other number.";

const CONTEXT_COUNT_RULE =
  "Counts of DTUs retrieved or harvested as conversation context are NOT account totals — " +
  "never quote one as how many DTUs the user has.";

/** Format collected facts as the system-prompt grounding block. */
export function formatGroundingBlock(facts, unreadable) {
  if (!facts || facts.length === 0) {
    return [
      "ACCOUNT FACTS — Analytics could not be read just now (the live surface did not answer).",
      "Rule: if the user asks about this account's values (DTU counts, citations, followers, reach, totals), " +
        "say the surface doesn't give you that right now — never estimate or invent a number.",
      CONTEXT_COUNT_RULE,
    ].join("\n");
  }
  const lines = [
    "ACCOUNT FACTS — Analytics, read live from the Analytics surface just now. " +
      "These are the account's real values; they override any examples, placeholders, " +
      "or numbers mentioned earlier in this conversation:",
    ...facts.map((f) => `- ${f.label}: ${f.value} (source: ${f.source})`),
  ];
  if (unreadable && unreadable.length > 0) {
    lines.push(
      `Not readable just now: ${unreadable.join("; ")}. ` +
        "If asked about those, say the surface doesn't give you that right now.",
    );
  }
  lines.push(DECLINE_RULE);
  return lines.join("\n");
}

/**
 * Build the grounding block for one chat turn. Returns '' when there is no
 * signed-in user to ground (anonymous chat proceeds exactly as before).
 * Never throws.
 */
export async function buildAnalyticsGroundingBlock(deps) {
  if (!deps?.userId) return "";
  let result;
  try {
    result = await collectAnalyticsFacts(deps);
  } catch {
    result = { facts: [], unreadable: ["the lens account data"] };
  }
  return formatGroundingBlock(result.facts, result.unreadable);
}
