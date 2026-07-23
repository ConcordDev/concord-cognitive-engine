// server/lib/detectors/lens-manifest-capability-detector.js
//
// OP4 (2026-07-23) — manifest/capability coverage detector.
//
// `concord-frontend/lib/lenses/manifest.ts` is a DECLARATIVE capability
// manifest — every lens's `macros: { list?, get?, create?, update?, delete?,
// run?, export? }` object claims a literal "domain.name" macro string that
// (per the file's own header comment) the generic UI shell + tooling treat
// as "this is the real backend action that fulfils this capability." Unlike
// `dead-macro-call-detector.js` (which walks LITERAL runtime call sites —
// `lensRun(...)` / `runMacro(...)` / `runDomain(...)` — in frontend source),
// nothing walks this declarative metadata and checks whether the claimed
// macro actually exists in the real MACROS/LENS_ACTIONS registry. A manifest
// claim can drift silently: the string is never invoked directly (it's
// consumed by generic-shell tooling and score-lenses' capability scoring,
// not dispatched as `lensRun(...)`), so a stale/wrong claim produces no
// runtime error anywhere — it just quietly lies about what a lens can do.
//
// PROOF THIS BUG CLASS IS REAL: `concord-frontend/lib/lenses/manifest.ts`'s
// own `sentinel` entry carries a comment — "Phantom `lens.sentinel.*` refs
// replaced with the REAL registered macros" — documenting a past manual fix
// of exactly this drift. This detector is the permanent, automated version
// of that one-off manual catch. Running it against the CURRENT tree (see the
// real-tree pinning test) finds the training-room entry still carries the
// same bug: `list: 'lens.training-room.list_skills'` and
// `get: 'lens.training-room.frame_data'` are unresolved — server/domains/
// training-room.js registers `list_skills`/`frame_data` directly under the
// `training-room` domain (`register("training-room", "list_skills", …)`),
// never under the generic `lens` artifact-CRUD domain — so the manifest
// entry should read `training-room.list_skills` / `training-room.frame_data`
// (no `lens.` prefix), the same fix already applied to `sentinel`.
//
// ADDRESSING CONVENTION (verified against real registrations, not assumed):
//   - A claim like `careers.tracks` or `civic_bonds.pledge` is a literal
//     "domain.name" pair: split on the FIRST dot. `register("careers",
//     "tracks", …)` / `register("civic_bonds", "pledge", …)` are real.
//   - A claim like `lens.world.list` routes through the GENERIC lens
//     artifact-CRUD runtime (`register("lens", "list"|"get"|"create"|
//     "update"|"delete"|"run"|"export", …)` in server.js, parameterized by
//     `input.domain`) — the middle segment ("world") is the artifact-kind
//     parameter, not part of the registered macro name. Only the TRAILING
//     segment (`list`) is the real registered name, always under domain
//     `lens`. This is legitimate ONLY when the trailing segment is one of
//     the seven reserved CRUD verbs the generic runtime actually registers.
//     A `lens.<domain>.<anythingElse>` claim (e.g. `lens.training-room.
//     list_skills`) has no matching `register("lens", "list_skills", …)`
//     anywhere — the generic runtime has no such action — so it is always
//     unbacked and always flagged.
//
// Precision discipline (mirrors dead-macro-call-detector.js's own
// discipline, and reuses its exact registered-pairs builder rather than
// re-deriving a second, potentially-drifting notion of "what's registered"):
//   - Only the well-typed `macros: {...}` object is checked. The sibling
//     `actions: string[]` field is deliberately NOT checked here — its own
//     type comment ("Domain-specific actions available via run") and real
//     content (e.g. careers' `actions: ['browse', 'work', 'offer', 'accept']`,
//     where 'browse' matches no registered careers macro at all) show it's a
//     looser UI-verb vocabulary, not a literal macro-name claim — flagging it
//     would be noise, not signal.
//   - `macros: {}` (a deliberately empty object, e.g. the `ops-telemetry`
//     entry — a REST-only dashboard with no macro surface) contributes zero
//     claims and zero findings, by design.

import path from "node:path";
import { readSafe, makeReport, makeError, relPath } from "./_framework.js";
import { buildRegisteredMacroPairs } from "./dead-macro-call-detector.js";

const MANIFEST_KEYS = ["list", "get", "create", "update", "delete", "run", "export"];
const GENERIC_LENS_VERBS = new Set(MANIFEST_KEYS);

/** Extract a balanced `{ ... }` or `[ ... ]` block starting at `openIdx`. */
function extractBalanced(src, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  return null;
}

/**
 * Parse every `macros: { ... }` block in the manifest source and pair each
 * with the nearest PRECEDING `domain: '...'` (every manifest object literal
 * declares `domain` before `macros`, so "nearest preceding" is unambiguous).
 * Returns [{ manifestDomain, key, value, line }].
 */
export function parseManifestMacroClaims(src) {
  const claims = [];
  const macroBlockRe = /macros\s*:\s*\{/g;
  let m;
  while ((m = macroBlockRe.exec(src)) != null) {
    const braceIdx = src.indexOf("{", m.index);
    const block = extractBalanced(src, braceIdx, "{", "}");
    if (block == null) continue;

    const before = src.slice(0, m.index);
    const domainMatches = [...before.matchAll(/domain\s*:\s*['"`]([a-zA-Z0-9_-]+)['"`]/g)];
    const manifestDomain = domainMatches.length ? domainMatches[domainMatches.length - 1][1] : null;
    const line = src.slice(0, m.index).split("\n").length;

    const pairRe = new RegExp(
      String.raw`\b(${MANIFEST_KEYS.join("|")})\s*:\s*['"\`]([a-zA-Z0-9_.-]+)['"\`]`,
      "g"
    );
    let pm;
    while ((pm = pairRe.exec(block)) != null) {
      claims.push({ manifestDomain, key: pm[1], value: pm[2], line });
    }
  }
  return claims;
}

/**
 * Resolve one manifest macro-string claim against the real registered
 * (domain, name) pairs (a `Map` keyed `"domain name"`, from
 * `buildRegisteredMacroPairs`). Returns `{ resolved: boolean, domain, name,
 * viaGenericLens: boolean }` — pure, independently testable.
 */
export function resolveManifestClaim(value, registeredPairs) {
  if (value.startsWith("lens.")) {
    const segs = value.split(".");
    const verb = segs[segs.length - 1];
    if (GENERIC_LENS_VERBS.has(verb) && registeredPairs.has(`lens ${verb}`)) {
      return { resolved: true, domain: "lens", name: verb, viaGenericLens: true };
    }
    return { resolved: false, domain: "lens", name: verb, viaGenericLens: true };
  }
  const dotIdx = value.indexOf(".");
  if (dotIdx < 0) return { resolved: false, domain: null, name: value, viaGenericLens: false };
  const domain = value.slice(0, dotIdx);
  const name = value.slice(dotIdx + 1);
  return { resolved: registeredPairs.has(`${domain} ${name}`), domain, name, viaGenericLens: false };
}

export async function runLensManifestCapabilityDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("lens-manifest-capability", "no_root", null, t0);

  try {
    const manifestPath = path.join(root, "concord-frontend", "lib", "lenses", "manifest.ts");
    const src = await readSafe(manifestPath);
    if (!src) return makeError("lens-manifest-capability", "manifest_missing", null, t0);

    const claims = parseManifestMacroClaims(src);
    const registeredPairs = await buildRegisteredMacroPairs(root);

    const findings = [];
    let uncheckable = 0;
    let checked = 0;
    let unbacked = 0;

    for (const claim of claims) {
      const resolution = resolveManifestClaim(claim.value, registeredPairs);
      if (resolution.domain == null) {
        uncheckable++;
        continue;
      }
      checked++;
      if (!resolution.resolved) {
        unbacked++;
        findings.push({
          id: "manifest_macro_unbacked",
          severity: "high",
          kind: "static",
          category: "wiring",
          message: `Lens manifest entry "${claim.manifestDomain}" claims ${claim.key}: '${claim.value}' but no register("${resolution.domain}", "${resolution.name}", …) / registerLensAction("${resolution.domain}", "${resolution.name}", …) exists anywhere in server/ — the manifest capability claim has no real backing macro.`,
          location: `${relPath(root, manifestPath)}:${claim.line}`,
          evidence: { manifestDomain: claim.manifestDomain, key: claim.key, value: claim.value, resolvedDomain: resolution.domain, resolvedName: resolution.name },
          fixHint: "point_manifest_macro_at_real_registration_or_register_it",
          subject: { kind: "manifest-entry", domain: claim.manifestDomain },
        });
      }
    }

    findings.unshift({
      id: "lens_manifest_capability_summary",
      severity: "info",
      kind: "static",
      category: "wiring",
      message: `Scanned ${claims.length} lens-manifest macro claim(s): ${checked} checkable (${unbacked} unbacked), ${uncheckable} uncheckable (no dot / malformed)`,
      evidence: { totalClaims: claims.length, checked, unbacked, uncheckable },
    });

    return makeReport("lens-manifest-capability", findings, t0);
  } catch (err) {
    return makeError("lens-manifest-capability", "exception", err, t0);
  }
}
