/**
 * CB-0450 guard: the export/import genus fixes.
 * Pins the four frontend-reachable fixes from the section; the section's
 * server-scope rows (lattice-003, forecast-002, global-012, import-002)
 * stay OPEN for the desk and are deliberately not pinned here.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('export/import genus (CB-0450)', () => {
  it('move-builder mounts the standard export menu for its domain', () => {
    const src = read('app/lenses/move-builder/page.tsx');
    expect(src).toContain('import { ExportMenu } from \'@/components/common/ExportMenu\'');
    expect(src).toContain('actions={<ExportMenu domain="move-builder" />}');
  });

  it('export schedule create refuses a blank name instead of auto-naming it', () => {
    const src = read('components/export/ExportToolkit.tsx');
    expect(src).not.toContain('name || `${frequency} export`');
    expect(src).toContain('if (!name.trim()) { setNameError(true); return; }');
    expect(src).toContain('Give the schedule a name first');
  });

  it('restore routes concord-custom-lens/v1 definitions to custom.importCanvas', () => {
    const src = read('components/import/RestoreDtuExport.tsx');
    expect(src).toContain("parsed.definition.spec === 'concord-custom-lens/v1'");
    expect(src).toContain("lensRun('custom', 'importCanvas', { definition })");
    // the DTU batch path is untouched
    expect(src).toContain("lensRun<JsonImportResult>('import', 'json', { dtus: parsed.dtus, overwrite })");
  });

  it('import desk warns before re-importing a completed file', () => {
    const src = read('components/import/ImportDeskPanel.tsx');
    expect(src).toContain('j.records_total === validationResult.record_count');
    expect(src).toContain('was already imported');
    expect(src).toContain("'Import anyway'");
  });
});
