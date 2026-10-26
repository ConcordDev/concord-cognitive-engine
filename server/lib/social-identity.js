/**
 * Social identity helpers (job oc-social-5, Social identity / JOB 8).
 *
 * Everything a profile owns for identity lives on the canonical social
 * profile record and persists through the existing payload_json snapshot
 * (social-persist.js writes the whole profile object, so new keys survive
 * restarts — no migration needed):
 *   - accent: user-picked #rrggbb, validated for WCAG contrast against
 *     the dark Social surface behind the avatar ring (#12121a — the
 *     profile card's --lattice-surface). Enforced here so a hostile
 *     client can never store an unreadable accent.
 *   - profileTrack: ONE of the owner's own published Studio-track
 *     marketplace listings (active, with a public /preview stream). The
 *     master stream is never referenced anywhere.
 *   - showcase: up to 6 ordered pins of the owner's own PUBLIC creations
 *     (public posts with media, active marketplace listings). Reads are
 *     re-sanitized per viewer on EVERY fetch — a pin whose target has
 *     since become private, followers-only, blocked, expired, or deleted
 *     is filtered out server-side before the response leaves.
 *
 * No emails or private settings ever leave through these helpers, and a
 * non-owner can never write someone else's identity.
 */
import { canonicalSocial, canViewPost, getPost } from "../emergent/social-layer.js";
import { scheduleSocialFlush } from "./social-persist.js";
import { getListing } from "../economy/marketplace-service.js";

/** The dark Social surface behind the avatar ring (frontend --lattice-surface). */
export const SOCIAL_SURFACE_HEX = "#12121a";
/** WCAG AA bar for the accent. */
export const ACCENT_MIN_CONTRAST = 4.5;
/** Hard cap on Showcase pins. */
export const SHOWCASE_MAX = 6;

// ── Accent (WCAG contrast, mirrored from lib/social/contrast.ts) ───────────

export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

function hexToRgb(hex) {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  return [parseInt(norm.slice(1, 3), 16), parseInt(norm.slice(3, 5), 16), parseInt(norm.slice(5, 7), 16)];
}

function channelLuminance(value) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function contrastRatio(foreground, background) {
  const a = hexToRgb(foreground);
  const b = hexToRgb(background);
  if (!a || !b) return null;
  const lum = (rgb) => 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2]);
  const l1 = lum(a);
  const l2 = lum(b);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

export function accentContrast(hex) {
  return contrastRatio(hex, SOCIAL_SURFACE_HEX);
}

/**
 * Set (or clear) the owner's accent. Refuses non-hex values and anything
 * under 4.5:1 contrast with a clear message — the same math the picker
 * runs client-side.
 */
export function setProfileAccent(STATE, userId, accentInput) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };

  if (accentInput == null || accentInput === "") {
    delete profile.accent;
    profile.updatedAt = new Date().toISOString();
    scheduleSocialFlush(STATE);
    return { ok: true, accent: null };
  }

  const hex = normalizeHex(accentInput);
  if (!hex) {
    return { ok: false, status: 400, error: "Accent must be a hex colour like #14b8a6." };
  }
  const ratio = accentContrast(hex);
  if (ratio === null || ratio < ACCENT_MIN_CONTRAST) {
    return {
      ok: false,
      status: 400,
      error: `Accent needs at least ${ACCENT_MIN_CONTRAST}:1 contrast against the dark profile surface${ratio !== null ? ` (currently ${ratio.toFixed(2)}:1)` : ""}. Pick a brighter colour.`,
    };
  }
  profile.accent = hex;
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, accent: hex };
}

// ── Profile track ──────────────────────────────────────────────────────────

function tryGetListing(db, listingId) {
  if (!db || typeof db.prepare !== "function" || !listingId) return null;
  try {
    return getListing(db, listingId);
  } catch {
    return null;
  }
}

function listingPreview(listing) {
  const preview = listing && !Array.isArray(listing.preview) && typeof listing.preview === "object" ? listing.preview : null;
  return preview;
}

/**
 * The owner's own published Studio-track listings that have a public
 * /preview stream — the only honest picker options for the profile track.
 */
export function listTrackOptions(STATE, userId, db) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  let options = [];
  try {
    if (db && typeof db.prepare === "function") {
      const rows = db
        .prepare(
          "SELECT id, title, preview_data FROM marketplace_economy_listings WHERE seller_id = ? AND status = 'active' AND content_type = 'music' ORDER BY created_at DESC LIMIT 50",
        )
        .all(userId);
      options = rows
        .map((row) => {
          let preview = null;
          try {
            preview = row.preview_data ? JSON.parse(row.preview_data) : null;
          } catch {
            preview = null;
          }
          return { listingId: row.id, title: row.title, artist: preview?.artist || null, genre: preview?.genre || null, previewArtifactId: preview?.previewArtifactId || null };
        })
        .filter((row) => !!row.previewArtifactId)
        .map(({ listingId, title, artist, genre }) => ({ listingId, title, artist, genre }));
    }
  } catch {
    options = [];
  }
  return { ok: true, options };
}

/**
 * Set (or clear) the profile track. The track MUST be the owner's own
 * published (active) Studio-track listing with a preview stream —
 * anything else is refused.
 */
export function setProfileTrack(STATE, userId, listingId, db) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };

  if (listingId == null || listingId === "") {
    delete profile.profileTrack;
    profile.updatedAt = new Date().toISOString();
    scheduleSocialFlush(STATE);
    return { ok: true, track: null };
  }

  const listing = tryGetListing(db, String(listingId));
  if (!listing) return { ok: false, status: 404, error: "Listing not found" };
  if (listing.sellerId !== userId) {
    return { ok: false, status: 403, error: "You can only feature your own tracks." };
  }
  if (listing.status !== "active") {
    return { ok: false, status: 400, error: "Only a published (active) listing can be the profile track." };
  }
  const preview = listingPreview(listing);
  if (!preview?.previewArtifactId) {
    return { ok: false, status: 400, error: "That listing has no public preview stream." };
  }

  profile.profileTrack = {
    listingId: listing.id,
    title: listing.title || "",
    artist: preview.artist || null,
    genre: preview.genre || null,
    addedAt: new Date().toISOString(),
  };
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, track: trackForViewer(profile, db) };
}

/**
 * The track as a given viewer should see it: re-validated on every read —
 * an unpublished or delisted track disappears rather than leaking a dead
 * stream. Playback is the listing's PUBLIC /preview stream, never /master.
 */
export function trackForViewer(profile, db) {
  const stored = profile?.profileTrack;
  if (!stored?.listingId) return null;
  const listing = tryGetListing(db, stored.listingId);
  if (!listing) return null;
  if (listing.sellerId !== profile.userId || listing.status !== "active") return null;
  const preview = listingPreview(listing);
  if (!preview?.previewArtifactId) return null;
  return {
    listingId: listing.id,
    title: listing.title || "",
    artist: preview.artist || null,
    genre: preview.genre || null,
    // Public preview stream only — /master stays owner/purchaser-gated.
    previewUrl: `/api/economy/marketplace/listings/${encodeURIComponent(listing.id)}/preview`,
  };
}

// ── Showcase shelf ─────────────────────────────────────────────────────────

function postHasMedia(post) {
  if (Array.isArray(post?.media) && post.media.length > 0) return true;
  return typeof post?.mediaUrl === "string" && post.mediaUrl.length > 0;
}

function pinKey(pin) {
  return `${pin.kind}:${pin.id}`;
}

function ensureShowcase(profile) {
  if (!Array.isArray(profile.showcase)) profile.showcase = [];
  return profile.showcase;
}

/** Pin one of the owner's own PUBLIC creations. Hard cap: SHOWCASE_MAX. */
export function pinToShowcase(STATE, userId, { kind, id }, db) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };

  const kindOf = String(kind || "");
  const idOf = String(id || "");
  if (!idOf) return { ok: false, status: 400, error: "id required" };

  if (kindOf === "post") {
    const post = social.posts.get(idOf);
    if (!post) return { ok: false, status: 404, error: "Post not found" };
    if (post.userId !== userId) {
      return { ok: false, status: 403, error: "You can only pin your own creations." };
    }
    if ((post.privacy || "public") !== "public") {
      return { ok: false, status: 400, error: "Only public posts can be pinned to the Showcase." };
    }
    if (!postHasMedia(post)) {
      return { ok: false, status: 400, error: "Only posts with media can be pinned to the Showcase." };
    }
    if (!canViewPost(userId, post, STATE)) {
      // Expired stories are invisible to everyone, author included.
      return { ok: false, status: 400, error: "That post can no longer be pinned." };
    }
  } else if (kindOf === "listing") {
    const listing = tryGetListing(db, idOf);
    if (!listing) return { ok: false, status: 404, error: "Listing not found" };
    if (listing.sellerId !== userId) {
      return { ok: false, status: 403, error: "You can only pin your own creations." };
    }
    if (listing.status !== "active") {
      return { ok: false, status: 400, error: "Only published listings can be pinned to the Showcase." };
    }
  } else {
    return { ok: false, status: 400, error: "kind must be post or listing" };
  }

  const showcase = ensureShowcase(profile);
  if (showcase.some((pin) => pinKey(pin) === `${kindOf}:${idOf}`)) {
    return { ok: false, status: 409, error: "Already pinned to the Showcase." };
  }
  if (showcase.length >= SHOWCASE_MAX) {
    return { ok: false, status: 400, error: `Showcase is full (max ${SHOWCASE_MAX}).` };
  }

  showcase.push({ kind: kindOf, id: idOf, pinnedAt: new Date().toISOString() });
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, count: showcase.length };
}

/** Remove a pin. 404 when it was never pinned (honest, not a silent no-op). */
export function unpinFromShowcase(STATE, userId, { kind, id }) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const showcase = ensureShowcase(profile);
  const key = `${String(kind || "")}:${String(id || "")}`;
  const index = showcase.findIndex((pin) => pinKey(pin) === key);
  if (index === -1) return { ok: false, status: 404, error: "Not pinned to the Showcase." };
  showcase.splice(index, 1);
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, count: showcase.length };
}

/** Reorder pins. The order must be an exact permutation of the current pins. */
export function reorderShowcase(STATE, userId, order) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const profile = social.profiles.get(userId);
  if (!profile) return { ok: false, status: 404, error: "Create a profile first" };
  const showcase = ensureShowcase(profile);
  if (!Array.isArray(order) || order.length !== showcase.length) {
    return { ok: false, status: 400, error: "order must list every Showcase item exactly once." };
  }
  const byKey = new Map(showcase.map((pin) => [pinKey(pin), pin]));
  const next = [];
  for (const entry of order) {
    const key = `${String(entry?.kind || "")}:${String(entry?.id || "")}`;
    const pin = byKey.get(key);
    if (!pin || next.includes(pin)) {
      return { ok: false, status: 400, error: "order must list every Showcase item exactly once." };
    }
    next.push(pin);
  }
  if (next.length !== showcase.length) {
    return { ok: false, status: 400, error: "order must list every Showcase item exactly once." };
  }
  profile.showcase = next;
  profile.updatedAt = new Date().toISOString();
  scheduleSocialFlush(STATE);
  return { ok: true, count: next.length };
}

/**
 * The Showcase a given viewer may see — re-sanitized on every read.
 * Posts go through the one read check every feed uses (canViewPost:
 * blocks both ways, author-always, followers-only, private, expiry,
 * deletion). Listings must still be published (active). Anything that
 * fails is dropped server-side, for every viewer including the author
 * (a deleted post is gone for everyone).
 */
export function showcaseForViewer(STATE, profile, viewerId, db) {
  const showcase = Array.isArray(profile?.showcase) ? profile.showcase : [];
  const items = [];
  for (const pin of showcase) {
    if (pin?.kind === "post") {
      const found = getPost(STATE, pin.id, viewerId);
      if (!found?.ok) continue;
      const post = found.post;
      items.push({
        kind: "post",
        id: post.id,
        content: post.content || post.body || "",
        title: post.title || null,
        mediaType: post.mediaType || null,
        mediaUrl: post.mediaUrl || null,
        media: Array.isArray(post.media) ? post.media : [],
        createdAt: post.createdAt || null,
      });
    } else if (pin?.kind === "listing") {
      const listing = tryGetListing(db, pin.id);
      if (!listing || listing.status !== "active") continue;
      items.push({
        kind: "listing",
        id: listing.id,
        title: listing.title || "",
        price: typeof listing.price === "number" ? listing.price : null,
      });
    }
  }
  return items;
}

/**
 * The owner's own pinnable creations: their public posts that carry
 * media, and their published (active) marketplace listings. Only things
 * that are already publicly visible — Studio projects (no visibility
 * flag) are never offered, and everything here belongs to the caller.
 */
export function showcaseOptions(STATE, userId, db) {
  if (!userId) return { ok: false, status: 401, error: "auth required" };
  const social = canonicalSocial(STATE);
  const pinned = new Set((social.profiles.get(userId)?.showcase || []).map(pinKey));
  const options = [];

  const posts = [];
  for (const post of social.posts.values()) {
    if (post?.userId !== userId) continue;
    if ((post.privacy || "public") !== "public") continue;
    if (!postHasMedia(post)) continue;
    if (!canViewPost(userId, post, STATE)) continue;
    posts.push(post);
  }
  posts.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  for (const post of posts.slice(0, 30)) {
    options.push({
      kind: "post",
      id: post.id,
      label: (post.title || post.content || post.body || "Post").slice(0, 60),
      detail: post.mediaType || null,
      alreadyPinned: pinned.has(`post:${post.id}`),
    });
  }

  try {
    if (db && typeof db.prepare === "function") {
      const rows = db
        .prepare("SELECT id, title, content_type FROM marketplace_economy_listings WHERE seller_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 30")
        .all(userId);
      for (const row of rows) {
        options.push({
          kind: "listing",
          id: row.id,
          label: (row.title || "Marketplace listing").slice(0, 60),
          detail: row.content_type || null,
          alreadyPinned: pinned.has(`listing:${row.id}`),
        });
      }
    }
  } catch {
    /* no listings table → no listing options */
  }

  return { ok: true, options };
}

/**
 * Identity enrichment for the profile response: accent (public data),
 * the re-validated track, and the per-viewer sanitized Showcase. Merged
 * onto the profileForViewer projection — private settings never enter
 * here because they were already stripped for non-owners.
 */
export function identityForViewer(STATE, userId, viewerId, db) {
  const stored = canonicalSocial(STATE).profiles.get(userId) || null;
  return {
    accent: typeof stored?.accent === "string" ? stored.accent : null,
    profileTrack: stored ? trackForViewer(stored, db) : null,
    showcase: stored ? showcaseForViewer(STATE, stored, viewerId, db) : [],
  };
}