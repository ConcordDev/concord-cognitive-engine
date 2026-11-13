/**
 * controls-honesty genus (CB-0528) — a labelled control performs its
 * labelled action, or the divergence is named.
 *
 * FIX-tournaments-004 EntrantsManager's add form had no form element and no
 *   Enter binding — Enter in the name field did nothing.
 * FIX-trades-007 ProjectDeskPanel.handleAction returned in silence when no
 *   project target existed, and the Action Result message it set on failure
 *   was rendered nowhere.
 * FIX-platform-004 Deployments Refresh spun and stopped with no outcome —
 *   failure, empty and success read identically.
 * FIX-logistics-008 the page's 'New shipment' CTA only switched tabs; the
 *   panel now opens its form on the CTA's signal, and the create form sends
 *   the estimatedDelivery date the server accepts.
 * (FIX-philosophy-005 does not reproduce at branch state — every curation
 * Add control is wired — and stays OPEN for the desk's re-walk.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FE = join(__dirname, '..');
const read = (p: string) => readFileSync(join(FE, p), 'utf8');

describe('tournaments-004 — Enter submits the entrant form', () => {
  const src = read('components/tournaments/EntrantsManager.tsx');
  it('the name and roster inputs submit on Enter', () => {
    const hits = src.match(/onKeyDown=\{\(e\) => \{ if \(e\.key === 'Enter'\) submitAdd\(\); \}\}/g) || [];
    expect(hits.length).toBe(2);
  });
});

describe('trades-007 — the empty-desk refusal speaks and renders', () => {
  const src = read('components/trades/ProjectDeskPanel.tsx');
  it('no target sets a worded message instead of returning silently', () => {
    expect(src).toContain('No project yet — add or select a project in the Project Desk first');
  });
  it('the Action Result panel renders the message field', () => {
    expect(src).toContain("typeof actionResult.message === 'string'");
  });
});

describe('platform-004 — refresh reports its outcome', () => {
  const src = read('components/platform/PlatformConsole.tsx');
  it('success and failure both set the refresh note', () => {
    expect(src).toContain('Refreshed — ');
    expect(src).toContain('Could not refresh the releases — try again.');
  });
  it('the note renders beside the Refresh button', () => {
    expect(src).toContain('{refreshNote && <p');
  });
});

describe('logistics-008 — the CTA opens the form; the form sends the date', () => {
  const page = read('app/lenses/logistics/page.tsx');
  const panel = read('components/logistics/ShipmentsPanel.tsx');
  it('the CTA bumps the create signal while switching tabs', () => {
    expect(page).toContain('setCreateSignal((n) => n + 1)');
    expect(page).toContain('<ShipmentsPanel createSignal={createSignal} />');
  });
  it('the panel opens its form when the signal fires', () => {
    expect(panel).toContain('if (createSignal && createSignal > 0) setCreating(true)');
  });
  it('the create form carries an estimated-delivery date into the input', () => {
    expect(panel).toContain('aria-label="Estimated delivery date"');
    expect(panel).toContain('estimatedDelivery: form.estimatedDelivery || null');
  });
});
