// Fixture: the clean counterpart of vulnerable-branch.js. Same shape —
// a parameter gates which of two paths executes — but `userChoice` matches
// no taint source, so this ordinary, extremely common control-flow pattern
// must NOT be flagged. Proves the detector isn't just flagging "any if on a
// parameter."
function checkAccess(userChoice) {
  if (userChoice) {
    return grantAccess();
  }
  return denyAccess();
}

function grantAccess() { return true; }
function denyAccess() { return false; }

module.exports = { checkAccess };
