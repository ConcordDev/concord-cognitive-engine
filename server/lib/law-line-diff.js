// server/lib/law-line-diff.js
//
// The line-level diff behind law.contract-diff: classic LCS over arrays of lines. Pure and import-free on purpose
// (no server dependencies), so domains/law.js and the frontend's tracked-changes test share one real engine.

export function lineDiff(oldText, newText) {
  const a = String(oldText || "").split("\n");
  const b = String(newText || "").split("\n");
  const m = a.length, n = b.length;
  const lcs = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ op: "same", text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ op: "remove", text: a[i] }); i++; }
    else { ops.push({ op: "add", text: b[j] }); j++; }
  }
  while (i < m) { ops.push({ op: "remove", text: a[i] }); i++; }
  while (j < n) { ops.push({ op: "add", text: b[j] }); j++; }
  return ops;
}
