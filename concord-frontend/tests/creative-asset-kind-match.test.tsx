/**
 * FIX-creative-010 — an image could be saved as a Video review asset
 * (upload detects the real kind, but the type select could be
 * flipped afterwards, and pasted URLs were never checked), leaving
 * the player spinning on an unplayable asset. Create now refuses a
 * kind that contradicts the uploaded file's detected kind or the
 * pasted URL's extension, in words.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-creative-010 — asset kind must match the media', () => {
  const s = read('components/creative/ProductionSuite.tsx');

  it('uploaded files pin their detected kind', () => {
    expect(s).toContain('setUploadedKind(detectedKind)');
    expect(s).toContain('uploadedKind !== kind');
    expect(s).toContain('Switch the type to match the file.');
  });

  it('pasted URLs are checked by extension both ways', () => {
    expect(s).toContain('That URL points at an image, but the asset type is Video.');
    expect(s).toContain('That URL points at a video, but the asset type is Image.');
  });
});
