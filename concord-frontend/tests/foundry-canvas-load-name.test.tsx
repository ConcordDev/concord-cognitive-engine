/**
 * FIX-foundry-005 exercise pin — opening a saved draft shows its name.
 *
 * The ticket: "Builder header keeps showing 'Untitled Game' after
 * opening a saved draft world." This pin drives the real FoundryCanvas
 * with the foundry API mocked in the shapes lib/foundry/api.ts returns,
 * opens the saved draft from the My-worlds strip, and expects the header
 * name input to carry the draft's name.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const DRAFT = {
  id: 'wld_dragon',
  name: 'Dragon Vale',
  description: 'A saved draft',
  status: 'draft',
  worldspec: { theme: { universeType: 'fantasy', displayName: 'Dragon Vale', palette: null }, systems: [], rules: [] },
};

vi.mock('@/lib/foundry/api', () => ({
  fetchSystems: vi.fn(async () => ({ ok: true, categories: {}, systems: [] })),
  listWorlds: vi.fn(async () => ({ ok: true, worlds: [DRAFT] })),
  getWorld: vi.fn(async () => ({ ok: true, world: DRAFT })),
  createWorld: vi.fn(async () => ({ ok: false, reason: 'unused' })),
  updateWorld: vi.fn(async () => ({ ok: true, world: DRAFT })),
  publishWorld: vi.fn(async () => ({ ok: true })),
  unpublishWorld: vi.fn(async () => ({ ok: true })),
  validateWorld: vi.fn(async () => ({ ok: true, valid: true, issues: [] })),
  fetchTemplates: vi.fn(async () => ({ ok: true, templates: [] })),
  defaultConfig: vi.fn(() => ({})),
}));

vi.mock('@/components/foundry/ComponentPalette', () => ({ ComponentPalette: () => null }));
vi.mock('@/components/foundry/ConfigPanel', () => ({ ConfigPanel: () => null }));
vi.mock('@/components/foundry/FoundryRulesPanel', () => ({ FoundryRulesPanel: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

vi.mock('lucide-react', () => {
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return {
    Loader2: make('Loader2'), Save: make('Save'), Rocket: make('Rocket'), Trash2: make('Trash2'),
    X: make('X'), CheckCircle2: make('CheckCircle2'), AlertTriangle: make('AlertTriangle'),
    Circle: make('Circle'), FileStack: make('FileStack'), Undo2: make('Undo2'), Eye: make('Eye'),
  };
});

import { FoundryCanvas } from '@/components/foundry/FoundryCanvas';

describe('FIX-foundry-005 — opening a draft names the header', () => {
  it('the header name input takes the opened draft’s name', async () => {
    const { container } = render(<FoundryCanvas />);
    // The saved draft appears in the My-worlds strip.
    const stripButton = await screen.findByRole('button', { name: /Dragon Vale/ });
    // Before opening, the header still shows the fresh-draft default.
    expect(screen.getByDisplayValue('Untitled Game')).toBeTruthy();
    fireEvent.click(stripButton);
    // After opening, the header input carries the draft's name.
    await waitFor(() => expect(screen.getByDisplayValue('Dragon Vale')).toBeTruthy());
    const input = container.querySelector('input[value="Dragon Vale"]');
    expect(input).toBeTruthy();
  });
});
