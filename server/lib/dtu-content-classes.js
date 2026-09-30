/**
 * DTU content-class admission profiles.
 *
 * One-shape council scoring (defs/invariants/examples/claims/nextActions)
 * rejected songs/media as low_value. Content classes let upload/sell/buy
 * work across industries with class-appropriate bars:
 *   - personal save: low bar
 *   - public promotion: stricter
 *
 * Classes: knowledge, media, formula, dataset, software, world_asset, generic
 */

export const CONTENT_CLASSES = Object.freeze([
  "knowledge",
  "media",
  "formula",
  "dataset",
  "software",
  "world_asset",
  "generic",
]);

const CLASS_SET = new Set(CONTENT_CLASSES);

/** Per-class admission: which signals count + personal/public minima. */
export const ADMISSION_PROFILES = Object.freeze({
  knowledge: {
    label: "Knowledge",
    personalMin: 1,
    publicMin: 2,
    rejectReason: "knowledge_insufficient_structure",
    // Academic core fields
    useAcademicCore: true,
  },
  media: {
    label: "Media",
    personalMin: 1,
    publicMin: 1,
    rejectReason: "media_missing_asset_or_title",
    useAcademicCore: false,
    // Title/summary + media signal is enough — no academic core required
  },
  formula: {
    label: "Formula",
    personalMin: 1,
    publicMin: 2,
    rejectReason: "formula_missing_composition",
    useAcademicCore: true,
    requireCompositionForPublic: true,
  },
  dataset: {
    label: "Dataset",
    personalMin: 1,
    publicMin: 2,
    rejectReason: "dataset_insufficient_structure",
    useAcademicCore: true,
  },
  software: {
    label: "Software",
    personalMin: 1,
    publicMin: 2,
    rejectReason: "software_insufficient_structure",
    useAcademicCore: true,
  },
  world_asset: {
    label: "World asset",
    personalMin: 1,
    publicMin: 1,
    rejectReason: "world_asset_missing_identity",
    useAcademicCore: false,
  },
  generic: {
    label: "Generic",
    personalMin: 1,
    publicMin: 2,
    rejectReason: "low_value",
    useAcademicCore: true,
  },
});

const MEDIA_MIME_PREFIXES = [
  "audio/", "video/", "image/",
];
const MEDIA_MIME_EXACT = new Set([
  "application/x-mpegURL",
  "application/vnd.apple.mpegurl",
  "application/ogg",
]);
const DATASET_MIME = new Set([
  "text/csv", "application/json", "application/x-ndjson",
  "application/parquet", "application/x-sqlite3",
]);
const SOFTWARE_MIME = new Set([
  "application/javascript", "text/javascript", "application/typescript",
  "application/x-python", "text/x-python", "application/x-sh",
]);
const MEDIA_TYPES = new Set(["audio", "video", "image", "document", "stream", "music", "song", "track", "podcast"]);
const MEDIA_DOMAINS = new Set([
  "music", "audio", "video", "media", "studio", "art", "photography",
  "animation", "film", "podcast", "sound",
]);
const FORMULA_HINTS = /\b(formula|recipe|composition|chem|molecule|alloy|blend)\b/i;
const DATASET_HINTS = /\b(dataset|csv|parquet|table|timeseries|corpus)\b/i;
const SOFTWARE_HINTS = /\b(software|code|package|module|library|app|sdk|script)\b/i;
const WORLD_HINTS = /\b(world_asset|building|prop|vehicle|npc_asset|mesh|gltf|glb)\b/i;
const KNOWLEDGE_HINTS = /\b(knowledge|claim|theorem|invariant|definition|essay|paper)\b/i;

function _norm(s) {
  return String(s || "").trim().toLowerCase();
}

function _arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Infer content class from mime / type / input / DTU-ish shape.
 * Explicit contentClass|class|meta.contentClass wins when valid.
 */
export function inferClass(input = {}) {
  const explicit = _norm(
    input.contentClass || input.class || input.meta?.contentClass || input.dtu?.contentClass
  );
  if (CLASS_SET.has(explicit)) return explicit;

  const mime = _norm(input.mime || input.mimeType || input.media?.mimeType || input.artifact?.mimeType || input.machine?.mimeType);
  const mediaType = _norm(input.mediaType || input.media?.mediaType || input.meta?.mediaType || input.type);
  const domain = _norm(input.domain || input.lens || input.meta?.lens || input.meta?.domain);
  const type = _norm(input.type || input.kind || input.meta?.type || input.machine?.kind);
  const tags = _arr(input.tags).map(_norm);
  const title = _norm(input.title);
  const blob = [mime, mediaType, domain, type, title, tags.join(" ")].join(" ");

  if (mime && (MEDIA_MIME_PREFIXES.some((p) => mime.startsWith(p)) || MEDIA_MIME_EXACT.has(mime))) {
    return "media";
  }
  if (MEDIA_TYPES.has(mediaType) || MEDIA_DOMAINS.has(domain) || tags.some((t) => MEDIA_TYPES.has(t) || MEDIA_DOMAINS.has(t))) {
    return "media";
  }
  if (DATASET_MIME.has(mime) || type === "dataset" || DATASET_HINTS.test(blob)) return "dataset";
  if (SOFTWARE_MIME.has(mime) || type === "code" || type === "software" || SOFTWARE_HINTS.test(blob)) return "software";
  if (type === "world_asset" || type === "building" || WORLD_HINTS.test(blob)) return "world_asset";
  if (type === "formula" || input.composition || input.core?.composition || FORMULA_HINTS.test(blob)) return "formula";
  if (type === "knowledge" || KNOWLEDGE_HINTS.test(blob)) return "knowledge";

  // Rich academic core without media → knowledge
  const core = input.core || {};
  const academic =
    _arr(core.definitions).length +
    _arr(core.invariants).length +
    _arr(core.claims).length +
    _arr(core.examples).length +
    _arr(core.nextActions).length;
  if (academic >= 2) return "knowledge";

  return "generic";
}

export function getAdmissionProfile(contentClass) {
  const cls = CLASS_SET.has(contentClass) ? contentClass : "generic";
  return ADMISSION_PROFILES[cls] || ADMISSION_PROFILES.generic;
}

function _hasComposition(dtu) {
  const c = dtu?.core?.composition ?? dtu?.composition ?? dtu?.machine?.composition ?? dtu?.meta?.composition;
  if (c == null) return false;
  if (typeof c === "string") return c.trim().length > 0;
  if (Array.isArray(c)) return c.length > 0;
  if (typeof c === "object") return Object.keys(c).length > 0;
  return Boolean(c);
}

function _hasMediaSignal(dtu) {
  if (dtu?.mediaType || dtu?.mimeType || dtu?.media?.mimeType || dtu?.media?.mediaType) return true;
  if (dtu?.artifact?.mimeType || dtu?.artifact?.url || dtu?.artifact?.path) return true;
  if (dtu?.machine?.mimeType || dtu?.machine?.mediaType || dtu?.machine?.mediaUrl) return true;
  if (dtu?.meta?.mimeType || dtu?.meta?.mediaType || dtu?.meta?.mediaUrl) return true;
  if (Array.isArray(dtu?.attachments) && dtu.attachments.length > 0) return true;
  const tags = _arr(dtu?.tags).map(_norm);
  if (tags.some((t) => MEDIA_TYPES.has(t) || MEDIA_DOMAINS.has(t))) return true;
  const domain = _norm(dtu?.domain || dtu?.meta?.lens);
  if (MEDIA_DOMAINS.has(domain)) return true;
  return false;
}

function _academicScore(core = {}) {
  return (
    _arr(core.definitions).length +
    _arr(core.invariants).length +
    _arr(core.examples).length +
    _arr(core.claims).length +
    _arr(core.nextActions).length
  );
}

/**
 * Class-aware admission score for councilGate.
 *
 * @returns {{
 *   ok: boolean,
 *   score: number,
 *   minScore: number,
 *   contentClass: string,
 *   reason?: string,
 *   profile: object
 * }}
 */
export function scoreAdmission(dtu, opts = {}) {
  const contentClass = inferClass({
    ...dtu,
    contentClass: opts.contentClass || dtu?.contentClass || dtu?.meta?.contentClass,
    mime: dtu?.mimeType || dtu?.media?.mimeType || dtu?.artifact?.mimeType,
    mediaType: dtu?.mediaType || dtu?.media?.mediaType,
    type: dtu?.type || dtu?.kind || dtu?.meta?.type,
    domain: dtu?.domain,
    tags: dtu?.tags,
    core: dtu?.core,
    composition: dtu?.composition || dtu?.core?.composition,
    title: dtu?.title,
  });
  const profile = getAdmissionProfile(contentClass);

  const promotePublic =
    opts.promotePublic === true ||
    opts.publicPromotion === true ||
    dtu?.visibility === "public" ||
    dtu?.meta?.visibility === "public" ||
    dtu?.meta?.visibility === "published" ||
    dtu?.scope === "global" ||
    dtu?.scope === "marketplace";

  const userInitiated = opts.userInitiated === true;
  let minScore = promotePublic
    ? profile.publicMin
    : userInitiated
      ? profile.personalMin
      : Math.max(profile.personalMin, 2);

  // Legacy override still respected when caller sets minScore explicitly
  if (typeof opts.minScore === "number" && Number.isFinite(opts.minScore)) {
    minScore = opts.minScore;
  }

  let score = 0;
  const core = dtu?.core || {};

  if (profile.useAcademicCore) {
    score += _academicScore(core);
  }

  // Title / summary always help a little for user saves
  if (userInitiated && (dtu?.human?.summary || dtu?.title)) score += 1;

  if (contentClass === "media") {
    if (_hasMediaSignal(dtu)) score += 2;
    else if (dtu?.title || dtu?.human?.summary) score += 1; // title-only media draft
  }

  if (contentClass === "formula") {
    if (_hasComposition(dtu)) score += 2;
  }

  if (contentClass === "world_asset") {
    if (dtu?.title || dtu?.meta?.assetId || dtu?.machine?.assetId || dtu?.artifact) score += 1;
  }

  if (contentClass === "dataset") {
    const schema = dtu?.core?.schema || dtu?.machine?.schema || dtu?.meta?.schema;
    if (schema) score += 1;
    if (dtu?.artifact || dtu?.meta?.rowCount != null) score += 1;
  }

  if (contentClass === "software") {
    if (dtu?.machine?.entrypoint || dtu?.meta?.entrypoint || dtu?.artifact) score += 1;
    if (_arr(core.invariants).length || _arr(core.examples).length) score += 0; // already in academic
  }

  // Public formula must show composition when profile asks
  if (promotePublic && profile.requireCompositionForPublic && !_hasComposition(dtu)) {
    return {
      ok: false,
      score,
      minScore,
      contentClass,
      reason: profile.rejectReason,
      profile,
    };
  }

  if (score < minScore) {
    return {
      ok: false,
      score,
      minScore,
      contentClass,
      reason: profile.rejectReason || "low_value",
      profile,
    };
  }

  return { ok: true, score, minScore, contentClass, profile };
}

export default {
  CONTENT_CLASSES,
  ADMISSION_PROFILES,
  inferClass,
  getAdmissionProfile,
  scoreAdmission,
};
