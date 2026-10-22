/**
 * Share a listing or a studio asset into the canonical social store.
 * Prices and fee rates are copied from the listing row and economy/fees.js.
 * Studio audio files served by GET /api/studio/audio are owner-only, so a
 * post gets a playable URL only when the asset already has an https URL.
 */
import { FEES } from "../economy/fees.js";
import { userOwnsListing, createPost, canonicalSocial } from "../emergent/social-layer.js";

const LISTING_TABLES = ["marketplace_listings", "marketplace_economy_listings"];
const LISTING_FIELDS = ["title", "price", "price_cents", "currency"];

function columnsOf(db, table) {
  try {
    return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name));
  } catch {
    return new Set();
  }
}

export function feeSchedule() {
  return {
    transferRate: FEES.TRANSFER,
    marketplaceRate: FEES.MARKETPLACE_PURCHASE,
  };
}

export function readOwnedListing(db, userId, listingId) {
  if (!db || typeof db.prepare !== "function" || !userOwnsListing(db, userId, listingId)) return null;
  for (const table of LISTING_TABLES) {
    const cols = columnsOf(db, table);
    if (!cols.has("id")) continue;
    const ownerCol = cols.has("owner_user_id") ? "owner_user_id" : (cols.has("seller_id") ? "seller_id" : null);
    if (!ownerCol) continue;
    const fields = ["id", ...LISTING_FIELDS.filter((name) => cols.has(name))];
    try {
      const row = db.prepare(`SELECT ${fields.join(", ")} FROM ${table} WHERE id = ? AND ${ownerCol} = ?`).get(listingId, userId);
      if (!row) continue;
      const listing = { id: String(row.id), title: row.title ? String(row.title) : null, ...feeSchedule() };
      if (typeof row.price === "number" && Number.isFinite(row.price)) listing.price = row.price;
      if (typeof row.price_cents === "number" && Number.isFinite(row.price_cents)) listing.priceCents = row.price_cents;
      if (row.currency) listing.currency = String(row.currency);
      return listing;
    } catch { /* this table's shape does not match */ }
  }
  return { id: String(listingId), title: null, ...feeSchedule() };
}

export function shareListing(STATE, { userId, listingId, content } = {}) {
  if (!userId || !listingId) return { ok: false, status: 400, error: "listingId required" };
  const db = STATE?.db;
  if (!userOwnsListing(db, userId, listingId)) {
    return { ok: false, status: 403, error: "You do not own this listing" };
  }
  const listing = readOwnedListing(db, userId, listingId);
  const text = String(content || listing?.title || "Shared a listing").slice(0, 2000);
  const made = createPost(STATE, { userId, content: text, mediaType: "listing", privacy: "public" });
  if (!made.ok) return made;
  const stored = canonicalSocial(STATE).posts.get(made.post.id);
  if (stored) stored.listing = listing;
  return { ok: true, post: { ...made.post, listing, mediaType: "listing" }, listing };
}

export function shareStudioAsset(STATE, { userId, projectId, assetId, content } = {}) {
  const db = STATE?.db;
  if (!userId || !projectId || !assetId) return { ok: false, status: 400, error: "projectId and assetId required" };
  if (!db || typeof db.prepare !== "function") return { ok: false, status: 503, error: "database unavailable" };
  let project;
  let asset;
  try {
    project = db.prepare("SELECT project_id, name, created_by FROM route_studio_projects WHERE project_id = ?").get(projectId);
    asset = db.prepare(
      "SELECT asset_id, name, mime_type, artifact_id, added_by FROM route_studio_assets WHERE asset_id = ? AND project_id = ?",
    ).get(assetId, projectId);
  } catch {
    return { ok: false, status: 404, error: "studio tables are not available" };
  }
  if (!project || !asset) return { ok: false, status: 404, error: "asset not found" };
  if (project.created_by !== userId && asset.added_by !== userId) {
    return { ok: false, status: 403, error: "You do not own this studio asset" };
  }
  const artifact = typeof asset.artifact_id === "string" ? asset.artifact_id : "";
  const publicUrl = /^https:\/\//i.test(artifact) ? artifact : null;
  const audio = !!(publicUrl && /^audio\//i.test(String(asset.mime_type || "")));
  const text = String(content || `Shared ${asset.name} from ${project.name}`).slice(0, 2000);
  const made = createPost(STATE, {
    userId,
    content: text,
    mediaType: audio ? "audio" : "text",
    mediaUrl: audio ? publicUrl : null,
    privacy: "public",
  });
  if (!made.ok) return made;
  return {
    ok: true,
    post: made.post,
    studio: {
      projectId,
      assetId,
      name: asset.name,
      audioUrl: audio ? publicUrl : null,
    },
  };
}
