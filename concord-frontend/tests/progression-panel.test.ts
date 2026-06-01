// Follow-up: ProgressionPanel (was the deferred fake-data panel) now fetches the
// real progression.creator_summary macro; DEMO_* is fallback-only.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('ProgressionPanel — real creator progression', () => {
  const src = read('components/world-lens/ProgressionPanel.tsx');
  it('fetches the real progression macro', () => {
    expect(src).toMatch(/domain: 'progression', name: 'creator_summary'/);
  });
  it('keeps DEMO_* only as a fallback (not the rendered default)', () => {
    expect(src).toMatch(/useState<ProfileProgression>\(profileProp \?\? DEMO_PROFILE\)/);
    expect(src).toMatch(/if \(profileProp\) return;/);
  });
});
