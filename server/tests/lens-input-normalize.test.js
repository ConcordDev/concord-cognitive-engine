// Pins the dispatch-layer normalizer that fixes the "double-wrapped-input
// dead-calculator" class (carpentry / cooking / construction / automotive +
// ~40 *ActionPanel components posting `{ artifact: { data } }`). The dispatch
// already builds the virtualArtifact (virtualArtifact.data = body.input), so a
// body that ALSO wraps `{ artifact: { data } }` double-nests and every handler
// reading `artifact.data.X` silently sees undefined. peelRedundantArtifactWrapper
// peels EXACTLY one redundant sole-key layer and is a no-op otherwise.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

describe("peelRedundantArtifactWrapper — peels the redundant wrapper", () => {
  it("peels a sole-key { artifact: { data: {...} } } one layer", () => {
    const out = peelRedundantArtifactWrapper({ artifact: { data: { ingredients: [1, 2], servings: 4 } } });
    assert.deepEqual(out, { ingredients: [1, 2], servings: 4 });
  });

  it("peels exactly one layer (does not over-peel nested artifact.data)", () => {
    // The inner value is the real domain payload — even if it itself has an
    // `artifact` key, only ONE redundant layer is removed.
    const out = peelRedundantArtifactWrapper({ artifact: { data: { artifact: { data: { x: 1 } } } } });
    assert.deepEqual(out, { artifact: { data: { x: 1 } } });
  });

  it("peels an empty data object", () => {
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: { data: {} } }), {});
  });
});

describe("peelRedundantArtifactWrapper — leaves legitimate input untouched", () => {
  it("leaves flat domain input byte-identical", () => {
    const flat = { rightAscension: 6, declination: 10, latitude: 40 };
    assert.equal(peelRedundantArtifactWrapper(flat), flat); // same reference
  });

  it("does NOT peel when artifact is not the sole key (real sibling fields)", () => {
    const body = { artifact: { data: { clients: [] } }, period: "month" };
    assert.deepEqual(peelRedundantArtifactWrapper(body), body);
  });

  it("does NOT peel when artifact has no data key", () => {
    const body = { artifact: { id: "a1", meta: {} } };
    assert.deepEqual(peelRedundantArtifactWrapper(body), body);
  });

  it("does NOT peel when artifact.data is not a plain object", () => {
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: { data: "string" } }), { artifact: { data: "string" } });
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: { data: [1, 2] } }), { artifact: { data: [1, 2] } });
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: { data: null } }), { artifact: { data: null } });
  });

  it("does NOT peel a legitimate field literally named 'artifact' that is an array/primitive", () => {
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: [1, 2] }), { artifact: [1, 2] });
    assert.deepEqual(peelRedundantArtifactWrapper({ artifact: 5 }), { artifact: 5 });
  });

  it("is idempotent — peeling already-flat input is a no-op (per-domain unwraps stay correct)", () => {
    const once = peelRedundantArtifactWrapper({ artifact: { data: { x: 1 } } });
    assert.deepEqual(peelRedundantArtifactWrapper(once), { x: 1 });
  });

  it("tolerates non-object / empty inputs", () => {
    assert.deepEqual(peelRedundantArtifactWrapper({}), {});
    assert.equal(peelRedundantArtifactWrapper(null), null);
    assert.equal(peelRedundantArtifactWrapper(undefined), undefined);
    assert.deepEqual(peelRedundantArtifactWrapper([1, 2]), [1, 2]);
  });
});
