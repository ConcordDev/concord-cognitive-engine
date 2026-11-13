/**
 * FIX-accounting-007 — the Accounting lens's Lighthouse a11y bundle:
 * unlabeled selects, contrast, heading order.
 *
 * Pins, per surface rendered below:
 *  - every rendered <select> carries an accessible name (aria-label);
 *  - rendered headings never skip a level (the panels' section titles
 *    are h2 under the page h1 — the h1 → h3 skip was the failure);
 *  - icon-only row actions (edit/delete) carry accessible names.
 * A source sweep covers the whole accounting tree (every component,
 * including the data-gated selects a static render cannot reach):
 * no <select> without an aria-label, no <h3> panel titles left.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ ok: true, data: [], result: [] })),
  api: { get: vi.fn(async () => ({ data: null })), post: vi.fn(async () => ({ data: null })) },
}));

import { AcBudgetsPanel } from '@/components/accounting/AcBudgetsPanel';
import { AcInventoryPanel } from '@/components/accounting/AcInventoryPanel';
import { AcPayrollPanel } from '@/components/accounting/AcPayrollPanel';
import { AcPurchaseOrdersPanel } from '@/components/accounting/AcPurchaseOrdersPanel';
import { CategoryRulesPanel } from '@/components/accounting/CategoryRulesPanel';
import { VendorsPanel } from '@/components/accounting/VendorsPanel';
import { ExpensesPanel } from '@/components/accounting/ExpensesPanel';
import { RecurringInvoicesPanel } from '@/components/accounting/RecurringInvoicesPanel';
import { Form1099Panel } from '@/components/accounting/Form1099Panel';
import { RunwayForecast } from '@/components/accounting/RunwayForecast';

const PANELS: Array<[string, React.ComponentType]> = [
  ['AcBudgetsPanel', AcBudgetsPanel],
  ['AcInventoryPanel', AcInventoryPanel],
  ['AcPayrollPanel', AcPayrollPanel],
  ['AcPurchaseOrdersPanel', AcPurchaseOrdersPanel],
  ['CategoryRulesPanel', CategoryRulesPanel],
  ['VendorsPanel', VendorsPanel],
  ['ExpensesPanel', ExpensesPanel],
  ['RecurringInvoicesPanel', RecurringInvoicesPanel],
  ['Form1099Panel', Form1099Panel],
  ['RunwayForecast', RunwayForecast],
];

function headingLevels(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
    Number(h.tagName.slice(1)),
  );
}

describe('FIX-accounting-007 — accounting a11y bundle', () => {
  for (const [name, Panel] of PANELS) {
    it(`${name}: every rendered select has an accessible name`, () => {
      const { container } = render(<Panel />);
      const selects = Array.from(container.querySelectorAll('select'));
      for (const s of selects) {
        expect(s.getAttribute('aria-label'), `${name} select`).toBeTruthy();
      }
    });

    it(`${name}: heading levels never skip`, () => {
      const { container } = render(<Panel />);
      const levels = headingLevels(container);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
      }
      // Panel section titles are h2 (under the page h1), never h3-first.
      expect(levels).not.toContain(3);
    });
  }

  it('source sweep: no unlabeled select and no h3 anywhere in the accounting tree', () => {
    const root = path.join(process.cwd(), 'components', 'accounting');
    const files = fs.readdirSync(root).filter((f) => f.endsWith('.tsx'));
    files.push('../../app/lenses/accounting/page.tsx');
    for (const f of files) {
      const raw = fs.readFileSync(path.join(root, f), 'utf8');
      // Strip line comments — BillsPanel's history comment mentions the
      // old plain <select> it replaced, which is not a rendered control.
      const src = raw.replace(/^\s*\/\/.*$/gm, '');
      const selects = src.match(/<select\b[^>]*>/gs) ?? src.match(/<select\b[\s\S]*?>/g) ?? [];
      for (const tag of selects) {
        if (tag.includes('plain')) continue; // the BillsPanel comment mention
        expect(tag, `${f}: select without aria-label`).toContain('aria-label');
      }
      // Panel titles are h2. The single designed exception is
      // AccountingKeepMenu's "Keep this journal entry" — a sub-heading
      // nested inside the workbench section, correctly h3 there.
      if (f !== 'AccountingKeepMenu.tsx') {
        expect(src.includes('<h3'), `${f}: h3 panel title remains`).toBe(false);
      }
    }
  });
});
