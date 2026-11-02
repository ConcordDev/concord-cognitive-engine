/**
 * dtu-format.js signing key: env-only for signing (CONCORD_DTU_SIGNING_KEY),
 * legacy-constant signatures still verify, no key => unsigned (never a
 * baked-in fallback). Tests use dummy key values only.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";
import { encodeDTU, verifyDTU } from "../economy/dtu-format.js";

const ENV = "CONCORD_DTU_SIGNING_KEY";
const saved = process.env[ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

const hmac = (key, buf) => createHmac("sha256", key).update(buf).digest("hex");
const dtu = { id: "dtu_signkey", humanLayer: { text: "hello" } };
// What pre-env-key exports were signed with (public constant, verify-only).
const LEGACY = "concord-platform-signing-key-v1";

describe("dtu-format signing key", () => {
  it("signs with the env key and verifies the round trip", () => {
    process.env[ENV] = "dummy-env-key-a";
    const enc = encodeDTU(dtu);
    assert.equal(enc.ok, true);
    assert.equal(enc.signature, hmac("dummy-env-key-a", enc.buffer));
    assert.notEqual(enc.signature, hmac(LEGACY, enc.buffer));
    const v = verifyDTU(enc.buffer, { expectedSignature: enc.signature });
    assert.equal(v.signatureValid, true);
    assert.equal(v.tampered, false);
  });

  it("rejects a signature made with a different key", () => {
    process.env[ENV] = "dummy-env-key-a";
    const enc = encodeDTU(dtu);
    process.env[ENV] = "dummy-env-key-b";
    const v = verifyDTU(enc.buffer, { expectedSignature: enc.signature });
    assert.equal(v.signatureValid, false);
    assert.equal(v.tampered, true);
  });

  it("still verifies a legacy-constant-signed file", () => {
    process.env[ENV] = "dummy-env-key-a";
    const enc = encodeDTU(dtu);
    const legacySig = hmac(LEGACY, enc.buffer);
    const v = verifyDTU(enc.buffer, { expectedSignature: legacySig });
    assert.equal(v.signatureValid, true);
    assert.equal(v.tampered, false);
  });

  it("legacy signatures verify even with no env key configured", () => {
    delete process.env[ENV];
    const enc = encodeDTU(dtu);
    const v = verifyDTU(enc.buffer, { expectedSignature: hmac(LEGACY, enc.buffer) });
    assert.equal(v.signatureValid, true);
  });

  it("missing env: encode is unsigned (null), never signed with the legacy key", () => {
    delete process.env[ENV];
    const enc = encodeDTU(dtu);
    assert.equal(enc.ok, true);
    assert.equal(enc.signature, null);
    assert.ok(enc.contentHash);
    // A null/garbage expected signature does not verify.
    assert.equal(verifyDTU(enc.buffer, { expectedSignature: "deadbeef" }).signatureValid, false);
  });

  it("blank env value counts as missing", () => {
    process.env[ENV] = "   ";
    assert.equal(encodeDTU(dtu).signature, null);
  });
});
