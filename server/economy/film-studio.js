/**
 * Concord Film Studios — Service Layer
 *
 * Handles all film-specific business logic:
 *   - Film DTU creation (with media metadata)
 *   - Preview system (first-5-min, trailer-cut, creator-selected-segment)
 *   - Component DTU decomposition (soundtrack, score, dialogue, etc.)
 *   - Series/episode containers and bundle pricing
 *   - Crew tagging and crew-created sellable DTUs
 *   - Film-specific remix tracking with transformation validation
 *   - Preview analytics (drop-off, conversion)
 *   - Discovery ranking (public, auditable weights)
 *   - Watch party sessions
 *   - Gift transfers
 *
 * Core Principles:
 *   - No paywall before preview. Ever. Hardcoded.
 *   - Usage rights model (inherits CREATOR_RIGHTS)
 *   - All fees/royalties inherit from core economy (fees.js, royalty-cascade.js)
 *   - No paid promotion. Algorithm weights are public.
 */

import { randomUUID, createHash } from "crypto";
import { registerCitation } from "./royalty-cascade.js";
import { economyAudit } from "./audit.js";
import { batchLookup } from "./_batch-lookup.js";
import {
  FILM_DTU_TYPES, FILM_RESOLUTIONS, FILM_PREVIEW,
  FILM_REMIX_TYPES, FILM_REMIX_TYPE_IDS,
  FILM_COMPONENT_TYPES, FILM_COMPONENT_TYPE_IDS,
  FILM_CREW_ROLES, FILM_CREW_ROLE_IDS,
  FILM_SERIES, FILM_DISCOVERY, FILM_GOVERNANCE,
  FILM_OWNERSHIP,
} from "../lib/film-studio-constants.js";

// ── Helpers ─────────────────────────────────────────────────────────────

function uid(prefix = "flm") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function safeJsonParse(str, fallback = []) {
  try { return JSON.parse(str); } catch (err) { console.debug('[film-studio] JSON parse failed', err?.message); return fallback; }
}

// ═══════════════════════════════════════════════════════════════════════════
// FILM DTU CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a Film DTU with media-specific metadata.
 * This extends an existing creative_artifact with film-specific fields.
 */
export function createFilmDTU(db, {
  artifactId, creatorId, filmType, durationSeconds,
  previewDurationSeconds, resolution, audioTracks,
  subtitleTracks, stems, previewType, previewTrailerDtuId,
  previewSegmentStartMs, previewSegmentEndMs,
  remixPermissions, parentCitations, seriesId,
  seasonNumber, episodeNumber,
}) {
  if (!artifactId) return { ok: false, error: "missing_artifact_id" };
  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!filmType || !FILM_DTU_TYPES[filmType]) {
    return { ok: false, error: "invalid_film_type", validTypes: Object.keys(FILM_DTU_TYPES) };
  }

  // Validate artifact exists
  const artifact = db.prepare("SELECT id, creator_id FROM creative_artifacts WHERE id = ?").get(artifactId);
  if (!artifact) return { ok: false, error: "artifact_not_found" };
  if (artifact.creator_id !== creatorId) return { ok: false, error: "not_artifact_owner" };

  // Validate resolution if provided
  if (resolution && !FILM_RESOLUTIONS[resolution]) {
    return { ok: false, error: "invalid_resolution", validResolutions: Object.keys(FILM_RESOLUTIONS) };
  }

  // Validate preview type
  const prevType = previewType || "first-5-min";
  if (!FILM_PREVIEW.types[prevType]) {
    return { ok: false, error: "invalid_preview_type", validTypes: Object.keys(FILM_PREVIEW.types) };
  }

  // Validate remix permissions
  const remixPerms = remixPermissions || "open";
  if (!["open", "licensed", "restricted"].includes(remixPerms)) {
    return { ok: false, error: "invalid_remix_permissions" };
  }

  // Validate series linkage
  if (filmType === "episode" && !seriesId) {
    return { ok: false, error: "episode_requires_series_id" };
  }
  if (seriesId) {
    const series = db.prepare("SELECT id, film_type FROM film_dtus WHERE id = ?").get(seriesId);
    if (!series) return { ok: false, error: "series_not_found" };
    if (series.film_type !== "series") return { ok: false, error: "parent_is_not_series" };
  }

  const prevDuration = previewDurationSeconds ?? FILM_PREVIEW.DEFAULT_DURATION_SECONDS;
  const id = uid("flm");
  const now = nowISO();

  try {
    db.prepare(`
      INSERT INTO film_dtus (
        id, artifact_id, creator_id, film_type,
        duration_seconds, preview_duration_seconds,
        resolution, audio_tracks_json, subtitle_tracks_json, stems_json,
        preview_type, preview_trailer_dtu_id,
        preview_segment_start_ms, preview_segment_end_ms,
        remix_permissions, parent_citations_json,
        series_id, season_number, episode_number,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, artifactId, creatorId, filmType,
      durationSeconds || null, prevDuration,
      resolution || null,
      JSON.stringify(audioTracks || []),
      JSON.stringify(subtitleTracks || []),
      JSON.stringify(stems || {}),
      prevType, previewTrailerDtuId || null,
      previewSegmentStartMs || null, previewSegmentEndMs || null,
      remixPerms,
      JSON.stringify(parentCitations || []),
      seriesId || null, seasonNumber || null, episodeNumber || null,
      now, now,
    );

    // Register citations for parent references — Phase 2 perf fix:
    // single batched IN-list replaces N round-trips.
    if (parentCitations && parentCitations.length > 0) {
      const parentMap = batchLookup(db, "film_dtus", "id", parentCitations, {
        columns: ["id", "creator_id"],
      });
      for (const parentId of parentCitations) {
        const parentDtu = parentMap.get(parentId);
        if (parentDtu) {
          registerCitation(db, {
            childId: id,
            parentId,
            creatorId,
            parentCreatorId: parentDtu.creator_id,
            generation: 1,
          });
        }
      }
    }

    return { ok: true, filmDtuId: id, artifactId, filmType, createdAt: now };
  } catch (err) {
    console.error("[economy] film_dtu_creation_failed:", err.message);
    return { ok: false, error: "film_dtu_creation_failed" };
  }
}

/**
 * Get a Film DTU by ID with all metadata.
 */
export function getFilmDTU(db, filmDtuId) {
  const row = db.prepare("SELECT * FROM film_dtus WHERE id = ?").get(filmDtuId);
  if (!row) return null;
  return {
    ...row,
    audioTracks: safeJsonParse(row.audio_tracks_json),
    subtitleTracks: safeJsonParse(row.subtitle_tracks_json),
    stems: safeJsonParse(row.stems_json, {}),
    parentCitations: safeJsonParse(row.parent_citations_json),
  };
}

/**
 * Update film DTU fields (creator only).
 */
export function updateFilmDTU(db, filmDtuId, creatorId, updates) {
  const film = db.prepare("SELECT * FROM film_dtus WHERE id = ? AND creator_id = ?").get(filmDtuId, creatorId);
  if (!film) return { ok: false, error: "film_not_found_or_not_owner" };

  const allowedFields = [
    "preview_duration_seconds", "resolution", "audio_tracks_json",
    "subtitle_tracks_json", "stems_json", "preview_type",
    "preview_trailer_dtu_id", "preview_segment_start_ms",
    "preview_segment_end_ms", "remix_permissions",
  ];

  const setClauses = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(typeof val === "object" ? JSON.stringify(val) : val);
    }
  }

  if (setClauses.length === 0) return { ok: false, error: "no_valid_updates" };

  setClauses.push("updated_at = ?");
  values.push(nowISO());
  values.push(filmDtuId);

  db.prepare(`UPDATE film_dtus SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  return { ok: true, filmDtuId, updatedFields: setClauses.length - 1 };
}

// ═══════════════════════════════════════════════════════════════════════════
// PREVIEW SYSTEM — No paywall before preview. Ever. Hardcoded.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get preview info for a film. No authentication required.
 * This is the public-facing preview endpoint.
 */
export function getFilmPreview(db, filmDtuId) {
  const film = db.prepare(`
    SELECT f.*, ca.title, ca.description, ca.price, ca.rating,
           ca.rating_count, ca.purchase_count, ca.file_path
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.id = ?
  `).get(filmDtuId);

  if (!film) return { ok: false, error: "film_not_found" };

  // Preview is ALWAYS available — no auth check
  const preview = {
    filmDtuId: film.id,
    title: film.title,
    description: film.description,
    filmType: film.film_type,
    durationSeconds: film.duration_seconds,
    resolution: film.resolution,
    previewType: film.preview_type,
    previewDurationSeconds: film.preview_duration_seconds,
    requiresAuth: false,

    // Purchase prompt data
    price: film.price,
    rating: film.rating,
    ratingCount: film.rating_count,
    purchaseCount: film.purchase_count,
  };

  // Add preview-type-specific data
  switch (film.preview_type) {
    case "first-5-min":
      preview.previewStartMs = 0;
      preview.previewEndMs = (film.preview_duration_seconds || 300) * 1000;
      preview.streamPath = film.file_path;
      break;
    case "trailer-cut":
      preview.trailerDtuId = film.preview_trailer_dtu_id;
      break;
    case "creator-selected-segment":
      preview.previewStartMs = film.preview_segment_start_ms || 0;
      preview.previewEndMs = film.preview_segment_end_ms || 300000;
      preview.streamPath = film.file_path;
      break;
  }

  return { ok: true, preview };
}

/**
 * Record a preview analytics event.
 */
export function recordPreviewEvent(db, {
  filmDtuId, viewerId, sessionId, eventType,
  dropOffTimestampMs, previewDurationWatchedMs, region,
}) {
  if (!filmDtuId) return { ok: false, error: "missing_film_dtu_id" };

  const validEvents = ["preview_start", "preview_drop_off", "preview_complete",
    "purchase_prompt_shown", "purchase_completed"];
  if (!validEvents.includes(eventType)) {
    return { ok: false, error: "invalid_event_type" };
  }

  const id = uid("prev");
  db.prepare(`
    INSERT INTO film_preview_events
      (id, film_dtu_id, viewer_id, session_id, event_type,
       drop_off_timestamp_ms, preview_duration_watched_ms, region, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, filmDtuId, viewerId || null, sessionId || null, eventType,
    dropOffTimestampMs || null, previewDurationWatchedMs || null,
    region || null, nowISO(),
  );

  return { ok: true, eventId: id };
}

/**
 * Get preview analytics for a film (creator only).
 */
export function getPreviewAnalytics(db, filmDtuId, creatorId) {
  const film = db.prepare("SELECT creator_id FROM film_dtus WHERE id = ?").get(filmDtuId);
  if (!film) return { ok: false, error: "film_not_found" };
  if (film.creator_id !== creatorId) return { ok: false, error: "not_creator" };

  const totalViews = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'preview_start'"
  ).get(filmDtuId)?.c || 0;

  const completions = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'preview_complete'"
  ).get(filmDtuId)?.c || 0;

  const purchases = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'purchase_completed'"
  ).get(filmDtuId)?.c || 0;

  const conversionRate = totalViews > 0 ? purchases / totalViews : 0;

  // Drop-off histogram (bucket by 10-second intervals)
  const dropOffs = db.prepare(`
    SELECT drop_off_timestamp_ms FROM film_preview_events
    WHERE film_dtu_id = ? AND event_type = 'preview_drop_off'
    AND drop_off_timestamp_ms IS NOT NULL
  `).all(filmDtuId);

  const dropOffBuckets = {};
  for (const { drop_off_timestamp_ms } of dropOffs) {
    const bucket = Math.floor(drop_off_timestamp_ms / 10000) * 10; // 10-second buckets
    dropOffBuckets[`${bucket}s`] = (dropOffBuckets[`${bucket}s`] || 0) + 1;
  }

  // Geographic distribution
  const geoDistribution = db.prepare(`
    SELECT region, COUNT(*) as count FROM film_preview_events
    WHERE film_dtu_id = ? AND region IS NOT NULL
    GROUP BY region ORDER BY count DESC
  `).all(filmDtuId);

  return {
    ok: true,
    analytics: {
      totalViews,
      completions,
      purchases,
      conversionRate,
      dropOffBuckets,
      geoDistribution,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPONENT DTU DECOMPOSITION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a component DTU for a film.
 * Each component auto-cites the parent film DTU.
 */
export function createFilmComponent(db, {
  filmDtuId, creatorId, componentType, label, description,
  price, artifactId, sceneNumber, sceneStartMs, sceneEndMs,
}) {
  if (!filmDtuId) return { ok: false, error: "missing_film_dtu_id" };
  if (!creatorId) return { ok: false, error: "missing_creator_id" };
  if (!componentType || !FILM_COMPONENT_TYPES[componentType]) {
    return { ok: false, error: "invalid_component_type", validTypes: FILM_COMPONENT_TYPE_IDS };
  }

  const film = db.prepare("SELECT creator_id FROM film_dtus WHERE id = ?").get(filmDtuId);
  if (!film) return { ok: false, error: "film_not_found" };
  if (film.creator_id !== creatorId) return { ok: false, error: "not_film_creator" };

  const typeDef = FILM_COMPONENT_TYPES[componentType];
  const id = uid("cmp");
  const now = nowISO();

  db.prepare(`
    INSERT INTO film_components
      (id, film_dtu_id, artifact_id, creator_id, component_type,
       label, description, price, is_mega,
       scene_number, scene_start_ms, scene_end_ms,
       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, filmDtuId, artifactId || null, creatorId, componentType,
    label || typeDef.label, description || typeDef.description,
    price || null, typeDef.isMega ? 1 : 0,
    sceneNumber || null, sceneStartMs || null, sceneEndMs || null,
    now, now,
  );

  // Auto-cite the parent film
  if (artifactId) {
    registerCitation(db, {
      childId: artifactId,
      parentId: filmDtuId,
      creatorId,
      parentCreatorId: creatorId,
      generation: 1,
    });
  }

  return { ok: true, componentId: id, filmDtuId, componentType };
}

/**
 * List all components for a film.
 */
export function listFilmComponents(db, filmDtuId) {
  return db.prepare(
    "SELECT * FROM film_components WHERE film_dtu_id = ? ORDER BY component_type"
  ).all(filmDtuId);
}

/**
 * Update a component's status or price.
 */
export function updateFilmComponent(db, componentId, creatorId, updates) {
  const component = db.prepare(
    "SELECT * FROM film_components WHERE id = ? AND creator_id = ?"
  ).get(componentId, creatorId);
  if (!component) return { ok: false, error: "component_not_found_or_not_owner" };

  const allowedFields = ["label", "description", "price", "status", "artifact_id"];
  const setClauses = [];
  const values = [];

  for (const [key, val] of Object.entries(updates)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      values.push(val);
    }
  }

  if (setClauses.length === 0) return { ok: false, error: "no_valid_updates" };

  setClauses.push("updated_at = ?");
  values.push(nowISO());
  values.push(componentId);

  db.prepare(`UPDATE film_components SET ${setClauses.join(", ")} WHERE id = ?`).run(...values);
  return { ok: true, componentId };
}

// ═══════════════════════════════════════════════════════════════════════════
// CREW CONTRIBUTION SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tag a crew member on a film DTU.
 */
export function addCrewMember(db, {
  filmDtuId, creatorId, userId, role, displayName, revenueSharePct,
}) {
  if (!filmDtuId || !userId || !role) {
    return { ok: false, error: "missing_required_fields" };
  }
  if (!FILM_CREW_ROLES[role]) {
    return { ok: false, error: "invalid_crew_role", validRoles: FILM_CREW_ROLE_IDS };
  }

  const film = db.prepare("SELECT creator_id FROM film_dtus WHERE id = ?").get(filmDtuId);
  if (!film) return { ok: false, error: "film_not_found" };
  if (film.creator_id !== creatorId) return { ok: false, error: "not_film_creator" };

  const share = revenueSharePct || 0;
  if (share < 0 || share > 50) return { ok: false, error: "revenue_share_out_of_range" };

  const id = uid("crw");
  try {
    db.prepare(`
      INSERT INTO film_crew (id, film_dtu_id, user_id, role, display_name, revenue_share_pct, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, filmDtuId, userId, role, displayName || null, share, nowISO());

    return { ok: true, crewId: id, filmDtuId, userId, role };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return { ok: false, error: "crew_member_already_tagged" };
    }
    console.error("[economy] crew_add_failed:", err.message);
    return { ok: false, error: "crew_add_failed" };
  }
}

/**
 * List crew for a film.
 */
export function listFilmCrew(db, filmDtuId) {
  return db.prepare(
    "SELECT * FROM film_crew WHERE film_dtu_id = ? ORDER BY role"
  ).all(filmDtuId);
}

/**
 * Remove a crew member (film creator only).
 */
export function removeCrewMember(db, crewId, creatorId) {
  const crew = db.prepare(`
    SELECT fc.*, fd.creator_id as film_creator_id
    FROM film_crew fc
    JOIN film_dtus fd ON fc.film_dtu_id = fd.id
    WHERE fc.id = ?
  `).get(crewId);

  if (!crew) return { ok: false, error: "crew_not_found" };
  if (crew.film_creator_id !== creatorId) return { ok: false, error: "not_film_creator" };

  db.prepare("DELETE FROM film_crew WHERE id = ?").run(crewId);
  return { ok: true, crewId };
}

/**
 * Create a crew-contributed DTU (by the crew member themselves).
 * Auto-cites the parent film.
 */
export function createCrewDTU(db, {
  crewId, filmDtuId, title, description, price,
  crewContributionType, artifactId,
}) {
  if (!crewId || !filmDtuId || !title || !crewContributionType) {
    return { ok: false, error: "missing_required_fields" };
  }

  const crew = db.prepare("SELECT * FROM film_crew WHERE id = ?").get(crewId);
  if (!crew) return { ok: false, error: "crew_not_found" };

  // Validate contribution type is valid for this crew role
  const roleDef = FILM_CREW_ROLES[crew.role];
  if (roleDef && !roleDef.sellableTypes.includes(crewContributionType)) {
    return {
      ok: false,
      error: "invalid_contribution_type_for_role",
      role: crew.role,
      validTypes: roleDef.sellableTypes,
    };
  }

  const id = uid("crwd");
  const now = nowISO();

  db.prepare(`
    INSERT INTO film_crew_dtus
      (id, crew_id, film_dtu_id, artifact_id, crew_contribution_type,
       title, description, price, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
  `).run(
    id, crewId, filmDtuId, artifactId || null, crewContributionType,
    title, description || null, price || null, now, now,
  );

  // Auto-cite the parent film
  if (artifactId) {
    const film = db.prepare("SELECT creator_id FROM film_dtus WHERE id = ?").get(filmDtuId);
    if (film) {
      registerCitation(db, {
        childId: artifactId,
        parentId: filmDtuId,
        creatorId: crew.user_id,
        parentCreatorId: film.creator_id,
        generation: 1,
      });
    }
  }

  return { ok: true, crewDtuId: id, crewId, filmDtuId };
}

/**
 * List crew DTUs for a film.
 */
export function listCrewDTUs(db, filmDtuId) {
  return db.prepare(`
    SELECT cd.*, fc.role, fc.display_name, fc.user_id
    FROM film_crew_dtus cd
    JOIN film_crew fc ON cd.crew_id = fc.id
    WHERE cd.film_dtu_id = ?
    ORDER BY fc.role, cd.created_at
  `).all(filmDtuId);
}

// ═══════════════════════════════════════════════════════════════════════════
// SERIES / EPISODE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a series bundle (season or full-series pricing).
 */
export function createSeriesBundle(db, {
  seriesDtuId, creatorId, bundleType, seasonNumber,
  bundlePrice, individualTotal, discountPct,
}) {
  if (!seriesDtuId || !creatorId || !bundleType || !bundlePrice) {
    return { ok: false, error: "missing_required_fields" };
  }

  const series = db.prepare("SELECT * FROM film_dtus WHERE id = ? AND film_type = 'series'").get(seriesDtuId);
  if (!series) return { ok: false, error: "series_not_found" };
  if (series.creator_id !== creatorId) return { ok: false, error: "not_series_creator" };

  if (!FILM_SERIES.pricingModes[bundleType]) {
    return { ok: false, error: "invalid_bundle_type", validTypes: Object.keys(FILM_SERIES.pricingModes) };
  }

  const discount = discountPct || 0;
  if (discount < FILM_SERIES.BUNDLE_DISCOUNT_MIN || discount > FILM_SERIES.BUNDLE_DISCOUNT_MAX) {
    return { ok: false, error: "discount_out_of_range" };
  }

  const id = uid("bndl");
  const now = nowISO();

  db.prepare(`
    INSERT INTO film_series_bundles
      (id, series_dtu_id, creator_id, bundle_type, season_number,
       bundle_price, individual_total, discount_pct,
       status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `).run(
    id, seriesDtuId, creatorId, bundleType,
    seasonNumber || null, bundlePrice, individualTotal || null,
    discount, now, now,
  );

  return { ok: true, bundleId: id, seriesDtuId, bundleType, bundlePrice };
}

/**
 * Get episodes for a series.
 */
export function getSeriesEpisodes(db, seriesDtuId) {
  return db.prepare(`
    SELECT f.*, ca.title, ca.description, ca.price, ca.rating,
           ca.purchase_count
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.series_id = ?
    ORDER BY f.season_number, f.episode_number
  `).all(seriesDtuId);
}

/**
 * Get bundles for a series.
 */
export function getSeriesBundles(db, seriesDtuId) {
  return db.prepare(
    "SELECT * FROM film_series_bundles WHERE series_dtu_id = ? AND status = 'active' ORDER BY bundle_type"
  ).all(seriesDtuId);
}

// ═══════════════════════════════════════════════════════════════════════════
// FILM REMIX SYSTEM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a film remix. Validates transformation threshold.
 * Remix of remix is supported — citation chain tracks full lineage.
 */
export function registerFilmRemix(db, {
  remixDtuId, sourceDtuId, remixType, transformationHash,
}) {
  if (!remixDtuId || !sourceDtuId || !remixType) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (!FILM_REMIX_TYPES[remixType]) {
    return { ok: false, error: "invalid_remix_type", validTypes: FILM_REMIX_TYPE_IDS };
  }

  // Get both DTUs
  const remix = db.prepare("SELECT * FROM film_dtus WHERE id = ?").get(remixDtuId);
  const source = db.prepare("SELECT * FROM film_dtus WHERE id = ?").get(sourceDtuId);
  if (!remix) return { ok: false, error: "remix_dtu_not_found" };
  if (!source) return { ok: false, error: "source_dtu_not_found" };

  // Compute transformation score if hashes provided
  let transformationScore = null;
  if (transformationHash && source.stems_json) {
    const sourceHash = createHash("sha256").update(source.stems_json).digest("hex");
    // Simple similarity: count matching character positions
    let matches = 0;
    const minLen = Math.min(transformationHash.length, sourceHash.length);
    for (let i = 0; i < minLen; i++) {
      if (transformationHash[i] === sourceHash[i]) matches++;
    }
    const similarity = minLen > 0 ? matches / minLen : 0;
    transformationScore = 1 - similarity; // Higher = more transformed

    // Enforce minimum transformation threshold
    if (transformationScore < FILM_GOVERNANCE.transformationHashThreshold) {
      return {
        ok: false,
        error: "insufficient_transformation",
        score: transformationScore,
        required: FILM_GOVERNANCE.transformationHashThreshold,
      };
    }
  }

  const id = uid("rmx");

  try {
    db.prepare(`
      INSERT INTO film_remixes
        (id, remix_dtu_id, source_dtu_id, remix_type,
         transformation_hash, transformation_score, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, remixDtuId, sourceDtuId, remixType,
      transformationHash || null, transformationScore,
      nowISO(),
    );

    // Register citation for royalty cascade
    registerCitation(db, {
      childId: remixDtuId,
      parentId: sourceDtuId,
      creatorId: remix.creator_id,
      parentCreatorId: source.creator_id,
      generation: 1,
    });

    return { ok: true, remixId: id, remixDtuId, sourceDtuId, remixType, transformationScore };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) {
      return { ok: false, error: "remix_already_registered" };
    }
    console.error("[economy] remix_registration_failed:", err.message);
    return { ok: false, error: "remix_registration_failed" };
  }
}

/**
 * Get all remixes of a source film.
 */
export function getFilmRemixes(db, sourceDtuId) {
  return db.prepare(`
    SELECT r.*, f.film_type, ca.title, ca.price
    FROM film_remixes r
    JOIN film_dtus f ON r.remix_dtu_id = f.id
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE r.source_dtu_id = ?
    ORDER BY r.created_at DESC
  `).all(sourceDtuId);
}

/**
 * Get the full remix lineage chain for a film.
 */
export function getRemixLineage(db, filmDtuId, maxDepth = 50) {
  const lineage = [];
  const visited = new Set();
  const queue = [{ id: filmDtuId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current.id) || current.depth > maxDepth) continue;
    visited.add(current.id);

    const parents = db.prepare(
      "SELECT source_dtu_id, remix_type FROM film_remixes WHERE remix_dtu_id = ?"
    ).all(current.id);

    for (const parent of parents) {
      const parentFilm = db.prepare(`
        SELECT f.id, f.film_type, f.creator_id, ca.title
        FROM film_dtus f
        JOIN creative_artifacts ca ON f.artifact_id = ca.id
        WHERE f.id = ?
      `).get(parent.source_dtu_id);

      if (parentFilm && !visited.has(parentFilm.id)) {
        lineage.push({
          filmDtuId: parentFilm.id,
          title: parentFilm.title,
          creatorId: parentFilm.creator_id,
          remixType: parent.remix_type,
          depth: current.depth + 1,
        });
        queue.push({ id: parentFilm.id, depth: current.depth + 1 });
      }
    }
  }

  return lineage;
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCOVERY & RANKING — Public, auditable weights
// No paid promotion. No payola. Hardcoded.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Compute and store the discovery score for a film.
 * Algorithm weights are defined in FILM_DISCOVERY.rankingFactors
 * and are PUBLIC and AUDITABLE.
 */
export function computeDiscoveryScore(db, filmDtuId) {
  const film = db.prepare(`
    SELECT f.*, ca.purchase_count, ca.rating, ca.created_at as artifact_created
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.id = ?
  `).get(filmDtuId);

  if (!film) return { ok: false, error: "film_not_found" };

  const weights = FILM_DISCOVERY.rankingFactors;

  // Purchase volume (normalized: cap at 1000 for max score)
  const purchaseVolume = Math.min((film.purchase_count || 0) / 1000, 1);

  // Citation count (remixes referencing this film)
  const citationCount = db.prepare(
    "SELECT COUNT(*) as c FROM film_remixes WHERE source_dtu_id = ?"
  ).get(filmDtuId)?.c || 0;
  const citationScore = Math.min(citationCount / 50, 1);

  // Completion rate (purchases vs preview_completes)
  const previewStarts = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'preview_start'"
  ).get(filmDtuId)?.c || 0;
  const previewCompletes = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'preview_complete'"
  ).get(filmDtuId)?.c || 0;
  const completionRate = previewStarts > 0 ? previewCompletes / previewStarts : 0;

  // Preview-to-purchase conversion
  const purchaseEvents = db.prepare(
    "SELECT COUNT(*) as c FROM film_preview_events WHERE film_dtu_id = ? AND event_type = 'purchase_completed'"
  ).get(filmDtuId)?.c || 0;
  const previewConversion = previewStarts > 0 ? purchaseEvents / previewStarts : 0;

  // Creator reputation (average rating across all their films)
  const creatorStats = db.prepare(`
    SELECT AVG(ca.rating) as avg_rating
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.creator_id = ? AND ca.rating_count > 0
  `).get(film.creator_id);
  const creatorReputation = creatorStats?.avg_rating ? creatorStats.avg_rating / 5 : 0;

  // Recency (within boost window)
  const ageHours = (Date.now() - new Date(film.artifact_created).getTime()) / (1000 * 60 * 60);
  let recencyScore = 0;
  if (ageHours <= FILM_DISCOVERY.NEW_CONTENT_BOOST_HOURS) {
    recencyScore = 1 - (ageHours / FILM_DISCOVERY.NEW_CONTENT_BOOST_HOURS);
  }

  // Weighted composite
  const composite =
    purchaseVolume * weights.purchase_volume.weight +
    citationScore * weights.citation_count.weight +
    completionRate * weights.completion_rate.weight +
    previewConversion * weights.preview_conversion.weight +
    creatorReputation * weights.creator_reputation.weight +
    recencyScore * weights.recency.weight;

  const now = nowISO();

  db.prepare(`
    INSERT OR REPLACE INTO film_discovery_scores
      (film_dtu_id, purchase_volume, citation_count, completion_rate,
       preview_conversion, creator_reputation, recency_score,
       composite_score, computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    filmDtuId, film.purchase_count || 0, citationCount,
    completionRate, previewConversion, creatorReputation,
    recencyScore, composite, now,
  );

  return {
    ok: true,
    filmDtuId,
    scores: {
      purchaseVolume, citationCount, completionRate,
      previewConversion, creatorReputation, recencyScore,
      composite,
    },
    weights: FILM_DISCOVERY.rankingFactors,
  };
}

/**
 * Browse/discover films with ranking.
 */
export function discoverFilms(db, {
  genre, filmType, sortBy = "composite_score",
  limit = 20, offset = 0,
} = {}) {
  let sql = `
    SELECT f.*, ca.title, ca.description, ca.price, ca.rating,
           ca.purchase_count, ca.genre,
           COALESCE(ds.composite_score, 0) as composite_score
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    LEFT JOIN film_discovery_scores ds ON f.id = ds.film_dtu_id
    WHERE ca.marketplace_status = 'active'
  `;
  const params = [];

  if (genre) {
    sql += " AND ca.genre = ?";
    params.push(genre);
  }
  if (filmType) {
    sql += " AND f.film_type = ?";
    params.push(filmType);
  }

  // Series containers show as browse entries; episodes are nested
  sql += " AND f.film_type != 'episode'";

  const validSorts = ["composite_score", "purchase_count", "rating", "created_at"];
  const sort = validSorts.includes(sortBy) ? sortBy : "composite_score";
  sql += ` ORDER BY ${sort} DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return db.prepare(sql).all(...params);
}

// ═══════════════════════════════════════════════════════════════════════════
// WATCH PARTY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a watch party session.
 */
export function createWatchParty(db, { filmDtuId, hostUserId }) {
  if (!filmDtuId || !hostUserId) return { ok: false, error: "missing_required_fields" };

  // Host must have a license
  const film = db.prepare("SELECT artifact_id FROM film_dtus WHERE id = ?").get(filmDtuId);
  if (!film) return { ok: false, error: "film_not_found" };

  const license = db.prepare(
    "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'"
  ).get(film.artifact_id, hostUserId);
  if (!license) return { ok: false, error: "no_active_license" };

  const id = uid("wp");
  const now = nowISO();

  db.prepare(`
    INSERT INTO film_watch_parties (id, film_dtu_id, host_user_id, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(id, filmDtuId, hostUserId, now);

  // Add host as first member
  db.prepare(`
    INSERT INTO film_watch_party_members (id, party_id, user_id, joined_at)
    VALUES (?, ?, ?, ?)
  `).run(uid("wpm"), id, hostUserId, now);

  return { ok: true, partyId: id, filmDtuId, hostUserId };
}

/**
 * Join a watch party.
 */
export function joinWatchParty(db, partyId, userId) {
  const party = db.prepare("SELECT * FROM film_watch_parties WHERE id = ?").get(partyId);
  if (!party) return { ok: false, error: "party_not_found" };
  if (party.status === "ended") return { ok: false, error: "party_ended" };

  // User must have a license for the film
  const film = db.prepare("SELECT artifact_id FROM film_dtus WHERE id = ?").get(party.film_dtu_id);
  if (!film) return { ok: false, error: "film_not_found" };

  const license = db.prepare(
    "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'"
  ).get(film.artifact_id, userId);
  if (!license) return { ok: false, error: "no_active_license" };

  try {
    db.prepare(`
      INSERT INTO film_watch_party_members (id, party_id, user_id, joined_at)
      VALUES (?, ?, ?, ?)
    `).run(uid("wpm"), partyId, userId, nowISO());

    return { ok: true, partyId, userId };
  } catch (err) {
    if (err.message?.includes("UNIQUE")) return { ok: true, alreadyJoined: true };
    console.error("[economy] join_failed:", err.message);
    return { ok: false, error: "join_failed" };
  }
}

/**
 * Update watch party state (start, pause, seek, end).
 */
export function updateWatchParty(db, partyId, hostUserId, { status, currentPositionMs }) {
  const party = db.prepare(
    "SELECT * FROM film_watch_parties WHERE id = ? AND host_user_id = ?"
  ).get(partyId, hostUserId);
  if (!party) return { ok: false, error: "party_not_found_or_not_host" };

  const updates = {};
  if (status) updates.status = status;
  if (currentPositionMs !== undefined) updates.current_position_ms = currentPositionMs;
  if (status === "active" && !party.started_at) updates.started_at = nowISO();
  if (status === "ended") updates.ended_at = nowISO();

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
  const values = Object.values(updates);
  values.push(partyId);

  db.prepare(`UPDATE film_watch_parties SET ${setClauses} WHERE id = ?`).run(...values);
  return { ok: true, partyId, updates };
}

// ═══════════════════════════════════════════════════════════════════════════
// GIFT TRANSFERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gift a licensed copy to another user.
 * The gifter's license is transferred (not duplicated).
 */
export function giftFilm(db, { licenseId, fromUserId, toUserId, filmDtuId, message }) {
  if (!FILM_OWNERSHIP.giftAllowed) {
    return { ok: false, error: "gifting_disabled" };
  }

  if (!licenseId || !fromUserId || !toUserId || !filmDtuId) {
    return { ok: false, error: "missing_required_fields" };
  }
  if (fromUserId === toUserId) return { ok: false, error: "cannot_gift_to_self" };

  // Verify license belongs to sender
  const license = db.prepare(
    "SELECT * FROM creative_usage_licenses WHERE id = ? AND licensee_id = ? AND status = 'active'"
  ).get(licenseId, fromUserId);
  if (!license) return { ok: false, error: "license_not_found_or_not_active" };

  const id = uid("gift");
  db.prepare(`
    INSERT INTO film_gift_transfers
      (id, license_id, from_user_id, to_user_id, film_dtu_id, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, licenseId, fromUserId, toUserId, filmDtuId, message || null, nowISO());

  return { ok: true, giftId: id, licenseId, fromUserId, toUserId };
}

/**
 * Accept a gift transfer.
 */
export function acceptGift(db, giftId, toUserId) {
  const gift = db.prepare(
    "SELECT * FROM film_gift_transfers WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(giftId, toUserId);
  if (!gift) return { ok: false, error: "gift_not_found_or_not_pending" };

  const txn = db.transaction(() => {
    // Transfer the license to the new user
    db.prepare(
      "UPDATE creative_usage_licenses SET licensee_id = ? WHERE id = ?"
    ).run(toUserId, gift.license_id);

    // Mark gift as accepted
    db.prepare(
      "UPDATE film_gift_transfers SET status = 'accepted', resolved_at = ? WHERE id = ?"
    ).run(nowISO(), giftId);
  });

  txn();
  return { ok: true, giftId, licenseId: gift.license_id, newLicenseeId: toUserId };
}

/**
 * Decline a gift transfer.
 */
export function declineGift(db, giftId, toUserId) {
  const gift = db.prepare(
    "SELECT * FROM film_gift_transfers WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(giftId, toUserId);
  if (!gift) return { ok: false, error: "gift_not_found_or_not_pending" };

  db.prepare(
    "UPDATE film_gift_transfers SET status = 'declined', resolved_at = ? WHERE id = ?"
  ).run(nowISO(), giftId);

  return { ok: true, giftId };
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATOR ANALYTICS (owned by creator, not platform)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get full analytics dashboard for a creator's films.
 * These analytics are DTU-owned by the creator — platform cannot sell them.
 */
export function getCreatorFilmAnalytics(db, creatorId) {
  // All films by creator
  const films = db.prepare(`
    SELECT f.id, f.film_type, ca.title, ca.price, ca.purchase_count,
           ca.rating, ca.rating_count, ca.derivative_count
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.creator_id = ?
  `).all(creatorId);

  // Total revenue from direct sales
  const directSales = db.prepare(`
    SELECT COALESCE(SUM(ca.price * ca.purchase_count), 0) as total
    FROM film_dtus f
    JOIN creative_artifacts ca ON f.artifact_id = ca.id
    WHERE f.creator_id = ?
  `).get(creatorId)?.total || 0;

  // Component sales
  const componentSales = db.prepare(`
    SELECT COALESCE(SUM(fc.price * fc.purchase_count), 0) as total
    FROM film_components fc
    WHERE fc.creator_id = ?
  `).get(creatorId)?.total || 0;

  // Citation map: who's remixing what
  const citationMap = db.prepare(`
    SELECT r.remix_type, r.source_dtu_id, ca.title as remix_title,
           ca2.title as source_title
    FROM film_remixes r
    JOIN film_dtus f1 ON r.remix_dtu_id = f1.id
    JOIN creative_artifacts ca ON f1.artifact_id = ca.id
    JOIN film_dtus f2 ON r.source_dtu_id = f2.id
    JOIN creative_artifacts ca2 ON f2.artifact_id = ca2.id
    WHERE f2.creator_id = ?
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all(creatorId);

  // Geographic distribution
  const geoDistribution = db.prepare(`
    SELECT pe.region, COUNT(*) as count
    FROM film_preview_events pe
    JOIN film_dtus f ON pe.film_dtu_id = f.id
    WHERE f.creator_id = ? AND pe.region IS NOT NULL
    GROUP BY pe.region ORDER BY count DESC
  `).all(creatorId);

  return {
    ok: true,
    analytics: {
      totalFilms: films.length,
      films,
      revenue: {
        directSales,
        componentSales,
        total: directSales + componentSales,
      },
      citationMap,
      geoDistribution,
    },
  };
}
