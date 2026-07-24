// Fixture: explicit `// @secret` annotation as the taint source, on a
// deliberately non-suggestive identifier (`k`) that the naming-convention
// heuristic would never catch on its own. Proves the annotation path is a
// real, independent taint source, not just decoration. MUST be flagged
// (secret_dependent_branch).
// @secret
function verify(k, input) {
  if (k === input) {
    return true;
  }
  return false;
}

module.exports = { verify };
