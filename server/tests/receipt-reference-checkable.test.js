// REC-INT-02: a declaration's reference must be checkable by a stranger.
// reference.source is structured + required, reviewedBy/reviewedAt are required,
// and every registered declaration's own reference case must reproduce.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import { up as up514 } from "../migrations/514_receipt_store.js";
import { resetSigningKeyCache } from "../lib/receipts/attest.js";
import { canteraPythonPath } from "../lib/conkay/chem/cantera.js";
import { solveBeamStudy } from "../domains/engineering.js";
import {
  applyReceiptDeclaration, assertCanSign, registerDeclaration, unregisterDeclaration, getDeclaration,
  listDeclarations, declarationProblems, sourceProblems, isValidIsbn, checkReferences, pendingReviews, declarationReferences,
} from "../lib/receipts/declarations.js";

const HAVE_KERNEL = (() => { try { return fs.existsSync(canteraPythonPath()); } catch { return false; } })();
const ENV_KEYS = ["CONCORD_RECEIPT_SIGNING_KEY", "CONCORD_RECEIPT_SIGNING_KEY_PATH", "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS"];
let db;
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.CONCORD_RECEIPT_SIGNING_KEY = crypto.generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
  resetSigningKeyCache();
  db = new Database(":memory:"); up514(db);
});
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; resetSigningKeyCache(); db.close(); });

const CHEM_IN = { fuel: "CH4", phi: 1, T0: 300, P0: 1 };
const GOOD_SOURCE = getDeclaration("chem", "equilibrium").reference.source;

/** Register a clone of chem.equilibrium under a scratch key with `mut` applied to a deep copy of its CH4 reference. */
function withDecl(mut, fn) {
  const base = getDeclaration("chem", "equilibrium");
  const ref = structuredClone(base.reference);
  const decl = { ...base, referenceFor: undefined, referenceList: undefined, reference: ref, reviewedBy: base.reviewedBy, reviewedAt: base.reviewedAt };
  mut(decl, ref);
  registerDeclaration("scratch", "eq", decl);
  try { return fn(); } finally { unregisterDeclaration("scratch", "eq"); }
}
const decide = () => assertCanSign("scratch", "eq", CHEM_IN);

describe("reference.source is required, structured, and checkable", () => {
  it("the shipped declarations carry a valid source and still sign", () => {
    for (const k of listDeclarations()) {
      const [d, ...a] = k.split(".");
      assert.deepEqual(declarationProblems(getDeclaration(d, a.join("."))), [], k);
    }
    assert.equal(assertCanSign("chem", "equilibrium", CHEM_IN).sign, true);
    const beam = { dims: { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 }, loadN: 20000, support: "simply-supported" };
    const out = applyReceiptDeclaration({ domain: "engineering", action: "beamStudy", inputs: beam, raw: { ok: true, result: solveBeamStudy(beam).result }, db });
    assert.equal(out.result.signed, true, out.result.signingReason);
  });

  it("missing source -> incomplete_declaration, never signs", () => {
    withDecl((_d, r) => { delete r.source; }, () => {
      const x = decide();
      assert.equal(x.sign, false);
      assert.match(x.reason, /^incomplete_declaration:source/);
    });
  });

  for (const [name, source] of Object.entries({
    emptyObject: {},
    emptyStrings: { kind: "book", citation: "", locator: "", isbn: "" },
    notAnObject: "Turns 3e",
    badKind: { ...GOOD_SOURCE, kind: "vibes" },
    shortCitation: { ...GOOD_SOURCE, citation: "Turns" },
    missingLocator: { ...GOOD_SOURCE, locator: undefined },
    blankLocator: { ...GOOD_SOURCE, locator: "   " },
    noIdentifier: { kind: "book", citation: GOOD_SOURCE.citation, locator: GOOD_SOURCE.locator },
    fakeIsbnChecksum: { ...GOOD_SOURCE, isbn: "9780073380194" },
    junkIsbn: { ...GOOD_SOURCE, isbn: "not-an-isbn" },
    badDoi: { kind: "paper", citation: GOOD_SOURCE.citation, locator: "Eq. 3", doi: "doi-ish" },
    badUrl: { kind: "url", citation: GOOD_SOURCE.citation, locator: "Sec 2", url: "see the website" },
  })) {
    it(`refuses to sign: ${name}`, () => {
      withDecl((_d, r) => { r.source = source; }, () => {
        const x = decide();
        assert.equal(x.sign, false, name);
        assert.match(x.reason, /^incomplete_declaration:/);
        assert.ok(declarationProblems(getDeclaration("scratch", "eq")).length > 0);
      });
    });
  }

  it("each identifier kind alone is enough when valid (isbn | doi | url | standardId)", () => {
    const base = { kind: "paper", citation: "Kwon, O. C., Faeth, G. M., Combust. Flame 124 (2001) 230", locator: "Table 2" };
    for (const id of [{ isbn: "0073380199" }, { doi: "10.1016/S0010-2180(00)00175-X" }, { url: "https://example.org/paper" }, { standardId: "ASTM E1049-85" }]) {
      assert.deepEqual(sourceProblems({ ...base, ...id }), [], JSON.stringify(id));
    }
    assert.equal(isValidIsbn("978-0-07-338019-3"), true);
    assert.equal(isValidIsbn("0-07-338019-9"), true);
    assert.equal(isValidIsbn("9780073380190"), false);
  });

  it("missing unit or reference-case inputs -> incomplete_declaration", () => {
    withDecl((_d, r) => { delete r.inputs; }, () => assert.match(decide().reason, /^incomplete_declaration:reference\.inputs/));
    withDecl((_d, r) => { r.unit = ""; }, () => assert.match(decide().reason, /^incomplete_declaration:reference\.unit/));
  });
});

describe("reviewedBy / reviewedAt are required", () => {
  for (const [name, mut, frag] of [
    ["no reviewedBy", (d) => { delete d.reviewedBy; }, "reviewedBy"],
    ["blank reviewedBy", (d) => { d.reviewedBy = "  "; }, "reviewedBy"],
    ["no reviewedAt", (d) => { delete d.reviewedAt; }, "reviewedAt"],
    ["unparseable reviewedAt", (d) => { d.reviewedAt = "last tuesday"; }, "reviewedAt"],
  ]) {
    it(`refuses to sign: ${name}`, () => {
      withDecl(mut, () => {
        const x = decide();
        assert.equal(x.sign, false);
        assert.equal(x.reason, `incomplete_declaration:${frag}`);
      });
    });
  }

  it("a fully reviewed clone signs", () => {
    withDecl((d) => { d.reviewedBy = "Dutch"; d.reviewedAt = "2026-11-16"; }, () => assert.equal(decide().sign, true));
  });

  it("the two seeds are still PENDING human review: visible, not silently 'reviewed'", () => {
    assert.deepEqual(pendingReviews().sort(), ["chem.equilibrium", "engineering.beamStudy"]);
  });
});

describe("golden: every registered declaration's reference case reproduces", () => {
  for (const key of ["chem.equilibrium", "engineering.beamStudy"]) {
    it(`${key} lands within its declared tolerance of the cited value`, { skip: key.startsWith("chem") && !HAVE_KERNEL ? "Cantera not installed" : false }, async () => {
      const [d, a] = key.split(".");
      const rows = await checkReferences(getDeclaration(d, a));
      assert.ok(rows.length >= 1);
      for (const r of rows) assert.equal(r.ok, true, `${key} "${r.case}": measured ${r.measured}, cited ${r.expected} ± ${r.tolerance} (${r.why})`);
    });
  }

  it("covers the WHOLE registry (a new declaration without a runReference fails here)", async () => {
    for (const k of listDeclarations()) {
      const decl = getDeclaration(...k.split(/\.(.+)/).slice(0, 2));
      assert.equal(typeof decl.runReference, "function", `${k} has no runReference`);
      assert.ok(declarationReferences(decl).length >= 1, k);
    }
  });

  it("FAILS on a planted declaration whose reference value is off", async () => {
    const decl = { runReference: async () => 100, referenceList: [{ case: "planted", value: 130, tolerance: 5, unit: "K", inputs: { x: 1 } }] };
    const rows = await checkReferences(decl);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].why, "outside_tolerance");
  });

  it("FAILS on a planted beam declaration with a wrong cited value", async () => {
    const real = getDeclaration("engineering", "beamStudy");
    const rows = await checkReferences({ ...real, referenceList: [{ ...real.reference, value: 50, tolerance: 2 }] });
    assert.equal(rows[0].ok, false);
  });

  it("FAILS when the solver does not compute or the declaration has no runReference", async () => {
    assert.equal((await checkReferences({ runReference: async () => null, referenceList: [{ case: "c", value: 1, tolerance: 1, inputs: { a: 1 } }] }))[0].why, "solver_did_not_compute");
    assert.equal((await checkReferences({ referenceList: [{ case: "c", value: 1, tolerance: 1, inputs: { a: 1 } }] }))[0].why, "no_runReference");
  });
});
