import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const root = resolve(__dirname, '../..');

function read(rel: string): Buffer {
  return readFileSync(resolve(root, rel));
}

describe('PWA manifest', () => {
  const manifest = JSON.parse(read('app/manifest.json').toString('utf8'));

  it('names Concord and describes the create-and-build platform', () => {
    expect(manifest.name).toBe('Concord');
    expect(manifest.short_name).toBe('Concord');
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.orientation).toBeUndefined();
    expect(manifest.description).toBe(
      'A platform to create and build: music Studio, engineering, art, and games.'
    );
  });

  it('ships PNG icons, including a maskable one, and no SVG-only icons', () => {
    expect(manifest.icons).toEqual([
      expect.objectContaining({
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      }),
      expect.objectContaining({
        src: '/icons/icon-512x512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      }),
    ]);
    expect(manifest.icons.some((icon: { type?: string }) => icon.type === 'image/svg+xml')).toBe(
      false
    );
  });

  it('has real PNG files at the manifest sizes plus a 180 apple touch icon', async () => {
    const expected: Array<[string, number]> = [
      ['public/icons/icon-192x192.png', 192],
      ['public/icons/icon-512x512.png', 512],
      ['public/icons/icon-512x512-maskable.png', 512],
      ['public/apple-touch-icon.png', 180],
    ];
    for (const [rel, size] of expected) {
      const buf = read(rel);
      expect(buf.subarray(0, 8).toString('utf8')).not.toContain('git-lfs');
      expect(buf[0]).toBe(0x89);
      const meta = await sharp(buf).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(size);
      expect(meta.height).toBe(size);
    }
  });

  it('links the apple touch icon from the root layout metadata', () => {
    const layout = read('app/layout.tsx').toString('utf8');
    expect(layout).toContain("url: '/apple-touch-icon.png'");
    expect(layout).toContain("sizes: '180x180'");
    expect(layout).toContain("type: 'image/png'");
  });
});
