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

/** The actor fields a request carries for its route, with the claimed values. */
export function claimedActors(method, path, body, query) {
  if (!WRITE.has(String(method).toUpperCase())) return [];
  const out = [];
  const p = normalisePath(path);
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
