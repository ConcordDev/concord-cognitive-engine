// server/lib/actor-identity.js
//
// The acting account on a write is the signed-in account, never a request field.
//
// SECURITY (2026-11-19, found during the Art lens audit and confirmed live):
// a set of older routes read WHO IS ACTING from the request body instead of
// the session. The worst, POST /api/economic/marketplace/buy, debited the
// account named in `body.odId`: signed in as anyone, a caller listed an item
// and "bought" it as a victim, moving the victim's Concord Coin to themselves
// (reproduced on a dev server: victim 88 CC -> 83 CC, no action of theirs).
// The same class sat on listing creation, rights transfers, billing keys,
// artistry projects and several frontier routes. Two routes had been fixed one
// at a time before (routes/connective-tissue.js requireSelf,
// routes/creative-marketplace.js); this closes the class in one place.
//
// Rule: on a write to a listed route, any listed ACTOR field present in the
// body or query must equal req.user.id, or the request is refused (403) before
// the handler runs. Refusing, not rewriting: a mismatch is either a bug or an
// attack, and both should be loud. With no signed-in user the request is
// refused (401), except in AUTH_MODE=public, the single-user local mode where
// there is no session by design (the same exception requireSelf documents).
//
// Only fields that mean "the account doing this" are listed. Fields that name
// a target (a tip's recipient, a role being assigned, a follow target) are
// deliberately left alone.

import { lensRunParams } from "./lens-input-normalize.js";

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const ACTOR_RULES = [
  { re: /^\/api\/economic\/(?!webhook$)/, fields: ["odId"] },
  { re: /^\/api\/realm\//, fields: ["odId"] },
  { re: /^\/api\/(artistry|creative-commerce)\//, fields: ["ownerId", "userId", "buyerId", "hostId", "followerId", "remixerId"] },
  { re: /^\/api\/atlas\/rights\/transfer$/, fields: ["fromUserId"] },
  { re: /^\/api\/canonical\/[^/]+\/rights\/transfer$/, fields: ["fromUserId"] },
  { re: /^\/api\/billing\//, fields: ["userId"] },
  { re: /^\/api\/creative-marketplace\/artifacts\/[^/]+\/purchase$/, fields: ["buyerId"] },
  { re: /^\/api\/(ct|connective-tissue)\/dtu\/purchase$/, fields: ["buyerId"] },
  { re: /^\/api\/(fabrication\/export|sensors\/devices|blockchain\/notarize|shell\/execute|notebooks|marketplace\/(listings|orders|reviews)|certificates\/(enroll|progress)|agents)$/, fields: ["userId"] },
  { re: /^\/api\/legal\/(disclaimers\/acknowledge|agreements)$/, fields: ["userId"] },
  // One-tap purchase debits the ledger balance of body.userId (economy/lens-culture.js
  // oneTapPurchase -> purchaseArtifact({ buyerId: userId })). The route also takes the
  // buyer from the session now; this keeps a spoofed userId loud (403) rather than ignored.
  { re: /^\/api\/lens-culture\/purchase$/, fields: ["userId"] },
];

/**
 * The path the rules are tested against. Express routes case-insensitively and
 * ignores a trailing slash by default (server.js sets neither "case sensitive
 * routing" nor "strict routing"), so `/api/Economic/marketplace/buy` and
 * `/api/atlas/rights/transfer/` reach the same handlers as the canonical paths.
 * Match on the same normalised form, or the guard can be bypassed by casing.
 */
export function normalisePath(path) {
  const p = String(path || "").toLowerCase().replace(/\/+$/, "");
  return p || "/";
}

// ── The lens dispatch: POST /api/lens/run and POST /api/lens/:domain/:id/run ──
//
// SECURITY (2026-11-28, confirmed live with two accounts): the REST rules above
// never covered the lens dispatch, where ~10,000 macros run. Many of them took
// the acting user from the request first (`input.userId || ctx.actor.userId`),
// so a signed-in caller could read and write another account's records by
// naming its id (conkay.affect_state / conkay.observe reproduced on a dev
// server; video's YouTube actions used params.userId outright). Those sites now
// read the session first; this makes a spoofed id loud (403) here as well.
//
// The actor id arrives inside the action's input, not at the top of the body:
// `{ domain, name|action, input: {...} }`, the legacy flat `{ domain, action, ...fields }`,
// a redundant `{ artifact: { data } }` wrapper (peeled by lensRunParams, the
// same function the route uses), and the generic lens.run shape, whose action
// fields sit one level down under `params`.
//
// Rule: any LENS_ACTOR_FIELDS value in the peeled input (or its `params`) must
// equal the signed-in user, unless that domain.action reads the field as a
// TARGET — someone else on purpose (follow, block, share, invite, an admin
// acting on an account). Those are listed in LENS_TARGET_FIELDS, each reviewed
// against its handler; scripts/scan-lens-actor-fields.mjs finds every action
// that reads one of these fields, and tests/lens-run-actor-identity.test.js
// fails if a target read appears that is not listed (or a listed one stops
// reading it). Deny by default: an unlisted target action fails loudly with 403
// instead of quietly letting a caller act as someone else.

export const LENS_ACTOR_FIELDS = Object.freeze(["userId", "ownerId", "actorId", "playerId"]);

export const LENS_TARGET_FIELDS = Object.freeze({
  // viewing someone (handlers apply their own visibility)
  "social.profile": ["userId"],
  "timeline.profile-get": ["userId"],
  "timeline.album-list": ["ownerId"],
  "reels.list_by_user": ["userId"],
  "questmarket.achievementShowcase": ["userId"],
  "understanding.promoted_by_composer": ["userId"],
  "dtu.citation-graph": ["userId"],
  "economy.royaltyFlow": ["userId"], // only narrows a DTU-scoped view; the no-DTU view is always the caller's
  "combat_polish.state_for_actor": ["actorId"],
  "skill_tree.for_actor": ["actorId"],
  "shard.route": ["userId"], // which shard holds an account (internal routing)
  // acting on someone (block, mute, report)
  "social.mute": ["userId"], "social.block": ["userId"], "social.report": ["userId"],
  "timeline.user-block": ["userId"], "timeline.user-unblock": ["userId"],
  "timeline.user-mute": ["userId"], "timeline.user-unmute": ["userId"],
  "feed.controls-block-user": ["userId"],
  // sharing, inviting, roles (the handler checks the caller owns or runs the space)
  "board.collaborator-add": ["userId"], "board.collaborator-remove": ["userId"],
  "collab.setPermission": ["userId"], "collab.room-member-remove": ["userId"],
  "foundry.collab_add": ["userId"], "foundry.collab_remove": ["userId"],
  "philosophy.channel-collaborator-add": ["userId"], "philosophy.channel-collaborator-remove": ["userId"],
  "pets.access-grant": ["userId"],
  "land_claims.invite": ["userId"],
  "lab.org-set-role": ["userId"],
  "command-center.teamSetRole": ["userId"],
  "spaces.promote": ["userId"],
  // admin only (the handler checks the role)
  "admin.tenantAction": ["userId"],
  "jobs.set_demographic": ["userId"],
  "fishing.catches": ["userId"],
  "governor.configure": ["userId"],
});

const LENS_RUN_RE = /^\/api\/lens\/run$/;
const LENS_ARTIFACT_RUN_RE = /^\/api\/lens\/([^/]+)\/[^/]+\/run$/;

function lensClaims(p, body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  let domain, action, bags;
  if (LENS_RUN_RE.test(p)) {
    const r = lensRunParams(b);
    domain = r.domain; action = r.action;
    bags = [["input", r.rest], ["input.params", r.rest?.params]];
  } else {
    const m = LENS_ARTIFACT_RUN_RE.exec(p);
    if (!m) return [];
    domain = m[1]; action = b.action;
    bags = [["body", b], ["body.params", b.params]];
  }
  // generic lens.run on an artifact by id: the artifact's domain is unknown here, so no target exemption applies
  const allowed = new Set(domain === "lens" && action === "run" ? [] : (LENS_TARGET_FIELDS[`${domain}.${action}`] || []));
  const out = [];
  for (const [src, bag] of bags) {
    if (!bag || typeof bag !== "object" || Array.isArray(bag)) continue;
    for (const f of LENS_ACTOR_FIELDS) {
      if (allowed.has(f)) continue;
      const v = bag[f];
      if ((typeof v === "string" && v !== "") || typeof v === "number") out.push({ field: f, source: src, value: String(v) });
    }
  }
  return out;
}

/** The actor fields a request carries for its route, with the claimed values. */
export function claimedActors(method, path, body, query) {
  if (!WRITE.has(String(method).toUpperCase())) return [];
  const p = normalisePath(path);
  const out = lensClaims(p, body);
  for (const rule of ACTOR_RULES) {
    if (!rule.re.test(p)) continue;
    for (const f of rule.fields) {
      for (const [src, bag] of [["body", body], ["query", query]]) {
        const v = bag && typeof bag === "object" ? bag[f] : undefined;
        if (v !== undefined && v !== null && v !== "") out.push({ field: f, source: src, value: String(v) });
      }
    }
  }
  return out;
}

/** Express middleware. Mount after authentication so req.user is resolved. */
export function actorIdentityGuard({ authMode = "hybrid" } = {}) {
  return function pinActorIdentity(req, res, next) {
    const claims = claimedActors(req.method, req.path, req.body, req.query);
    if (!claims.length) return next();
    const me = req.user?.id ? String(req.user.id) : null;
    if (!me) {
      if (authMode === "public") return next();
      return res.status(401).json({ ok: false, error: "auth_required", message: "Sign in to do that." });
    }
    const wrong = claims.find((c) => c.value !== me);
    if (wrong) {
      return res.status(403).json({ ok: false, error: "not_your_account", message: `${wrong.field} must be your own account.` });
    }
    next();
  };
}
