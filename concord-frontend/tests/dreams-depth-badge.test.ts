// Pins the Dreams disposition slice (S-DRM-1..5, Lead disposition
// 2026-11-01 on the PROBE-STATIC determination): the lens declares its
// engine-corpus tier (the gate record's F1 absence), the surface frames
// the corpus as the engine's (not "your dreams"), the withdrawn
// interpretation claim is scoped to what the template computes, the
// marketplace listing control is gone (provenance ruling), and the tag
// layer is labelled as the reader's own annotation.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('dreams');
const page = readFileSync(join(__dirname, '../app/lenses/dreams/page.tsx'), 'utf8');
const reader = readFileSync(join(__dirname, '../components/dreams/DreamReader.tsx'), 'utf8');
const library = readFileSync(join(__dirname, '../components/dreams/DreamLibrary.tsx'), 'utf8');

describe('Dreams declaration (S-DRM-1)', () => {
  it('declares a real tier — the F1 absence is closed', () => {
    expect(m?.dataTier).toBe('REAL_FREE');
  });

  it('the badge states the engine character (PROBE-STATIC, scoped)', () => {
    const badge = renderHook(() => useDepthBadge('dreams')).result.current;
    expect(badge?.label).toBe('Engine corpus');
    expect(badge?.caption).toMatch(/dream engine/);
    expect(badge?.caption).toMatch(/not by you/);
  });

  it('the manifest no longer advertises a publish action', () => {
    expect(m?.actions || []).not.toContain('publish');
    expect(m?.actions || []).toContain('browse');
  });
});

describe('Dreams corpus labelling (S-DRM-2)', () => {
  it('the corpus is framed as the engine’s, not the reader’s', () => {
    expect(page).not.toContain('Your latest dreams');
    expect(page).toMatch(/engine’s latest dreams/);
    expect(page).toMatch(/composed by the dream engine/);
  });

  it('the counted unit is labelled for what it counts — substrate events', () => {
    expect(page).toContain('substrate events');
    expect(page).not.toMatch(/fragments ·/);
    expect(reader).toContain('substrate events');
    expect(library).toContain('substrate events');
    expect(library).not.toMatch(/\} fragments/);
  });
});

describe('Dreams interpretation claim withdrawn (S-DRM-3)', () => {
  it('no surface promises a reflection linking the dream to your activity', () => {
    expect(page).not.toMatch(/interpret it, tag it, and publish/);
    expect(reader).not.toMatch(/deterministic reflection links/);
    expect(reader).toMatch(/does not read the dream/);
    expect(reader).toContain('Substrate summary');
  });
});

describe('Dreams marketplace ruled out (S-DRM-4)', () => {
  it('the reader carries no listing control and calls no listing verb', () => {
    expect(reader).not.toContain("'dreams', 'publish'");
    expect(reader).not.toContain("'dreams', 'reprice'");
    expect(reader).not.toMatch(/Royalty cascade pays you/);
    expect(page).not.toMatch(/publish to sell on the marketplace/);
  });

  it('a pre-existing listing stays withdrawable — the remedy remnant', () => {
    expect(reader).toContain('Withdraw from marketplace');
    expect(reader).toContain("'dreams', 'unpublish'");
  });
});

describe('Dreams tag attribution (S-DRM-5)', () => {
  it('tag rows are labelled as the reader’s own annotation', () => {
    expect(page).toContain('your tags:');
    expect(reader).toContain('Your tags');
    expect(reader).toMatch(/shown only to you/);
    expect(library).toContain('your tags:');
  });
});
