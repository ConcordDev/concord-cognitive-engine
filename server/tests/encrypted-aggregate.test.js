// server/tests/encrypted-aggregate.test.js
//
// Validates server/lib/crypto/encrypted-aggregate.js — sum/mean over N
// contributor Paillier ciphertexts, computed without decrypting any
// individual contribution. Run WITHOUT --test-force-exit.

import { test, before, describe } from "node:test";
import assert from "node:assert/strict";

import { generateKeypair, encrypt, decrypt as realDecrypt } from "../lib/crypto/paillier.js";
import {
  aggregateSumEncrypted,
  aggregate,
  releaseWithDifferentialPrivacy,
} from "../lib/crypto/encrypted-aggregate.js";

const TEST_BITS = 512;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(986532);
function randSmallInt(max = 1000) {
  return Math.floor(rng() * max);
}

let kp;

before(() => {
  kp = generateKeypair({ bits: TEST_BITS });
});

describe("encrypted-aggregate: sum matches plaintext-computed sum exactly", () => {
  test("sum over N contributor ciphertexts", () => {
    const N = 20;
    const values = Array.from({ length: N }, () => BigInt(randSmallInt()));
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    const expectedSum = values.reduce((s, v) => s + v, 0n);

    const result = aggregate({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "sum" });

    assert.equal(result.mode, "sum");
    assert.equal(result.count, N);
    assert.equal(result.sum, expectedSum);
  });

  test("sum of a single contribution equals that contribution", () => {
    const value = 42n;
    const ciphertexts = [encrypt(kp.publicKey, value)];
    const result = aggregate({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "sum" });
    assert.equal(result.sum, value);
  });
});

describe("encrypted-aggregate: mean matches plaintext-computed mean exactly", () => {
  test("mean over N contributor ciphertexts", () => {
    const N = 17;
    const values = Array.from({ length: N }, () => BigInt(randSmallInt()));
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    const expectedSum = values.reduce((s, v) => s + v, 0n);
    const expectedMean = Number(expectedSum) / N;
    const expectedMeanFloor = expectedSum / BigInt(N);

    const result = aggregate({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "mean" });

    assert.equal(result.sum, expectedSum);
    assert.equal(result.mean, expectedMean);
    assert.equal(result.meanFloor, expectedMeanFloor);
  });

  test("exactly-divisible mean is exact (no floating point drift)", () => {
    const values = [10n, 20n, 30n, 40n]; // sum 100, count 4, mean exactly 25
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    const result = aggregate({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "mean" });
    assert.equal(result.mean, 25);
    assert.equal(result.meanFloor, 25n);
  });
});

describe("encrypted-aggregate: aggregateSumEncrypted never decrypts", () => {
  test("aggregateSumEncrypted performs pure ciphertext arithmetic and returns a ciphertext, not a plaintext", () => {
    const values = [1n, 2n, 3n];
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    const sumCiphertext = aggregateSumEncrypted(kp.publicKey, ciphertexts);
    // The returned aggregate must itself still be an encrypted value: it
    // must NOT equal the plaintext sum, and it must decrypt correctly.
    assert.notEqual(sumCiphertext, 6n);
    assert.equal(realDecrypt(kp.secretKey, sumCiphertext), 6n);
  });
});

describe("encrypted-aggregate: the aggregate path decrypts exactly once, on the final aggregate only", () => {
  test("decrypt is invoked exactly once, with the aggregate ciphertext (not any individual contribution)", () => {
    const values = [5n, 15n, 25n, 35n, 45n];
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    const expectedAggregateCiphertext = aggregateSumEncrypted(kp.publicKey, ciphertexts);

    let calls = 0;
    const seenArgs = [];
    const spyDecrypt = (sk, c) => {
      calls++;
      seenArgs.push(c);
      return realDecrypt(sk, c);
    };

    const result = aggregate({
      pk: kp.publicKey,
      sk: kp.secretKey,
      ciphertexts,
      mode: "sum",
      decryptFn: spyDecrypt,
    });

    assert.equal(calls, 1, "decrypt must be called exactly once for the whole aggregation");
    assert.equal(seenArgs[0], expectedAggregateCiphertext, "the single decrypt call must operate on the aggregate ciphertext");
    for (const c of ciphertexts) {
      assert.notEqual(seenArgs[0], c, "the decrypted argument must not be any individual contribution's ciphertext");
    }
    assert.equal(result.sum, values.reduce((s, v) => s + v, 0n));
  });

  test("same single-decrypt guarantee holds for mode: mean", () => {
    const values = [3n, 6n, 9n];
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    let calls = 0;
    const spyDecrypt = (sk, c) => { calls++; return realDecrypt(sk, c); };
    aggregate({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "mean", decryptFn: spyDecrypt });
    assert.equal(calls, 1);
  });
});

describe("encrypted-aggregate: composes with differential privacy via an injected mechanism, never its own", () => {
  test("releaseWithDifferentialPrivacy requires an explicit noiseFn (refuses to invent its own DP)", () => {
    const ciphertexts = [encrypt(kp.publicKey, 10n)];
    assert.throws(
      () => releaseWithDifferentialPrivacy({ pk: kp.publicKey, sk: kp.secretKey, ciphertexts, mode: "sum" }),
      /noiseFn/
    );
  });

  test("releaseWithDifferentialPrivacy applies the injected noiseFn to the single revealed scalar and still only decrypts once", () => {
    const values = [10n, 20n, 30n];
    const ciphertexts = values.map((v) => encrypt(kp.publicKey, v));
    let decryptCalls = 0;
    const spyDecrypt = (sk, c) => { decryptCalls++; return realDecrypt(sk, c); };
    let noiseFnCalledWith = null;
    const noiseFn = (rawValue) => {
      noiseFnCalledWith = rawValue;
      return rawValue + 1000; // deterministic stand-in "noise" for the test
    };

    const result = releaseWithDifferentialPrivacy({
      pk: kp.publicKey,
      sk: kp.secretKey,
      ciphertexts,
      mode: "sum",
      noiseFn,
      decryptFn: spyDecrypt,
    });

    assert.equal(decryptCalls, 1);
    assert.equal(noiseFnCalledWith, 60); // exact revealed sum, pre-noise
    assert.equal(result.rawValue, 60);
    assert.equal(result.released, 1060);
  });
});
