// server/lib/crypto/paillier.js
//
// A real Paillier cryptosystem, implemented from scratch in pure BigInt —
// no dependencies beyond node:crypto (used ONLY as the entropy source for
// key material and per-encryption randomness).
//
// ── What this actually provides ─────────────────────────────────────────
// Paillier is a PARTIALLY homomorphic encryption (PHE) scheme: it supports
// exactly these operations, and nothing else —
//   E(a) · E(b)      decrypts to  a + b        (addEncrypted)
//   E(a) · g^k       decrypts to  a + k         (addPlaintext, k a known constant)
//   E(a) ^ k         decrypts to  a * k         (multiplyPlaintext, k a known constant)
// There is deliberately NO function that multiplies two ciphertexts
// together — Paillier cannot do that. E(a) * E(b) is not "encrypted a*b",
// it's meaningless noise. Computing E(a*b) from E(a) and E(b) alone
// requires Fully Homomorphic Encryption (FHE — e.g. CKKS/BFV/BGV/TFHE,
// which rely on bootstrapping to support unbounded multiplicative depth).
// This module does not implement FHE and does not claim to.
// `multiplyCiphertexts` exists only to return an explicit, named refusal
// instead of silently producing garbage — see below.
//
// Paillier arithmetic is BigInt modular exponentiation over a ~2048-bit
// modulus by default — orders of magnitude slower than native number
// arithmetic. It is appropriate for aggregating a bounded set of
// contributor values (see ../crypto/encrypted-aggregate.js), not for
// general-purpose computation.
//
// Confidentiality only. Paillier hides the plaintext of each ciphertext
// from anyone without the secret key; it says nothing about what the
// *released* decrypted result might leak about its inputs (e.g. decrypting
// the sum of exactly one contribution reveals that contribution exactly).
// That is a differential-privacy concern, not an encryption concern — see
// encrypted-aggregate.js's `releaseWithDifferentialPrivacy`, which composes
// this module with the real Laplace mechanism in
// server/domains/anon.js's `differentialPrivacy` macro.
//
// Key-generation quality depends on the primality test (Miller-Rabin,
// implemented below) and the entropy source (node:crypto's CSPRNG). This
// is appropriate for application use but has not been independently
// audited — do not use this for anything beyond Concord's own in-app
// aggregation use case without a proper security review.

import { randomBytes } from "node:crypto";

/** Real production key size. Tests use smaller keys (see paillier.test.js)
 *  purely for speed — this constant is what `generateKeypair()` uses when
 *  the caller doesn't override `bits`. */
export const DEFAULT_KEY_BITS = 2048;

/** Floor enforced by generateKeypair — below this, "prime" search still
 *  works but the resulting modulus offers no real security margin; the
 *  floor exists so a careless low bits value doesn't silently mint a
 *  toy key and call it a keypair. Tests deliberately use 512, which is
 *  still well above this floor and fast to generate. */
const MIN_KEY_BITS = 256;

// ─── BigInt primitives ─────────────────────────────────────────────────

function absBig(x) {
  return x < 0n ? -x : x;
}

function gcd(a, b) {
  a = absBig(a);
  b = absBig(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function lcm(a, b) {
  return (a / gcd(a, b)) * b;
}

/** Extended Euclidean algorithm — modular inverse of `a` mod `m`. */
function modInverse(a, m) {
  let aa = ((a % m) + m) % m;
  let [oldR, r] = [aa, m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) {
    throw new Error("modInverse: value is not invertible modulo m (gcd != 1)");
  }
  return ((oldS % m) + m) % m;
}

/** base^exp mod m via BigInt square-and-multiply. */
function modPow(base, exp, m) {
  if (m === 1n) return 0n;
  let result = 1n;
  let b = ((base % m) + m) % m;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

/**
 * Cryptographically-random BigInt with exactly `bits` significant bits
 * (top bit forced set) and forced odd (bottom bit set) — suitable as a
 * primality-test candidate. Uses node:crypto.randomBytes, NEVER the
 * platform's non-cryptographic pseudo-random generator — that generator
 * is not a cryptographically secure PRNG (predictable state on multiple
 * engines), which would make key material generated from it
 * forgeable/predictable.
 */
function randomOddBigIntWithBits(bits) {
  const byteLen = Math.ceil(bits / 8);
  const excessBits = byteLen * 8 - bits;
  const buf = randomBytes(byteLen);
  if (excessBits > 0) {
    buf[0] &= 0xff >> excessBits;
  }
  buf[0] |= 0x80 >> excessBits; // force the top significant bit set
  buf[byteLen - 1] |= 1; // force odd
  return BigInt("0x" + buf.toString("hex"));
}

/** Cryptographically-random BigInt uniform in [0, max). node:crypto-backed. */
function randomBigIntBelow(max) {
  if (max <= 0n) throw new Error("randomBigIntBelow: max must be positive");
  const bits = max.toString(2).length;
  const byteLen = Math.ceil(bits / 8);
  const excessBits = byteLen * 8 - bits;
  for (;;) {
    const buf = randomBytes(byteLen);
    if (excessBits > 0) buf[0] &= 0xff >> excessBits;
    const candidate = BigInt("0x" + buf.toString("hex"));
    if (candidate < max) return candidate;
  }
}

const SMALL_PRIMES = [
  2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n, 43n, 47n, 53n,
  59n, 61n, 67n, 71n, 73n, 79n, 83n, 89n, 97n, 101n, 103n, 107n, 109n, 113n,
  127n, 131n, 137n, 139n, 149n, 151n, 157n, 163n, 167n, 173n, 179n, 181n,
  191n, 193n, 197n, 199n, 211n, 223n, 227n, 229n, 233n, 239n, 241n, 251n,
];

/**
 * Miller-Rabin primality test with cryptographically-random witnesses
 * (node:crypto-backed). Probabilistic: `rounds` independent witnesses
 * bound the false-positive probability at 4^-rounds — standard practice
 * for RSA/Paillier-class prime generation (this is the same class of test
 * OpenSSL/GMP use, just without the sieve pre-filters they add for speed).
 */
// Single Miller-Rabin witness check against n = 2^r * d + 1. Returns true
// iff witness `a` does NOT prove n composite (i.e. n passes this round).
function passesMillerRabinWitness(n, d, r, a) {
  let x = modPow(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let j = 0n; j < r - 1n; j++) {
    x = modPow(x, 2n, n);
    if (x === n - 1n) return true;
  }
  return false;
}

function isProbablePrime(n, rounds = 24) {
  if (n < 2n) return false;
  for (const p of SMALL_PRIMES) {
    if (n === p) return true;
    if (n % p === 0n) return false;
  }
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d /= 2n;
    r += 1n;
  }
  for (let i = 0; i < rounds; i++) {
    const a = 2n + randomBigIntBelow(n - 3n); // witness in [2, n-2]
    if (!passesMillerRabinWitness(n, d, r, a)) return false;
  }
  return true;
}

function generatePrime(bits) {
  for (;;) {
    const candidate = randomOddBigIntWithBits(bits);
    if (isProbablePrime(candidate)) return candidate;
  }
}

// ─── Keypair generation ─────────────────────────────────────────────────

/**
 * generateKeypair({ bits })
 * Two random `bits/2`-bit primes p, q (node:crypto-backed Miller-Rabin
 * search); n = p*q; lambda = lcm(p-1, q-1); g = n+1 (the standard
 * simplification — valid whenever gcd(n, lambda) === 1, which we check
 * and regenerate on the rare failure rather than silently proceeding);
 * mu = (L(g^lambda mod n^2))^-1 mod n, where L(x) = (x-1)/n.
 *
 * Returns { publicKey: {n, g, nSquared, bits}, secretKey: {lambda, mu, n, nSquared, bits} }
 * — all BigInt fields. Use publicKeyToJSON/secretKeyToJSON to serialize.
 */
export function generateKeypair({ bits = DEFAULT_KEY_BITS } = {}) {
  if (!Number.isInteger(bits) || bits < MIN_KEY_BITS) {
    throw new Error(
      `generateKeypair: bits must be an integer >= ${MIN_KEY_BITS} (got ${bits}). ` +
      `The module default is ${DEFAULT_KEY_BITS} for real use; tests may use smaller ` +
      `keys (still >= ${MIN_KEY_BITS}) purely for speed.`
    );
  }
  const primeBits = Math.floor(bits / 2);
  let p, q, n, nSquared, lambda;
  for (;;) {
    p = generatePrime(primeBits);
    q = generatePrime(primeBits);
    if (p === q) continue;
    n = p * q;
    nSquared = n * n;
    lambda = lcm(p - 1n, q - 1n);
    // Required for the g=n+1 simplification's bijectivity guarantee. Holds
    // for virtually all random prime pairs; regenerate on the rare miss
    // rather than silently proceeding with a broken key.
    if (gcd(n, lambda) === 1n) break;
  }
  const g = n + 1n;
  const L = (x) => (x - 1n) / n;
  const mu = modInverse(L(modPow(g, lambda, nSquared)), n);
  return {
    publicKey: { n, g, nSquared, bits },
    secretKey: { lambda, mu, n, nSquared, bits },
  };
}

function assertPublicKey(pk) {
  if (!pk || typeof pk.n !== "bigint" || typeof pk.g !== "bigint") {
    throw new Error("invalid Paillier public key (expected BigInt n, g — see publicKeyFromJSON for deserializing a stored key)");
  }
}

function assertSecretKey(sk) {
  if (!sk || typeof sk.lambda !== "bigint" || typeof sk.mu !== "bigint" || typeof sk.n !== "bigint") {
    throw new Error("invalid Paillier secret key (expected BigInt lambda, mu, n — see secretKeyFromJSON for deserializing a stored key)");
  }
}

function nSquaredOf(pkOrSk) {
  return pkOrSk.nSquared ?? pkOrSk.n * pkOrSk.n;
}

function coerceBigInt(v) {
  return typeof v === "bigint" ? v : BigInt(v);
}

/**
 * Standard Paillier plaintext-wraparound convention for negative numbers:
 * the plaintext space is Z_n, so a signed value m in (-n/2, n/2) is
 * represented as (m mod n) — i.e. a negative value wraps around to
 * n + m. This is not "silently producing garbage": it's the documented,
 * standard way Paillier (and modular arithmetic generally) represents
 * negative integers. `decryptSigned` reverses it by mapping any raw
 * decrypted value > n/2 back to negative. Plain `decrypt` always returns
 * the raw unsigned representative in [0, n).
 */
function wrapSignedPlaintext(n, m) {
  const v = coerceBigInt(m);
  return ((v % n) + n) % n;
}

// ─── Core operations ────────────────────────────────────────────────────

/**
 * encrypt(pk, m) -> ciphertext BigInt
 * c = g^m * r^n mod n^2, with a FRESH cryptographically-random r (coprime
 * to n) drawn on every call — this randomization is what makes Paillier
 * encryption semantically secure: encrypting the same plaintext twice
 * yields two different ciphertexts, both of which decrypt to the same
 * value. Accepts negative BigInt/number/string m per the wraparound
 * convention documented above.
 */
export function encrypt(pk, m) {
  assertPublicKey(pk);
  const nSquared = nSquaredOf(pk);
  const mm = wrapSignedPlaintext(pk.n, m);
  let r;
  do {
    r = randomBigIntBelow(pk.n);
  } while (r === 0n || gcd(r, pk.n) !== 1n);
  const gm = modPow(pk.g, mm, nSquared);
  const rn = modPow(r, pk.n, nSquared);
  return (gm * rn) % nSquared;
}

/**
 * decrypt(sk, c) -> plaintext BigInt in [0, n)
 * m = L(c^lambda mod n^2) * mu mod n, where L(x) = (x-1)/n.
 * Returns the raw unsigned representative — use decryptSigned if the
 * plaintext may have been a negative number under the wraparound
 * convention.
 */
export function decrypt(sk, c) {
  assertSecretKey(sk);
  const nSquared = nSquaredOf(sk);
  const cc = coerceBigInt(c);
  const L = (x) => (x - 1n) / sk.n;
  const u = modPow(cc, sk.lambda, nSquared);
  return (L(u) * sk.mu) % sk.n;
}

/** decrypt(), then reinterpret the [0, n) result as a signed value using
 *  the n/2 cutoff documented on wrapSignedPlaintext. */
export function decryptSigned(sk, c) {
  const m = decrypt(sk, c);
  return m > sk.n / 2n ? m - sk.n : m;
}

/**
 * addEncrypted(pk, c1, c2) -> ciphertext BigInt
 * c1 * c2 mod n^2. This is Paillier's entire reason for existing:
 * decrypt(addEncrypted(pk, encrypt(a), encrypt(b))) === a + b, computed
 * without either operand ever being decrypted.
 */
export function addEncrypted(pk, c1, c2) {
  assertPublicKey(pk);
  const nSquared = nSquaredOf(pk);
  return (coerceBigInt(c1) * coerceBigInt(c2)) % nSquared;
}

/**
 * addPlaintext(pk, c, k) -> ciphertext BigInt
 * c * g^k mod n^2 — decrypts to (plaintext of c) + k, for a k the caller
 * knows in the clear (not itself encrypted).
 */
export function addPlaintext(pk, c, k) {
  assertPublicKey(pk);
  const nSquared = nSquaredOf(pk);
  const kk = wrapSignedPlaintext(pk.n, k);
  return (coerceBigInt(c) * modPow(pk.g, kk, nSquared)) % nSquared;
}

/**
 * multiplyPlaintext(pk, c, k) -> ciphertext BigInt
 * c^k mod n^2 — decrypts to (plaintext of c) * k, for a k the caller
 * knows in the clear. This is scaling by a known constant, NOT
 * multiplying two encrypted values together (see multiplyCiphertexts).
 */
export function multiplyPlaintext(pk, c, k) {
  assertPublicKey(pk);
  const nSquared = nSquaredOf(pk);
  const kk = wrapSignedPlaintext(pk.n, k);
  return modPow(coerceBigInt(c), kk, nSquared);
}

/**
 * multiplyCiphertexts(...) — DELIBERATELY NOT A REAL OPERATION.
 * There is no ciphertext-times-ciphertext operation in Paillier. Calling
 * this always returns a structured refusal rather than a number, so
 * nothing downstream can mistake it for a real result. If you need
 * arbitrary-depth computation over ciphertexts (including ciphertext x
 * ciphertext), that requires Fully Homomorphic Encryption — this module
 * is Partially Homomorphic (additive-only) and does not implement FHE.
 */
export function multiplyCiphertexts() {
  return {
    ok: false,
    error: "fhe_required",
    reason:
      "Paillier is partially homomorphic (additive only): E(a) * E(b) does not " +
      "decrypt to a*b, or to anything meaningful — it is not a valid operation in " +
      "this scheme. Computing an encrypted product of two ciphertexts requires " +
      "Fully Homomorphic Encryption (FHE — e.g. CKKS, BFV, BGV, or TFHE, which use " +
      "bootstrapping to support unbounded multiplicative depth). This module does " +
      "not implement FHE and does not claim to. Use addEncrypted() for E(a)+E(b), " +
      "or multiplyPlaintext() to scale a ciphertext by a known plaintext constant.",
  };
}

// ─── Serialization (BigInt <-> JSON-safe strings) ──────────────────────
// BigInt is not JSON-serializable. Anything that crosses a persistence or
// network boundary (macro results, saved lens state) must go through
// these, never carry a raw BigInt across that boundary.

export function publicKeyToJSON(pk) {
  assertPublicKey(pk);
  return { n: pk.n.toString(), g: pk.g.toString(), bits: pk.bits ?? null };
}

export function publicKeyFromJSON(obj) {
  const n = BigInt(obj.n);
  const g = BigInt(obj.g);
  return { n, g, nSquared: n * n, bits: obj.bits ?? null };
}

export function secretKeyToJSON(sk) {
  assertSecretKey(sk);
  return { lambda: sk.lambda.toString(), mu: sk.mu.toString(), n: sk.n.toString(), bits: sk.bits ?? null };
}

export function secretKeyFromJSON(obj) {
  const n = BigInt(obj.n);
  return { lambda: BigInt(obj.lambda), mu: BigInt(obj.mu), n, nSquared: n * n, bits: obj.bits ?? null };
}

export function ciphertextToString(c) {
  return coerceBigInt(c).toString();
}

export function ciphertextFromString(s) {
  return BigInt(s);
}
