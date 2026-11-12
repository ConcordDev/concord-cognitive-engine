/**
 * raw-strings-genus.test.ts — CB-0473 guard (B6).
 *
 * Users get words, not machine strings. Each pin holds one surface to
 * translating its server tokens / object shapes before rendering.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0473 raw-internal-strings genus', () => {
  it('FIX-009: genome velocity renders the server object shape with its real unit', () => {
    const src = read('components/education/EducationEnginePanels.tsx');
    expect(src).toContain('velocityLabel');
    expect(src).toContain('perMinute');
    expect(src).not.toContain('${summary.velocity}/wk');
  });

  it('FIX-foundry-009: foundry failures translate through one reason-words map', () => {
    const map = read('components/foundry/reasonWords.ts');
    expect(map).toContain("no_systems: 'Add at least one system first.'");
    expect(read('components/foundry/BuilderStudio.tsx')).toContain('foundryReasonWords');
    expect(read('components/foundry/FoundryCanvas.tsx')).toContain('foundryReasonWords(r.reason)');
    expect(read('components/foundry/FoundryPreview.tsx')).toContain('foundryReasonWords(r.reason)');
  });

  it('FIX-kingdoms-003: every tab error funnels through the translator; the Found name is capped', () => {
    const src = read('components/kingdoms/DynastyRealmManager.tsx');
    expect(src).toContain('kingdomErrorWords(text)');
    const panel = read('components/kingdoms/KingdomCreatePanel.tsx');
    expect(panel).toContain('kingdomErrorWords');
    expect(panel).toContain('maxLength={200}');
  });

  it('FIX-agents-015: the fork panel words cover dtu_not_found', () => {
    const src = read('components/agents/ForkPreviewPanel.tsx');
    expect(src).toContain("dtu_not_found: 'One or more of those DTU ids do not exist");
  });
});
