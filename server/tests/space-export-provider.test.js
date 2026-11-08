// A9 PR 2 — Space's export provider: the caller's own tracked
// satellites + launch watchlist reach collectLensExport; other users'
// records and the shared anonymous bucket never do.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerSpaceActions from "../domains/space.js";
import { collectLensExport, _clearLensExportProvidersForTests } from "../lib/lens-export.js";

before(() => {
  _clearLensExportProvidersForTests();
  globalThis._concordSTATE = { spaceLens: { watch: new Map(), satellites: new Map() } };
  registerSpaceActions(() => {});
  const S = globalThis._concordSTATE.spaceLens;
  S.satellites.set("u1", [
    { id: "sat_1", name: "Aurora-1", altitudeKm: 550, inclinationDeg: 97.4, notes: "SSO bird", trackedAt: "2026-11-01T00:00:00.000Z" },
  ]);
  S.watch.set("u1", [
    { id: "wl_1", launchKey: "falcon-9", name: "Falcon 9 · Starlink", provider: "SpaceX", net: "2026-12-01", pad: "LC-39A", note: "", trackedAt: "2026-11-02T00:00:00.000Z" },
  ]);
  S.satellites.set("u2", [
    { id: "sat_2", name: "Other Bird", altitudeKm: 400, inclinationDeg: 51.6, notes: "", trackedAt: "2026-11-03T00:00:00.000Z" },
  ]);
  S.watch.set("anon", [
    { id: "wl_9", launchKey: "x", name: "Anon Watch", provider: "?", net: null, pad: null, note: "", trackedAt: "2026-11-03T00:00:00.000Z" },
  ]);
});

const noArtifacts = async () => ({ ok: true, artifacts: [] });

describe("space export provider", () => {
  it("collects the caller's satellites + watch entries", async () => {
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "space", ctx: { actor: { userId: "u1" } }, limit: 100 });
    const types = out.artifacts.map((a) => a.type).sort();
    assert.deepEqual(types, ["launch_watch", "tracked_satellite"]);
    const sat = out.artifacts.find((a) => a.type === "tracked_satellite");
    assert.equal(sat.title, "Aurora-1");
    assert.match(sat.data.content, /550 km · 97\.4° · SSO bird/);
    assert.equal(out.sources.stateRecords, 2);
  });

  it("another user's records and the anon bucket never surface", async () => {
    const u2 = await collectLensExport({ runMacro: noArtifacts, domain: "space", ctx: { actor: { userId: "u2" } }, limit: 100 });
    assert.deepEqual(u2.artifacts.map((a) => a.id), ["sat_2"]);
    const anon = await collectLensExport({ runMacro: noArtifacts, domain: "space", ctx: {}, limit: 100 });
    assert.equal(anon.artifacts.length, 0);
  });
});
