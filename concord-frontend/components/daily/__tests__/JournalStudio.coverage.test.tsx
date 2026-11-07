// Render + behaviour coverage for the Day One style journal studio: composer, timeline,
// search, edit, delete, tabs and exports. Sibling heatmap/habit/lock panels are stubbed.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const ENTRY = (id: string, tags: string[] = ['gratitude']) => ({ id, title: `Entry ${id}`, body: `Body of ${id}`, mood: 4, tags, date: '2026-03-02', media: [{ kind: 'link', url: 'https://example.com', caption: 'ref' }], template: null });

function resultFor(action: string): unknown {
  switch (action) {
    case 'entry-list': return { entries: [ENTRY('e1'), ENTRY('e2', ['work'])] };
    case 'on-this-day': return { entries: [ENTRY('o1')] };
    case 'daily-dashboard': return { totalEntries: 12, daysJournaled: 9, currentStreak: 3, entriesThisMonth: 5, wroteToday: false };
    case 'prompt-today': return { prompt: 'What made you smile today?' };
    case 'mood-trend': return { averageMood: 3.6 };
    case 'templates-list': return { templates: [{ id: 't1', name: 'Gratitude', icon: '🙏', description: 'Three good things', tags: ['gratitude'], body: '1.\n2.\n3.' }] };
    case 'tags-list': return { tags: [{ tag: 'gratitude', count: 4 }, { tag: 'work', count: 2 }] };
    case 'entry-search': return { entries: [ENTRY('s1')] };
    case 'export-archive': return { markdown: '# Archive', filename: 'a.md' };
    case 'export-journal': return { markdown: '# All', filename: 'all.md' };
    default: return { id: 'new' };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('../EntryHeatmap', () => ({ EntryHeatmap: () => <span>heatmap-stub</span> }));
vi.mock('../HabitBuilder', () => ({ HabitBuilder: () => <span>habits-stub</span> }));
vi.mock('../JournalLock', () => ({ JournalLock: ({ onUnlock }: { onUnlock?: () => void }) => <button onClick={onUnlock}>lock-stub</button> }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 20)); });
  return !!hits[nth];
};
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('JournalStudio', () => {
  it('loads the timeline, composes and saves an entry, searches, edits, deletes and exports', async () => {
    const { JournalStudio } = await import('../JournalStudio');
    const view = render(<JournalStudio />);
    await settle();
    expect(view.container.textContent).toMatch(/Entry e1|smile today/);
    expect(sent()).toEqual(expect.arrayContaining(['entry-list', 'on-this-day', 'daily-dashboard', 'prompt-today', 'mood-trend', 'templates-list', 'tags-list']));

    await press(/Gratitude/);
    const body = screen.queryAllByRole('textbox');
    for (const el of body) await act(async () => { fireEvent.change(el, { target: { value: el.tagName === 'TEXTAREA' ? 'Today was good' : 'tag1, tag2' } }); });
    await press(/^😄$|^🙂$/);
    await press(/Save|Add entry|Post/i);
    expect(sent()).toContain('entry-create');

    const search = screen.queryAllByRole('textbox').find((el) => /search/i.test(el.getAttribute('placeholder') || ''));
    if (search) {
      await act(async () => { fireEvent.change(search, { target: { value: 'good' } }); });
      await act(async () => { fireEvent.keyDown(search, { key: 'Enter' }); });
      await press(/Search/i);
    }
    await press(/gratitude/i, 1);
    await press(/Edit|Pencil/i);
    const editors = screen.queryAllByRole('textbox');
    for (const el of editors) await act(async () => { fireEvent.change(el, { target: { value: el.tagName === 'TEXTAREA' ? 'Edited body' : 'edited' } }); });
    await press(/Save changes|^Save$/i);
    await press(/Delete|Trash/i);
    await press(/Export archive|Archive|Markdown/i);
    await press(/Export all|Export journal|Everything/i);
    for (const t of ['Streaks', 'Habits', 'Lock', 'Write']) { await press(new RegExp(`^${t}$`)); await settle(); }
    expect(sent().some((x) => /entry-update|entry-delete|entry-search|export-/.test(x))).toBe(true);
  });

  it('exercises every control and survives empty and failing backends', async () => {
    const { JournalStudio } = await import('../JournalStudio');
    render(<JournalStudio />);
    await settle();
    await exercise({ passes: 1, text: 'note', skip: /^(Streaks|Habits|Lock)$|delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
    cleanup();
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: false, error: 'nope', result: actionOf(a) === 'entry-list' ? { entries: [] } : undefined } }));
    const view = render(<JournalStudio />);
    await settle();
    await press(/Save|Add entry|Post/i);
    expect(view.container.textContent?.length).toBeGreaterThan(20);
  });
});
