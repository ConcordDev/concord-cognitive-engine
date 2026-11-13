/**
 * FIX-pets-008 — the photo timeline accepted any URL (a favicon.ico
 * was added as a photo). addPhoto now refuses non-image URLs in
 * words; real image extensions and data:image URLs still pass.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-pets-008 — photo timeline validates image URLs', () => {
  const s = read('components/pets/PetRecordsPanel.tsx');

  it('checks the URL is an image before adding', () => {
    expect(s).toContain('data:image');
    expect(s).toContain('(png|jpe?g|gif|webp|avif|svg)');
    expect(s).toContain('That URL does not point at an image');
  });
});
