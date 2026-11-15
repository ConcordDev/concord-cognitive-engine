/**
 * Classroom form-field id/name coverage (FIX-classroom-008, leg b).
 *
 * The walk's console report counted 19 form fields missing id/name on
 * /lenses/classroom. Fields without an id/name are invisible to
 * autofill, password managers, form tooling and several assistive
 * technologies. These pins scan the classroom surface's sources
 * (the lens page + the two mounted classroom components) with a
 * brace/quote-aware tag scanner and require EVERY input/select/
 * textarea — including the quiz builder's per-question rows and the
 * quiz-taking radios — to carry both an id and a name. (The ticket's
 * other legs — CSP/eval, background 500/502 + /api/lens/run 400s, WS
 * failures — are deployed-environment observations dispositioned in
 * the slice record; this file pins the branch-state leg.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Brace/quote-aware tag scanner: yields attribute strings of form tags. */
function* formTags(src: string): Generator<string> {
  const re = /<(input|select|textarea)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + 1 + m[1].length, depth = 0, quote: string | null = null;
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
      i++;
    }
    yield src.slice(start, i);
    re.lastIndex = i;
  }
}

const SURFACE = [
  'app/lenses/classroom/page.tsx',
  'components/classroom/ClassroomWorkspace.tsx',
  'components/classroom/OpenLibrarySearch.tsx',
];

describe('classroom field id/name coverage (FIX-classroom-008)', () => {
  for (const rel of SURFACE) {
    it(`${rel}: every form field carries an id and a name`, () => {
      const tags = [...formTags(read(rel))];
      expect(tags.length).toBeGreaterThan(0);
      for (const attrs of tags) {
        expect(attrs, `field missing id: <…${attrs.slice(0, 80)}>`).toMatch(/\bid\s*=/);
        expect(attrs, `field missing name: <…${attrs.slice(0, 80)}>`).toMatch(/\bname\s*=/);
      }
    });
  }

  it('the known walk-era fields are named (announce, assignment, quiz builder)', () => {
    const ws = read('components/classroom/ClassroomWorkspace.tsx');
    for (const id of ['classroom-announce-text', 'classroom-assignment-title', 'classroom-assignment-due',
      'classroom-submission-content', 'classroom-grade-score', 'classroom-material-kind',
      'classroom-viewas-student', 'classroom-quiz-title']) {
      expect(ws).toContain(`id="${id}"`);
    }
    expect(ws).toContain('id={`classroom-quiz-q${i}-prompt`}');
    expect(ws).toContain('id={`classroom-quiz-q${i}-option-${oi}`}');
  });
});
