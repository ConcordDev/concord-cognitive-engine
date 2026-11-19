/**
 * The change being proved, as editor gutter marks. Pure: takes the hunks the
 * server's `code.proof-diff` returns for one file (base → saved content) and
 * says which lines of the saved file were added, and above which line
 * something was removed. Nothing here guesses; no hunks, no marks.
 */

import type { DiffHunk } from './proofApi';

export interface GutterMarks { added: number[]; removedAbove: number[] }

export function gutterMarks(hunks: DiffHunk[], lineCount: number): GutterMarks {
  const added: number[] = [];
  const removedAbove: number[] = [];
  let pendingDel = false;
  let lastNew = 0;
  for (const h of hunks) {
    if (h.type === 'del') { pendingDel = true; continue; }
    const n = h.newLine;
    if (typeof n !== 'number') continue;
    if (pendingDel) { removedAbove.push(n); pendingDel = false; }
    if (h.type === 'add') added.push(n);
    lastNew = n;
  }
  // A removal at the very end sits under the last line.
  if (pendingDel && lineCount > 0) removedAbove.push(Math.min(Math.max(lastNew, 1), lineCount));
  return { added: [...new Set(added)].filter((l) => l <= lineCount), removedAbove: [...new Set(removedAbove)].filter((l) => l <= lineCount) };
}
