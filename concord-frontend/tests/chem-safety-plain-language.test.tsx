/**
 * FIX-chem-005 — the bleach + ammonia warning was correct but pure
 * jargon ('segregate immediately', 'chloramine') for a young
 * audience. A high-severity interaction result now leads with a
 * plain-language alert before the technical detail.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-chem-005 — plain-language safety warning', () => {
  const s = read('components/chem/ChemSafetyPanel.tsx');

  it('high severity shows the plain-words alert', () => {
    expect(s).toContain("interResult.severity === 'high'");
    expect(s).toContain('Never mix these. It can make a poison gas. Leave the area and tell an adult.');
  });
});
