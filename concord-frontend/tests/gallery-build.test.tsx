/**
 * Gallery fix return (B2) — F6 source pins: Take down is a two-step
 * confirmation in the family form (Creative F9's pattern), never a
 * one-click removal. The remove call fires only from the confirm.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = readFileSync(
  join(process.cwd(), 'app/lenses/gallery/page.tsx'),
  'utf8',
);

describe('gallery F6 — two-step take down', () => {
  it('the arm state is per-work', () => {
    expect(page).toContain('confirmTakeDownId');
    expect(page).toContain('setConfirmTakeDownId(work.id)');
  });

  it('the first click arms; only the confirm calls the remove path', () => {
    expect(page).toContain('Confirm take down');
    // The bare label arms the confirm; it does not call takeDown.
    const armButton = page.slice(page.indexOf('Take down'));
    expect(armButton.slice(0, 200)).not.toContain('takeDown(work.id)');
    // takeDown is invoked from the confirm button only.
    const confirmIdx = page.indexOf('Confirm take down');
    const before = page.slice(Math.max(0, confirmIdx - 300), confirmIdx);
    expect(before).toContain('takeDown(work.id)');
  });

  it('Cancel disarms without removing', () => {
    expect(page).toContain('setConfirmTakeDownId(null)');
    expect(page).toContain('Cancel');
  });

  it('a completed take-down clears the arm state', () => {
    const takeDownBody = page.slice(page.indexOf('const takeDown'));
    expect(takeDownBody.slice(0, 900)).toContain('setConfirmTakeDownId(null)');
  });
});
