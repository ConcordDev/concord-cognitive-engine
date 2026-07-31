// server/lib/detectors/internal-actor-stamp-detector.js
//
// Seeded by a real, confirmed vulnerability (SECURITY audit 2026-07-27,
// server.js#runJob): `jobs.enqueue` is a user-reachable macro that accepts an
// arbitrary domain.name job kind. The job runner used to build the execution
// ctx by spreading the job's caller-supplied actor and then unconditionally
// stamping `internal: true` on top — `{ ...j.actor, internal: true }` — which
// let any authenticated user route ANY macro through the job queue to pick up
// internal-context privileges (council-gate skip, HTTP-layer-gate bypass)
// they would never have calling the macro directly. Fixed by gating the
// internal stamp behind an explicit isSystemJob check.
//
// The FIX for that one call site is real and confirmed in the current tree.
// This detector is the permanent regression guard for the SHAPE of the bug,
// not a re-check of that one site: `{ ...IDENTIFIER, internal: true }` (or the
// equivalent `.internal = true` assignment on an object built from a
// non-literal source) is exactly the pattern that turns "internal" from a
// hardcoded system-context marker into something a caller-influenced value
// can carry along for the ride. A hardcoded actor literal
// (`{ userId: "system", role: "owner", internal: true }`) is the legitimate,
// safe shape — it can't be influenced by any request. Spreading a variable
// into the same object is the risky shape, because nothing in a static scan
// can prove the spread source is genuinely trustworthy at that point — that
// requires the kind of manual trace this bug needed. Every instance is
// therefore a required-review finding, allowlisted individually once
// verified guarded (same posture as authz-coverage's bypass-path pinning).

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, lineOf, walk } from "./_framework.js";

// `{ ...ident, internal: true }` / `{...ident,internal:true}` — spread-then-stamp.
const SPREAD_STAMP_RE = /\{\s*\.\.\.([A-Za-z_$][\w$.?]*)\s*,\s*internal\s*:\s*true/g;
// `target.internal = true` where target isn't obviously a hardcoded local
// built entirely from a literal on the same statement (heuristic: flag all,
// then exempt via ALLOWLIST — same "surface everything, allowlist reviewed"
// posture as the rest of the suite rather than trying to prove safety here).
const ASSIGN_STAMP_RE = /\b([A-Za-z_$][\w$.]*)\s*\.\s*internal\s*=\s*true\b/g;

// Reviewed, confirmed-guarded instances. Each entry names the exact site
// (file substring + nearby text) so a moved/renamed guard re-surfaces as a
// finding rather than silently staying allowlisted after the code around it
// changed shape.
const ALLOWLIST = [
  {
    file: "server.js",
    nearText: "isSystemJob",
    reason:
      "runJob() gates this stamp behind an explicit isSystemJob check (job.actor.internal===true or role in {system,owner,founder}); a user-enqueued job takes the OTHER branch and gets ctx.internal=false + actor.internal=false. Fixed + reviewed 2026-07-27.",
  },
  {
    file: "server.js",
    nearText: "function makeInternalCtx(source",
    reason:
      "This IS the canonical, single, trusted factory that mints an internal ctx (`makeInternalCtx`) — not a caller-influenced spread/assign. It unconditionally marks the context as internal regardless of its `source` parameter; `source` only ever becomes the actor's userId (an attribution string), never the internal-flag's value, so a caller cannot toggle whether internal status is granted by calling this function. The real question for this pattern is REACHABILITY — which code paths call makeInternalCtx(), not what its own definition does — and that's a call-site-by-call-site review question this static detector can't answer generically (the same reason the jobs.enqueue bug was a reachability bug, not a value-control bug). Reviewed 2026-07-31 (public-read-write-verb-detector pass).",
  },
];

function isAllowlisted(rel, content, matchIndex) {
  const windowStart = Math.max(0, matchIndex - 800);
  const window = content.slice(windowStart, matchIndex);
  return ALLOWLIST.some((a) => rel.endsWith(a.file) && window.includes(a.nearText));
}

/**
 * Strip `//` line comments and `/* *\/` block comments, replacing removed
 * characters with spaces (never newlines) so every match index / line number
 * computed against the result still lines up with the ORIGINAL source.
 * Load-bearing for this detector specifically: its own source file explains
 * the bug shape it looks for by quoting the exact risky pattern in prose
 * (`{ ...j.actor, internal: true }`, `x.internal = true`) — without this,
 * the detector matches its own documentation and flags itself. Same
 * self-inflicted-false-positive class CLAUDE.md documents for the UX-polish
 * grader's generic-scaffold detector, fixed here the same way rather than
 * softening the pattern.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      out += "  "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) { out += "  "; i += 2; }
      continue;
    }
    out += src[i]; i++;
  }
  return out;
}

export async function runInternalActorStampDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("internal-actor-stamp", "no_root", null, t0);
  try {
    // server/lib/detectors/*.js is excluded: this whole suite is static
    // analysis code that never constructs a privileged runtime ctx, and its
    // own ALLOWLIST entries necessarily quote the risky pattern in prose
    // (a `reason:` STRING, which stripComments() correctly does not touch —
    // stripping string content would be wrong in general). This detector
    // self-matched its own allowlist reason text twice this session before
    // this exclusion was added; excluding the directory is the durable fix,
    // not just careful wording (which the next added ALLOWLIST entry could
    // just as easily reintroduce).
    const detectorsDir = path.join(root, "server", "lib", "detectors") + path.sep;
    const files = [
      path.join(root, "server", "server.js"),
      ...(await walk(path.join(root, "server", "domains"), [".js"])),
      ...(await walk(path.join(root, "server", "routes"), [".js"])),
      ...(await walk(path.join(root, "server", "lib"), [".js"])).filter((f) => !f.startsWith(detectorsDir)),
    ];

    const findings = [];
    let scanned = 0, flagged = 0, exempted = 0;
    for (const f of files) {
      const content = await readSafe(f);
      if (!content) continue;
      scanned++;
      const rel = relPath(root, f);
      // Match against a comment-stripped view — see stripComments' doc
      // comment for why this is load-bearing, not cosmetic, for this
      // specific detector. Positions/line numbers stay valid against
      // `content` because stripComments preserves length and newlines.
      const scan = stripComments(content);

      SPREAD_STAMP_RE.lastIndex = 0;
      let m;
      while ((m = SPREAD_STAMP_RE.exec(scan)) != null) {
        const lineNo = lineOf(content, m.index);
        if (isAllowlisted(rel, content, m.index)) { exempted++; continue; }
        flagged++;
        findings.push({
          id: "internal_actor_stamp_spread",
          severity: "high",
          kind: "static",
          category: "security",
          subject: { kind: "file", path: rel, line: lineNo },
          message: `${rel}:${lineNo} builds an actor/ctx via "{ ...${m[1]}, internal: true }" — spreading a non-literal source while stamping internal:true is the exact shape that let jobs.enqueue grant internal-context privileges to user-triggered calls (SEC audit 2026-07-27). Verify the spread source cannot be caller-influenced at this point, then allowlist with a reason.`,
          location: `${rel}:${lineNo}`,
          evidence: { spreadSource: m[1] },
          fixHint: "verify_spread_source_is_system_only_or_gate_before_stamping",
        });
      }

      ASSIGN_STAMP_RE.lastIndex = 0;
      while ((m = ASSIGN_STAMP_RE.exec(scan)) != null) {
        const lineNo = lineOf(content, m.index);
        if (isAllowlisted(rel, content, m.index)) { exempted++; continue; }
        flagged++;
        findings.push({
          id: "internal_actor_stamp_assign",
          severity: "medium",
          kind: "static",
          category: "security",
          subject: { kind: "file", path: rel, line: lineNo },
          message: `${rel}:${lineNo} sets "${m[1]}.internal = true" — verify this target was constructed from a trusted, non-caller-influenced source before this point.`,
          location: `${rel}:${lineNo}`,
          evidence: { target: m[1] },
          fixHint: "verify_target_is_system_only_or_gate_before_stamping",
        });
      }
    }

    findings.unshift({
      id: "internal_actor_stamp_summary",
      severity: "info",
      kind: "static",
      category: "security",
      message: `Scanned ${scanned} file(s) for internal:true stamps built from a non-literal source; ${flagged} require review, ${exempted} already reviewed+allowlisted`,
      evidence: { scanned, flagged, exempted },
    });

    return makeReport("internal-actor-stamp", findings, t0);
  } catch (err) {
    return makeError("internal-actor-stamp", "exception", err, t0);
  }
}
