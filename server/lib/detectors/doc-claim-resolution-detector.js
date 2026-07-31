// server/lib/detectors/doc-claim-resolution-detector.js
//
// Seeded by a real instance found this session: a plan doc described
// "server/lib/external-fetch.js has NO SSRF guard" as the largest remaining
// security item — and the file had, in fact, already been fixed (guarded via
// fetchPublicUrl, dated 2026-07-27), which only came to light by directly
// reading the source instead of trusting the doc. CLAUDE.md's own "Docs are a
// build artifact, not prose" section already gates NUMBER claims with
// reproduction commands (scripts/check-doc-claims-all.mjs) and TEST-LINK
// claims (scripts/verify-invariant-test-links.mjs). Neither covers the third
// shape: a prose claim that something is fixed/closed/resolved/shipped,
// naming a specific file (optionally `#functionName` or `:lineNumber`). That
// claim can drift exactly like a number can — the file gets renamed, the
// function gets removed in a later refactor, or (the sharper failure mode)
// the fix described was reverted and the doc never caught up.
//
// This detector does NOT verify the SEMANTIC claim (whether the fix is still
// correct) — that's undecidable statically. It verifies the CHEAPER, honest
// precondition: does the referenced file still exist, and if a function name
// was named, does that identifier still appear in the file at all. A claim
// that fails even this weak check is definitely stale; a claim that passes
// it might still be substantively wrong, which is why findings here are
// "verify this claim", not "this claim is false".

import path from "node:path";
import { readSafe, makeReport, makeError, walk } from "./_framework.js";

const FIXED_KEYWORDS = /\b(fixed|closed|resolved|patched|shipped)\b/i;
// Backticked `path/to/file.ext` or `path/to/file.ext:123` or
// `path/to/file.ext#functionName` — requires a slash so bare identifiers
// (`isSafePathSegment`) and prose (`config`) don't false-positive.
const FILE_REF_RE = /`([\w./-]+\/[\w.-]+\.(?:js|ts|tsx|jsx|mjs|py))(?:[:#]([A-Za-z_][\w]*))?`/g;
const PLACEHOLDER_RE = /path\/to\/|yourname|\.\.\.\//;

// A line that cites another project's GitHub repo (e.g. verifying a macro's
// field names against "github.com/freelawproject/courtlistener" because the
// real API was network-blocked) is citing THAT repo's own source file, not
// claiming a path in OUR tree — the "fixed/closed" keyword on the line
// describes the Concord macro, not the cited external file. This repo's own
// GitHub org (ConcordDev) is excluded from the "external" set so a citation
// of Concord's own repo URL still counts normally. Confirmed real instance:
// docs/lens-specs/law-capability-map.md citing CourtListener's
// `cl/search/forms.py` — without this guard it false-positives as stale
// every run, and a blunter "ref must start with a real top-level dir" filter
// would also have swallowed genuine findings like a bare `register/page.tsx`
// shorthand reference that really has gone stale.
// Three idioms actually observed in this repo's own docs for citing an
// external project's source (all found running this detector for real, on
// docs/{FRONTEND_REBUILD_PROGRAM,WAVE4_INVENTORY}.md + lens-specs/law-
// capability-map.md — each a DIFFERENT phrasing of the same CourtListener
// citation): a full github.com/owner/repo URL, a raw.githubusercontent.com
// fetch, and a bare "owner/repo" shorthand token sitting near the word
// "GitHub" with no URL at all. All three exclude this project's own org.
// githubusercontent.com alone (no trailing path) is already a strong enough
// external-source signal on its own; github.com specifically still requires
// a path so a bare mention of "github.com" in passing doesn't over-trigger.
const EXTERNAL_GITHUB_URL_RE = /githubusercontent\.com\b|github\.com\/(?!concorddev\/)[\w-]+(?:\/[\w.-]+)?/i;
const EXTERNAL_OWNER_REPO_NEAR_GITHUB_RE = /\bGitHub\b[\s\S]{0,80}?\b(?!concorddev\/)([\w-]+)\/([\w.-]+)\b|\b([\w-]+)\/([\w.-]+)\b[\s\S]{0,80}?\bGitHub\b/i;

function citesExternalRepo(line) {
  if (EXTERNAL_GITHUB_URL_RE.test(line)) return true;
  const m = EXTERNAL_OWNER_REPO_NEAR_GITHUB_RE.exec(line);
  if (!m) return false;
  const owner = (m[1] || m[3] || "").toLowerCase();
  return owner !== "concorddev" && owner !== "";
}

const BASES = ["server", "concord-frontend", "."];

async function resolveFile(root, ref) {
  for (const base of BASES) {
    const p = path.join(root, base, ref);
    const c = await readSafe(p);
    if (c) return { path: p, content: c };
    // Also try the ref as already-rooted (e.g. "server/lib/x.js").
    const p2 = path.join(root, ref);
    const c2 = await readSafe(p2);
    if (c2) return { path: p2, content: c2 };
  }
  return null;
}

export async function runDocClaimResolutionDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("doc-claim-resolution", "no_root", null, t0);
  try {
    const docFiles = [path.join(root, "CLAUDE.md")];
    const docsDir = path.join(root, "docs");
    for (const f of await walk(docsDir, [".md"])) docFiles.push(f);

    const findings = [];
    let claimsChecked = 0, staleClaims = 0;

    for (const docFile of docFiles) {
      const content = await readSafe(docFile);
      if (!content) continue;
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!FIXED_KEYWORDS.test(line)) continue;
        if (citesExternalRepo(line)) continue; // citing another project's own source, not ours

        FILE_REF_RE.lastIndex = 0;
        let m;
        while ((m = FILE_REF_RE.exec(line)) != null) {
          const ref = m[1];
          const symbol = m[2] && /^\d+$/.test(m[2]) ? null : m[2]; // a pure digit is a line number, not a symbol
          if (PLACEHOLDER_RE.test(ref)) continue;
          claimsChecked++;

          const resolved = await resolveFile(root, ref);
          const docRel = path.relative(root, docFile);
          if (!resolved) {
            staleClaims++;
            findings.push({
              id: "doc_claim_file_not_found",
              severity: "medium",
              kind: "static",
              category: "docs",
              subject: { kind: "doc", path: docRel, line: i + 1 },
              message: `${docRel}:${i + 1} claims something is fixed/closed, referencing "${ref}", but that file no longer exists — verify the claim is still true and update or remove the stale reference`,
              location: `${docRel}:${i + 1}`,
              evidence: { ref, docFile: docRel },
              fixHint: "verify_and_update_stale_doc_claim",
            });
            continue;
          }
          if (symbol && !new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(resolved.content)) {
            staleClaims++;
            findings.push({
              id: "doc_claim_symbol_not_found",
              severity: "medium",
              kind: "static",
              category: "docs",
              subject: { kind: "doc", path: docRel, line: i + 1 },
              message: `${docRel}:${i + 1} claims something is fixed/closed at "${ref}#${symbol}", but "${symbol}" no longer appears in that file — verify the claim is still true`,
              location: `${docRel}:${i + 1}`,
              evidence: { ref, symbol, docFile: docRel },
              fixHint: "verify_and_update_stale_doc_claim",
            });
          }
        }
      }
    }

    findings.unshift({
      id: "doc_claim_resolution_summary",
      severity: "info",
      kind: "static",
      category: "docs",
      message: `Checked ${claimsChecked} "fixed/closed"-adjacent file reference(s) across ${docFiles.length} doc file(s); ${staleClaims} no longer resolve`,
      evidence: { docFiles: docFiles.length, claimsChecked, staleClaims },
    });

    return makeReport("doc-claim-resolution", findings, t0);
  } catch (err) {
    return makeError("doc-claim-resolution", "exception", err, t0);
  }
}
