// server/tests/paillier.test.js
//
// Validates server/lib/crypto/paillier.js — a from-scratch, pure-BigInt
// Paillier cryptosystem. Run WITHOUT --test-force-exit (per the task: it
// silently truncates runs). Key size here is intentionally small (512
// bits) purely for test speed; the module's real default is 2048 bits
// (see DEFAULT_KEY_BITS assertion below).

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  generateKeypair,
  encrypt,
  decrypt,
  decryptSigned,
  addEncrypted,
  addPlaintext,
  multiplyPlaintext,
  multiplyCiphertexts,
  DEFAULT_KEY_BITS,
} from "../lib/crypto/paillier.js";

const TEST_BITS = 512; // fast in tests; production default is 2048 (see below)

// Small deterministic PRNG (mulberry32) — used ONLY to pick plaintext test
// values reproducibly across runs. Never used for key material or
// ciphertext randomness (that always goes through node:crypto inside
// paillier.js itself — see the source-inspection test at the bottom).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260724);
function randSmallInt(max = 100000) {
  return Math.floor(rng() * max);
}

let kp1;
let kp2;

before(() => {
  kp1 = generateKeypair({ bits: TEST_BITS });
  kp2 = generateKeypair({ bits: TEST_BITS });
});

describe("paillier: module defaults", () => {
  test("DEFAULT_KEY_BITS is a real production size (2048), independent of the test key size", () => {
    assert.equal(DEFAULT_KEY_BITS, 2048);
  });
});

describe("paillier: core homomorphic identity", () => {
  test("decrypt(addEncrypted(pk, encrypt(a), encrypt(b))) === a + b, exact BigInt equality, over many random pairs", () => {
    const ROUNDS = 60;
    for (let i = 0; i < ROUNDS; i++) {
      const a = BigInt(randSmallInt());
      const b = BigInt(randSmallInt());
      const ca = encrypt(kp1.publicKey, a);
      const cb = encrypt(kp1.publicKey, b);
      const csum = addEncrypted(kp1.publicKey, ca, cb);
      const result = decrypt(kp1.secretKey, csum);
      assert.equal(result, a + b, `round ${i}: expected ${a} + ${b} = ${a + b}, got ${result}`);
    }
  });

  test("chains 10+ additions and the running total is exact at every step", () => {
    const CHAIN_LEN = 15;
    const values = Array.from({ length: CHAIN_LEN }, () => BigInt(randSmallInt()));
    let runningPlain = 0n;
    let runningCipher = encrypt(kp1.publicKey, 0n);
    for (let i = 0; i < CHAIN_LEN; i++) {
      runningPlain += values[i];
      runningCipher = addEncrypted(kp1.publicKey, runningCipher, encrypt(kp1.publicKey, values[i]));
      const decrypted = decrypt(kp1.secretKey, runningCipher);
      assert.equal(decrypted, runningPlain, `chain step ${i}: expected ${runningPlain}, got ${decrypted}`);
    }
    // Final total, independently cross-checked
    const expectedTotal = values.reduce((s, v) => s + v, 0n);
    assert.equal(runningPlain, expectedTotal);
    assert.equal(decrypt(kp1.secretKey, runningCipher), expectedTotal);
  });
});

describe("paillier: randomized encryption", () => {
  test("encrypting the same plaintext twice yields different ciphertexts that both decrypt to the same value", () => {
    const m = 424242n;
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      const c = encrypt(kp1.publicKey, m);
      seen.add(c.toString());
      assert.equal(decrypt(kp1.secretKey, c), m);
    }
    // All 8 ciphertexts for the SAME plaintext must be distinct — a
    // deterministic scheme would collapse this set to size 1, which would
    // leak plaintext equality to anyone who can compare ciphertexts.
    assert.equal(seen.size, 8, "expected 8 distinct ciphertexts for repeated encryption of the same plaintext");
  });
});

describe("paillier: round-trip across edge values", () => {
  test("decrypt(encrypt(0)) === 0", () => {
    assert.equal(decrypt(kp1.secretKey, encrypt(kp1.publicKey, 0n)), 0n);
  });
  test("decrypt(encrypt(1)) === 1", () => {
    assert.equal(decrypt(kp1.secretKey, encrypt(kp1.publicKey, 1n)), 1n);
  });
  test("decrypt(encrypt(n-1)) === n-1 (large value near the top of the plaintext space)", () => {
    const edge = kp1.publicKey.n - 1n;
    assert.equal(decrypt(kp1.secretKey, encrypt(kp1.publicKey, edge)), edge);
  });
  test("decrypt(encrypt(n-2)) === n-2", () => {
    const edge = kp1.publicKey.n - 2n;
    assert.equal(decrypt(kp1.secretKey, encrypt(kp1.publicKey, edge)), edge);
  });
});

describe("paillier: negative numbers (documented n-wraparound convention)", () => {
  test("decryptSigned round-trips negative values", () => {
    for (const m of [-1n, -5n, -424242n, -1n * BigInt(randSmallInt())]) {
      const c = encrypt(kp1.publicKey, m);
      assert.equal(decryptSigned(kp1.secretKey, c), m);
    }
  });
  test("plain decrypt() of a negative plaintext returns the wrapped [0,n) representative, not the signed value", () => {
    const m = -5n;
    const c = encrypt(kp1.publicKey, m);
    const raw = decrypt(kp1.secretKey, c);
    assert.notEqual(raw, m);
    assert.equal(raw, kp1.publicKey.n - 5n);
  });
  test("homomorphic addition still works across the negative/positive boundary", () => {
    const a = -30n;
    const b = 50n;
    const csum = addEncrypted(kp1.publicKey, encrypt(kp1.publicKey, a), encrypt(kp1.publicKey, b));
    assert.equal(decryptSigned(kp1.secretKey, csum), a + b);
  });
});

describe("paillier: addPlaintext / multiplyPlaintext identities", () => {
  test("addPlaintext(pk, E(a), k) decrypts to a + k", () => {
    for (let i = 0; i < 10; i++) {
      const a = BigInt(randSmallInt());
      const k = BigInt(randSmallInt());
      const c = addPlaintext(kp1.publicKey, encrypt(kp1.publicKey, a), k);
      assert.equal(decrypt(kp1.secretKey, c), a + k);
    }
  });
  test("multiplyPlaintext(pk, E(a), k) decrypts to a * k", () => {
    for (let i = 0; i < 10; i++) {
      const a = BigInt(randSmallInt(1000));
      const k = BigInt(randSmallInt(1000));
      const c = multiplyPlaintext(kp1.publicKey, encrypt(kp1.publicKey, a), k);
      assert.equal(decrypt(kp1.secretKey, c), a * k);
    }
  });
});

describe("paillier: honest refusal of ciphertext x ciphertext", () => {
  test("multiplyCiphertexts refuses explicitly and names FHE", () => {
    const result = multiplyCiphertexts();
    assert.equal(result.ok, false);
    assert.equal(result.error, "fhe_required");
    assert.match(result.reason, /FHE|[Ff]ully [Hh]omomorphic/);
  });

  test("there is no exported function that actually multiplies two ciphertext arguments together", async () => {
    const mod = await import("../lib/crypto/paillier.js");
    // Every export whose name suggests ciphertext-times-ciphertext must be
    // the refusal function (arity 0, returns {ok:false}) — never a real
    // BigInt-returning multiply.
    for (const [name, fn] of Object.entries(mod)) {
      if (typeof fn !== "function") continue;
      if (/multiplyCiphertext/i.test(name)) {
        const r = fn(kp1.publicKey, 1n, 1n);
        assert.equal(r.ok, false, `${name} must refuse rather than return a ciphertext`);
      }
    }
  });
});

describe("paillier: wrong key fails", () => {
  test("decrypting with a different keypair's secret key does not recover the original plaintext", () => {
    const m = 777777n;
    const c = encrypt(kp1.publicKey, m);
    let recovered;
    let threw = false;
    try {
      recovered = decrypt(kp2.secretKey, c);
    } catch (_e) {
      threw = true;
    }
    if (!threw) {
      assert.notEqual(recovered, m, "decrypting with the wrong secret key must not reproduce the original plaintext");
    }
    // Either outcome (throw, or garbage != m) is an acceptable "fails" —
    // what's NOT acceptable is silently recovering the right answer.
  });
});

describe("paillier: key material provenance", () => {
  test("paillier.js sources key material from node:crypto, never Math.random()", () => {
    const here = fileURLToPath(import.meta.url);
    const src = readFileSync(path.join(path.dirname(here), "..", "lib", "crypto", "paillier.js"), "utf8");
    assert.match(src, /from ["']node:crypto["']/, "expected an explicit node:crypto import");
    assert.match(src, /randomBytes/, "expected randomBytes to be used for key/ciphertext randomness");
    assert.doesNotMatch(src, /Math\.random\s*\(/, "paillier.js must never use Math.random() for cryptographic randomness");
  });

  test("two independently generated keypairs have different moduli (proves real randomness, not a fixed/hardcoded key)", () => {
    assert.notEqual(kp1.publicKey.n, kp2.publicKey.n);
  });
});
