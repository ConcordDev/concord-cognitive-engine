/**
 * F1-Python wiring (R3 re-review of PR #1707, code.md §9 addendum).
 *
 * The vendored Pyodide runtime shipped, the local runner routed Python
 * correctly — and no member surface could ever produce a tab whose
 * language was 'python': every creation/open default in the chain was
 * 'javascript', there was no language selector, and nothing inferred a
 * language from a filename. A file named .py therefore ran AS JAVASCRIPT
 * and wore a JS error under a process stamp.
 *
 * These tests pin the fix at its decision point (the resolver in
 * localExec.ts) and at the wiring (the panel's open/save sites, the
 * toolbar selector, and a Run control in the shared editor header —
 * the Project workspace's title bar hides with the Scratch container,
 * which is why it had no Run control at all).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { languageForFilename, resolveTabLanguage, RUNNABLE_LANGUAGE_OPTIONS } from '@/components/code/localExec';

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(resolve(here, '../components/code/CodeEditorWorkspacePanel.tsx'), 'utf8');

describe('languageForFilename', () => {
  it('maps the runnable extensions', () => {
    expect(languageForFilename('helper.py')).toBe('python');
    expect(languageForFilename('main.js')).toBe('javascript');
    expect(languageForFilename('mod.mjs')).toBe('javascript');
    expect(languageForFilename('app.ts')).toBe('typescript');
    expect(languageForFilename('view.tsx')).toBe('typescript');
    expect(languageForFilename('UPPER.PY')).toBe('python');
  });
  it('returns null for unmapped or missing extensions', () => {
    expect(languageForFilename('notes.md')).toBeNull();
    expect(languageForFilename('untitled')).toBeNull();
    expect(languageForFilename('')).toBeNull();
    expect(languageForFilename(null)).toBeNull();
  });
});

describe('resolveTabLanguage — the provenance rules', () => {
  it("a .py file with the chain's default stored language opens as Python (the R3 case)", () => {
    expect(resolveTabLanguage('helper.py', 'javascript')).toBe('python');
    expect(resolveTabLanguage('helper.py', undefined)).toBe('python');
    expect(resolveTabLanguage('helper.py', 'plaintext')).toBe('python');
    expect(resolveTabLanguage('app.ts', 'javascript')).toBe('typescript');
  });
  it('a stored non-default language is never overridden by inference', () => {
    expect(resolveTabLanguage('main.js', 'python')).toBe('python');
    expect(resolveTabLanguage('helper.py', 'wat')).toBe('wat');
  });
  it("the member's explicit choice always wins", () => {
    expect(resolveTabLanguage('helper.py', 'javascript', true)).toBe('javascript');
    expect(resolveTabLanguage('main.js', 'python', true)).toBe('python');
  });
  it('unmapped names keep the stored/default language', () => {
    expect(resolveTabLanguage('notes.md', undefined)).toBe('javascript');
    expect(resolveTabLanguage('notes.md', 'plaintext')).toBe('plaintext');
    expect(resolveTabLanguage('main.js', 'javascript')).toBe('javascript');
  });
});

describe('the advertised set is exactly the runnable set', () => {
  it('the selector options are JavaScript, TypeScript, Python', () => {
    expect(RUNNABLE_LANGUAGE_OPTIONS.map((o) => o.id)).toEqual(['javascript', 'typescript', 'python']);
  });
});

describe('panel wiring (source assertions)', () => {
  it('both tab-open sites resolve the language instead of defaulting it', () => {
    const sites = panel.match(/language: resolveTabLanguage\(/g) ?? [];
    expect(sites.length).toBeGreaterThanOrEqual(2);
    expect(panel).not.toContain("language: data?.language || 'javascript'");
    expect(panel).not.toContain("language: file.language || 'javascript'");
  });
  it('the save path persists the language and the chosen flag together', () => {
    expect(panel).toContain('language: tab.language, languageChosen: tab.languageChosen === true');
  });
  it('the toolbar selector offers the runnable options and writes through the chosen setter', () => {
    expect(panel).toContain('RUNNABLE_LANGUAGE_OPTIONS.map');
    expect(panel).toContain('onChange={(e) => setActiveTabLanguage(e.target.value)}');
    expect(panel).toContain('languageChosen: true');
  });
  it('the shared editor header carries a Run control on the real mutation', () => {
    // A second runScriptMutation.mutate() call site in a button (the first
    // is the Scratch title bar's Run) — the editor header's, visible in
    // both workspaces.
    const runButtons = panel.match(/onClick=\{\(\) => \{ if \(localRun \|\| \(!execOff && !execUnknown\)\) runScriptMutation\.mutate\(\); \}\}/g) ?? [];
    expect(runButtons.length).toBe(2);
  });
});
