import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

describe('committed worklet bundles', () => {
  it('matches the TypeScript sources and does not call eval', () => {
    execFileSync('node', ['scripts/build-worklets.mjs', '--check'], { cwd: process.cwd(), stdio: 'pipe' });
    const capture = fs.readFileSync(path.join(process.cwd(), 'public/worklets/capture-tap.js'), 'utf8');
    const pitch = fs.readFileSync(path.join(process.cwd(), 'public/worklets/pitch-tap.js'), 'utf8');
    expect(capture).toContain("registerProcessor('concord-capture-tap'");
    expect(pitch).toContain("registerProcessor('concord-pitch-correct'");
    expect(pitch).not.toMatch(/\bimport\s+/);
    for (const js of [capture, pitch]) {
      expect(js).not.toMatch(/\beval\s*\(/);
      expect(js).not.toMatch(/new Function\s*\(/);
    }
  });
});
