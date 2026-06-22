// Follow-up: ProgressionPanel (was the deferred fake-data panel) now fetches the
// real progression.creator_summary macro and renders an EMPTY default until the
// macro returns — no fabricated demo data is ever shown as the baseline.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('ProgressionPanel — real creator progression', () => {
  const src = read('components/world-lens/ProgressionPanel.tsx');
  it('fetches the real progression macro', () => {
    expect(src).toMatch(/lensRun<[^>]*>\(\s*'progression', 'creator_summary'/);
  });
  it('renders an empty default, not fabricated demo data', () => {
    expect(src).toMatch(/useState<ProfileProgression>\(profileProp \?\? EMPTY_PROFILE\)/);
    expect(src).toMatch(/if \(profileProp\) return;/);
  });
});
