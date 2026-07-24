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
