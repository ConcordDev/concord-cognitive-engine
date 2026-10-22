import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

describe('committed capture worklet', () => {
  it('matches the TypeScript source and does not call eval', () => {
    execFileSync('node', ['scripts/build-worklets.mjs', '--check'], { cwd: process.cwd(), stdio: 'pipe' });
    const js = fs.readFileSync(path.join(process.cwd(), 'public/worklets/capture-tap.js'), 'utf8');
    expect(js).toContain("registerProcessor('concord-capture-tap'");
    expect(js).not.toMatch(/\beval\s*\(/);
    expect(js).not.toMatch(/new Function\s*\(/);
  });
});
