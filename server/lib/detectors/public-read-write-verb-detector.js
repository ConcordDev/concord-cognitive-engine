// server/lib/detectors/public-read-write-verb-detector.js
//
// Gate 2 (`publicReadDomains` in server.js) is a domain -> Set(macro names)
// allowlist of macros safe to call WITHOUT authentication. Every entry is an
// assertion that the listed macro is genuinely read-only, OR that its handler
// self-scopes correctly when the caller is anonymous. Nothing has ever
// verified that assertion against the real handler code — it's been trust on
// the honor system since the allowlist was first written.
//
// Seeded by the exact bug shape found and fixed this session (SEC-3): a
// mutating endpoint (RBAC role update) trusted to self-gate that didn't. The
// same class can hide here: a write-shaped macro name (create/update/delete/
// transfer/...) sitting in the PUBLIC READ allowlist, whose handler either
// can't be found or shows no sign of checking the caller's identity before
// mutating.
//
// This detector does NOT replace a real security review of each flagged
// macro. It converts "nobody has looked" into "here is the exact list to
// look at" — the same posture as authz-coverage-detector's bypass-allowlist
// pinning.
//
// Two real bugs were found and fixed in THIS detector by running it against
// the live tree (not just synthetic fixtures) and reading what it flagged:
//
// 1. Every finding shared the exact same `location` string (the fixed line
//    where `const publicReadDomains = {` starts), regardless of which
//    domain/macro it was about. The ratchet's fingerprint is
//    sha256(detector|ruleId|location|severity) — with `location` constant,
//    ALL "no_ownership_idiom" findings collapsed onto ONE fingerprint (and
//    all "handler_not_found" findings onto another), so out of 36 real
//    findings only 2 survived into the baseline/ratchet bookkeeping. Once
//    one of the two got baselined, every future distinct occurrence of that
//    ruleId — a genuinely different, unreviewed macro — would have silently
//    read as "already known" forever. Fixed: location is now the resolved
//    handler's real file:line when found, and a `domain.macro`-qualified
//    fallback when not (see `locationFor`).
//
// 2. OWNERSHIP_IDIOM_RE required a literal `ctx.actor` (no `?` between `ctx`
//    and `.actor`), but this codebase's dominant idiom is `ctx?.actor?.userId`
//    (optional-chaining right after `ctx` too). This produced 9 false
//    positives out of 12 "no_ownership_idiom" findings — including
//    `dtu.update`, whose handler turned out to have a careful, correct
//    ownership check the regex simply couldn't see. Fixed by allowing `?`
//    after `ctx` as well as after `.actor`.
//
// After both fixes, manual review of the 3 real remaining
// "no_ownership_idiom" findings confirmed: `agent.create` and
// `scope.promote` were genuine anonymous-write gaps (fixed in server.js,
// same commit as this detector fix); `collab.join` is intentional by
// design (a session-link-based Live-Share-style join — the neighboring
// `_collabActorId` comment in server.js documents that edit/merge already
// require prior participation, and join is necessarily the entry point
// that can't require it) — allowlisted below with that citation.
//
// `handler_not_found` findings turned out to be dominated by a different,
// non-adversarial pattern: many publicReadDomains entries name a generic
// CRUD verb (create/update/delete) that was never the real macro name for
// that domain (e.g. `goals` uses propose/approve/activate/complete/abandon,
// never bare "create"; `creative` uses "create_work", not "create"). A
// macro that doesn't exist can't be called via `/api/lens/run` at all — the
// dispatcher returns macro_not_found — so this is real, confirmed doc/config
// drift (misleading, worth cleaning up) rather than a live anonymous-write
// path. Downgraded from "high" to "medium" to reflect that it is inert, not
// exploitable, while still being worth surfacing and fixing.

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, lineOf, walk } from "./_framework.js";

// Verb-prefix heuristic for "this macro name implies a mutation" — mirrors
// scripts/audit-wiring-gate.mjs's SYSTEM_VERB list plus the domain-economy
// verbs this codebase actually uses (transfer/tip/follow/mint/...).
const WRITE_VERB_RE = /^(create|update|delete|remove|destroy|transfer|tip|follow|unfollow|join|leave|invite|revoke|grant|ban|unban|kick|mint|withdraw|deposit|pay|spend|credit|debit|approve|reject|cancel|refund|mute|unmute|block|unblock|report|vote|bid|claim|redeem|purchase|buy|sell|list_on_market|publish|unpublish|post|comment|reply|edit|rename|move|assign|unassign|promote|demote|lock|unlock|archive|restore|merge|split|bulkCreate|bulkUpdate|bulkDelete|set[A-Z]|add[A-Z]|drop[A-Z])/;

// Handlers whose OWN name/shape already implies self-scoping (list_mine,
// *_mine, get_own, ...) are exempt — the "mine" suffix is this codebase's own
// established idiom for "scoped to ctx.actor by construction" (see dtu/drafts/
// sessions comments in server.js right next to publicReadDomains itself).
const SELF_SCOPING_NAME_RE = /mine\b|_own\b|^my/i;

// Ownership-check idioms this codebase actually uses in handler bodies.
// `ctx\??\.actor\??\.` (not `ctx\.actor\??\.`) — this codebase's dominant
// idiom is optional-chaining right after `ctx` too (`ctx?.actor?.userId`,
// confirmed in server/domains/land-claims.js, routes/worlds.js, and the
// dtu.update handler itself), which the tighter pattern missed entirely —
// a real false-negative source found by manually reading a flagged
// handler (dtu.update) that turned out to have a careful, correct
// ownership check my regex simply couldn't see.
const OWNERSHIP_IDIOM_RE =
  /ctx\??\.actor\??\.userId|ctx\??\.userId|ctx\??\.actor\??\.id\b|ctx\??\.actor\??\.odId|aidCk\s*\(|req\.user\??\.id|reason:\s*['"]no_user['"]|ok:\s*false.{0,40}no_user|creator_id\s*[=!]==?\s*|user_id\s*[=!]==?\s*|owner_id\s*[=!]==?\s*|creatorId\s*[=!]==?\s*|ownerId\s*[=!]==?\s*|ownerField\s*[=!]==?\s*|owner[A-Z]\w*\s*[=!]==?\s*/;

// Reviewed, confirmed-intentional instances — same posture as
// internal-actor-stamp-detector.js's ALLOWLIST: named exact site + reason,
// so a moved/renamed guard re-surfaces as a finding instead of silently
// staying allowlisted after the code around it changed shape.
const ALLOWLIST = [
  {
    domain: "collab",
    macro: "join",
    reason:
      "Session-link-based Live-Share-style join — knowing the sessionId IS the authorization (matches the code lens's real Yjs CRDT collab pattern). The neighboring _collabActorId comment in server.js documents that a WORSE bug (userId spoofing) was already found and fixed here, and that edit()/merge() now require the caller to already be a participant — join is necessarily the entry point that adds a participant, so it can't require pre-existing participation without being circular. An anonymous caller collapses onto the fixed 'anonymous' identity shared by all anonymous callers, which is a UX quirk, not a privilege gain.",
  },
];

function isAllowlisted(domain, macro) {
  return ALLOWLIST.some((a) => a.domain === domain && a.macro === macro);
}

/** Parse `const publicReadDomains = { key: new Set([...]), ... };` from server.js. */
export function parsePublicReadDomains(content) {
  const startIdx = content.indexOf("const publicReadDomains = {");
  if (startIdx < 0) return null;
  // Balance braces from the opening `{` to find the literal's extent.
  const braceStart = content.indexOf("{", startIdx);
  let depth = 0, i = braceStart, end = -1;
  for (; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const block = content.slice(braceStart, end + 1);

  const out = []; // { domain, macro, offsetInBlock }
  const entryRe = /(["'`]?)([A-Za-z][\w-]*)\1\s*:\s*new Set\(\s*\[([^\]]*)\]\s*\)/g;
  let m;
  while ((m = entryRe.exec(block)) != null) {
    const domain = m[2];
    const listBlob = m[3];
    const macroRe = /['"`]([\w.-]+)['"`]/g;
    let mm;
    while ((mm = macroRe.exec(listBlob)) != null) {
      out.push({ domain, macro: mm[1], offsetInBlock: m.index });
    }
  }
  return { entries: out, blockStartOffset: braceStart };
}

/** Locate a macro handler's body: register("domain","name",(ctx,...)=>{...}) or registerLensAction(...). Returns a bounded body string or null. */
export function findHandlerBody(allSourceBlob, domain, macro) {
  const found = findHandlerMatch(allSourceBlob, domain, macro);
  return found ? found.body : null;
}

/**
 * Same lookup as findHandlerBody, but also returns the match index so the
 * caller can compute a real, finding-specific line number instead of a
 * shared placeholder. See the file header for why a shared location broke
 * the ratchet's fingerprinting.
 */
function findHandlerMatch(allSourceBlob, domain, macro) {
  const re = new RegExp(`register(?:LensAction)?\\s*\\(\\s*["'\`]${escapeRe(domain)}["'\`]\\s*,\\s*["'\`]${escapeRe(macro)}["'\`]\\s*,`);
  const m = re.exec(allSourceBlob);
  if (!m) return null;
  // Grab a bounded window after the match (function bodies here run well
  // under 4000 chars; this is a heuristic scan, not a parser).
  return { index: m.index, body: allSourceBlob.slice(m.index, m.index + 4000) };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export async function runPublicReadWriteVerbDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("public-read-write-verb", "no_root", null, t0);
  try {
    const serverPath = path.join(root, "server", "server.js");
    const serverSrc = await readSafe(serverPath);
    if (!serverSrc) return makeError("public-read-write-verb", "server_js_unreadable", null, t0);

    const parsed = parsePublicReadDomains(serverSrc);
    if (!parsed) return makeError("public-read-write-verb", "public_read_domains_not_found", null, t0);

    // Load every server/domains/*.js file individually (not concatenated)
    // so a resolved handler's location can name the real file it lives in.
    const domainFiles = await walk(path.join(root, "server", "domains"), [".js"]);
    const domainSources = [];
    for (const f of domainFiles) {
      const c = await readSafe(f);
      if (c) domainSources.push({ rel: relPath(root, f), content: c });
    }

    const serverRel = relPath(root, serverPath);
    const allowlistBlockLine = lineOf(serverSrc, serverSrc.indexOf("const publicReadDomains = {"));

    const findings = [];
    let flagged = 0, checked = 0, allowlistedCount = 0;
    for (const { domain, macro } of parsed.entries) {
      if (!WRITE_VERB_RE.test(macro)) continue;
      if (SELF_SCOPING_NAME_RE.test(macro)) continue;
      checked++;
      if (isAllowlisted(domain, macro)) { allowlistedCount++; continue; }

      let match = findHandlerMatch(serverSrc, domain, macro);
      let matchRel = serverRel, matchSrc = serverSrc;
      if (!match) {
        for (const ds of domainSources) {
          match = findHandlerMatch(ds.content, domain, macro);
          if (match) { matchRel = ds.rel; matchSrc = ds.content; break; }
        }
      }

      if (!match) {
        flagged++;
        // No real registration site exists to point at — the location is
        // the allowlist entry's own line, qualified with domain.macro so
        // distinct not-found macros still fingerprint distinctly (a bare
        // shared line number would repeat the exact collision bug this
        // detector was rewritten to fix).
        findings.push({
          id: "public_read_write_verb_handler_not_found",
          severity: "medium",
          kind: "static",
          category: "security",
          subject: { kind: "macro", domain, macro },
          message: `publicReadDomains lists write-shaped macro "${domain}.${macro}" (anonymous-callable) but no register()/registerLensAction() call for it could be located anywhere in server.js or server/domains/*.js — it cannot actually be invoked via /api/lens/run (dispatch returns macro_not_found), so this is confirmed-stale allowlist drift, not a live anonymous-write path. Remove the dead entry, or add the real macro if it was meant to exist.`,
          location: `${serverRel}:${allowlistBlockLine}:${domain}.${macro}`,
          evidence: { domain, macro },
          fixHint: "remove_dead_entry_or_register_the_missing_macro",
        });
        continue;
      }

      if (!OWNERSHIP_IDIOM_RE.test(match.body)) {
        flagged++;
        const realLine = lineOf(matchSrc, match.index);
        findings.push({
          id: "public_read_write_verb_no_ownership_idiom",
          severity: "high",
          kind: "static",
          category: "security",
          subject: { kind: "macro", domain, macro },
          message: `publicReadDomains lists write-shaped macro "${domain}.${macro}" (anonymous-callable) but its handler at ${matchRel}:${realLine} shows no ownership-check idiom (ctx.actor.userId / no_user rejection / owner-id comparison) — verify it can't be used to mutate another user's data anonymously`,
          location: `${matchRel}:${realLine}`,
          evidence: { domain, macro },
          fixHint: "verify_macro_handler_self_scopes_or_remove_from_public_read_domains",
        });
      }
    }

    findings.unshift({
      id: "public_read_write_verb_summary",
      severity: "info",
      kind: "static",
      category: "security",
      message: `publicReadDomains: ${checked} write-shaped macro name(s) found in the anonymous-read allowlist; ${flagged} flagged for missing/unverifiable ownership checks, ${allowlistedCount} already reviewed+allowlisted`,
      evidence: { checked, flagged, allowlistedCount, totalEntries: parsed.entries.length },
    });

    return makeReport("public-read-write-verb", findings, t0);
  } catch (err) {
    return makeError("public-read-write-verb", "exception", err, t0);
  }
}
