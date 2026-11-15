/**
 * Ingest pipeline status stages (FIX-ingest-003, counters leg).
 * The status strip showed a 'Queued' stage hardcoded to 0 — but ingest
 * is synchronous (a single mutation; no queue exists), so that counter
 * could never move and the strip misdescribed the pipeline. The strip
 * now shows only the real stages, and Processing still reflects the
 * in-flight mutation.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/ingest/WorkbenchPanel.tsx'), 'utf8');

describe('ingest pipeline stages (FIX-ingest-003)', () => {
  it('has no hardcoded Queued stage', () => {
    expect(src).not.toContain("stage: 'Queued'");
  });

  it('Processing still binds the mutation pending state', () => {
    expect(src).toContain("stage: 'Processing', count: ingestText.isPending ? 1 : 0");
  });
});
