// CONCORD_PLATFORM_PROVIDER_<SLOT>=local keeps a slot on Concord's own brain
// for High Power accounts (live 2026-11-04: High Power chat went to a
// flash-lite fallback while the conscious brain was idle).
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { platformProviderConfigured, platformProviderIdForSlot, platformSlotPinnedLocal, platformProviderChat } from "../lib/platform-providers.js";

const KEYS = ["CONCORD_PLATFORM_GOOGLE_API_KEY", "CONCORD_PLATFORM_PROVIDER_CONSCIOUS", "CONCORD_PLATFORM_PROVIDER_VISION"];
let saved;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test("a configured slot is routed to its platform provider by default", () => {
  process.env.CONCORD_PLATFORM_GOOGLE_API_KEY = "test-key";
  delete process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS;
  assert.equal(platformSlotPinnedLocal("conscious"), false);
  assert.equal(platformProviderConfigured("conscious"), true);
  assert.equal(platformProviderIdForSlot("conscious"), "google");
});

for (const v of ["local", "none", "off", " LOCAL "]) {
  test(`CONCORD_PLATFORM_PROVIDER_CONSCIOUS=${JSON.stringify(v)} pins conscious to the local brain, other slots untouched`, async () => {
    process.env.CONCORD_PLATFORM_GOOGLE_API_KEY = "test-key";
    process.env.CONCORD_PLATFORM_PROVIDER_CONSCIOUS = v;
    delete process.env.CONCORD_PLATFORM_PROVIDER_VISION;
    assert.equal(platformSlotPinnedLocal("conscious"), true);
    assert.equal(platformProviderConfigured("conscious"), false);
    assert.equal(platformProviderIdForSlot("conscious"), null);
    assert.equal(platformProviderConfigured("vision"), true);
    const r = await platformProviderChat({ slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_platform_provider_for_slot");
  });
}
