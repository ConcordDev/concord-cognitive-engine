// Fixture: the constant-time version of vulnerable-compare.js. Fixed-length
// loop (bound is `secret.length` — a `.length` access on the tainted array,
// deliberately exempt from the loop-bound rule since it's the recommended
// idiom: touch every byte regardless of content), accumulate differences
// with `|=` (compound assignment — deliberately NOT taint-propagating, see
// detector header), single comparison after the loop, no early exit.
//
// This is the LOAD-BEARING negative test — a detector that flags this is
// worthless, because this is what the fix looks like.
// @secret
function timingSafeEquals(secret, input) {
  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret[i] ^ input[i];
  }
  return diff === 0;
}

module.exports = { timingSafeEquals };
