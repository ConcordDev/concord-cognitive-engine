// Narrative trail reads the real bundled cinematic catalog.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import NarrativeWalkLensPage from '@/app/lenses/narrative-walk/page';
import { cancelActiveSequence } from '@/lib/world-lens/cinematic-director';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'app', 'lenses', 'narrative-walk', 'page.tsx');

describe('Narrative walk lens — real catalog', () => {
  const source = readFileSync(FILE, 'utf8');

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { cancelActiveSequence(); localStorage.clear(); });

  it('imports the cinematic director and the sequence registry', () => {
    expect(source).toMatch(/cinematic-director/);
    expect(source).toMatch(/cinematic-sequences-registry/);
    expect(source).toMatch(/playSequence/);
    expect(source).toMatch(/concordia:narrative-walk:open/);
  });

  it('stays closed until Begin, then shows the first authored sequence', async () => {
    render(<NarrativeWalkLensPage />);
    expect(screen.getByRole('status')).toHaveTextContent(/Opening the trail/);
    expect(await screen.findByText('No walk open.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Begin the walk' }));
    expect(await screen.findByRole('heading', { name: 'Lattice Quest Realised' })).toBeInTheDocument();
    expect(screen.getByText(/lattice-born quest/)).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem('concordia:narrative-walk:open')).toBe('quest_lattice_realised'));
  });
});
