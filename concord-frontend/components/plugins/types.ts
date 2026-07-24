/**
 * Shared types for the plugin gallery lens — the real
 * `/api/plugins/gallery/*` surface (`server/lib/plugin-gallery.js`), NOT the
 * older, unrelated `/api/plugins` emergent/developer-sdk loader that feeds
 * `components/world-lens/LensPluginSystem.tsx` (mounted in
 * `app/lenses/system/page.tsx`). Do not merge these two subsystems.
 *
 * Field-for-field mirror of `withLoadedFlag()`'s output in
 * `server/lib/plugin-gallery.js` — kept intentionally exhaustive so a future
 * reader can diff this file against the server source instead of guessing.
 */

export interface GalleryPluginRating {
  up: number;
  down: number;
}

/** One tier of a per-domain reputation ladder (server/lib/reputation-badges.js). */
export interface ReputationBadge {
  key: string;
  category: string;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
  label: string;
  threshold: number;
}

/** Deterministic 0..100 score for one reputation domain (server/domains/profile.js#reputation-summary). */
export interface ReputationDomainScore {
  domain: string;
  score: number;
}

/**
 * SDK-H — author identity/reputation for a gallery entry. Computed
 * server-side by `plugin-gallery.js#computeAuthorReputation`, which reuses
 * the REAL general reputation system — `profile.reputation-summary` (peer
 * view via `targetUserId`) + `reputation-badges.js#listBadges` — never a
 * parallel/invented one.
 *
 * This is a DIFFERENT trust signal from `trusted`/`trustDescription` below
 * (self-attested package signing) — see `AuthorBadge.tsx` for how the two
 * are rendered distinctly, never merged into one badge/boolean.
 */
export interface AuthorReputationSummary {
  authorId: string;
  /** The DB-backed lookup actually resolved (not the same as "has activity" — an honest zero also has `available: true`). */
  available: boolean;
  /** Any real citation/DTU/badge activity at all — drives the "no reputation history yet" honest-empty state. */
  hasActivity: boolean;
  totalCitations: number;
  dtuCount: number;
  worldsOwned: number;
  reputationDomains: ReputationDomainScore[];
  /** Every REAL badge this author has actually earned (may be empty). */
  badges: ReputationBadge[];
  /** The single highest-tier badge to headline, or null when none earned yet. */
  topBadge: ReputationBadge | null;
}

export interface GalleryPlugin {
  pluginId: string;
  authorId: string;
  name: string;
  description: string;
  version: string;
  /** Present only on the (stripped) server response as `undefined`; never sent to the client. */
  source?: undefined;
  signature: string | null;
  hash: string;
  /** Self-attested signature verification — see `trustDescription` for the honest gloss. */
  trusted: boolean;
  declaredMacros: string[] | null;
  publishedAt: string;
  installs: number;
  rating: GalleryPluginRating;
  loadedPluginId: string | null;
  delistedAt: string | null;
  delistedReason: string | null;
  delistedBy: string | null;
  /** The real manifest macro-domain grants this plugin is confined to at install time. */
  declaredCapabilities: string[];
  /** Plain-language gloss on `trusted` — self-attestation, not independent review. */
  trustDescription: string;
  /** Is this plugin's code actually running in this process right now? Only present when the server had a STATE handle to check against. */
  loaded?: boolean;
  /** Author identity/reputation (SDK-H) — see AuthorReputationSummary. Optional only for back-compat with older server responses / fixtures; the live route always sets it. */
  authorReputationSummary?: AuthorReputationSummary;
}

export interface GalleryListResponse {
  ok: true;
  plugins: GalleryPlugin[];
}

export interface GalleryErrorResponse {
  ok: false;
  error: string;
}

export interface InstallSuccessResponse {
  ok: true;
  loaded: boolean;
  freshLoad?: boolean;
  alreadyInstalled?: boolean;
  pluginId: string;
}

export interface InstallFailureResponse {
  ok: false;
  error: string;
  reason?: string | null;
  validation?: { errors?: string[] } | null;
}

export type InstallResponse = InstallSuccessResponse | InstallFailureResponse;

export interface RateSuccessResponse {
  ok: true;
  rating: GalleryPluginRating;
}

export interface RateFailureResponse {
  ok: false;
  error: string;
}

export type RateResponse = RateSuccessResponse | RateFailureResponse;
