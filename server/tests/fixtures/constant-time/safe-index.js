// Fixture: the clean counterpart of vulnerable-index.js. `publicIndex`
// matches no taint source (naming convention or annotation), so the same
// shape of code (array subscript from a parameter) must NOT be flagged —
// proves the detector isn't just flagging "any index expression."
function readFromTable(table, publicIndex) {
  return table[publicIndex];
}

module.exports = { readFromTable };
