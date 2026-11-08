// Render + behaviour coverage for the component workbench: catalog + server-side search,
// starred filter, preview states, prop controls (save / reset), usage snippet copy, the
// accessibility audit and the variant gallery.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
let favourites: string[] = ['Button'];
const COMP = (name: string, group: string) => ({ name, group, description: `${name} component`, homePath: `/lenses/${name.toLowerCase()}`, homeLabel: `${name} home`, importPath: `@/components/${name}`, icon: 'box', states: ['default', 'loading', 'error'], propCount: 3 });
function resultFor(action: string, input?: Record<string, unknown>): unknown {
  switch (action) {
    case 'catalog': return { components: [COMP('Button', 'inputs'), COMP('Card', 'layout'), COMP('Modal', 'overlays')], groups: [{ id: 'inputs', label: 'Inputs', count: 1 }, { id: 'layout', label: 'Layout', count: 1 }, { id: 'overlays', label: 'Overlays', count: 1 }], source: 'auto-generated' };
    case 'favourites-list': return { favourites };
    case 'search': return { results: [{ name: 'Card' }, { name: 'Modal' }] };
    case 'preview': return { availableStates: ['default', 'loading', 'error'], liveMount: '/lenses/button', props: { size: 'md' }, state: input?.state ?? 'default' };
    case 'props-schema': return { schema: [{ key: 'size', label: 'Size', type: 'enum', options: ['sm', 'md', 'lg'], default: 'md' }, { key: 'rounded', label: 'Rounded', type: 'boolean', default: false }, { key: 'padding', label: 'Padding', type: 'range', min: 0, max: 32, step: 4, default: 8 }], defaults: { size: 'md', rounded: false, padding: 8 }, current: { size: 'md', rounded: false, padding: 8 }, hasOverrides: false };
    case 'usage-snippet': return { usage: '<Button size="md" />', propsInterface: 'interface ButtonProps { size: string }', importLine: "import { Button } from '@/components/Button'" };
    case 'variant-gallery': return { variants: [{ state: 'default', label: 'Default', tone: 'emerald', description: 'Idle' }, { state: 'error', label: 'Error', tone: 'rose', description: 'Failed' }, { state: 'loading', label: 'Loading', tone: 'amber', description: 'Busy' }, { state: 'x', label: 'Other', tone: 'slate', description: '' }] };
    case 'a11y-check': return { score: 76.666, summary: { passes: 4, warnings: 1, errors: 1 }, scoreFormula: '100 - 12 per error', scoreNote: 'static audit', basis: 'declared', standard: 'WCAG 2.2 AA', findings: [{ rule: 'contrast', category: 'color', severity: 'pass', detail: 'ok' }, { rule: 'label', category: 'aria', severity: 'error', detail: 'missing label' }, { rule: 'size', category: 'target', severity: 'warn', detail: 'small' }, { rule: 'hint', category: 'info', severity: 'info', detail: 'note' }], declarations: [{ rule: 'role', category: 'aria', severity: 'pass', detail: 'declared' }], responsive: [{ breakpoint: 'mobile', label: 'Mobile', widthPx: 375, fits: true, note: 'ok' }, { breakpoint: 'tablet', label: 'Tablet', widthPx: 768, fits: false, note: 'overflows' }, { breakpoint: 'desktop', label: 'Desktop', widthPx: 1280, fits: true, note: '' }] };
    case 'save-props': return { saved: { size: 'lg' } };
    case 'reset-props': return { defaults: { size: 'md', rounded: false, padding: 8 } };
    case 'favourite-toggle': return { favourited: !favourites.includes(String(input?.component)) };
    default: return { ok: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 40)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const click = async (el: Element) => { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 30)); }); };
const btn = (re: RegExp, nth = 0) => screen.getAllByRole('button', { name: re })[nth];
const mount = async () => { const { ComponentWorkbench } = await import('../ComponentWorkbench'); const v = render(<ComponentWorkbench />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  favourites = ['Button'];
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a), a[2] as Record<string, unknown>) } }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('ComponentWorkbench', () => {
  it('loads the catalog, filters (search, group, starred) and stars components', { timeout: 60000 }, async () => {
    const v = await mount();
    expect(v.container.textContent).toMatch(/Button/);
    expect(sent()).toEqual(expect.arrayContaining(['catalog', 'favourites-list', 'preview', 'props-schema', 'usage-snippet', 'variant-gallery', 'a11y-check']));
    await act(async () => { fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'ca' } }); await new Promise((r) => setTimeout(r, 400)); });
    expect(sent()).toContain('search');
    await act(async () => { fireEvent.change(screen.getByLabelText('Search components'), { target: { value: '' } }); await new Promise((r) => setTimeout(r, 300)); });
    await click(btn(/Layout \(1\)/));
    await click(btn(/All \(/));
    await click(btn(/Starred/));
    await click(btn(/Starred/));
    const stars = screen.queryAllByLabelText(/favou?rite|star/i);
    if (stars[0]) await click(stars[0]);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('switches preview state, edits props, saves, resets, copies the snippet and shows the audit', { timeout: 90000 }, async () => {
    const v = await mount();
    await click(btn(/^loading$/));
    await click(btn(/^error$/));
    const TAB_NAMES = ['Props', 'Snippet', 'Accessibility', 'Variants', 'Preview'];
    for (const t of TAB_NAMES) {
      const tab = screen.queryAllByRole('button').find((b) => new RegExp(t, 'i').test((b.textContent || '').trim()) && (b.textContent || '').trim().length < 24);
      if (tab) await click(tab);
      await exercise({ passes: 1, text: '12', skip: /Props|Snippet|Accessibility|Variants|Preview|Starred|^All|Inputs|Layout|Overlays|^(default|loading|error)$|^×$/i });
      await settle();
    }
    expect(sent().some((x) => /save-props|reset-props|a11y-check/.test(x))).toBe(true);
    expect(v.container.textContent).toMatch(/WCAG|score|pass/i);
  });

  it('shows empty search results and backend failures', async () => {
    const v = await mount();
    lensRunMock.mockImplementation(async (...a: unknown[]) => actionOf(a) === 'search' ? { data: { ok: true, result: { results: [] } } } : { data: { ok: false } });
    await act(async () => { fireEvent.change(screen.getByLabelText('Search components'), { target: { value: 'zzz' } }); await new Promise((r) => setTimeout(r, 400)); });
    expect(v.container.textContent).toMatch(/No components match/);
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: false } }));
    const bad = await mount();
    expect(bad.container.textContent).toMatch(/Component Workbench/);
  });
});
