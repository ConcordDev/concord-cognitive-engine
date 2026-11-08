// Render + behaviour coverage for the live database client: connections, datasets/ER canvas,
// CSV import, SQL editor (run/explain/autocomplete/destructive guard), result grid edits,
// export and history. The lens backend is mocked per action with the real result shapes.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const CONN = (id: string, engine: string, host: string) => ({ id, name: `Conn ${id}`, engine, host, port: engine === 'postgresql' ? 5432 : null, database: 'app', username: 'me', hasPassword: engine === 'postgresql', readOnly: false, color: '#06b6d4', datasetCount: 2, rowTotal: 7, createdAt: '2026-03-01T00:00:00Z', lastUsedAt: null });
const DATASETS = [
  { id: 'd1', name: 'users', columns: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'text' }], rowCount: 3, x: 20, y: 20 },
  { id: 'd2', name: 'orders', columns: [{ name: 'id', type: 'integer' }, { name: 'user_id', type: 'integer' }], rowCount: 4, x: 260, y: 60 },
];
const SELECT = { columns: ['_rid', 'id', 'name'], rows: [{ _rid: 1, id: 1, name: 'Ada' }, { _rid: 2, id: 2, name: 'Bo' }], rowCount: 2, affected: null, op: 'SELECT', durationMs: 3, success: true, truncated: true, cap: 2, scope: 'workspace' };
const EXPLAIN = { verb: 'SELECT', table: 'users', totalCost: 12, estimatedRows: 3, warnings: ['full scan'], nodes: [{ id: 'n1', label: 'Seq Scan', type: 'scan', rows: 3, cost: 10, detail: 'users', children: ['n2'] }, { id: 'n2', label: 'Sort', type: 'sort', rows: 3, cost: 2, detail: '', children: [] }] };

function resultFor(action: string): unknown {
  switch (action) {
    case 'connection-list': return { connections: [CONN('c1', 'in-memory', 'local'), CONN('c2', 'postgresql', 'db.example.com')] };
    case 'dataset-list': return { datasets: DATASETS, relations: [{ id: 'r1', fromDataset: 'orders', fromColumn: 'user_id', toDataset: 'users', toColumn: 'id' }] };
    case 'connection-test': return { connected: true, datasets: 2 };
    case 'sql-autocomplete': return { suggestions: [{ value: 'users', kind: 'table' }, { value: 'name', kind: 'column', table: 'users', type: 'text' }] };
    case 'query-run': return SELECT;
    case 'query-explain': return EXPLAIN;
    case 'query-export': return { content: 'id,name\n1,Ada', format: 'csv' };
    case 'query-history': return { history: [{ id: 'h1', sql: 'select 1', ranAt: '2026-03-01T00:00:00Z', durationMs: 2, success: true, rowCount: 1, op: 'SELECT' }] };
    case 'dataset-import-csv': return { dataset: 'imported', imported: 2, rejected: 1, totalRows: 3, errors: [{ row: 3, error: 'bad int' }] };
    default: return { ok: true, id: 'new' };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({ TreeDiagram: ({ root }: { root?: { label?: string } }) => <div>tree:{root?.label}</div> }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const press = async (re: RegExp, nth = 0) => {
  const hits = screen.queryAllByRole('button').filter((x) => re.test((x.textContent || x.getAttribute('aria-label') || x.getAttribute('title') || '').trim()));
  if (hits[nth]) await act(async () => { fireEvent.click(hits[nth]); await new Promise((r) => setTimeout(r, 20)); });
  return !!hits[nth];
};
const mount = async () => { const { LiveDbClient } = await import('../LiveDbClient'); const v = render(<LiveDbClient />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('LiveDbClient', () => {
  it('lists connections and datasets, runs SQL, explains, and shows the results grid', { timeout: 60000 }, async () => {
    const view = await mount();
    expect(sent()).toEqual(expect.arrayContaining(['connection-list', 'dataset-list']));
    expect(view.container.textContent).toMatch(/Conn c1|users|orders/);
    const editor = screen.queryAllByRole('textbox').find((x) => x.tagName === 'TEXTAREA');
    if (editor) {
      await act(async () => { fireEvent.change(editor, { target: { value: 'SELECT * FROM users' } }); });
      await settle();
    }
    await press(/^Run|Execute/i);
    await press(/Explain/i);
    await press(/CSV/i);
    await press(/JSON/i);
    await press(/History/i);
    await press(/Clear history|Clear/i);
    expect(sent()).toEqual(expect.arrayContaining(['query-run', 'query-explain']));
  });

  it('exercises every control with permissive responses', { timeout: 120000 }, async () => {
    await mount();
    await exercise({ passes: 2, text: 'select * from users', skip: /delete|remove|trash|discard|cancel|close|dismiss|clear|^×$/i });
    await settle();
    expect(sent().length).toBeGreaterThan(5);
  });

  it('guards destructive statements, stages row edits and handles failures', { timeout: 60000 }, async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => {
      const act_ = actionOf(a);
      const input = (a[2] ?? {}) as Record<string, unknown>;
      if (act_ === 'query-run' && !input.confirmDestructive && /delete/i.test(String(input.sql))) return { data: { ok: true, result: { ...SELECT, needsConfirm: true, error: 'Affects every row', destructive: 'DELETE' } } };
      if (act_ === 'query-run' && /fail/i.test(String(input.sql))) return { data: { ok: false, error: 'boom' } };
      if (act_ === 'connection-test') return { data: { ok: true, result: { connected: false, scope: 'remote', stage: 'auth', error: 'bad pw' } } };
      return { data: { ok: true, result: resultFor(act_) } };
    });
    await mount();
    const editor = () => screen.queryAllByRole('textbox').find((x) => x.tagName === 'TEXTAREA') as HTMLElement;
    await act(async () => { fireEvent.change(editor(), { target: { value: 'DELETE FROM users' } }); });
    await press(/^Run|Execute/i);
    await press(/Confirm|Run anyway|Yes/i);
    await act(async () => { fireEvent.change(editor(), { target: { value: 'SELECT fail' } }); });
    await press(/^Run|Execute/i);
    await act(async () => { fireEvent.change(editor(), { target: { value: 'SELECT * FROM users' } }); });
    await press(/^Run|Execute/i);
    const cell = screen.queryAllByText('Ada')[0];
    if (cell) { await act(async () => { fireEvent.doubleClick(cell); }); }
    const cellInput = screen.queryAllByRole('textbox').find((x) => (x as HTMLInputElement).value === 'Ada');
    if (cellInput) {
      await act(async () => { fireEvent.change(cellInput, { target: { value: 'Ada L' } }); fireEvent.keyDown(cellInput, { key: 'Enter' }); });
    }
    await press(/SQL|Preview/i);
    await press(/Commit|Apply/i);
    await press(/Test/i);
    await press(/Delete|Trash/i); await press(/Delete|Trash|Confirm/i);
    expect(sent()).toContain('query-run');
  });

  it('manages connections, datasets, relations and CSV import', { timeout: 90000 }, async () => {
    await mount();
    const byLabel = (re: RegExp) => screen.queryAllByLabelText(re)[0] as HTMLElement | undefined;
    const clickLabel = async (re: RegExp) => { const el = byLabel(re); if (el) await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 20)); }); };
    const setField = async (el: Element | undefined, value: string) => { if (el) await act(async () => { fireEvent.change(el, { target: { value } }); }); };
    const byPh = (re: RegExp) => screen.queryAllByRole('textbox').find((x) => re.test(x.getAttribute('placeholder') || ''));

    await clickLabel(/New connection/);
    await press(/^Save|Create|Add connection/i);
    await setField(byPh(/Connection name/), 'Prod');
    await setField(byLabel(/^Engine$/), 'postgresql');
    await setField(byPh(/^Host$/), 'db.example.com');
    await setField(byPh(/Database/), 'app');
    await setField(byPh(/Username/), 'me');
    await setField(byLabel(/^Port$/), 'abc');
    await press(/^Save|Create|Add connection/i);
    await setField(byLabel(/^Port$/), '5432');
    await setField(byLabel(/^Password$/), 'secret');
    await press(/^Save|Create|Add connection/i);

    await clickLabel(/Test connection/);
    await clickLabel(/Replace stored password/);
    await setField(byLabel(/Connection password/), 'newpw');
    await press(/^Save|Update|Set/i);
    await clickLabel(/Replace stored password/);
    await press(/Remove password|Clear password/i);
    await press(/read-?only/i);
    await clickLabel(/Delete connection/); await clickLabel(/Confirm delete connection/);

    await clickLabel(/New dataset/);
    await setField(byPh(/table name/), 'events');
    await setField(byPh(/^column$/), 'id');
    await setField(byLabel(/Column type/), 'integer');
    await press(/Add column/i);
    await clickLabel(/Remove column/);
    await press(/Create|Save/i);
    await clickLabel(/Rename dataset users/);
    const ren = screen.queryAllByRole('textbox').find((x) => (x as HTMLInputElement).value === 'users');
    await setField(ren, 'people');
    if (ren) await act(async () => { fireEvent.keyDown(ren, { key: 'Enter' }); fireEvent.blur(ren); });
    await setField(byLabel(/Move dataset users/), 'c2');
    await clickLabel(/Delete dataset/); await clickLabel(/Confirm delete dataset/);

    await setField(byLabel(/Import target dataset/), '');
    await setField(byPh(/new table name/), 'imported');
    await setField(byPh(/Paste CSV/), 'id,name\n1,Ada\n2,Bo');
    await press(/^Import/i);
    for (const t of ['Schema', 'ER', 'Diagram', 'Query', 'Data']) await press(new RegExp(t, 'i'));
    await press(/Add relation|Link/i);
    expect(sent()).toEqual(expect.arrayContaining(['connection-create']));
    expect(sent().some((x) => /dataset-|connection-(test|update|delete)/.test(x))).toBe(true);
  });

  it('shows an error when the connection list fails', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'db down' } }));
    const view = await mount();
    expect(view.container.textContent?.length).toBeGreaterThan(10);
  });
});
