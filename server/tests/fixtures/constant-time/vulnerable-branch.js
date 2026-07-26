// Fixture: secret-dependent branch. `secretFlag` is tainted by naming
// convention and directly gates which of two paths executes — the branch
// taken (and its timing) can leak the secret. MUST be flagged
// (secret_dependent_branch).
// @secret
function checkAccess(secretFlag) {
  if (secretFlag) {
    return grantAccess();
  }
  return denyAccess();
}

function grantAccess() { return true; }
function denyAccess() { return false; }

module.exports = { checkAccess };
