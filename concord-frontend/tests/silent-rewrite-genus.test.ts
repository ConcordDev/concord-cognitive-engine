/**
 * Silent-rewrite genus guard (CB-0477) — FIX-code-003, FIX-music-005,
 * FIX-forge-005, FIX-geology-009, FIX-welding-006, FIX-consulting-003,
 * FIX-game-005.
 *
 * Each surface used to rewrite the user's input in silence: a blank
 * rename reverted, a tempo outside its own declared range reverted, a
 * sanitised table name landed under a different name, a '-' keystroke
 * vanished into 0, negative calculator inputs blanked, junk engagement
 * amounts sailed through to a server clamp, NaN unit stats passed.
 * The pins hold the words each surface now says instead.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('code-003: a blank rename is cancelled in words, not in silence', () => {
  const src = read('components/code/FileExplorer.tsx');
  it('blank commit names the cancellation and keeps the name', () => {
    expect(src).toContain('The rename was cancelled — a file name cannot be empty.');
    expect(src).toContain('setRenameError');
  });
});

describe('music-005: tempo commits inside its declared range, reverting in words', () => {
  const src = read('components/music/SessionView.tsx');
  it('out-of-range tempo names the 20–400 bound', () => {
    expect(src).toContain('Tempo must be 20–400 BPM.');
    expect(src).toContain('v >= 20 && v <= 400');
    expect(src).toContain('onBlur={commitTempo}');
  });
});

describe('forge-005: a sanitised table name is announced with its stored form', () => {
  const src = read('components/forge/ForgeWorkbench.tsx');
  it('the note names both the rule and the stored name', () => {
    expect(src).toContain('Table names use lowercase letters, numbers and underscores — added as');
    expect(src).toContain('name !== raw');
  });
});

describe('geology-009: specific gravity keeps the typed text and names its range', () => {
  const src = read('components/geology/RockMineralIdPanel.tsx');
  it('the field is text-driven and invalid values are not sent', () => {
    expect(src).toContain('sgText');
    expect(src).toContain('Specific gravity must be between 0 and 25');
    expect(src).not.toContain('specificGravity: Number(e.target.value) || 0');
  });
});

describe('welding-006: negative calculator inputs stay visible and are named', () => {
  const src = read('components/welding/WelderProcedures.tsx');
  it('no change handler clamps at 0 any more', () => {
    expect(src).not.toContain('Math.max(0, Number(e.target.value)');
    expect(src).toContain("Negative values can't be used — enter 0 or more.");
  });
});

describe('consulting-003: engagement amounts are refused at the form in words', () => {
  const src = read('components/consulting/EngagementTracker.tsx');
  it('junk and negative amounts name the field before anything is sent', () => {
    expect(src).toContain('must be a number.');
    expect(src).toContain("can't be negative.");
    expect(src).toContain('setFormError');
  });
});

describe('game-005: unusable unit stats are named and hold the balance check', () => {
  const src = read('components/game/GameDesignLab.tsx');
  it('the validity line names the row and field; the name is capped', () => {
    expect(src).toContain('must be a number of 0 or more.');
    expect(src).toContain('!!unitIssue');
    expect(src).toContain('maxLength={200}');
  });
});
