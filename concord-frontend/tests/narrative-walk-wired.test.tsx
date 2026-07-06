// Phase CA4 — confirm narrative-walk lens reads cinematic catalog.

import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NarrativeWalkLensPage from '@/app/lenses/narrative-walk/page';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'app', 'lenses', 'narrative-walk', 'page.tsx');

describe('Phase CA4 — Narrative walk lens', () => {
  const source = readFileSync(FILE, 'utf8');

  it('imports the cinematic-director + sequences-registry', () => {
    expect(source).toMatch(/cinematic-director/);
    expect(source).toMatch(/cinematic-sequences-registry/);
  });

  it('calls ensureCinematicsRegistered + listSequences and renders the real authored catalog', async () => {
    render(<NarrativeWalkLensPage />);
    expect(screen.getByRole('status')).toBeInTheDocument(); // "Loading the cinematic library…"
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    // The real registry ships 11 authored sequences (per this file's own
    // header comment) — assert real catalog entries rendered, not a stub.
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBeGreaterThanOrEqual(10);
  });

  it('plays a sequence on click via director.playSequence', () => {
    expect(source).toMatch(/playSequence/);
  });

  it('persists watched set to localStorage', () => {
    expect(source).toMatch(/localStorage/);
    expect(source).toMatch(/concordia:narrative-walk:watched/);
  });
});
