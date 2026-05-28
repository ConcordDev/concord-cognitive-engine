// Phase CA4 — confirm narrative-walk lens reads cinematic catalog.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'app', 'lenses', 'narrative-walk', 'page.tsx');

describe('Phase CA4 — Narrative walk lens', () => {
  const source = readFileSync(FILE, 'utf8');

  it('imports the cinematic-director + sequences-registry', () => {
    expect(source).toMatch(/cinematic-director/);
    expect(source).toMatch(/cinematic-sequences-registry/);
  });

  it('calls ensureCinematicsRegistered + listSequences', () => {
    expect(source).toMatch(/ensureCinematicsRegistered/);
    expect(source).toMatch(/listSequences/);
  });

  it('plays a sequence on click via director.playSequence', () => {
    expect(source).toMatch(/playSequence/);
  });

  it('persists watched set to localStorage', () => {
    expect(source).toMatch(/localStorage/);
    expect(source).toMatch(/concordia:narrative-walk:watched/);
  });
});
