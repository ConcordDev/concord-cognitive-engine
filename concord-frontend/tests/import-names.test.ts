// FIX-import-006 — the import surface's drop areas and file controls
// must carry accessible names a screen reader can announce: the drop
// zone relied on whatever text happened to be inside it, the per-file
// remove button announced itself as "Close", and the hidden file
// inputs behind the Browse / substrate / restore labels had no name of
// their own. These pins hold the explicit names in place.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const universal = read('components/import/UniversalImport.tsx');
const desk = read('components/import/ImportDeskPanel.tsx');
const restore = read('components/import/RestoreDtuExport.tsx');

describe('FIX-import-006 — import drop areas and file controls are named', () => {
  it('the universal drop zone announces what it does', () => {
    expect(universal).toContain('aria-label="Drop files to import, or activate to browse for files"');
    expect(universal).toContain('aria-label="Choose files to import"');
  });

  it('the per-file remove button names the file it removes', () => {
    expect(universal).toContain('aria-label={`Remove ${f.file.name}`}');
    expect(universal).not.toContain('aria-label="Close"');
  });

  it('the desk drop region and its file inputs are named', () => {
    expect(desk).toContain('aria-label="Structured data import: drop backup or data files here, or browse to choose one"');
    expect(desk).toContain('aria-label="Choose a backup or data file"');
    expect(desk).toContain('aria-label="Choose a substrate archive to import"');
  });

  it('the restore file input is named', () => {
    expect(restore).toContain('aria-label="Choose a DTU export file to restore"');
  });
});

describe('FIX-import-005 map-fields blank guard', () => {
  it('refuses a blank Map-to-fields run with the requirement stated', () => {
    expect(desk).toContain("Enter at least one target field to map to (comma-separated).");
    expect(desk).toContain("action === 'mapFields' && targetFieldsInput");
  });
  it('surfaces the guard error in the mapFields result area', () => {
    expect(desk).toContain('if (d.error)');
  });
});
