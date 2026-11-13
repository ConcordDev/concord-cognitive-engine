/**
 * H13 — negative / non-positive numeric entries get an inline message beside
 * the field (never silently clamped). No upper bound is invented: those need
 * domain judgment and are left to the owners.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = (f: string) => readFileSync(resolve(__dirname, `../components/${f}`), 'utf8');

describe('H13 numeric notes', () => {
  it.each([
    ['fashion/FashionClosetPanel.tsx', "Number(form.cost) < 0", "Cost can&apos;t be negative."],
    ['urban-planning/ZoningSiteAnalysis.tsx', "!(Number(lotSizeSqFt) > 0)", 'Lot size must be greater than 0.'],
    ['emergency-services/EmergencyServicesActionPanel.tsx', 'Number(dispatchPriority) > 5', 'Priority must be 1–5.'],
    ['emergency-services/EmergencyServicesActionPanel.tsx', 'Number(dispatchDistance) < 0', 'Distance can&apos;t be negative.'],
    ['home-improvement/ProjectsPanel.tsx', 'Number(newProject.budget) < 0', 'Budget can&apos;t be negative.'],
    ['home-improvement/ProjectsPanel.tsx', 'Number(expenseDraft.amount) < 0', 'Amount can&apos;t be negative.'],
    ['home-improvement/HomeInventory.tsx', 'Number(form.purchasePrice) < 0', 'Price can&apos;t be negative.'],
  ])('%s shows "%s" beside the field', (file, cond, msg) => {
    const s = src(file);
    expect(s).toContain(cond);
    expect(s).toContain(`role="note" className="col-span-full text-xs text-rose-300">${msg}</span>`);
  });
  it('no invented upper bound on the fashion cost', () => {
    expect(src('fashion/FashionClosetPanel.tsx')).not.toContain('1000000');
  });
  it('budget/expense/price inputs carry min=0', () => {
    expect(src('home-improvement/HomeInventory.tsx')).toMatch(/type="number" min=\{0\} placeholder="Purchase price/);
    expect(src('home-improvement/ProjectsPanel.tsx')).toMatch(/type="number" min=\{0\} (value|placeholder)/);
  });
});
