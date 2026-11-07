// server/lib/walk-registry.js
//
// Walk → Registry Merge Pilot (founder directive 2026-11-06, option C).
//
// Serves the lens-walk corpus's VERIFIED knowledge into the MCP registry:
//   (A) a description overlay keyed by domain+macro that macro-reflection
//       consults when building reflected tool definitions, and
//   (B) the data behind the Tier-1 `walk_guide` tool (see mcp-tools.js).
//
// The single data source is walk-registry-data.json, generated from the
// pilot distillation record (MCP Platform lane, 2026-11-06:
// walk-registry-merge-pilot-distillation-record-2026-11-06.md). Only
// verified-working behaviour is distilled; walk findings are never spec.
// If the data needs a field this module does not carry, the record is
// amended first — this module never improvises content.
//
// Kill switch / measurement toggle: CONCORD_WALK_OVERLAY=off disables
// BOTH the overlay consult (macro-reflection falls back to the source
// descriptions untouched) and the walk_guide tool's registration, so the
// pilot's measurement arms run the identical tree with enrichment as the
// only variable. Default: on.

import fs from 'fs';

export const WALK_OVERLAY_ENABLED = process.env.CONCORD_WALK_OVERLAY !== 'off';

let _data = null;
function loadData() {
  if (_data) return _data;
  try {
    const raw = fs.readFileSync(new URL('./walk-registry-data.json', import.meta.url), 'utf8');
    _data = JSON.parse(raw);
  } catch (_e) {
    // A missing/corrupt sidecar must never break discovery: the overlay
    // simply has no entries and walk_guide reports itself unavailable.
    _data = { version: 0, overlay: {}, guide: {} };
  }
  return _data;
}

/** Overlay entry for one macro, or null. Keys are the exact registered
 *  spellings (domain as reflected, verb as registered — hyphens,
 *  underscores and camelCase preserved). */
export function walkOverlayEntry(domain, name) {
  if (!WALK_OVERLAY_ENABLED) return null;
  const d = loadData();
  return (d.overlay && d.overlay[domain] && d.overlay[domain][name]) || null;
}

/** All overlay entries for a domain: { verb: {text, args} } ({} if none). */
export function walkOverlayForDomain(domain) {
  if (!WALK_OVERLAY_ENABLED) return {};
  const d = loadData();
  return (d.overlay && d.overlay[domain]) || {};
}

/** Guide entry for a lens/domain: {core, provenance} or null. */
export function walkGuideEntry(lens) {
  if (!WALK_OVERLAY_ENABLED) return null;
  const d = loadData();
  return (d.guide && d.guide[lens]) || null;
}

export function walkGuideLenses() {
  if (!WALK_OVERLAY_ENABLED) return [];
  return Object.keys(loadData().guide || {});
}

/**
 * The walk_guide tool handler's data path. Read-only; executes nothing.
 *
 * args: { lens }  → that lens's verified core + provenance + its overlay
 *                   entries (the macros an agent can call with walk-
 *                   verified argument shapes).
 *       { macro } → full reflected name ("macro.<domain>.<verb>"): the
 *                   overlay entry for that macro (when one was distilled)
 *                   plus the owning lens's guide entry.
 * Every answer carries the provenance block (source walk file, walk
 * date/verdict, currency grade) per the founder brief.
 */
export function walkGuideLookup(args = {}) {
  if (!WALK_OVERLAY_ENABLED) {
    return { ok: false, error: 'walk_guide is disabled (CONCORD_WALK_OVERLAY=off)' };
  }
  const lens = typeof args.lens === 'string' ? args.lens.trim().toLowerCase() : '';
  const macro = typeof args.macro === 'string' ? args.macro.trim() : '';

  if (macro) {
    const m = macro.match(/^macro\.([^.]+)\.(.+)$/);
    if (!m) return { ok: false, error: 'macro must be a full reflected name, e.g. macro.neuro.statisticalTest' };
    const [, domain, verb] = m;
    const entry = walkGuideEntry(domain);
    if (!entry) {
      return { ok: false, error: `no walk guide entry for domain '${domain}'`, pilotLenses: walkGuideLenses() };
    }
    const ov = walkOverlayEntry(domain, verb);
    return {
      ok: true,
      macro,
      domain,
      overlay: ov
        ? { verifiedBehaviour: ov.text, args: ov.args }
        : { verifiedBehaviour: null, note: 'No overlay entry was distilled for this macro: the walk record does not bind this name to a verified flow. The lens guide entry below is the verified knowledge available.' },
      guide: entry.core,
      provenance: entry.provenance,
    };
  }

  if (lens) {
    const entry = walkGuideEntry(lens);
    if (!entry) {
      return { ok: false, error: `no walk guide entry for lens '${lens}'`, pilotLenses: walkGuideLenses() };
    }
    const overlay = walkOverlayForDomain(lens);
    return {
      ok: true,
      lens,
      guide: entry.core,
      provenance: entry.provenance,
      overlayEntries: Object.entries(overlay).map(([verb, e]) => ({
        macro: `macro.${lens}.${verb}`,
        verifiedBehaviour: e.text,
        args: e.args,
      })),
    };
  }

  return { ok: false, error: 'lens or macro is required', pilotLenses: walkGuideLenses() };
}
