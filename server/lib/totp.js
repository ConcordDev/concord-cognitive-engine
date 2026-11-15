// server/lib/totp.js — two-factor authentication primitives (FIX-settings-005).
//
// TOTP enrolment + sign-in enforcement for Concord accounts, implemented
// from node:crypto only (no new dependency): HOTP/TOTP per RFC 4226 /
// RFC 6238 (SHA-1, 6 digits, 30-second step), base32 secrets (RFC 4648),
// single-use recovery codes (SHA-256 hashed at rest), a short-lived
// sign-in challenge store, and at-rest encryption for the TOTP secret in
// the platform's connector-tokens format (enc:v1: AES-256-GCM, key from
// CONCORD_CONNECTOR_TOKEN_KEY || JWT_SECRET || SESSION_SECRET, plaintext
// degrade WITH a warning when no secret is configured — the same posture
// as server/lib/connector-tokens.js, whose helpers are module-private;
// the ciphertext format is identical so rows stay interchangeable).
//
// Nothing in this module logs a secret, a code, or a recovery code.

import crypto from "node:crypto";

// ── base32 (RFC 4648) ────────────────────────────────────────────────────

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ── HOTP / TOTP (RFC 4226 / RFC 6238) ────────────────────────────────────

export function hotp(secretBuf, counter, digits = 6) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secretBuf).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export const TOTP_STEP_SEC = 30;
export const TOTP_DIGITS = 6;

export function totp(secretBuf, { atMs = Date.now(), stepSec = TOTP_STEP_SEC, digits = TOTP_DIGITS } = {}) {
  return hotp(secretBuf, Math.floor(atMs / 1000 / stepSec), digits);
}

// Verify a user-supplied code against the secret. Accepts the current
// step ± `window` steps for clock drift, but REJECTS any step at or
// below `lastAcceptedStep` — a code that already signed someone in
// cannot be replayed inside its validity window. Returns { ok, step }
// where step is the matched counter (persist it as the new
// lastAcceptedStep on success), or { ok: false }.
export function verifyTotp(secretBuf, code, { atMs = Date.now(), window = 1, lastAcceptedStep = -1, stepSec = TOTP_STEP_SEC, digits = TOTP_DIGITS } = {}) {
  const supplied = String(code || "").replace(/\s/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(supplied)) return { ok: false };
  const nowStep = Math.floor(atMs / 1000 / stepSec);
  for (let delta = -window; delta <= window; delta++) {
    const step = nowStep + delta;
    if (step < 0 || step <= lastAcceptedStep) continue;
    const expected = hotp(secretBuf, step, digits);
    const a = Buffer.from(expected);
    const b = Buffer.from(supplied);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      return { ok: true, step };
    }
  }
  return { ok: false };
}

export function generateSecretBase32() {
  return base32Encode(crypto.randomBytes(20));
}

export function buildOtpauthUri({ issuer = "Concord", account, secretBase32 }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── recovery codes ───────────────────────────────────────────────────────

// Ten codes, each 12 hex chars shown as XXXX-XXXX-XXXX. The plaintext
// is returned exactly once (at enable / regenerate); only the SHA-256
// hash of the normalised code is ever stored.
export function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    const hex = crypto.randomBytes(6).toString("hex").toUpperCase();
    codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
  }
  return codes;
}

export function normaliseRecoveryCode(code) {
  return String(code || "").toUpperCase().replace(/[^0-9A-F]/g, "");
}

export function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(normaliseRecoveryCode(code)).digest("hex");
}

// ── secret at rest (connector-tokens enc:v1 format) ─────────────────────

const ENC_PREFIX = "enc:v1:";
let _warnedNoKey = false;

function totpKey() {
  const raw =
    process.env.CONCORD_CONNECTOR_TOKEN_KEY ||
    process.env.JWT_SECRET ||
    process.env.SESSION_SECRET ||
    "";
  if (!raw) return null;
  return crypto.createHash("sha256").update(String(raw)).digest();
}

export function encryptSecret(plain) {
  if (plain == null) return null;
  const key = totpKey();
  if (!key) {
    if (!_warnedNoKey) {
      console.warn("[totp] no CONCORD_CONNECTOR_TOKEN_KEY/JWT_SECRET/SESSION_SECRET set — TOTP secrets stored UNENCRYPTED. Set a secret to enable AES-256-GCM at rest.");
      _warnedNoKey = true;
    }
    return String(plain);
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (stored == null) return null;
  const s = String(stored);
  if (!s.startsWith(ENC_PREFIX)) return s; // plaintext row (no-key degrade)
  const key = totpKey();
  if (!key) return null; // cannot decrypt without the key → fail closed
  try {
    const [ivHex, tagHex, ctHex] = s.slice(ENC_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return null; // tampered or wrong key → fail closed
  }
}

// ── sign-in challenge store ──────────────────────────────────────────────

// A challenge is minted only AFTER the password verifies. It carries
// nothing but the user id, its birth time, and a failed-attempt count.
// 5-minute TTL, at most 5 attempts, one live challenge per user (a
// fresh mint burns the user's previous challenge), burned on success.
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const CHALLENGE_MAX_ATTEMPTS = 5;

export function createChallengeStore({ ttlMs = CHALLENGE_TTL_MS, maxAttempts = CHALLENGE_MAX_ATTEMPTS } = {}) {
  const byId = new Map();
  const byUser = new Map();

  function burn(id) {
    const rec = byId.get(id);
    if (!rec) return;
    byId.delete(id);
    if (byUser.get(rec.userId) === id) byUser.delete(rec.userId);
  }

  function sweep(now) {
    for (const [id, rec] of byId) {
      if (now - rec.createdAt > ttlMs) burn(id);
    }
  }

  return {
    mint(userId, now = Date.now()) {
      sweep(now);
      const prior = byUser.get(userId);
      if (prior) burn(prior);
      const id = crypto.randomBytes(32).toString("hex");
      byId.set(id, { userId, createdAt: now, attempts: 0 });
      byUser.set(userId, id);
      return id;
    },
    // Returns the live record or null (unknown / expired → burned).
    get(id, now = Date.now()) {
      const rec = byId.get(id);
      if (!rec) return null;
      if (now - rec.createdAt > ttlMs) {
        burn(id);
        return null;
      }
      return rec;
    },
    // Records a failed attempt; burns and returns false at the cap.
    fail(id) {
      const rec = byId.get(id);
      if (!rec) return false;
      rec.attempts += 1;
      if (rec.attempts >= maxAttempts) {
        burn(id);
        return false;
      }
      return true;
    },
    burn,
    size() {
      return byId.size;
    },
  };
}

// The one process-wide challenge store. Both sign-in issuance paths
// (routes/auth.js password login and routes/oauth.js completion) mint
// into it, and POST /api/auth/login/verify-2fa is its only consumer.
export const signInChallenges = createChallengeStore();
