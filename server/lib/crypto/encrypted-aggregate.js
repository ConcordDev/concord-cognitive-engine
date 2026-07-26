// server/lib/crypto/encrypted-aggregate.js
//
// Encrypted sum/mean aggregation over Paillier ciphertexts contributed by
// multiple parties, computed ENTIRELY on ciphertexts. Combining N
// contributors' encrypted values into one running total never decrypts
// an individual contribution — only the final aggregate is ever
// decrypted, and only once, by whoever calls aggregate()/
// releaseWithDifferentialPrivacy() with the secret key.
//
// ── Two different guarantees — do not conflate them ─────────────────────
// 1. Paillier's additive homomorphism (this module) provides
//    CONFIDENTIALITY OF INDIVIDUAL CONTRIBUTIONS DURING COMPUTATION: an
//    observer who sees every ciphertext, and even the aggregation
//    process itself, learns nothing about any individual contributor's
//    value — only whoever holds the secret key can decrypt, and even
//    they only ever decrypt the combined total, never a single
//    contribution.
// 2. Differential privacy (the real Laplace mechanism already in
//    server/domains/anon.js's `differentialPrivacy` macro, with its
//    persisted cross-session epsilon ledger) provides a bound on how much
//    the RELEASED, decrypted result can leak about any individual
//    contribution. These are not the same guarantee: a perfectly
//    confidential-in-transit aggregate can still leak everything on
//    release (a sum of exactly one contributor's encrypted value decrypts
//    to that value, exactly — Paillier was never asked to prevent that).
//    That is precisely why `releaseWithDifferentialPrivacy` below composes
//    with a DP mechanism rather than treating encryption alone as
//    sufficient privacy.
//
// This module does NOT reimplement differential privacy. It never invents
// its own Laplace sampler — `releaseWithDifferentialPrivacy` takes a
// caller-supplied `noiseFn`, and the intended caller (see
// server/domains/crypto.js's `paillierAggregate` macro) supplies one
// backed by the real anon.js `differentialPrivacy` macro, so the exact
// same mechanism and the exact same persisted epsilon budget apply
// everywhere DP is used in this codebase.

import { addEncrypted, decrypt as defaultDecrypt } from "./paillier.js";

/**
 * aggregateSumEncrypted(pk, ciphertexts) -> ciphertext BigInt
 * Homomorphically sums N ciphertexts via repeated addEncrypted. Pure
 * ciphertext arithmetic — never touches a secret key, never decrypts
 * anything.
 */
export function aggregateSumEncrypted(pk, ciphertexts) {
  if (!Array.isArray(ciphertexts) || ciphertexts.length === 0) {
    throw new Error("aggregateSumEncrypted: requires at least one ciphertext");
  }
  let acc = ciphertexts[0];
  for (let i = 1; i < ciphertexts.length; i++) {
    acc = addEncrypted(pk, acc, ciphertexts[i]);
  }
  return acc;
}

/**
 * aggregate({ pk, sk, ciphertexts, mode, decryptFn })
 * mode: "sum" | "mean"
 *
 * Homomorphically combines every ciphertext (never decrypting any of
 * them individually), then decrypts the SINGLE resulting aggregate
 * ciphertext exactly once. `decryptFn` defaults to paillier.js's real
 * `decrypt` — tests inject a spy here to prove the single-decrypt
 * property without needing to monkeypatch a frozen ES-module export.
 *
 * Paillier cannot compute mean by dividing ciphertexts (division isn't a
 * supported homomorphic operation, and even if it were, an exact integer
 * mean over ciphertexts alone isn't generally meaningful) — so "mean" is
 * computed as: homomorphic sum -> single decrypt -> plaintext division.
 * The division happens in the clear, on the already-revealed aggregate,
 * not on any individual contribution.
 */
export function aggregate({ pk, sk, ciphertexts, mode = "sum", decryptFn = defaultDecrypt }) {
  if (mode !== "sum" && mode !== "mean") {
    throw new Error(
      `aggregate: unsupported mode '${mode}' — only 'sum' and 'mean' are supported. ` +
      `Paillier's only ciphertext-level operations are addition and plaintext-constant ` +
      `scaling, so anything requiring ciphertext x ciphertext (e.g. variance/stddev ` +
      `computed purely over ciphertexts) is out of scope for this module.`
    );
  }
  const count = ciphertexts.length;
  const sumCiphertext = aggregateSumEncrypted(pk, ciphertexts);
  // The ONE decrypt call in the entire pipeline — on the aggregate, never
  // on an individual contribution.
  const sum = decryptFn(sk, sumCiphertext);
  if (mode === "sum") {
    return { mode, sum, count, sumCiphertext };
  }
  return {
    mode,
    sum,
    count,
    mean: Number(sum) / count,
    // Exact BigInt floor-division mean, for callers who want to stay in
    // BigInt-land instead of losing precision to a JS Number.
    meanFloor: sum / BigInt(count),
    sumCiphertext,
  };
}

/**
 * releaseWithDifferentialPrivacy({ pk, sk, ciphertexts, mode, noiseFn, decryptFn })
 * Wraps aggregate() and then hands the single revealed scalar to a
 * caller-supplied `noiseFn(rawValue) -> noisyValue`. This function is
 * REQUIRED — this module deliberately does not implement its own DP
 * mechanism (see module docstring). The intended noiseFn calls into
 * server/domains/anon.js's real `differentialPrivacy` macro so the
 * released number is noised by the same Laplace mechanism (and counted
 * against the same persisted epsilon ledger) as every other DP-noised
 * value in Concord.
 */
export function releaseWithDifferentialPrivacy({ pk, sk, ciphertexts, mode = "sum", noiseFn, decryptFn = defaultDecrypt }) {
  if (typeof noiseFn !== "function") {
    throw new Error(
      "releaseWithDifferentialPrivacy: requires a noiseFn. This module does not " +
      "reimplement differential privacy — compose with server/domains/anon.js's " +
      "real `differentialPrivacy` macro (Laplace mechanism + persisted epsilon " +
      "ledger) instead of inventing a second, uncoordinated noise mechanism."
    );
  }
  const agg = aggregate({ pk, sk, ciphertexts, mode, decryptFn });
  const rawValue = mode === "mean" ? agg.mean : Number(agg.sum);
  const released = noiseFn(rawValue);
  return { ...agg, rawValue, released };
}
