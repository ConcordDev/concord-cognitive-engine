/**
 * H3 — Export menu and Share & Publish close on Escape through the one
 * overlay listener, and focus returns to the control that opened them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { installOverlayKeyboard } from '@/lib/a11y/overlay-keyboard';

vi.mock('@/lib/api/client', () => ({ apiHelpers: { lens: { list: vi.fn(), exportList: vi.fn() } }, lensRun: vi.fn() }));
import { ExportMenu } from '@/components/common/ExportMenu';

afterEach(cleanup);

describe('H3 Export menu keyboard', () => {
  it('Escape closes the menu and focus returns to the Export button', async () => {
    const off = installOverlayKeyboard();
    render(<ExportMenu domain="bio" />);
    const trigger = screen.getByTitle('Export (Ctrl+E)');
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    off();
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('H3 DIY forms are dialogs the Escape listener can see', () => {
  const src = (f: string) => readFileSync(resolve(__dirname, `../components/diy/${f}`), 'utf8');
  it('library editor and New Project panels carry role=dialog + Close', () => {
    const lib = src('DiyLibraryPanel.tsx');
    expect(lib).toMatch(/role="dialog" aria-modal="true" aria-label=\{`\$\{editingItem/);
    const ws = src('ProjectWorkshop.tsx');
    expect(ws).toContain('role="dialog" aria-modal="true" aria-label="New project"');
    expect(lib).toContain('aria-label="Close"');
    expect(ws).toContain('aria-label="Close"');
  });
});
