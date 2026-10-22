// Studio marketplace publish.
// Lists a rendered master through the existing economy marketplace.
// Paid sales debit Concord balance (coins bought via the existing Stripe
// checkout). The fee is calculateFee("MARKETPLACE_PURCHASE"), which is
// FEES.MARKETPLACE_PURCHASE plus UNIVERSAL_FEE_RATE. This module does not
// invent a rate or a second checkout.

import { calculateFee, FEES, UNIVERSAL_FEE_RATE } from "./fees.js";
import { authRequired } from "./guards.js";
import { createListing, getListing } from "./marketplace-service.js";
import { retrieveArtifact } from "../lib/artifact-store.js";

const LICENSES = ["personal", "nonexclusive", "exclusive", "cc-by"];
const LICENSE_SET = new Set(LICENSES);
const MIN_PAID = 0.01;
const MAX_PRICE = 1_000_000;

export function studioTerms() {
  const sample = calculateFee("MARKETPLACE_PURCHASE", 100);
  return {
    ok: true,
    currency: "concord_coins",
    paidSales: true,
    paymentPath: "concord_balance",
    marketplaceFeeRate: FEES.MARKETPLACE_PURCHASE,
    universalFeeRate: UNIVERSAL_FEE_RATE,
    combinedRate: sample.rate,
    exampleAmount: 100,
    exampleFee: sample.fee,
    exampleNet: sample.net,
    minPaidPrice: MIN_PAID,
    maxPrice: MAX_PRICE,
    licenses: LICENSES,
    note: "Buyers pay from their Concord balance. Concord coins are purchased through the existing checkout. The fee is the marketplace rate plus the universal transaction rate already defined by the economy.",
  };
}

export function publishStudioTrack(db, { sellerId, body = {} }) {
  const title = String(body.title || "").trim();
  const artist = String(body.artist || "").trim();
  const genre = String(body.genre || "").trim();
  const license = String(body.license || "");
  const masterId = String(body.masterArtifactId || body.master_artifact_id || "").trim();
  const previewId = String(body.previewArtifactId || body.preview_artifact_id || "").trim();
  const coverId = String(body.coverArtifactId || body.cover_artifact_id || "").trim();
  const price = Number(body.price);
  const bpm = body.bpm == null || body.bpm === "" ? null : Number(body.bpm);
  const musicalKey = body.key || body.musicalKey || null;

  if (!sellerId) return fail(401, "auth_required");
  if (!title) return fail(400, "missing_title");
  if (!artist) return fail(400, "missing_artist");
  if (!LICENSE_SET.has(license)) return fail(400, "invalid_license");
  if (!masterId) return fail(400, "master_not_found");
  if (!previewId) return fail(400, "missing_preview");
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) return fail(400, "invalid_price");
  const rounded = Math.round(price * 100) / 100;
  if (price > 0 && (rounded < MIN_PAID || rounded === 0)) return fail(400, "invalid_price");

  const master = loadOwnedDtu(db, masterId, sellerId, "master_not_found");
  if (!master.ok) return master;
  const preview = loadOwnedDtu(db, previewId, sellerId, "preview_not_found");
  if (!preview.ok) return preview;
  if (coverId) {
    const cover = loadOwnedDtu(db, coverId, sellerId, "cover_not_found");
    if (!cover.ok) return cover;
  }

  const hashSource = master.dtu?.machine?.verifier?.hash || master.dtu?.artifact?.hash || masterId;
  const previewData = {
    artist,
    genre: genre || null,
    bpm: Number.isFinite(bpm) ? bpm : null,
    key: musicalKey,
    musicalKey,
    coverArtifactId: coverId || null,
    previewArtifactId: previewId,
    masterArtifactId: masterId,
    tempoChanges: !!body.tempoChanges,
    license,
  };

  const listed = createListing(db, {
    sellerId,
    contentId: masterId,
    contentType: "music",
    title,
    description: [artist, genre].filter(Boolean).join(" · "),
    price: rounded,
    contentData: String(hashSource),
    licenseType: license,
    previewData,
    royaltyChain: [],
  });
  if (!listed.ok) return { status: 400, body: listed };
  const listing = getListing(db, listed.listing.id);
  return {
    status: 200,
    body: {
      ok: true,
      listing,
      path: `/lenses/marketplace/music/${listed.listing.id}`,
      terms: studioTerms(),
    },
  };
}

export function readListingMedia(db, { listingId, kind, userId }) {
  const listing = getListing(db, listingId);
  if (!listing) return fail(404, "listing_not_found");
  const preview = listing.preview && !Array.isArray(listing.preview) ? listing.preview : null;
  if (kind === "preview" || kind === "cover") {
    if (listing.status !== "active") return fail(404, "listing_not_active");
    const artifactId = kind === "cover" ? preview?.coverArtifactId : preview?.previewArtifactId;
    if (!artifactId) return fail(404, kind === "cover" ? "cover_missing" : "preview_missing");
    return loadArtifactBytes(db, artifactId);
  }
  if (kind !== "master") return fail(400, "unknown_media");
  const allowed = userId && userId === listing.sellerId
    || (Number(listing.price) === 0 && listing.status === "active")
    || (userId && hasFulfilledPurchase(db, listing.id, userId));
  if (!allowed) return fail(403, "master_locked");
  const artifactId = preview?.masterArtifactId || listing.contentId;
  return loadArtifactBytes(db, artifactId);
}

export function mountStudioMarketplaceRoutes(app, db) {
  app.get("/api/economy/marketplace/studio-terms", (_req, res) => {
    res.json(studioTerms());
  });

  app.post("/api/economy/marketplace/studio-publish", authRequired, (req, res) => {
    try {
      const result = publishStudioTrack(db, { sellerId: req.user?.id, body: req.body || {} });
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(500).json({ ok: false, error: "studio_publish_failed", detail: err?.message });
    }
  });

  const media = (kind) => (req, res) => {
    try {
      const result = readListingMedia(db, {
        listingId: req.params.listingId,
        kind,
        userId: req.user?.id || null,
      });
      if (!result.ok) return res.status(result.status).json(result.body);
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(result.bytes);
    } catch (err) {
      res.status(500).json({ ok: false, error: "listing_media_failed", detail: err?.message });
    }
  };

  app.get("/api/economy/marketplace/listings/:listingId/preview", media("preview"));
  app.get("/api/economy/marketplace/listings/:listingId/cover", media("cover"));
  app.get("/api/economy/marketplace/listings/:listingId/master", media("master"));
}

function fail(status, error) {
  return { ok: false, status, body: { ok: false, error } };
}

function loadOwnedDtu(db, id, sellerId, missingError) {
  let row;
  try {
    row = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(id);
  } catch {
    return fail(400, missingError);
  }
  if (!row?.data) return fail(400, missingError);
  let dtu;
  try { dtu = JSON.parse(row.data); } catch { return fail(400, missingError); }
  const owner = dtu.ownerId || dtu.createdBy || dtu.authorId || dtu.meta?.ownerId || dtu.meta?.createdBy || null;
  if (owner && owner !== sellerId) return fail(403, "not_owner");
  return { ok: true, dtu };
}

function loadArtifactBytes(db, artifactId) {
  let row;
  try {
    row = db.prepare("SELECT data FROM dtu_store WHERE id = ?").get(artifactId);
  } catch {
    return fail(404, "file_missing");
  }
  if (!row?.data) return fail(404, "file_missing");
  let dtu;
  try { dtu = JSON.parse(row.data); } catch { return fail(404, "file_missing"); }
  const artifact = dtu.artifact;
  if (!artifact?.diskPath) return fail(404, "file_missing");
  const bytes = retrieveArtifact(artifactId, artifact);
  if (!bytes) return fail(404, "file_missing");
  const mime = typeof artifact.type === "string" && artifact.type.includes("/") ? artifact.type : "application/octet-stream";
  return { ok: true, bytes, mime };
}

function hasFulfilledPurchase(db, listingId, buyerId) {
  try {
    const row = db.prepare(
      "SELECT 1 AS ok FROM purchases WHERE listing_id = ? AND buyer_id = ? AND status = 'FULFILLED' LIMIT 1"
    ).get(listingId, buyerId);
    return !!row;
  } catch {
    return false;
  }
}
