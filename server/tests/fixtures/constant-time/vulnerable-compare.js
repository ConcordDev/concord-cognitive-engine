// Fixture: the textbook non-constant-time comparison. `secret` is a taint source via the
// authoritative `// @secret` annotation. The loop bails out via an early `return
// false` the instant a mismatch is found, so the time this function takes
// leaks the position of the first differing byte — the classic timing
// side-channel precondition. MUST be flagged (secret_dependent_early_exit,
// and also secret_dependent_branch for the `if` inside the loop).
// @secret
function timingUnsafeEquals(secret, input) {
  for (let i = 0; i < secret.length; i++) {
    if (secret[i] !== input[i]) {
      return false;
    }
  }
  return true;
}

module.exports = { timingUnsafeEquals };
