// server/lib/detectors/money-txn-hygiene-detector.js
//
// Un-transacted multi-write money-path detector.
//
// Seeded from a REAL bug (commit c74b60d6, "fix: fabrication disclosure,
// listener leak, un-transacted money writes"): `server/economy/reserves.js`'s
// `applyBalanceDelta` did an UPDATE on `reserves_balance` then an INSERT into
// `reserves_ledger` with NO `db.transaction(...)` wrapper, and its caller
// `allocateFromFee` invoked it twice in a row, also unwrapped (4 sequential
// writes with no atomicity anywhere). A crash mid-sequence could leave the
// reserve balance updated with no matching ledger entry, or one side of a
// fee split credited while its sibling was not. The fix wrapped each delta
// atomically and nested an outer transaction around the paired calls
// (better-sqlite3 nests `db.transaction(...)` calls as SAVEPOINTs).
//
// Detection strategy:
//   For every function found in `server/`, count `.run(` calls (better-sqlite3
//   statement execution) bound to an INSERT/UPDATE/DELETE whose SQL text (or
//   a nearby resolved table-name variable) matches a money-shaped table name.
//   If a function racks up >=2 such write operations — counting BOTH direct
//   inline writes and one-level-delegated calls to a same-file helper that
//   itself performs a money write — and the function's own body never opens
//   a `db.transaction(...)`, it's flagged. This is exactly the bug shape
//   above: `applyBalanceDelta` (2 direct writes, no wrap) and, generally,
//   any caller that composes two such write operations without an outer
//   transaction (the `allocateFromFee` shape).
//
// Delegation awareness (one level, mirroring `grade-macro-depth.mjs`'s
// delegation logic in spirit, not implementation): a function that calls a
// SINGLE same-file write-helper exactly once is not, by that call alone,
// "un-transacted" — the helper owns its own atomicity. Calling the SAME (or a
// different) write-helper a second time, or performing a second direct write,
// re-introduces the composition risk and is flagged unless the caller itself
// wraps the calls in `db.transaction(...)`. This is one level only: a helper
// that itself only delegates to a third function is not tracked further.
//
// Known precision limit — no control-flow awareness. This is a textual/
// structural detector (same family as the sibling command-injection
// detector): it counts call SITES, not reachable execution paths. Two write
// call sites that are actually MUTUALLY EXCLUSIVE — an if/else branch, a
// switch-case, or a try/catch fallback pattern ("attempt with ref_id column,
// catch → retry without it") — are indistinguishable, from pure text, from
// two writes that always run back-to-back. Real examples found scanning this
// repo: `economy/ledger.js#recordTransaction` (try/catch column-fallback),
// `server.js#creditWallet`/`debitWallet` (same fallback shape), `economy/
// stripe.js#handleWebhook` (separate `switch` cases), and `lib/account-
// lifecycle.js#requestAccountDeletion` (if-balance vs else-immediate-delete)
// all trip the >=2-writes-no-transaction rule without being the sequential-
// composition bug this detector targets. Accept these as a known noise
// class rather than a detector bug — teaching it real control-flow analysis
// would be a different (much heavier) tool. A human triaging a finding
// should always open the file and check whether the writes are sequential
// or alternatives before acting on it; `escalate_only` already routes
// INVARIANT-file findings to a human for exactly this kind of judgment call.
//
// SELECT * on money tables: intentionally NOT checked here. That sub-case is
// already covered by `performance-hotspot-detector.js`'s `select_star_hot`
// rule for the risky shapes (bare full-table scan, or a JOIN) regardless of
// table name; that detector also has a DELIBERATE, tested policy of not
// flagging pinpoint `SELECT * FROM t WHERE ...` lookups (negligible cost in
// better-sqlite3, and forcing an explicit column list on every single-row
// lookup would tightly couple every query to schema migrations for no
// measurable win). Duplicating either half here would either double-report
// or fight that documented design decision — so this detector stays in its
// lane: transaction hygiene, not column projection.
//
// Severity: always "high" for a genuine finding (a mid-sequence crash on a
// money path is a real correctness/consistency bug, not a style nit). Files
// on the repo's MONEY/AUTH INVARIANT list (`scripts/autoloop/guard.mjs`) are
// human-escalation-only — the loop must never auto-fix them — so findings in
// those files carry `escalate_only: true` in addition to the normal severity;
// they are still reported (an invariant file can still have a real gap), just
// routed differently downstream.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

// Money-shaped table name markers (task spec, matched against SQL text or a
// resolved nearby table-name variable).
const MONEY_TABLE_RE = /balance|ledger|withdraw|royalt|coin|wallet|escrow|reserve/i;
const WRITE_VERB_RE = /\b(?:INSERT|UPDATE|DELETE)\b/i;

// Files that are themselves money/auth invariants per `scripts/autoloop/guard.mjs`'s
// INVARIANT list — never auto-fix territory, escalate-only.
const INVARIANT_FILES = [
  /^server\/economy\/royalty-cascade\.js$/,
  /^server\/economy\/withdrawals\.js$/,
  /^server\/economy\/balances\.js$/,
  /^server\/lib\/creative-marketplace-constants\.js$/,
  /^server\/lib\/coin-service\.js$/,
];

const SKIP_FILES = [
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/,
  /\/tests?\//,
  // Migrations are one-shot boot-time schema/backfill code with their own
  // idioms (often intentionally sequential across a whole table); the
  // per-function money-write shape this detector hunts for doesn't apply.
  /\/migrations\//,
  // The detector sources + fixtures carry seed examples of the pattern they
  // hunt for; scanning them is meta-noise (same convention as the sibling
  // command-injection detector).
  /\/lib\/detectors\//,
];

/**
 * Balanced-paren extractor: given the index of an opening "(", returns the
 * text between it and its matching ")" plus the index right after that ")".
 * String/template-literal content is opaque (mirrors `stripComments`'s own
 * simplification) so parens inside a SQL string (`VALUES (?, ?, ?)`) never
 * throw off the balance.
 */
// A real function body over a 77k-line monolith full of regex literals is a
// harsher environment than a single call-argument list: a naive scanner that
// only tracks `'`/`"`/`` ` `` delimiters mis-fires on a bare apostrophe INSIDE
// a regex literal (`/act\s+as\s+...(don't\s+have)/` needs no escaping — it's
// not a string). That single unescaped `'` was mistaken for opening a string,
// which stayed "open" until the next literal `'` anywhere later in the file —
// swallowing thousands of real lines (and their braces) as inert string
// content. The fallout: `readBalancedBrace` matched a function's closing `}`
// half the file away, and every identifier textually inside that bogus range
// looked like a "call" from the original function. Regex-literal awareness
// (heuristic: a `/` is a regex start only where a value can't precede it —
// after `(`, `,`, an operator, `return`, etc. — the same litmus a real JS
// tokenizer uses) closes that hole.
const REGEX_PRECEDING_WORD_RE = /(?:return|typeof|instanceof|in|of|case|delete|void|throw|new|yield|await)$/;

function looksLikeRegexStart(content, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(content[j])) j--;
  if (j < 0) return true; // start of content — a value can't precede
  const prevChar = content[j];
  if ("({[,;:!&|?=+-*%^~<>".includes(prevChar)) return true;
  if (/[A-Za-z_$]/.test(prevChar)) {
    let k = j;
    while (k >= 0 && /[\w$]/.test(content[k])) k--;
    return REGEX_PRECEDING_WORD_RE.test(content.slice(k + 1, j + 1));
  }
  return false;
}

/** content[i] === '/' and it plausibly opens a regex literal — find its end (after flags), or null if unterminated (not actually a regex). */
function skipRegexLiteral(content, i) {
  let j = i + 1;
  let inClass = false;
  while (j < content.length) {
    const ch = content[j];
    if (ch === "\n") return null;
    if (ch === "\\") { j += 2; continue; }
    if (ch === "[") { inClass = true; j++; continue; }
    if (ch === "]") { inClass = false; j++; continue; }
    if (ch === "/" && !inClass) { j++; break; }
    j++;
  }
  while (j < content.length && /[a-z]/i.test(content[j])) j++;
  return j;
}

/**
 * If `content[i]` opens a string/template literal or a regex literal, return
 * the index just past its end. Otherwise return null (plain code character —
 * caller examines it normally, e.g. for paren/brace counting).
 */
function skipStringOrRegex(content, i) {
  const ch = content[i];
  if (ch === "'" || ch === '"' || ch === "`") {
    let j = i + 1;
    while (j < content.length) {
      if (content[j] === "\\") { j += 2; continue; }
      if (content[j] === ch) { j++; break; }
      j++;
    }
    return j;
  }
  if (ch === "/" && looksLikeRegexStart(content, i)) {
    const end = skipRegexLiteral(content, i);
    if (end != null) return end;
  }
  return null;
}

/**
 * Comment stripper, regex-literal aware. The sibling `command-injection-detector.js`
 * exports a `stripComments` with the same intent but WITHOUT regex-literal
 * awareness — a bare apostrophe inside a regex literal (very common in this
 * tree: `/...(don't\s+have)/`) throws its naive quote-tracker into a
 * perpetually-"open" string state, which then hides real `//`/`/* *‍/`
 * comment markers for the rest of the file (or until a coincidental closing
 * quote turns up). That's tolerable for command-injection's narrow use (a
 * single-call taint scan), but fatal for this detector's function-body brace
 * balancing, which depends on comments being fully and correctly removed
 * first. This local variant reuses the same `skipStringOrRegex` regex-aware
 * atom-skipper so quotes and regex literals never get misread as comments
 * (or vice versa) and comments never get misread as containing real code.
 * Newlines are preserved so line numbers stay accurate.
 */
export function stripCommentsRegexAware(content) {
  let out = "";
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    const nx = content[i + 1];
    if (ch === "/" && nx === "/") {
      while (i < n && content[i] !== "\n") i++;
      continue; // leave the \n to be copied next iter
    }
    if (ch === "/" && nx === "*") {
      i += 2;
      while (i < n && !(content[i] === "*" && content[i + 1] === "/")) { if (content[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    const skip = skipStringOrRegex(content, i);
    if (skip != null) { out += content.slice(i, skip); i = skip; continue; }
    out += ch;
    i++;
  }
  return out;
}

export function readBalancedParen(content, openIdx) {
  let depth = 0;
  let i = openIdx;
  const start = openIdx + 1;
  while (i < content.length) {
    const skip = skipStringOrRegex(content, i);
    if (skip != null) { i = skip; continue; }
    const ch = content[i];
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return { text: content.slice(start, i), end: i + 1 }; }
    i++;
  }
  return { text: content.slice(start), end: content.length };
}

/** Same idea, for `{ ... }` blocks. Returns the index of the matching "}". */
export function readBalancedBrace(content, openIdx) {
  let depth = 0;
  let i = openIdx;
  while (i < content.length) {
    const skip = skipStringOrRegex(content, i);
    if (skip != null) { i = skip; continue; }
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  return content.length - 1;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does this SQL argument text represent an INSERT/UPDATE/DELETE against a
 * money-shaped table? Checks the literal text first; if the table name is
 * interpolated (`` `UPDATE ${tableVar} SET ...` ``), tries to resolve a
 * simple same-file `const/let/var tableVar = "..."` string assignment and
 * tests THAT against the money-table marker — the "nearby table-name
 * variable" case from the spec.
 */
export function isMoneyWriteSql(sqlText, fileContent) {
  if (!sqlText || !WRITE_VERB_RE.test(sqlText)) return false;
  if (MONEY_TABLE_RE.test(sqlText)) return true;
  const interps = sqlText.match(/\$\{([^}]*)\}/g) || [];
  for (const block of interps) {
    for (const id of block.match(/[A-Za-z_$][\w$]*/g) || []) {
      const re = new RegExp(`(?:const|let|var)\\s+${escapeRegex(id)}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`);
      const vm = re.exec(fileContent || "");
      if (vm && MONEY_TABLE_RE.test(vm[1])) return true;
    }
  }
  return false;
}

/**
 * Find every `.run(` call site within `body` that's bound to an
 * INSERT/UPDATE/DELETE statement, direct-chained (`db.prepare(sql).run(...)`)
 * or split via a named statement variable
 * (`const stmt = db.prepare(sql); ...; stmt.run(...)`). Returns
 * `[{ index, sql }]` for money-shaped writes only.
 */
export function findMoneyWriteCallSites(body, fileContent) {
  const sites = [];
  const prepareRe = /\.prepare\s*\(/g;
  let m;
  while ((m = prepareRe.exec(body)) != null) {
    const openParen = body.indexOf("(", m.index);
    if (openParen < 0) continue;
    const { text: sql, end } = readBalancedParen(body, openParen);
    const isMoney = isMoneyWriteSql(sql, fileContent);

    // Direct chain: `.prepare(ARGS).run(`
    const after = body.slice(end, end + 40);
    if (/^\s*\.run\s*\(/.test(after)) {
      if (isMoney) sites.push({ index: m.index, sql });
      continue;
    }

    // Split-variable: `const NAME = <recv>.prepare(ARGS)` ... `NAME.run(`
    const before = body.slice(Math.max(0, m.index - 80), m.index);
    const asg = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w.$]*$/.exec(before);
    if (asg && isMoney) {
      const varName = asg[1];
      const runRe = new RegExp(`\\b${escapeRegex(varName)}\\s*\\.run\\s*\\(`, "g");
      const rest = body.slice(end);
      let rm;
      while ((rm = runRe.exec(rest)) != null) sites.push({ index: end + rm.index, sql });
    }
  }
  return sites;
}

/**
 * Extract top-level named functions from `content`: `function name(...) {}`
 * declarations (incl. `export`/`async`/generator) and arrow functions
 * assigned to `const/let/var name = (...) => {}`. Deliberately shallow —
 * no class-method-shorthand or object-literal-method support (one level of
 * "what's a function" heuristic is enough for this detector's purpose;
 * nested/anonymous callbacks are still covered because they fall inside
 * their enclosing named function's body range).
 */
export function extractTopLevelFunctions(content) {
  const funcs = [];

  const declRe = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = declRe.exec(content)) != null) {
    const name = m[1];
    const parenOpen = content.indexOf("(", m.index + m[0].length - 1);
    if (parenOpen < 0) continue;
    const { end: afterParams } = readBalancedParen(content, parenOpen);
    const braceOpen = content.indexOf("{", afterParams);
    if (braceOpen < 0 || braceOpen - afterParams > 200) continue; // sanity: brace should follow soon
    const braceEnd = readBalancedBrace(content, braceOpen);
    funcs.push({ name, nameIndex: m.index, bodyStart: braceOpen, bodyEnd: braceEnd, body: content.slice(braceOpen, braceEnd + 1) });
  }

  const arrowRe = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;
  while ((m = arrowRe.exec(content)) != null) {
    const name = m[1];
    const braceOpen = m.index + m[0].length - 1;
    const braceEnd = readBalancedBrace(content, braceOpen);
    funcs.push({ name, nameIndex: m.index, bodyStart: braceOpen, bodyEnd: braceEnd, body: content.slice(braceOpen, braceEnd + 1) });
  }

  return funcs;
}

const TRANSACTION_WRAP_RE = /\.transaction\s*\(/;

/** Count call sites to `calleeName(` inside `body`, excluding member calls (`.calleeName(`). */
function countCallSites(body, calleeName) {
  const re = new RegExp(`(^|[^.\\w$])${escapeRegex(calleeName)}\\s*\\(`, "g");
  let n = 0;
  while (re.exec(body) != null) n++;
  return n;
}

/**
 * Analyze one file's content for the un-transacted money-write shape.
 * Returns an array of finding-ready records (without file/location stamped —
 * caller adds those) so this is directly unit-testable.
 */
export function analyzeMoneyTxnHygiene(content) {
  const funcs = extractTopLevelFunctions(content);
  if (funcs.length === 0) return [];

  // Pass 1: direct money-write sites + transaction-wrap flag per function.
  for (const f of funcs) {
    f.directSites = findMoneyWriteCallSites(f.body, content);
    f.hasTxWrap = TRANSACTION_WRAP_RE.test(f.body);
    f.isWriteHelper = f.directSites.length > 0;
  }

  const out = [];
  // Pass 2: one-level delegation — attribute 1 write-op per call site to a
  // same-file write-helper (never inline the helper's own write COUNT; a
  // single call to an already-transacted helper must not, by itself, read
  // as "2 writes").
  for (const f of funcs) {
    let delegated = 0;
    const delegateNames = [];
    for (const g of funcs) {
      if (g === f || !g.isWriteHelper) continue;
      const calls = countCallSites(f.body, g.name);
      if (calls > 0) {
        delegated += calls;
        delegateNames.push({ name: g.name, calls, transacted: g.hasTxWrap });
      }
    }
    const total = f.directSites.length + delegated;
    if (total < 2) continue;
    if (f.hasTxWrap) continue;

    const tables = new Set();
    for (const s of f.directSites) {
      const t = s.sql.match(new RegExp(`\\b(\\w*(?:${MONEY_TABLE_RE.source})\\w*)\\b`, "i"));
      if (t) tables.add(t[1]);
    }

    out.push({
      func: f.name,
      nameIndex: f.nameIndex,
      directWrites: f.directSites.length,
      delegatedWrites: delegated,
      delegates: delegateNames,
      totalWrites: total,
      tables: [...tables],
    });
  }
  return out;
}

export async function runMoneyTxnHygieneDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("money-txn-hygiene", "no_root", null, t0);

  try {
    const exts = [".js", ".mjs", ".cjs"];
    const files = await walk(path.join(root, "server"), exts);
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      const c = stripCommentsRegexAware(raw);
      // Cheap pre-filter: skip files that can't possibly match (no money
      // table marker AND no write verb anywhere) before the expensive
      // function-extraction pass.
      if (!MONEY_TABLE_RE.test(c) || !WRITE_VERB_RE.test(c)) continue;
      scanned++;

      let hits;
      try {
        hits = analyzeMoneyTxnHygiene(c);
      } catch {
        continue; // malformed/unparseable file — skip, never let one file crash the sweep
      }
      const isInvariant = INVARIANT_FILES.some((re) => re.test(rel));

      for (const hit of hits) {
        findings.push({
          id: "money_txn_untransacted_writes",
          severity: "high",
          kind: "static",
          category: "correctness",
          subject: { kind: "file", path: rel },
          message:
            `${hit.func}() performs ${hit.totalWrites} money-table write(s) ` +
            `(${hit.directWrites} direct + ${hit.delegatedWrites} delegated${hit.tables.length ? `, tables: ${hit.tables.join(", ")}` : ""}) ` +
            `with no db.transaction(...) wrapper — a crash mid-sequence can leave paired writes out of sync`,
          location: `${rel}:${lineOf(c, hit.nameIndex)}`,
          evidence: {
            func: hit.func,
            directWrites: hit.directWrites,
            delegatedWrites: hit.delegatedWrites,
            delegates: hit.delegates,
            tables: hit.tables,
            snippet: snippet(hit.func, 80),
          },
          fixHint: "wrap_paired_money_writes_in_db_transaction",
          escalate_only: isInvariant,
        });
        if (findings.length > 500) break;
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "money_txn_hygiene_summary",
      severity: "info",
      kind: "static",
      category: "correctness",
      message: `Scanned ${scanned} money-shaped file(s) of ${files.length} under server/; flagged ${findings.length}`,
      evidence: { moneyFiles: scanned, totalFiles: files.length },
    });

    return makeReport("money-txn-hygiene", findings, t0);
  } catch (err) {
    return makeError("money-txn-hygiene", "exception", err, t0);
  }
}
