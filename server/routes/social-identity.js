/**
 * Social identity routes (job oc-social-5, Social identity / JOB 8).
 *
 * A route-override module like server/routes/social-core.js: mounted
 * through the existing registration (createSocialEngagementRoutes mounts
 * this router at /api/social BEFORE social-core, so these handlers win
 * over both social-core and the inline server.js handlers for the same
 * method+path). server.js itself is never touched.
 *
 * Overrides of existing paths (registered ahead of social-core):
 *   POST /api/social/profile        — same save path, plus a validated
 *                                      `accent` key (400 + clear message
 *                                      when the contrast check fails)
 *   GET  /api/social/profile/:userId — same profile read, enriched with
 *                                      the identity fields (accent,
 *                                      sanitized profileTrack,
 *                                      per-viewer sanitized showcase)
 *
 * New paths (owner-only writes; reads re-sanitized per viewer):
 *   GET    /api/social/identity/track-options
 *   POST   /api/social/identity/track
 *   GET    /api/social/identity/showcase/options
 *   POST   /api/social/identity/showcase/pin
 *   DELETE /api/social/identity/showcase/:kind/:id
 *   POST   /api/social/identity/showcase/reorder
 */
import { Router } from "express";
import { getProfile, upsertProfile } from "../emergent/social-layer.js";
import {
  listTrackOptions,
  setProfileAccent,
  setProfileTrack,
  pinToShowcase,
  unpinFromShowcase,
  reorderShowcase,
  showcaseOptions,
  identityForViewer,
  accentContrast,
  normalizeHex,
  ACCENT_MIN_CONTRAST,
} from "../lib/social-identity.js";

function stateOf() {
  return globalThis._concordSTATE || null;
}

function asAuth(requireAuth) {
  if (typeof requireAuth !== "function") {
    return (_req, res) => res.status(401).json({ ok: false, error: "auth required" });
  }
  return requireAuth();
}

function sendLayer(res, result, okStatus = 200) {
  if (!result || result.ok === false) {
    const status = Number.isInteger(result?.status) ? result.status : 400;
    return res.status(status).json(result || { ok: false, error: "failed" });
  }
  return res.status(okStatus).json(result);
}

function sessionUserId(req) {
  return req.user?.id || req.actor?.userId || null;
}

export default function createSocialIdentityRoutes({ db, requireAuth }) {
  const router = Router();
  const auth = asAuth(requireAuth);

  // ── POST /profile — the existing profile-settings save path, plus the
  // accent key. The upsert allowlist in the social layer is untouched;
  // accent is applied explicitly here after the same validation the
  // picker runs client-side. All-or-nothing: an accent that fails the
  // contrast check fails the whole save with 400 BEFORE anything is
  // written (the check is pure math — it doesn't need the profile to
  // exist yet, so first-save with an accent works).
  router.post("/profile", auth, (req, res) => {
    const userId = sessionUserId(req);
    if (!userId || userId === "anon") {
      return res.status(401).json({ ok: false, error: "auth required" });
    }
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const body = req.body && typeof req.body === "object" ? req.body : {};

    if ("accent" in body && body.accent != null && body.accent !== "") {
      const hex = normalizeHex(body.accent);
      if (!hex) {
        return res.status(400).json({ ok: false, error: "Accent must be a hex colour like #14b8a6." });
      }
      const ratio = accentContrast(hex);
      if (ratio === null || ratio < ACCENT_MIN_CONTRAST) {
        return res.status(400).json({
          ok: false,
          error: `Accent needs at least ${ACCENT_MIN_CONTRAST}:1 contrast against the dark profile surface${ratio !== null ? ` (currently ${ratio.toFixed(2)}:1)` : ""}. Pick a brighter colour.`,
        });
      }
    }

    try {
      const result = upsertProfile(STATE, userId, body);
      if (!result?.ok) return sendLayer(res, result);
      if ("accent" in body) {
        // null/'' clears the accent; the non-empty value was validated
        // above (upsert just guaranteed the profile record exists).
        const accentResult = setProfileAccent(STATE, userId, body.accent == null || body.accent === "" ? null : body.accent);
        if (!accentResult.ok) return sendLayer(res, accentResult);
      }
      return res.json({ ...result, accent: result.profile?.accent || null });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || "profile save failed" });
    }
  });

  // ── GET /profile/:userId — the profile read every Social surface uses,
  // enriched with the identity fields. Same base shape and privacy
  // projection as the social-core route it replaces (getProfile runs
  // profileForViewer: a stranger never sees private settings or email).
  router.get("/profile/:userId", auth, (req, res) => {
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const viewerId = sessionUserId(req);
    const result = getProfile(STATE, req.params.userId, viewerId);
    if (!result?.ok) return sendLayer(res, result);
    const identity = identityForViewer(STATE, req.params.userId, viewerId, db || STATE.db);
    result.profile.accent = identity.accent;
    result.profile.profileTrack = identity.profileTrack;
    result.profile.showcase = identity.showcase;
    return res.json(result);
  });

  // ── Profile track ─────────────────────────────────────────────────────

  // The caller's own published Studio-track listings with a preview
  // stream — there is no userId param to snoop.
  router.get("/identity/track-options", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, listTrackOptions(STATE, userId, db || STATE.db));
  });

  // Set (body.listingId) or clear (body.listingId null) the caller's
  // profile track. The track must be the caller's own active listing.
  router.post("/identity/track", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    sendLayer(res, setProfileTrack(STATE, userId, body.listingId ?? null, db || STATE.db));
  });

  // ── Showcase ──────────────────────────────────────────────────────────

  // The caller's own pinnable public creations.
  router.get("/identity/showcase/options", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, showcaseOptions(STATE, userId, db || STATE.db));
  });

  router.post("/identity/showcase/pin", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    sendLayer(res, pinToShowcase(STATE, userId, { kind: body.kind, id: body.id }, db || STATE.db));
  });

  router.delete("/identity/showcase/:kind/:id", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    sendLayer(res, unpinFromShowcase(STATE, userId, { kind: req.params.kind, id: req.params.id }));
  });

  router.post("/identity/showcase/reorder", auth, (req, res) => {
    const userId = sessionUserId(req);
    const STATE = stateOf();
    if (!STATE) return res.status(503).json({ ok: false, error: "state unavailable" });
    const body = req.body && typeof req.body === "object" ? req.body : {};
    sendLayer(res, reorderShowcase(STATE, userId, Array.isArray(body.order) ? body.order : null));
  });

  return router;
}