// Shared helpers for render-coverage tests of big panels whose shape is driven by
// many macros. Not a test file (vitest only collects *.test.*).

import { act, fireEvent } from '@testing-library/react';

const ARRAY_KEYS = /^(events|comments|versions|items|tags|shots|scenes|entries|photos|pins|elements|layers|frames|tracks|rows|cast|crew|locations|props|notes|steps|ingredients|dates|requests|history|files|assets|stops|members|attendees|tasks|lines|children|points|keyframes|segments|sections|flags|chips|options|links|reminders|recalls|logs)$/i;
const NUM_KEYS = /(amount|price|total|count|hours|budget|miles|mileage|odometer|cost|qty|quantity|gallons|mpg|year|pct|percent|score|size|width|height|duration|fps|frame|order|index|runtime|variance|days|rate|version|number|num|ratio|km|liters|litres)$/i;
const BOOL_KEYS = /^(is[A-Z]|has[A-Z]|done$|resolved$|active$|current$|locked$|approved$|paid$|published$|visible$|enabled$|ready$|overBudget$|overdue$)/;
const DATE_KEYS = /(At|Date|date|time|Time|due|deadline)$/;

/** An entity that answers any property read with a plausible value, so renders never hit `undefined.map`. */
export function fakeEntity(seed = 'e1', depth = 0): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_t, key) {
      if (key === Symbol.toPrimitive) return () => 'Item';
      if (typeof key !== 'string') return undefined;
      if (key === 'then') return undefined;
      if (key === 'id') return seed;
      if (ARRAY_KEYS.test(key)) return [];
      if (BOOL_KEYS.test(key)) return false;
      if (NUM_KEYS.test(key)) return 5;
      if (DATE_KEYS.test(key)) return '2026-03-01';
      if (key === 'status') return 'active';
      if (key === 'kind' || key === 'type') return 'general';
      if (depth < 1 && /^(vehicle|asset|board|sheet|breakdown|deliverable|animation|link|event|document)$/.test(key)) return fakeEntity(seed, depth + 1);
      return 'Item';
    },
    has: () => true,
  });
}

/** Fill every field and press every enabled control (deletes skipped), letting each async handler settle. */
export async function exercise(opts: { passes?: number; skip?: RegExp; root?: ParentNode; text?: string } = {}) {
  const { passes = 2, skip = /delete|remove|trash|discard|cancel|close|dismiss|reset|clear|^back|^×$/i, root = document, text = 'Test' } = opts;
  for (let pass = 0; pass < passes; pass++) {
    for (const el of Array.from(root.querySelectorAll('input, textarea')) as HTMLInputElement[]) {
      if (!el.isConnected || el.disabled || el.readOnly) continue;
      if (el.type === 'checkbox' || el.type === 'radio') { await act(async () => { fireEvent.click(el); }); continue; }
      if (el.type === 'file' || el.type === 'range' || el.type === 'color') continue;
      const v = el.type === 'number' ? '5' : el.type === 'date' ? '2026-03-01' : el.type === 'time' ? '10:30' : el.type === 'email' ? 'a@example.org' : el.type === 'url' ? 'https://example.org' : text;
      try { await act(async () => { fireEvent.change(el, { target: { value: v } }); }); } catch { /* controlled field may reject */ }
    }
    for (const sel of Array.from(root.querySelectorAll('select')) as HTMLSelectElement[]) {
      const opt = Array.from(sel.options).find((o) => o.value && o.value !== sel.value);
      if (opt) { try { await act(async () => { fireEvent.change(sel, { target: { value: opt.value } }); }); } catch { /* noop */ } }
    }
    // buttons plus clickable rows/cards (selecting an item opens its detail view)
    for (const el of Array.from(root.querySelectorAll('button, [role="tab"], [role="button"], [class*="cursor-pointer"], tr[class*="hover"], li[class*="hover"]')) as HTMLElement[]) {
      if (!el.isConnected || (el as HTMLButtonElement).disabled) continue;
      const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (skip.test(label)) continue;
      try { await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); }); } catch { /* a control may unmount mid-pass */ }
    }
  }
}

/** lensRun mock that accepts both call shapes: (domain, action, input) and ({ domain, action|name, input }). */
export function actionOf(args: unknown[]): string {
  const a = args[0];
  if (typeof a === 'object' && a) { const o = a as { action?: string; name?: string }; return o.action || o.name || ''; }
  return String(args[1] ?? '');
}
