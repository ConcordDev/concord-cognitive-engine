// FIX-animation-002 — Create with an empty title silently produced an
// 'Untitled animation', and Bone with an empty name silently became
// 'Bone N' on the server. Both names are now required, with the
// requirement stated at the form; server refusals on the bone add
// surface instead of vanishing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const section = read('components/animation/AnimationStudioSection.tsx');
const tools = read('components/animation/AnimToolsPanel.tsx');

describe('FIX-animation-002 — names are required and speak', () => {
  it('create refuses a blank title with a message, no silent Untitled', () => {
    expect(section).toContain("if (!form.title.trim()) { setError('Give the animation a title.'); return; }");
    expect(section).not.toContain("title: form.title.trim() || 'Untitled animation'");
  });
  it('bone add refuses a blank name and surfaces server refusals', () => {
    expect(tools).toContain("if (!name.trim()) { setBoneError('Give the bone a name.'); return; }");
    expect(tools).toContain("setBoneError(r.data?.error || 'Could not add the bone.')");
    expect(tools).toContain('role="alert"');
  });
});
