import { describe, expect, it } from 'vitest';
import { safeLocalMediaUrl } from '@/lib/safe-media-url';

describe('safeLocalMediaUrl', () => {
  it('allows blob: object URLs (the poster-from-file path)', () => {
    const u = 'blob:http://localhost:3000/6f9619ff-8b86-4a1e-b54d-3f6a1c9d2e4f';
    expect(safeLocalMediaUrl(u)).toBe(u);
  });

  it('allows png, jpeg and webp base64 data URLs (the poster-from-drawing path)', () => {
    for (const mime of ['png', 'jpeg', 'webp']) {
      const u = `data:image/${mime};base64,iVBORw0KGgoAAAANSUhEUg==`;
      expect(safeLocalMediaUrl(u)).toBe(u);
    }
  });

  it('rejects scriptable URLs', () => {
    expect(safeLocalMediaUrl('javascript:alert(1)')).toBe('');
    expect(safeLocalMediaUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe('');
    expect(safeLocalMediaUrl('vbscript:msgbox(1)')).toBe('');
  });

  it('rejects remote URLs — posters are local by construction', () => {
    expect(safeLocalMediaUrl('https://example.com/poster.png')).toBe('');
    expect(safeLocalMediaUrl('http://example.com/poster.png')).toBe('');
    expect(safeLocalMediaUrl('//example.com/poster.png')).toBe('');
  });

  it('rejects image types outside the poster set, and garbage', () => {
    expect(safeLocalMediaUrl('data:image/gif;base64,R0lGODlhAQABAAAAACw=')).toBe('');
    expect(safeLocalMediaUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')).toBe('');
    expect(safeLocalMediaUrl('not a url')).toBe('');
    expect(safeLocalMediaUrl('')).toBe('');
  });
});
