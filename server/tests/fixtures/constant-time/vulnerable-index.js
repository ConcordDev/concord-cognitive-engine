// Fixture: secret-dependent memory index. `secretIndex` is tainted by
// naming convention and is used directly as the array subscript — a
// secret-dependent memory address, the classic cache-timing precondition
// (think: an S-box lookup keyed directly by a secret nibble). MUST be
// flagged (secret_dependent_index).
// @secret
function readFromTable(table, secretIndex) {
  return table[secretIndex];
}

module.exports = { readFromTable };
