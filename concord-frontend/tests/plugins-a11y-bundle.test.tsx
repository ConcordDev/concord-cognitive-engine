/**
 * FIX-plugins-003 — the Plugins lens's Lighthouse a11y bundle:
 * contrast + touch targets (no selects exist in this tree; expected
 * a11y >= 95).
 *
 * Contrast: slate-500 microcopy (badge labels, gallery status text,
 * card metadata, consent notes) raised to slate-400. Targets: the
 * consent dialog's p-1 close button, the gallery Install button and
 * the ~18px rating buttons meet the min-h-11 floor. Headings: card
 * titles are the first headings under the frame h1, so they are h2;
 * the consent dialog's own h2/h3 structure stands.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { PluginInstallConsent } from '@/components/plugins/PluginInstallConsent';
import type { GalleryPlugin } from '@/components/plugins/types';

const PLUGIN: GalleryPlugin = {
  pluginId: 'gallery.example-plugin',
  authorId: 'author-1',
  name: 'Example Plugin',
  description: 'Does something useful with DTUs.',
  version: '1.2.0',
  signature: 'sig-abc',
  hash: 'hash-abc',
  trusted: true,
  declaredMacros: ['dtu.read'],
  publishedAt: '2026-07-20T00:00:00.000Z',
  installs: 4,
  rating: { up: 3, down: 1 },
  loadedPluginId: null,
  delistedAt: null,
  delistedReason: null,
  delistedBy: null,
  declaredCapabilities: ['dtu.read'],
  trustDescription: 'Self-attested.',
  loaded: false,
};

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-plugins-003 — plugins a11y bundle', () => {
  it('consent dialog: h2 title, close button floored and raised', () => {
    render(<PluginInstallConsent plugin={PLUGIN} onCancel={vi.fn()} onInstalled={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 2 })).toBeTruthy();
    const close = screen.getByLabelText('Cancel install');
    expect(close.className).toContain('min-h-11');
    expect(close.className).toContain('text-slate-400');
  });

  it('no slate-500 text remains; gallery card titles are h2; small buttons floored', () => {
    for (const f of ['AuthorBadge.tsx', 'PluginGalleryList.tsx', 'PluginInstallConsent.tsx']) {
      const src = read(`components/plugins/${f}`);
      expect(src.includes('text-slate-500'), `${f}: slate-500 remains`).toBe(false);
    }
    const list = read('components/plugins/PluginGalleryList.tsx');
    expect(list).toContain('<h2 className="truncate text-[13px] font-semibold text-slate-100">');
    expect(list).toContain('min-h-11 items-center gap-0.5 rounded px-2 py-0.5');
    expect(list).toContain('inline-flex min-h-11 items-center rounded-md bg-cyan-600');
  });
});
