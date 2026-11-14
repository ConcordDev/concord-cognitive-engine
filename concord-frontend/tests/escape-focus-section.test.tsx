// B6 Escape/focus section pins (GB-1531 pool share).
//
// The genus rides ONE shared mechanism — the AppShell-installed overlay
// keyboard (lib/a11y/overlay-keyboard): Escape clicks the top dialog's
// close control, Tab is trapped in modal dialogs, frame tablists rove
// by arrow keys. The 2026-11-12 walk predates that mechanism's landing
// and hardening, so most surfaces are exercised here as
// NOT_REPRODUCING_AT_HEAD pins (the mechanism closing them at branch
// state), and the three genuine gaps found are pinned as fixes:
//  - DTUPickerModal carried no role="dialog", so the overlay listener
//    was blind to it (FIX-transfer-010 drawer leg) — it is a dialog now.
//  - The command palette dropped focus to the page root on close
//    (FIX-engineering-015 / FIX-ingest-005 palette legs) — it restores
//    the element focused when it opened.
//  - The Export menu had no arrow-key travel between its options
//    (FIX-engineering-015 menu leg) — ArrowDown/ArrowUp now cycle.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installOverlayKeyboard } from '@/lib/a11y/overlay-keyboard';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(async () => ({ data: { ok: true, messages: [], labels: [] } })), post: vi.fn(async () => ({ data: { ok: true } })) },
  apiHelpers: {
    lens: { list: vi.fn(async () => ({ data: { artifacts: [] } })), exportList: vi.fn(async () => ({ data: { artifacts: [] } })) },
    semanticSearch: { search: vi.fn(async () => ({ data: { ok: false } })) },
    graph: { force: vi.fn(async () => ({ data: { ok: false } })) },
  },
  lensRun: vi.fn(async () => ({ data: { ok: true, result: {} } })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/lenses/bio' }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CrossDomainConnections } from '@/components/common/CrossDomainConnections';
import { openLensTool } from '@/lib/lens-dock';
import { ExportMenu } from '@/components/common/ExportMenu';
import { ContentPublisher } from '@/components/lens/ContentPublisher';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import { CommandPalette } from '@/components/common/CommandPalette';
import { useUIStore } from '@/store/ui';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';

afterEach(cleanup);

async function esc() {
  await act(async () => {
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe('shared overlay mechanism closes the walked surfaces at head', () => {
  it('Export menu: Escape closes it (bio-007 · chem-008 · dtus-005 · root-003 · urban-planning-006)', async () => {
    const off = installOverlayKeyboard();
    render(<ExportMenu domain="bio" />);
    fireEvent.click(screen.getByTitle('Export (Ctrl+E)'));
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeTruthy();
    await esc();
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Export' })).toBeNull(), { timeout: 2000 });
    off();
  });

  it('Share & Publish: Escape closes it (defense-007 · federation-005 · law-enforcement-003)', async () => {
    const off = installOverlayKeyboard();
    render(<ContentPublisher domain="repos" artifactId="repo_1" title="My repo" />);
    fireEvent.click(screen.getByRole('button', { name: /^Share$/ }));
    const dialog = await screen.findByRole('dialog');
    // Focus-trap leg (defense-007): Tab on the last control wraps to the
    // first instead of leaving the still-open dialog.
    const postBtn = screen.getByRole('button', { name: /Post to Feed/ });
    postBtn.focus();
    await act(async () => { fireEvent.keyDown(postBtn, { key: 'Tab' }); });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(postBtn);
    await esc();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 2000 });
    off();
  });

  it('lens view tabs: ArrowRight moves to the next tab (chem-008 · ingest-005 tablist legs)', () => {
    render(
      <NorthStarFrame
        lensId="chem"
        crumb="Chemistry"
        tabs={[{ id: 'elements', label: 'Elements' }, { id: 'reactions', label: 'Reactions' }]}
        activeTab="elements"
        onTab={vi.fn()}
        tabsLabel="Chemistry views"
      >
        <div>body</div>
      </NorthStarFrame>,
    );
    const first = screen.getByRole('button', { name: /Elements/ });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect((document.activeElement as HTMLElement)?.textContent).toMatch(/Reactions/);
  });

  it('Cross-domain panel: Escape closes it (cri-009 · docs-008 cross-domain legs)', async () => {
    const off = installOverlayKeyboard();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <CrossDomainConnections domain="music" domainLabel="Music" />
      </QueryClientProvider>,
    );
    await act(async () => { openLensTool('connections'); });
    expect(screen.getByLabelText('Close panel')).toBeTruthy();
    await esc();
    await vi.waitFor(() => expect(screen.queryByLabelText('Close panel')).toBeNull(), { timeout: 2000 });
    off();
  });
});

describe('the genuine gaps, fixed', () => {
  it('DTU picker: Escape closes it now that the panel is a dialog (transfer-010)', async () => {
    const off = installOverlayKeyboard();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <DTUPickerModal onClose={onClose} onSelect={vi.fn()} title="Search DTUs" />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Search DTUs' })).toBeTruthy();
    await esc();
    expect(onClose).toHaveBeenCalled();
    off();
  });

  it('command palette: Escape hands focus back to the control that had it (engineering-015 · ingest-005)', async () => {
    const off = installOverlayKeyboard();
    render(
      <div>
        <button data-testid="opener">opener</button>
        <CommandPalette />
      </div>,
    );
    const opener = screen.getByTestId('opener');
    opener.focus();
    await act(async () => { useUIStore.getState().setCommandPaletteOpen(true); });
    await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
      await new Promise((r) => setTimeout(r, 80));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(opener), { timeout: 2000 });
    off();
  });

  it('Export menu: ArrowDown moves focus onto the first option (engineering-015)', async () => {
    const off = installOverlayKeyboard();
    render(<ExportMenu domain="bio" />);
    const trigger = screen.getByTitle('Export (Ctrl+E)');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Export' });
    await act(async () => { fireEvent.keyDown(dialog, { key: 'ArrowDown' }); });
    expect((document.activeElement as HTMLElement)?.textContent).toMatch(/Export as JSON/);
    off();
  });

  it('ingest schedule form carries a Cancel and an Escape reset (ingest-004, source pin)', () => {
    const src = readFileSync(resolve(__dirname, '../components/ingest/PipelinePanel.tsx'), 'utf8');
    expect(src).toContain('resetScheduleForm');
    expect(src).toMatch(/onClick=\{resetScheduleForm\}[\s\S]{0,300}Cancel/);
  });

  it('label Add explains its disabled state when the name is empty (message-007, source pin)', () => {
    const src = readFileSync(resolve(__dirname, '../components/message/LabelManagerPanel.tsx'), 'utf8');
    expect(src).toContain('Type a label name to add it.');
  });
});
