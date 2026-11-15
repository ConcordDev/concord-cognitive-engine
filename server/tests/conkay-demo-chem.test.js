// GB-1534: the no-login chemistry equilibrium demo.
//
// The demo settles a real Cantera equilibrium through the ConKay design
// session and answers with a signed v2 calc receipt whose verdict is
// checked against the cited Turns reference value. When Cantera is not
// importable the endpoint must say so honestly — HTTP 200, status
// NOT_COMPUTED, a signed receipt with a NOT_COMPUTED verdict — and never
// invent a temperature. CI installs cantera==3.2.* so the PASS leg runs.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import { resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { canteraPythonPath } from "../lib/conkay/chem/cantera.js";
import createConkayDemoRouter from "../routes/conkay-demo.js";

const ENV_KEYS = [
  "CONCORD_RECEIPT_SIGNING_KEY",
  "CONCORD_RECEIPT_SIGNING_KEY_PATH",
  "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS",
];

function clearKey() {
  for (const k of ENV_KEYS) delete process.env[k];
  resetSigningKeyCache();
}

beforeEach(() => {
  clearKey();
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  resetSigningKeyCache();
});
afterEach(() => clearKey());

const passthrough = (_req, _res, next) => next();

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
    server.on("error", reject);
  });
}

async function withDemo(fn) {
  const app = express();
  app.use("/api/conkay/demo", createConkayDemoRouter({ rateLimit: passthrough }));
  const { server, port } = await listen(app);
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// Same kernel gate as conkay-reacting-chemistry.test.js: the configured
// Cantera Python must actually exist on disk.
const HAVE_KERNEL = (() => {
  try {
    return fs.existsSync(canteraPythonPath());
  } catch {
    return false;
  }
})();

describe("conkay demo chem equilibrium (GB-1534)", () => {
  it("rejects out-of-bounds inputs with the bound named", async () => {
    await withDemo(async (base) => {
      for (const [query, pattern] of [
        ["fuel=Xe", /fuel/],
        ["phi=3", /phi/],
        ["phi=0.1", /phi/],
        ["T0=100", /T0/],
        ["T0=2000", /T0/],
        ["P0=20", /P0/],
        ["P0=0.1", /P0/],
      ]) {
        const res = await fetch(`${base}/api/conkay/demo/chem/equilibrium?${query}`);
        assert.equal(res.status, 400, query);
        const body = await res.json();
        assert.match(body.error, pattern, query);
      }
    });
  });

  it("answers the default demo with a signed v2 receipt", async () => {
    await withDemo(async (base) => {
      const res = await fetch(`${base}/api/conkay/demo/chem/equilibrium`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.saved, false);
      const receipt = body.result.calcReceipt;
      assert.equal(receipt.receiptSchema, "concord-calc-receipt/2");
      assert.equal(receipt.reference.value, 2226);
      assert.equal(receipt.reference.tolerance, 25);
      const verdict = verifyAttestation(JSON.parse(JSON.stringify(receipt)));
      assert.equal(verdict.valid, true);
      assert.equal(verdict.outputsSigned, true);
      if (HAVE_KERNEL) {
        // The CI leg (cantera installed): the cited reference check passes.
        assert.equal(body.result.status, "COMPUTED");
        assert.equal(receipt.verdict.status, "PASS");
        assert.ok(
          Math.abs(body.result.adiabaticFlameTemperatureK - 2226) <= 25,
          `T_ad ${body.result.adiabaticFlameTemperatureK} K must sit within 2226 ± 25 K`,
        );
        assert.equal(receipt.results.adiabaticFlameTemperature.value, body.result.adiabaticFlameTemperatureK);
      } else {
        // No kernel in this environment: an honest NOT_COMPUTED, signed,
        // with the reason — and no temperature anywhere.
        assert.equal(body.result.status, "NOT_COMPUTED");
        assert.equal(typeof body.result.reason, "string");
        assert.equal(receipt.verdict.status, "NOT_COMPUTED");
        assert.equal(body.result.adiabaticFlameTemperatureK, undefined);
        assert.deepEqual(receipt.results, {});
      }
    });
  });

  it("renders the chem calc sheet", async () => {
    await withDemo(async (base) => {
      const res = await fetch(`${base}/api/conkay/demo/chem/equilibrium/sheet`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /text\/html/);
      const html = await res.text();
      assert.match(html, /Calculation sheet/);
      assert.match(html, /Finite-rate kinetics were not checked/);
      assert.match(html, /Heat loss and radiation were not checked/);
      assert.ok(!/\d\.\d{6,}/.test(html), "sheet must not carry raw float noise");
    });
  });

  it("renders the beam calc sheet for the demo's default solve", async () => {
    await withDemo(async (base) => {
      const q = "length=1200&height=200&flangeWidth=100&flangeThickness=10&webThickness=6&loadN=200000&support=simply-supported&material=steel-a992";
      const res = await fetch(`${base}/api/conkay/demo/beam/sheet?${q}`);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.match(html, /Yield check only — PASS/);
      assert.match(html, /Shear was not checked/);
    });
  });
});
