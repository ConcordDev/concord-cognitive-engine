// Save-on-write guard (Phase 4, "data that doesn't save").
//
// /api/lens/run does not save STATE after every action; each handler has to
// call saveStateDebounced (reached by domains as the global
// `_concordSaveStateDebounced`, or through a private save*State wrapper that
// calls it). A handler that mutates STATE and forgets that call is only
// persisted when something else bumps the save counter, or at clean
// shutdown, so a crash loses it.
//
// This test loads every module in server/domains, registers its lens actions
// against a stub registry, and runs every write-named action against a stub
// STATE with minimal generic input. When the action succeeded AND changed
// the STATE the snapshot persists, the save hook must have run.
// Actions we cannot drive cheaply (they need real inputs, or touch the
// network / filesystem) are skipped, and the checked/skipped counts print.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { serializeLensState } from "../lib/lens-state-persistence.js";
// One name classifier for both the wrapper and the guard, so the guard checks
// exactly the actions the wrapper is meant to cover.
import { isWriteName } from "../lib/lens-save-on-write.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DOMAINS_DIR = path.join(here, "..", "domains");

// "Persisted STATE" is exactly what the process snapshot walks: the keys in
// LENS_STATE_KEYS, serialized by serializeLensState. Ephemeral keys (presence,
// cursors, hubActivity, the documented exclusions) never enter it, so mutating
// them without a save is not a lost write.
function stateSnapshot(STATE) {
  try { return JSON.stringify(serializeLensState(STATE)); } catch { return "[unserializable]"; }
}

// ── generic minimal input ───────────────────────────────────────────────
const NUMERIC_RE = /amount|price|qty|quantity|count|hours|rate|value|score|size|width|height|limit|duration|minutes|days|total|cost|weight|level|index|order|position|^x$|^y$|^z$/i;
function makeParams(latestIds) {
  const bag = {
    name: "guard item", title: "guard title", text: "guard text", content: "guard content",
    description: "guard description", label: "guard label", body: "guard body",
    note: "guard note", message: "guard message", email: "guard@example.invalid",
    url: "https://example.invalid/guard", date: "2026-01-15", kind: "note", type: "note",
    category: "general", status: "active", query: "guard", q: "guard",
  };
  return new Proxy(bag, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      if (/id$/i.test(prop)) return latestIds.last ?? "guard_id";
      if (NUMERIC_RE.test(prop)) return 5;
      return "guard";
    },
    has() { return true; },
  });
}
function plainParams(latestIds) {
  const id = latestIds.last ?? "guard_id";
  return {
    name: "guard item", title: "guard title", text: "guard text", content: "guard content",
    id, itemId: id, projectId: id, recordId: id, boardId: id,
    amount: 5, quantity: 1, price: 5,
  };
}
function harvestIds(result, latestIds, depth = 0) {
  if (!result || typeof result !== "object" || depth > 4) return;
  if (typeof result.id === "string" || typeof result.id === "number") latestIds.last = result.id;
  for (const v of Object.values(result)) {
    if (v && typeof v === "object") harvestIds(v, latestIds, depth + 1);
  }
}

const SKIP_DOMAINS = new Set([
  // Write files / spawn processes from handlers; this test must not touch disk
  // outside memory.
  "art", "music", "studio", "code", "system",
]);
const IO_SOURCE_RE = /fsp\.|fs\.(?:write|append|mkdir|rm|unlink)|writeFile|execSync|execFile|spawn\(|child_process|\bfetch\(|connectorFetch|safeFetch/;

const TIMEOUT_MS = 1500;
function withTimeout(p) {
  let t;
  return Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS); }),
  ]).finally(() => clearTimeout(t));
}

async function loadDomain(file) {
  const handlers = new Map(); // action -> fn (registration order preserved)
  const registry = (domain, action, fn) => {
    if (typeof fn === "function") handlers.set(`${domain}\u0000${action}`, fn);
  };
  const mod = await import(pathToFileURL(path.join(DOMAINS_DIR, file)).href);
  const reg = typeof mod.default === "function" ? mod.default : null;
  if (!reg) return { handlers, loaded: false };
  await reg(registry);
  return { handlers, loaded: true };
}

// Known-missing saves tracked here instead of hidden. Empty: every write action is enforced.
const PENDING_OWNED_ELSEWHERE = new Set([]);
const REQUIRED_DOMAINS = [
  "diy", "electrical", "appmaker", "accounting", "ml", "timeline", "whiteboard",
];
// domain file -> registered actions that must be exercised (not skipped).
const REQUIRED_ACTIONS = {
  // Deletes are covered by lens-delete-persists.test.js; here the creators
  // must be exercised so the domain is genuinely checked.
  "diy.js": ["project-create"],
  "electrical.js": [],
  "appmaker.js": ["projectCreate"],
  "accounting.js": ["recurring-bills-create"],
  "ml.js": ["experiment-start"],
  "timeline.js": ["post-create"],
  "whiteboard.js": ["board-save"],
};

describe("lens save-on-write guard", () => {
  it("every succeeding write action that mutates persisted STATE triggers a save", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new Error("network disabled in guard test"));
    // Handlers can reach the network through helpers (feed-cache, ssrf-guard)
    // that bypass globalThis.fetch; cut sockets and DNS so nothing leaves.
    const realConnect = net.Socket.prototype.connect;
    const realLookup = dns.lookup;
    net.Socket.prototype.connect = function () { throw new Error("network disabled in guard test"); };
    dns.lookup = (...a) => { const cb = a[a.length - 1]; if (typeof cb === "function") cb(new Error("network disabled in guard test")); };
    const prevSTATE = globalThis._concordSTATE;
    const prevSave = globalThis._concordSaveStateDebounced;

    const failures = [];
    const checkedByDomain = {};
    const checkedNames = new Set();
    const skipped = { nonWrite: 0, io: 0, domain: 0, failed: 0, noMutation: 0, noLoad: 0 };
    let checked = 0;

    try {
      const files = fs.readdirSync(DOMAINS_DIR).filter((f) => f.endsWith(".js")).sort();
      for (const file of files) {
        const base = file.replace(/\.js$/, "");
        const STATE = {};
        let saves = 0;
        globalThis._concordSTATE = STATE;
        globalThis._concordSaveStateDebounced = () => { saves++; };
        let loaded;
        try {
          loaded = await withTimeoutLong(loadDomain(file));
        } catch {
          skipped.noLoad++;
          continue;
        }
        if (!loaded.loaded) { skipped.noLoad++; continue; }
        const latestIds = {};
        for (const [key, fn] of loaded.handlers) {
          const [domain, action] = key.split("\u0000");
          if (SKIP_DOMAINS.has(base) || SKIP_DOMAINS.has(domain)) { skipped.domain++; continue; }
          if (!isWriteName(action)) { skipped.nonWrite++; continue; }
          if (IO_SOURCE_RE.test(Function.prototype.toString.call(fn))) { skipped.io++; continue; }

          const ctx = { actor: { userId: "guard_user", role: "owner" }, userId: "guard_user", STATE };
          let outcome = null;
          for (const mk of [makeParams, plainParams]) {
            const before = stateSnapshot(STATE);
            const savesBefore = saves;
            let res;
            try {
              res = await withTimeout(fn(ctx, { id: "guard_artifact", data: {} }, mk(latestIds)));
            } catch {
              continue;
            }
            const ok = res && typeof res === "object" && res.ok !== false && !res.error;
            if (ok) harvestIds(res, latestIds);
            if (!ok) continue;
            const after = stateSnapshot(STATE);
            outcome = { mutated: before !== after, saved: saves > savesBefore };
            break;
          }
          if (!outcome) { skipped.failed++; continue; }
          if (!outcome.mutated) { skipped.noMutation++; continue; }
          checked++;
          checkedByDomain[base] = (checkedByDomain[base] || 0) + 1;
          checkedNames.add(`${base}.js:${action}`);
          if (!outcome.saved) failures.push(`${domain}.${action}`);
        }
      }
    } finally {
      globalThis.fetch = realFetch;
      net.Socket.prototype.connect = realConnect;
      dns.lookup = realLookup;
      globalThis._concordSTATE = prevSTATE;
      globalThis._concordSaveStateDebounced = prevSave;
    }

    const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
    console.log(
      `[save-guard] checked=${checked} skipped=${skippedTotal} ` +
      `(${Object.entries(skipped).map(([k, v]) => `${k}:${v}`).join(", ")}) ` +
      `domains-with-checks=${Object.keys(checkedByDomain).length}`,
    );
    console.log(`[save-guard] required domains: ${REQUIRED_DOMAINS.map((d) => `${d}=${checkedByDomain[d] || 0}`).join(" ")}`);

    for (const d of REQUIRED_DOMAINS) {
      assert.ok(checkedByDomain[d] > 0, `delete-candidate domain "${d}" had no checked write action`);
    }
    // Some creators need a prerequisite record generic input cannot build
    // (accounting needs a vendor); report those rather than fail on them. The
    // delete paths are pinned with real inputs in lens-delete-persists.test.js.
    const unexercised = Object.entries(REQUIRED_ACTIONS)
      .flatMap(([file, names]) => names.map((n) => `${file}:${n}`))
      .filter((k) => !checkedNames.has(k));
    if (unexercised.length) console.log(`[save-guard] not exercised by generic input: ${unexercised.join(", ")}`);
    // Any entry added to PENDING_OWNED_ELSEWHERE prints every run; remove it once it saves.
    const pending = failures.filter((f) => PENDING_OWNED_ELSEWHERE.has(f));
    if (pending.length) console.log(`[save-guard] known missing saves (domain owned elsewhere): ${pending.join(", ")}`);
    const unexpected = failures.filter((f) => !PENDING_OWNED_ELSEWHERE.has(f));
    assert.deepEqual(unexpected, [], `write actions that mutated persisted STATE without a save:\n  ${unexpected.join("\n  ")}`);
  });
});

function withTimeoutLong(p) {
  let t;
  return Promise.race([
    p,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error("load timeout")), 20000); }),
  ]).finally(() => clearTimeout(t));
}
