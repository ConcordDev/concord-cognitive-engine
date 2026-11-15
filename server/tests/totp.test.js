// server/tests/totp.test.js — FIX-settings-005 lib pins.
//
// RFC 4226 / RFC 6238 vectors, the ±1 drift window, the replay guard,
// recovery-code hashing, the at-rest cipher, and the challenge store's
// TTL / attempt cap / one-live-challenge-per-user rules.
import test from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  hotp,
  totp,
  verifyTotp,
  generateSecretBase32,
  buildOtpauthUri,
  generateRecoveryCodes,
  normaliseRecoveryCode,
  hashRecoveryCode,
  encryptSecret,
  decryptSecret,
  createChallengeStore,
  CHALLENGE_TTL_MS,
  CHALLENGE_MAX_ATTEMPTS,
} from "../lib/totp.js";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii"); // RFC 4226/6238 SHA-1 seed

test("hotp matches the RFC 4226 vectors", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => {
    assert.equal(hotp(RFC_SECRET, counter), code, `counter ${counter}`);
  });
});

test("totp matches the RFC 6238 SHA-1 vectors (6-digit truncation)", () => {
  // T=59s → counter 1 → 94287082 (8-digit) → 287082; T=1111111109 → 07081804 → 081804.
  assert.equal(totp(RFC_SECRET, { atMs: 59_000 }), "287082");
  assert.equal(totp(RFC_SECRET, { atMs: 1_111_111_109_000 }), "081804");
  assert.equal(totp(RFC_SECRET, { atMs: 1_234_567_890_000 }), "005924");
});

test("base32 round-trips and the generated secret decodes to 20 bytes", () => {
  const secret = generateSecretBase32();
  assert.equal(secret.length, 32);
  assert.equal(base32Decode(secret).length, 20);
  assert.equal(base32Encode(RFC_SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), RFC_SECRET);
  // Decode tolerates spaces / lowercase / padding noise from manual entry.
  assert.deepEqual(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"), RFC_SECRET);
});

test("verifyTotp accepts the current step and ±1 drift, rejects outside", () => {
  const atMs = 1_700_000_000_000;
  const step = Math.floor(atMs / 1000 / 30);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step), { atMs }).ok, true);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), { atMs }).ok, true);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), { atMs }).ok, true);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), { atMs }).ok, false);
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), { atMs }).ok, false);
  assert.equal(verifyTotp(RFC_SECRET, "12345", { atMs }).ok, false); // wrong length
  assert.equal(verifyTotp(RFC_SECRET, "abcdef", { atMs }).ok, false); // non-numeric
  assert.equal(verifyTotp(RFC_SECRET, "", { atMs }).ok, false);
});

test("verifyTotp replay guard: an accepted step cannot be reused", () => {
  const atMs = 1_700_000_000_000;
  const step = Math.floor(atMs / 1000 / 30);
  const code = hotp(RFC_SECRET, step);
  const first = verifyTotp(RFC_SECRET, code, { atMs });
  assert.equal(first.ok, true);
  assert.equal(first.step, step);
  // Same code, same instant, with the accepted step recorded → refused.
  assert.equal(verifyTotp(RFC_SECRET, code, { atMs, lastAcceptedStep: first.step }).ok, false);
  // An OLDER code (previous step) is also refused once a newer step landed.
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), { atMs, lastAcceptedStep: first.step }).ok, false);
  // The NEXT step's code still verifies.
  assert.equal(verifyTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), { atMs, lastAcceptedStep: first.step }).ok, true);
});

test("otpauth uri carries issuer, account, and parameters", () => {
  const uri = buildOtpauthUri({ account: "ada@example.com", secretBase32: "GEZDGNBVGY3TQOJQ" });
  assert.ok(uri.startsWith("otpauth://totp/Concord%3Aada%40example.com?"));
  assert.ok(uri.includes("secret=GEZDGNBVGY3TQOJQ"));
  assert.ok(uri.includes("issuer=Concord"));
  assert.ok(uri.includes("digits=6"));
  assert.ok(uri.includes("period=30"));
});

test("recovery codes: format, normalisation, and hashing", () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const [first] = codes;
  // The same code typed without dashes / lowercase hashes identically.
  assert.equal(hashRecoveryCode(first), hashRecoveryCode(first.replace(/-/g, "").toLowerCase()));
  assert.equal(normaliseRecoveryCode(first).length, 12);
  // Different codes hash differently; the hash never contains the code.
  assert.notEqual(hashRecoveryCode(first), hashRecoveryCode(codes[1]));
  assert.ok(!hashRecoveryCode(first).includes(normaliseRecoveryCode(first)));
});

test("secret cipher round-trips and fails closed on tamper", () => {
  process.env.JWT_SECRET = "totp-test-secret";
  try {
    const secret = generateSecretBase32();
    const stored = encryptSecret(secret);
    assert.notEqual(stored, secret);
    assert.equal(decryptSecret(stored), secret);
    // Tampered ciphertext → null, never a wrong secret.
    const tampered = stored.slice(0, -2) + (stored.endsWith("00") ? "ff" : "00");
    assert.equal(decryptSecret(tampered), null);
    // A legacy plaintext row still reads (no-key degrade back-compat).
    assert.equal(decryptSecret(secret), secret);
    assert.equal(decryptSecret(null), null);
  } finally {
    delete process.env.JWT_SECRET;
  }
});

test("challenge store: mint, expiry, attempt cap, one live per user", () => {
  const store = createChallengeStore();
  const t0 = 1_700_000_000_000;
  const id = store.mint("user_a", t0);
  assert.equal(store.get(id, t0)?.userId, "user_a");
  assert.equal(store.get("unknown-id", t0), null);
  // Expired challenges read as null and are burned.
  assert.equal(store.get(id, t0 + CHALLENGE_TTL_MS + 1), null);
  assert.equal(store.size(), 0);

  const id2 = store.mint("user_b", t0);
  for (let i = 0; i < CHALLENGE_MAX_ATTEMPTS - 1; i++) {
    assert.equal(store.fail(id2), true, `attempt ${i + 1} keeps the challenge`);
  }
  assert.equal(store.fail(id2), false, "the cap burns the challenge");
  assert.equal(store.get(id2, t0), null);

  // A fresh mint for the same user burns the previous challenge.
  const a1 = store.mint("user_c", t0);
  const a2 = store.mint("user_c", t0);
  assert.notEqual(a1, a2);
  assert.equal(store.get(a1, t0), null);
  assert.equal(store.get(a2, t0)?.userId, "user_c");
  store.burn(a2);
  assert.equal(store.get(a2, t0), null);
});
