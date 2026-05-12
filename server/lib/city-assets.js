/**
 * City Asset Management — Concord Cognitive Engine
 *
 * Manages 3D assets (GLB/GLTF) stored as DTU artifacts and the
 * modular character-customization system (slot-based equipment).
 */

import { randomUUID } from "crypto";
import logger from "../logger.js";
import { LruMap, LruSet } from "./lru-map.js";

// ──────────────────────────── Constants ────────────────────────────

const ASSET_CATEGORIES = Object.freeze({
  ARCHITECTURE: "architecture",
  NATURE: "nature",
  VEHICLE: "vehicle",
  CHARACTER: "character",
  FURNITURE: "furniture",
  PROP: "prop",
  EFFECT: "effect",
  SOUND: "sound",
});

const ASSET_THEMES = Object.freeze([
  "modern",
  "cyberpunk",
  "medieval",
  "fantasy",
  "minimal",
  "industrial",
  "nature",
  "sci-fi",
]);

const CHARACTER_SLOTS = Object.freeze({
  BODY: { id: "body", label: "Body Type", maxSize: 10 * 1024 * 1024, baseOptions: 5 },
  SKIN: { id: "skin", label: "Skin Tone", maxSize: 0, baseOptions: 0 }, // color picker, no mesh
  HAIR: { id: "hair", label: "Hair", maxSize: 5 * 1024 * 1024, baseOptions: 20 },
  FACE: { id: "face", label: "Face", maxSize: 5 * 1024 * 1024, baseOptions: 10 },
  TOP: { id: "top", label: "Top Clothing", maxSize: 5 * 1024 * 1024, baseOptions: 30 },
  BOTTOM: { id: "bottom", label: "Bottom Clothing", maxSize: 5 * 1024 * 1024, baseOptions: 20 },
  SHOES: { id: "shoes", label: "Shoes", maxSize: 5 * 1024 * 1024, baseOptions: 15 },
  HAT: { id: "hat", label: "Hat/Headwear", maxSize: 5 * 1024 * 1024, baseOptions: 10 },
  GLASSES: { id: "glasses", label: "Glasses/Face Accessory", maxSize: 5 * 1024 * 1024, baseOptions: 10 },
  BACK: { id: "back", label: "Back Item", maxSize: 5 * 1024 * 1024, baseOptions: 10 },
  HAND: { id: "hand", label: "Hand Item", maxSize: 5 * 1024 * 1024, baseOptions: 10 },
  PARTICLE: { id: "particle", label: "Particle Effect", maxSize: 1 * 1024 * 1024, baseOptions: 0 }, // earned from achievements
});

// File-size limits per category (bytes)
const SIZE_LIMITS = Object.freeze({
  object: 5 * 1024 * 1024,      // 5 MB
  character: 10 * 1024 * 1024,  // 10 MB
  building: 20 * 1024 * 1024,   // 20 MB (building packs)
});

const VALID_FORMATS = new Set(["glb", "gltf"]);

// ──────────────────────────── Storage ──────────────────────────────

/** @type {Map<string, object>} assetId → asset record */
const assets = new LruMap();

/** @type {Map<string, object>} userId → character profile */
const characterProfiles = new LruMap();

// ──────────────────────────── Helpers ──────────────────────────────

function categoryToSizeLimit(category) {
  if (category === ASSET_CATEGORIES.CHARACTER) return SIZE_LIMITS.character;
  if (category === ASSET_CATEGORIES.ARCHITECTURE) return SIZE_LIMITS.building;
  return SIZE_LIMITS.object;
}

function slotById(slotId) {
  return Object.values(CHARACTER_SLOTS).find((s) => s.id === slotId) ?? null;
}

// ──────────────────────────── Public API ───────────────────────────

/**
 * Register a new 3D asset.
 *
 * @param {object} opts
 * @param {string}  [opts.id]        — Optional; auto-generated if omitted.
 * @param {string}   opts.name
 * @param {string}   opts.category   — Must be a value in ASSET_CATEGORIES.
 * @param {string}   opts.theme      — Must be a value in ASSET_THEMES.
 * @param {string}  [opts.slot]      — Character-customization slot id (body, hair, …).
 * @param {string}   opts.format     — "glb" or "gltf".
 * @param {number}   opts.fileSize   — Size in bytes.
 * @param {string}   opts.creatorId
 * @param {string[]} [opts.tags=[]]
 * @param {string}  [opts.license]
 * @returns {object} The persisted asset record.
 */
export function registerAsset(opts) {
  const {
    id = randomUUID(),
    name,
    category,
    theme,
    slot,
    format,
    fileSize,
    creatorId,
    tags = [],
    license = "standard",
  } = opts ?? {};

  // --- validation ---
  if (!name) throw new Error("Asset name is required");
  if (!Object.values(ASSET_CATEGORIES).includes(category)) {
    throw new Error(`Invalid category "${category}". Must be one of: ${Object.values(ASSET_CATEGORIES).join(", ")}`);
  }
  if (!ASSET_THEMES.includes(theme)) {
    throw new Error(`Invalid theme "${theme}". Must be one of: ${ASSET_THEMES.join(", ")}`);
  }
  if (!VALID_FORMATS.has(format)) {
    throw new Error(`Invalid format "${format}". Must be glb or gltf`);
  }
  if (slot) {
    const slotDef = slotById(slot);
    if (!slotDef) {
      throw new Error(`Unknown character slot "${slot}"`);
    }
    if (slotDef.maxSize > 0 && fileSize > slotDef.maxSize) {
      throw new Error(`File size ${fileSize} exceeds slot "${slot}" limit of ${slotDef.maxSize} bytes`);
    }
  }

  const maxSize = categoryToSizeLimit(category);
  if (fileSize > maxSize) {
    throw new Error(`File size ${fileSize} exceeds ${category} limit of ${maxSize} bytes`);
  }

  const record = {
    id,
    name,
    category,
    theme,
    slot: slot ?? null,
    format,
    fileSize,
    creatorId,
    tags,
    license,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  assets.set(id, record);
  logger.info("city-assets", `Registered asset "${name}" [${id}]`, { category, theme, slot });
  return record;
}

/**
 * Get asset metadata by id.
 * @param {string} assetId
 * @returns {object|null}
 */
export function getAsset(assetId) {
  return assets.get(assetId) ?? null;
}

/**
 * List assets with optional filters.
 *
 * @param {object}  [opts={}]
 * @param {string}  [opts.category]
 * @param {string}  [opts.theme]
 * @param {string}  [opts.slot]
 * @param {number}  [opts.limit=50]
 * @param {number}  [opts.offset=0]
 * @param {string}  [opts.sortBy="createdAt"]
 * @returns {{ items: object[], total: number }}
 */
export function listAssets(opts = {}) {
  const { category, theme, slot, limit = 50, offset = 0, sortBy = "createdAt" } = opts;

  let results = [...assets.values()];

  if (category) results = results.filter((a) => a.category === category);
  if (theme) results = results.filter((a) => a.theme === theme);
  if (slot) results = results.filter((a) => a.slot === slot);

  results.sort((a, b) => {
    const aVal = a[sortBy] ?? "";
    const bVal = b[sortBy] ?? "";
    return aVal < bVal ? 1 : aVal > bVal ? -1 : 0; // desc by default
  });

  const total = results.length;
  const items = results.slice(offset, offset + limit);

  return { items, total };
}

/**
 * List character-customization assets for a given slot.
 * @param {string} slot — Slot id (e.g. "hair", "top").
 * @returns {object[]}
 */
export function listAssetsBySlot(slot) {
  const slotDef = slotById(slot);
  if (!slotDef) throw new Error(`Unknown character slot "${slot}"`);
  return [...assets.values()].filter((a) => a.slot === slot);
}

/**
 * Get all base/free assets (tagged "base").
 * @returns {object[]}
 */
export function getBaseAssets() {
  return [...assets.values()].filter((a) => a.tags.includes("base"));
}

/**
 * Validate that a GLB upload meets size limits for a given category.
 *
 * @param {number} fileSize
 * @param {string} category
 * @returns {{ valid: boolean, maxSize: number, reason?: string }}
 */
export function validateGLBUpload(fileSize, category) {
  if (!Object.values(ASSET_CATEGORIES).includes(category)) {
    return { valid: false, maxSize: 0, reason: `Invalid category "${category}"` };
  }
  const maxSize = categoryToSizeLimit(category);
  if (fileSize > maxSize) {
    return {
      valid: false,
      maxSize,
      reason: `File size ${fileSize} exceeds ${category} limit of ${maxSize} bytes`,
    };
  }
  return { valid: true, maxSize };
}

/**
 * Create or update a character profile for a user.
 *
 * @param {string} userId
 * @param {Record<string, string>} slotSelections — e.g. { body: assetId, hair: assetId, … }
 * @returns {object} The persisted profile.
 */
export function createCharacterProfile(userId, slotSelections) {
  if (!userId) throw new Error("userId is required");
  if (!slotSelections || typeof slotSelections !== "object") {
    throw new Error("slotSelections must be an object");
  }

  // Validate every slot key
  for (const key of Object.keys(slotSelections)) {
    const slotDef = slotById(key);
    if (!slotDef) throw new Error(`Unknown slot "${key}" in selections`);

    // Skin slot stores a color string, not an assetId
    if (key === "skin") continue;

    const assetId = slotSelections[key];
    if (assetId) {
      const asset = assets.get(assetId);
      if (!asset) throw new Error(`Asset "${assetId}" not found for slot "${key}"`);
      if (asset.slot !== key) {
        throw new Error(`Asset "${assetId}" is not assigned to slot "${key}"`);
      }
    }
  }

  const existing = characterProfiles.get(userId);
  const profile = {
    userId,
    slots: { ...(existing?.slots ?? {}), ...slotSelections },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  characterProfiles.set(userId, profile);
  logger.info("city-assets", `Character profile saved for user ${userId}`, {
    slots: Object.keys(profile.slots),
  });
  return profile;
}

/**
 * Get a user's character profile.
 * @param {string} userId
 * @returns {object|null}
 */
export function getCharacterProfile(userId) {
  return characterProfiles.get(userId) ?? null;
}

/**
 * Aggregate asset counts by category, theme, and slot.
 * @returns {{ byCategory: Record<string,number>, byTheme: Record<string,number>, bySlot: Record<string,number> }}
 */
export function getAssetStats() {
  const byCategory = {};
  const byTheme = {};
  const bySlot = {};

  for (const asset of assets.values()) {
    byCategory[asset.category] = (byCategory[asset.category] ?? 0) + 1;
    byTheme[asset.theme] = (byTheme[asset.theme] ?? 0) + 1;
    if (asset.slot) {
      bySlot[asset.slot] = (bySlot[asset.slot] ?? 0) + 1;
    }
  }

  return { byCategory, byTheme, bySlot, total: assets.size };
}

export { ASSET_CATEGORIES, ASSET_THEMES, CHARACTER_SLOTS };
