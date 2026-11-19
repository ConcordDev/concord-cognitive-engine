// Behavior test for the ledger NO_STORE honesty fix (office-ruled
// 2026-11-19): ledger is a read-only economy-flow domain with NO
// per-user store anywhere in its module (verified premise), so its
// export honestly reports stateBacked: true via NO_STORE_DOMAINS —
// the same shape as frontier/lattice/narrative-walk — while still
// carrying exactly the caller's ledger-tagged DTUs.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, isNoStoreDomain } = await import("../lib/lens-export.js");

globalThis._concordSTATE = {};
const dtus = [
  { id: "d1", domain: "ledger", ownerId: "user-a", title: "Ledger note", content: "x" },
  { id: "d2", domain: "affect", ownerId: "user-a", title: "Trap", content: "x" },
];
const macro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus };
  return { ok: false, error: "no_macro_in_harness" };
};

test("ledger is a named no-store domain and its export is honestly state-backed", async () => {
  assert.equal(isNoStoreDomain("ledger"), true);
  const out = await collectLensExport({ runMacro: macro, domain: "ledger", ctx: { actor: { userId: "user-a" } } });
  assert.equal(out.ok, true);
  assert.equal(out.stateBacked, true);
  assert.deepEqual(out.artifacts.map((r) => r.id), ["d1"], "only the caller's ledger DTU rides");
});
