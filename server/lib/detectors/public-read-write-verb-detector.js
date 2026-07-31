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
// mutating. A live instance already exists in the tree at the time this
// detector was written: `dtu: new Set([..., "create", "update", "delete",
// "bulkCreate", ...])` — flagged here for human review, not silently fixed,
// since the handler may in fact self-scope correctly and this detector can
// only prove "no ownership idiom found", never "definitely unsafe".
//
// This detector does NOT replace a real security review of each flagged
// macro. It converts "nobody has looked" into "here is the exact list to
// look at" — the same posture as authz-coverage-detector's bypass-allowlist
// pinning.

import path from "node:path";
import { readSafe, makeReport, makeError, relPath, lineOf } from "./_framework.js";

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
const OWNERSHIP_IDIOM_RE =
  /ctx\.actor\??\.userId|ctx\.userId|ctx\.actor\??\.id\b|aidCk\s*\(|req\.user\??\.id|reason:\s*['"]no_user['"]|ok:\s*false.{0,40}no_user|creator_id\s*[=!]==?\s*|user_id\s*[=!]==?\s*|owner_id\s*[=!]==?\s*|creatorId\s*[=!]==?\s*|ownerId\s*[=!]==?\s*/;

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
  const patterns = [
    new RegExp(`register(?:LensAction)?\\s*\\(\\s*["'\`]${escapeRe(domain)}["'\`]\\s*,\\s*["'\`]${escapeRe(macro)}["'\`]\\s*,`),
  ];
  for (const re of patterns) {
    const m = re.exec(allSourceBlob);
    if (!m) continue;
    // Grab a bounded window after the match (function bodies here run well
    // under 4000 chars; this is a heuristic scan, not a parser).
    return allSourceBlob.slice(m.index, m.index + 4000);
  }
  return null;
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

    // Also load every server/domains/*.js file's source so handler lookup
    // isn't limited to server.js inline registrations.
    const { walk } = await import("./_framework.js");
    const domainFiles = await walk(path.join(root, "server", "domains"), [".js"]);
    let domainsBlob = "";
    for (const f of domainFiles) domainsBlob += "\n" + (await readSafe(f));

    const findings = [];
    let flagged = 0, checked = 0;
    for (const { domain, macro } of parsed.entries) {
      if (!WRITE_VERB_RE.test(macro)) continue;
      if (SELF_SCOPING_NAME_RE.test(macro)) continue;
      checked++;

      const body = findHandlerBody(serverSrc, domain, macro) || findHandlerBody(domainsBlob, domain, macro);
      const rel = relPath(root, serverPath);
      const lineNo = lineOf(serverSrc, serverSrc.indexOf("const publicReadDomains = {"));

      if (!body) {
        flagged++;
        findings.push({
          id: "public_read_write_verb_handler_not_found",
          severity: "high",
          kind: "static",
          category: "security",
          subject: { kind: "macro", domain, macro },
          message: `publicReadDomains lists write-shaped macro "${domain}.${macro}" (anonymous-callable) but its handler could not be located to verify self-scoping`,
          location: `${rel}:${lineNo}`,
          evidence: { domain, macro },
          fixHint: "verify_macro_handler_self_scopes_or_remove_from_public_read_domains",
        });
        continue;
      }
      if (!OWNERSHIP_IDIOM_RE.test(body)) {
        flagged++;
        findings.push({
          id: "public_read_write_verb_no_ownership_idiom",
          severity: "high",
          kind: "static",
          category: "security",
          subject: { kind: "macro", domain, macro },
          message: `publicReadDomains lists write-shaped macro "${domain}.${macro}" (anonymous-callable) but its handler shows no ownership-check idiom (ctx.actor.userId / no_user rejection / owner-id comparison) — verify it can't be used to mutate another user's data anonymously`,
          location: `${rel}:${lineNo}`,
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
      message: `publicReadDomains: ${checked} write-shaped macro name(s) found in the anonymous-read allowlist; ${flagged} flagged for missing/unverifiable ownership checks`,
      evidence: { checked, flagged, totalEntries: parsed.entries.length },
    });

    return makeReport("public-read-write-verb", findings, t0);
  } catch (err) {
    return makeError("public-read-write-verb", "exception", err, t0);
  }
}
