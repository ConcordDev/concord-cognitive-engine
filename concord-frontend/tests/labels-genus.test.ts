/**
 * labels-genus.test.ts — CB-0458 guard (B6).
 *
 * Pins:
 *  - FIX-creative-008: bench action descriptions are human text, not raw
 *    macro keys.
 *  - FIX-fitness-012: empty states name the tab's contents in human words,
 *    never the lowercased tab id ('hrzones', 'aiplan', 'finish').
 *  - FIX-dreams-008: the personal scope option says what the set is
 *    ('Mine — unpublished'), not 'Personal'.
 *  - FIX-healthcare-012 (label leg): the codes tab is labelled for the
 *    ICD-10 search the surface actually offers.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0458 labels-that-lie genus', () => {
  it('FIX-creative-008: no raw macro keys as action descriptions', () => {
    const src = read('components/creative/CreativeActionPanel.tsx');
    expect(src).toContain("desc: 'Generate the shot list'");
    expect(src).not.toContain("desc: 'shotListGenerate'");
    expect(src).not.toContain("desc: 'assetOrganize'");
    expect(src).not.toContain("desc: 'budgetTrack'");
    expect(src).not.toContain("desc: 'distributionChecklist'");
  });

  it('FIX-fitness-012: empty states use human tab labels in both fitness files', () => {
    for (const rel of ['components/fitness/FitnessApp.tsx', 'components/fitness/FitnessCoachWorkspace.tsx']) {
      const src = read(rel);
      expect(src).toContain("'HR zones'");
      expect(src).toContain("'AI plans'");
      expect(src).not.toContain('No {activeTab.toLowerCase()} found');
    }
    expect(read('components/fitness/FitnessApp.tsx')).toContain("'finished workouts'");
  });

  it('FIX-dreams-008: scope option names the set honestly', () => {
    const src = read('components/dreams/DreamLibrary.tsx');
    expect(src).toContain('<option value="personal">Mine — unpublished</option>');
    expect(src).not.toContain('<option value="personal">Personal</option>');
  });

  it('FIX-healthcare-012: codes tab labelled ICD-10 (the search that exists)', () => {
    const src = read('components/healthcare/EpicShell.tsx');
    expect(src).toContain("label: 'ICD-10',");
    expect(src).not.toContain("label: 'ICD-10 / CPT'");
  });
});
