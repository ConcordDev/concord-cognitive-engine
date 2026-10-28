// server/lib/lens-save-on-write.js
//
// /api/lens/run does not save STATE after an action; each handler has to ask
// for it. Domains that keep their records under STATE.<x>Lens but never call
// the save hook only reach disk when something else bumps the save counter
// (or at clean shutdown), so a crash loses the write.
//
// saveAfterWrites() wraps a domain registrar the same way guardAnonWrites()
// does: a successful write-shaped action schedules the debounced save.
// The save is a no-op when the global hook is absent (unit tests, minimal
// builds) and never changes the handler's result.

import { isWriteActionName } from "./lens-authz.js";

const WRITE_TOKENS = new Set([
  "create", "add", "update", "edit", "set", "delete", "remove", "record", "log",
  "save", "submit", "claim", "append", "register", "rename", "move", "reorder",
  "toggle", "mark", "assign", "import", "upload", "post", "publish", "unpublish",
  "fork", "clone", "duplicate", "archive", "restore", "start", "stop", "complete",
  "close", "open", "book", "cancel", "approve", "reject", "invite", "join",
  "leave", "follow", "unfollow", "like", "pin", "unpin", "schedule", "enroll",
  "bookmark", "tag", "untag", "comment", "reply", "vote", "rate", "review",
  "pay", "send", "write", "upsert", "put", "insert", "store", "track", "checkin",
  "resolve", "dismiss", "snooze", "apply", "grant", "revoke", "reschedule",
  "cursor", "presence", "controls", "ingest",
]);
// A read noun anywhere in the name ("audit-log-list", "checkin-history",
// "rate-limit-status") makes it a read even when it contains a write word.
const READ_NOUNS = new Set(["list", "history", "status", "heatmap"]);
const READ_LEADS = new Set([
  "get", "list", "search", "summary", "stats", "calc", "compute", "preview",
  "validate", "analyze", "analyse", "estimate", "find", "browse", "query",
  "read", "view", "show", "export", "lookup", "suggest", "recommend", "facets",
  "rollup", "report", "explain", "check", "convert", "simulate", "detect",
  "score", "forecast", "compare", "diff", "render", "plan",
]);

function tokens(name) {
  return String(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Name-only write classifier shared by saveAfterWrites and the guard test. */
export function isWriteName(name) {
  const t = tokens(name);
  if (t.some((x) => READ_NOUNS.has(x))) return false;
  if (!t.some((x) => WRITE_TOKENS.has(x))) return false;
  if (READ_LEADS.has(t[0]) && !WRITE_TOKENS.has(t[0])) return false;
  return true;
}

// Count every save the process schedules so a handler that already saved is not
// saved twice. The global hook is wrapped lazily (and re-wrapped if replaced, e.g.
// by tests); the wrapper only counts and forwards.
let _saveSeq = 0;
function countedHook() {
  const fn = globalThis._concordSaveStateDebounced;
  if (typeof fn !== "function") return null;
  if (fn.__saveCounted) return fn;
  const counted = function (...a) { _saveSeq += 1; return fn.apply(this, a); };
  counted.__saveCounted = true;
  try { globalThis._concordSaveStateDebounced = counted; } catch { return fn; }
  return counted;
}

function requestSave(seqBefore) {
  const fn = countedHook();
  if (typeof fn !== "function") return;
  // Any save scheduled since the handler started (its own, or another write's debounced
  // save, which serializes the whole STATE when it fires) already covers this write.
  if (_saveSeq !== seqBefore) return;
  try { fn(); } catch { /* best effort: a failed schedule must not fail the action */ }
}

const succeeded = (res) => res && typeof res === "object" && res.ok !== false && !res.error;

/**
 * Wrap a registrar so a successful write-shaped action schedules a state save.
 * Idempotent. Compose after guardAnonWrites():
 *   registerLensAction = saveAfterWrites(guardAnonWrites(registerLensAction));
 */
export function saveAfterWrites(register) {
  if (typeof register !== "function" || register.__saveAfterWrites) return register;
  const wrapped = function saveRegister(domain, name, handler, ...rest) {
    if (typeof handler !== "function" || handler.__saveAfterWrites || !(isWriteName(name) || isWriteActionName(name, handler))) {
      return register.call(this, domain, name, handler, ...rest);
    }
    const isAsync = handler.constructor && handler.constructor.name === "AsyncFunction";
    const saving = isAsync
      ? async function (...args) {
        countedHook();
        const seq = _saveSeq;
        const res = await handler.apply(this, args);
        if (succeeded(res)) requestSave(seq);
        return res;
      }
      : function (...args) {
        countedHook();
        const seq = _saveSeq;
        const res = handler.apply(this, args);
        if (res && typeof res.then === "function") {
          return res.then((r) => { if (succeeded(r)) requestSave(seq); return r; });
        }
        if (succeeded(res)) requestSave(seq);
        return res;
      };
    Object.assign(saving, handler);
    saving.__saveAfterWrites = true;
    saving.__inner = handler;
    // Source-reading tools (param synthesis, docs) see the real handler.
    saving.toString = () => Function.prototype.toString.call(handler);
    try { Object.defineProperty(saving, "name", { value: handler.name || name }); } catch { /* non-configurable */ }
    try { Object.defineProperty(saving, "length", { value: handler.length }); } catch { /* non-configurable */ }
    return register.call(this, domain, name, saving, ...rest);
  };
  wrapped.__saveAfterWrites = true;
  return wrapped;
}
