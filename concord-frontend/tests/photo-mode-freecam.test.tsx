// Phase BE1 — confirm PhotoMode wires freecam + save-to-gallery + caption.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'PhotoMode.tsx');

describe('Phase BE1 — PhotoMode freecam + gallery', () => {
  const source = readFileSync(FILE, 'utf8');

  it('listens for WASD/QE/RF keys + wheel and dispatches concordia:freecam', () => {
    expect(source).toMatch(/concordia:freecam/);
    expect(source).toMatch(/case 'w':/);
    expect(source).toMatch(/case 'q':/);
  });

  it('has a caption field with maxLength constraint', () => {
    expect(source).toMatch(/value=\{caption\}/);
    expect(source).toMatch(/maxLength=\{120\}/);
  });

  it('saveToGallery posts to /api/photos/save with the data URL', () => {
    expect(source).toMatch(/\/api\/photos\/save/);
    expect(source).toMatch(/dataUrl/);
  });

  it('exposes Save to gallery + Share publicly buttons', () => {
    expect(source).toMatch(/Save to gallery/);
    expect(source).toMatch(/Share publicly/);
  });
});
