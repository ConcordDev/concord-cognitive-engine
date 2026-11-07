// Close-out slice A3 — the Ask / retrieval / Assistant genera.
//
// Genus 1 (server half): deterministicFallbackReply, extracted verbatim
// from server.js. A request that carried a substantive question and
// produced no reply must NOT be answered with the cold-start greeting;
// a request that asked nothing keeps the greeting.
// Genus 3: _lensEmitDTU, extracted verbatim with its collaborators
// stubbed. The exhaust DTU it mints for an artifact must carry the
// record it points at — the artifact's title in human.summary (the
// indexed field) and the artifact's text in creti (the scanned field) —
// or the artifact (a Quick Capture above all) is unretrievable.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SRC = readFileSync(new URL("../server.js", import.meta.url), "utf8");

function extractFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} present`);
  // Find the body brace: the first { after the parameter list closes
  // (default parameters may contain braces of their own).
  let parens = 0; let i = SRC.indexOf("(", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "(") parens++;
    else if (SRC[i] === ")") { parens--; if (parens === 0) { i++; break; } }
  }
  i = SRC.indexOf("{", i);
  let depth = 0;
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") { depth--; if (depth === 0) break; }
  }
  return SRC.slice(start, i + 1);
}

describe("A3 Genus 1 — the fallback answers honestly", () => {
  const fallback = new Function(`${extractFn("deterministicFallbackReply")}; return deterministicFallbackReply;`)();
  it("a substantive question that produced no reply gets a no-answer statement, never the greeting", () => {
    const out = fallback({ body: { mode: "nonprofit", message: "How many campaigns do I have?" } });
    assert.ok(!out.includes("Concord is up"), out);
    assert.match(out, /don't have an answer/i);
  });
  it("a cold start (nothing asked) keeps the greeting", () => {
    const out = fallback({ body: { mode: "chat", message: "   " } });
    assert.match(out, /Concord is up/);
    const out2 = fallback({ body: {} });
    assert.match(out2, /Concord is up/);
  });
});

describe("A3 Genus 3 — the exhaust DTU carries its record", () => {
  function loadEmit() {
    const set = [];
    const STATE = { dtus: { set: (id, dtu) => set.push(dtu), get: (id) => set.find((d) => d.id === id) } };
    const factory = new Function(
      "uid", "nowISO", "STATE", "applyEnrichment", "linkArtifactDTU",
      "renderAndAttach", "recordEnrichmentMetric", "updateCrossDomainContext",
      `${extractFn("_lensEmitDTU")}; return _lensEmitDTU;`,
    );
    const emit = factory(
      (p) => `${p}_test1`,
      () => "2026-11-06T00:00:00.000Z",
      STATE,
      () => ({ enriched: false, edgesCreated: 0 }),
      () => {},
      () => {},
      () => {},
      () => {},
    );
    return { emit, set };
  }
  it("a capture artifact's title lands in human.summary and its text in creti", () => {
    const { emit, set } = loadEmit();
    emit({ actor: { userId: "u1" } }, "bounties", "create", "capture",
      { id: "art1", title: "PR2BOUNT-UNIQUE-STRING-1101", ownerId: "u1", data: { content: "the captured body text" } });
    assert.equal(set.length, 1);
    assert.ok(set[0].human.summary.includes("PR2BOUNT-UNIQUE-STRING-1101"), set[0].human.summary);
    assert.ok(set[0].creti.includes("PR2BOUNT-UNIQUE-STRING-1101"), set[0].creti);
    assert.ok(set[0].creti.includes("the captured body text"), set[0].creti);
    assert.equal(set[0].visibility, "private");
    assert.equal(set[0].ownerId, "u1");
  });
  it("an artifact with no text still titles its exhaust", () => {
    const { emit, set } = loadEmit();
    emit({ actor: { userId: "u1" } }, "atlas", "create", "place",
      { id: "art2", title: "Saved Overlook", ownerId: "u1", data: {} });
    assert.ok(set[0].human.summary.includes("Saved Overlook"));
    assert.ok(set[0].creti.includes("Saved Overlook"));
  });
});
