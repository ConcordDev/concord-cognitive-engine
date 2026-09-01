// server/lib/auth-gate/gates/expiration.js
//
// F0.5 NEW gate — TTL check. Auth-gate's only NEW gate that has no
// existing system to wrap; this is a small, well-scoped addition.

/**
 * Check if envelope EXPIRATION has elapsed.
 *
 * @param {Object} envelope
 * @returns {Object} {pass, reason_code, expired_at, now}
 */
export async function check(envelope) {
  if (!envelope.EXPIRATION) {
    // No expiration set → pass (caller decided this envelope never expires)
    return { pass: true, reason_code: "no_expiration_set" };
  }

  const expiresAt = new Date(envelope.EXPIRATION).getTime();
  if (Number.isNaN(expiresAt)) {
    return { pass: false, reason_code: "expiration_unparseable", value: envelope.EXPIRATION };
  }

  const now = Date.now();
  if (now >= expiresAt) {
    return {
      pass: false,
      reason_code: "authority_expired",
      expired_at: envelope.EXPIRATION,
      now: new Date(now).toISOString(),
    };
  }

  return {
    pass: true,
    reason_code: "authority_valid",
    expires_at: envelope.EXPIRATION,
    remaining_ms: expiresAt - now,
  };
}