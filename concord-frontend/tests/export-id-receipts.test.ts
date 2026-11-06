// A9 PR 1 — receipts + inspected success: source pins over the shared
// components (full ID on save receipts; the export blob inspected
// before the checkmark; Creative's receipts carrying the full ID).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');
const saveBtn = read('components/dtu/SaveAsDtuButton.tsx');
const exportBtn = read('components/lens/DTUExportButton.tsx');
const creativePanel = read('components/creative/CreativeActionPanel.tsx');
const dtuId = read('components/dtu/DtuId.tsx');

describe('A9 — full-ID receipts', () => {
  it('the shared receipt form renders the full id, copyable', () => {
    assert.match(dtuId, /export function DtuId/);
    assert.match(dtuId, /navigator\.clipboard\.writeText\(id\)/);
    assert.match(dtuId, /\{id\}/);
    assert.doesNotMatch(dtuId, /slice\(0/);
  });

  it('SaveAsDtuButton’s success state renders the full id', () => {
    assert.match(saveBtn, /Saved as DTU <DtuId id=\{savedId\} \/>/);
  });

  it('Creative’s mint/publish receipts carry the full id, never the ellipsis form', () => {
    assert.doesNotMatch(creativePanel, /slice\(0, 8\)/);
    assert.match(creativePanel, /Pkg DTU \$\{id\}/);
    assert.match(creativePanel, /desc: mintedDtuId \? mintedDtuId/);
  });
});

describe('A9 — the inspected export', () => {
  it('DTUExportButton refuses an empty or JSON-typed body before any download', () => {
    assert.match(exportBtn, /received\.size === 0/);
    assert.match(exportBtn, /\/json\/i\.test\(received\.type/);
    const checkAt = exportBtn.indexOf('received.size === 0');
    const downloadAt = exportBtn.indexOf('Trigger browser download');
    assert.ok(checkAt > 0 && downloadAt > checkAt, 'the inspection precedes the download');
  });
});
