// Standby-slice pins (B6, CB-0590):
//   FIX-home-improvement-003 — every create/edit form in the lens names the
//     missing required field next to its disabled submit (the ProjectsPanel
//     pattern the haiku partial established), not only ProjectsPanel.
//   FIX-home-improvement-005 — the money fields refuse out-of-range values
//     in words: one shared ceiling (MAX_MONEY) + the range helper, wired
//     into the submit guards of budget · expense · inventory price ·
//     shopping price.
//   FIX-meditation-004 — the reminder label inputs cap at LABEL_MAX with a
//     visible note when the cap is hit, and the input can shrink inside
//     its card (min-w-0).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as fs from 'node:fs';
import * as path from 'node:path';

const HI_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'components', 'home-improvement');
const src = (f: string) => fs.readFileSync(path.join(HI_DIR, f), 'utf8');

describe('FIX-home-improvement-003 — disabled submits name their missing field', () => {
  const cases: Array<[string, string]> = [
    ['ShoppingList.tsx', 'Item name is required.'],
    ['ContractorDirectory.tsx', 'Contractor name is required.'],
    ['PhotoGallery.tsx', 'Add a before or after photo first.'],
    ['ProjectGantt.tsx', 'Phase name is required.'],
    ['IdeaBoards.tsx', 'Board name is required.'],
    ['MaintenanceReminders.tsx', 'Task is required.'],
    ['HomeInventory.tsx', 'Asset name is required.'],
  ];
  it.each(cases)('%s renders the required-field note beside its submit', (file, note) => {
    expect(src(file)).toContain(note);
    expect(src(file)).toContain('role="note"');
  });
  it('the timeline create-project row names its field too', () => {
    expect(src('ProjectGantt.tsx')).toContain('Project name is required.');
  });
  it('the edit forms name the field beside Save changes', () => {
    for (const f of ['ContractorDirectory.tsx', 'IdeaBoards.tsx', 'HomeInventory.tsx']) {
      expect(src(f)).toContain('Name is required.');
    }
  });
});

describe('FIX-home-improvement-005 — one money ceiling, refused in words', () => {
  it('the shared helper bounds money at MAX_MONEY', async () => {
    const { MAX_MONEY, moneyOutOfRange } = await import('@/components/home-improvement/hi-shared');
    expect(MAX_MONEY).toBe(10_000_000);
    expect(moneyOutOfRange(-1)).toBe(true);
    expect(moneyOutOfRange(99_999_999_999)).toBe(true);
    expect(moneyOutOfRange(250_000)).toBe(false);
    expect(moneyOutOfRange('')).toBe(false);
    expect(moneyOutOfRange(undefined)).toBe(false);
  });
  it('budget, expense, inventory price and shopping price all guard on the helper', () => {
    expect(src('ProjectsPanel.tsx')).toContain('moneyOutOfRange(newProject.budget)');
    expect(src('ProjectsPanel.tsx')).toContain('moneyOutOfRange(expenseDraft.amount)');
    expect(src('HomeInventory.tsx')).toContain('moneyOutOfRange(form.purchasePrice)');
    expect(src('HomeInventory.tsx')).toContain('moneyOutOfRange(assetEdit.purchasePrice)');
    expect(src('ShoppingList.tsx')).toContain('moneyOutOfRange(form.price)');
    expect(src('ShoppingList.tsx')).toContain('moneyOutOfRange(priceEdit[it.id])');
  });
  it('the over-cap note names the ceiling', () => {
    expect(src('ProjectsPanel.tsx')).toContain('or less.');
    expect(src('HomeInventory.tsx')).toContain('or less.');
    expect(src('ShoppingList.tsx')).toContain('Price must be between $0 and $');
  });
});

// ---- FIX-meditation-004: render the reminders panel against a stubbed engine
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true, result: {} } })) },
}));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: React.ReactNode }) => children,
  motion: new Proxy({}, { get: () => (p: Record<string, unknown>) => <div>{p.children as React.ReactNode}</div> }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
import { RemindersPanel } from '@/components/meditation/RemindersPanel';

describe('FIX-meditation-004 — reminder label cap', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(async () => ({
      data: { ok: true, result: { reminders: [], count: 0, nextFire: null, dueToday: 0 }, error: null },
    }));
  });
  afterEach(() => cleanup());

  it('the label input is capped, shrinkable, and names the cap when hit', async () => {
    render(<RemindersPanel />);
    const input = await screen.findByPlaceholderText('Label (optional)');
    expect(input.getAttribute('maxlength')).toBe('80');
    expect(input.className).toContain('min-w-0');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'x'.repeat(80) } });
    });
    expect(screen.getByText(/Labels are capped at 80 characters\./)).toBeTruthy();
  });
});
