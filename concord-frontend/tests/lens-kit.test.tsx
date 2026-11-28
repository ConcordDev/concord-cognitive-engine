import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import {
  SourcedNumber, ReceiptCard, receiptFromServer, LensAsync, LensTabStrip, LensDialog, LensColumns,
  sourced, mustSource, formatValue, formatUncertainty, formatSource, fromMargin, fromProbability, ledgerAmount, counted,
  checkLensTokens, contrastRatio, parseColor, unwrapLensResponse,
} from '@/components/lens-kit';

describe('sourced numbers — no number without a source and an uncertainty', () => {
  it('refuses a number with no source, no uncertainty, a non-finite value, or a value outside its own interval', () => {
    const src = { kind: 'solver' as const, id: 'structure.frame' };
    expect(sourced({ value: 3, source: undefined as never, uncertainty: { kind: 'exact', why: 'x' } })).toMatchObject({ ok: false, reason: expect.stringMatching(/no source/) });
    expect(sourced({ value: 3, source: src, uncertainty: undefined as never })).toMatchObject({ ok: false, reason: expect.stringMatching(/no uncertainty/) });
    expect(sourced({ value: Infinity, source: src, uncertainty: { kind: 'exact', why: 'x' } })).toMatchObject({ ok: false, reason: expect.stringMatching(/not a finite number/) });
    expect(sourced({ value: NaN, source: src, uncertainty: { kind: 'exact', why: 'x' } }).ok).toBe(false);
    expect(sourced({ value: 5, source: src, uncertainty: { kind: 'interval', low: 1, high: 2 } })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside its own interval/) });
    expect(sourced({ value: 1, source: { kind: 'solver', id: '' }, uncertainty: { kind: 'exact', why: 'x' } }).ok).toBe(false);
    expect(sourced({ value: 1, source: { kind: 'feed', name: 'CoinGecko', at: '' }, uncertainty: { kind: 'exact', why: 'x' } }).ok).toBe(false);
    expect(sourced({ value: 1, source: src, uncertainty: { kind: 'unknown', reason: '' } }).ok).toBe(false);
    expect(sourced({ value: 1.5, source: src, uncertainty: { kind: 'exact', why: 'counted' }, style: 'integer' }).ok).toBe(false);
    expect(() => mustSource({ value: 1, source: src, uncertainty: undefined as never })).toThrow(/refused to show a number/);
  });

  it('formats in one place: money, CC, percent, integers, significant figures, and says the uncertainty and source in words', () => {
    const m = mustSource({ value: 1234.5, style: 'money', source: { kind: 'ledger', id: 'led_1' }, uncertainty: { kind: 'exact', why: 'ledger' } });
    expect(formatValue(m)).toBe('$1,234.50');
    expect(formatSource(m)).toBe('ledger entry led_1');
    expect(formatUncertainty(m)).toBe('exact (ledger)');
    const cc = ledgerAmount(12.5, 'led_2');
    expect(cc.ok && formatValue(cc.n)).toBe('12.5 CC');
    const s = mustSource({ value: 92.04912, unit: 'MPa', source: { kind: 'solver', id: 'structure.frame', version: '1.0.0' }, uncertainty: { kind: 'interval', low: 81.2, high: 103.9, level: 0.95 } });
    expect(formatValue(s)).toBe('92.05 MPa');
    expect(formatUncertainty(s)).toBe('81.2–103.9 MPa, 95 % range');
    expect(formatSource(s)).toBe('solver structure.frame v1.0.0');
    const p = fromProbability({ p: 0.098, low: 0.0857, high: 0.1118 }, 2000);
    expect(p.ok && formatValue(p.n)).toBe('9.8 %');
    expect(p.ok && formatUncertainty(p.n)).toBe('8.57 %–11.2 %, 95 % range');
    expect(formatValue(counted(1200, 'sales').ok ? (counted(1200, 'sales') as { n: never }).n : (null as never))).toBe('1,200');
  });

  it('adapts a solver margin: demand, capacity and utilization each carry their source', () => {
    const r = fromMargin({ check: 'M1 von Mises ≤ Fy / 2', demand: 6.6e6, capacity: 16.5e6, unit: 'Pa', basis: 'USDA Wood Handbook (MOR)' }, { id: 'structure.frame', version: '1.0.0' });
    expect(r.utilization.ok && formatValue(r.utilization.n)).toBe('40 %');
    expect(r.capacity.ok && formatSource(r.capacity.n)).toBe('USDA Wood Handbook (MOR)');
    expect(r.demand.ok && formatUncertainty(r.demand.n)).toMatch(/uncertainty unknown: a single solver run/);
    expect(fromMargin({ demand: 1, capacity: 0 }, { id: 'x' }).utilization).toMatchObject({ ok: false });
  });

  it('<SourcedNumber> shows only sourced numbers; anything else is a visible refusal, never the number', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<SourcedNumber n={{ value: 42, unit: 'kg' }} />);
    expect(screen.getByTestId('sourced-refused').textContent).toMatch(/no source/);
    expect(screen.queryByText(/42/)).toBeNull();
    rerender(<SourcedNumber n={sourced({ value: 42, source: { kind: 'user' }, uncertainty: undefined as never })} />);
    expect(screen.getByTestId('sourced-refused').textContent).toMatch(/no uncertainty/);
    rerender(<SourcedNumber n={mustSource({ value: 42, unit: 'kg', label: 'mass', source: { kind: 'solver', id: 'mass.part' }, uncertainty: { kind: 'relative', rel: 0.02 } })} showUncertainty />);
    expect(screen.getByTestId('sourced-number').textContent).toMatch(/42 kg/);
    expect(screen.getByTestId('sourced-number').textContent).toMatch(/± 2 %/);
    fireEvent.click(screen.getByRole('button', { name: /mass: computed by a solver/ }));
    expect(screen.getByTestId('sourced-detail').textContent).toMatch(/From: solver mass\.part/);
    err.mockRestore();
  });
});

describe('receipt card', () => {
  const base = { title: 'Shelf board in bending', verdict: 'pass' as const, lines: [{ label: 'stress', n: mustSource({ value: 6.6, unit: 'MPa', source: { kind: 'solver', id: 'structure.frame' }, uncertainty: { kind: 'unknown', reason: 'one run' } }) }], method: '3D frame FE', reference: 'USDA Wood Handbook' };
  it('a signed receipt shows its id and a verify link; an unsigned one says why and never looks signed', () => {
    const signed = receiptFromServer({ result: { signed: true, receiptId: 'rcpt_9', receiptUrl: '/receipts/rcpt_9' } }, base);
    const { rerender } = render(<ReceiptCard receipt={signed} />);
    expect(screen.getByTestId('receipt-signature').textContent).toMatch(/Signed receipt rcpt_9/);
    expect(screen.getByRole('link', { name: 'verify it' }).getAttribute('href')).toBe('/receipts/rcpt_9');
    expect(screen.getByTestId('receipt-verdict').textContent).toBe('Passes');
    const unsigned = receiptFromServer({ result: { signed: false, signingReason: 'llm_backed_action' } }, base);
    rerender(<ReceiptCard receipt={unsigned} />);
    expect(screen.getByTestId('receipt-signature').textContent).toMatch(/Unsigned: AI-generated answer, never signed/);
    expect(screen.queryByRole('link', { name: 'verify it' })).toBeNull();
    // "signed: true" without a receipt id is not a signature
    expect(receiptFromServer({ signed: true }, base).signed).toBe(false);
  });
});

describe('states, layout and dialog', () => {
  it('LensAsync renders exactly one honest state; empty needs a reason', () => {
    const { rerender } = render(<LensAsync status="loading" />);
    expect(screen.getByTestId('lens-loading').getAttribute('aria-busy')).toBe('true');
    rerender(<LensAsync status="error" error={{ response: { data: { message: 'quota exceeded' } } }} onRetry={() => {}} />);
    expect(screen.getByTestId('lens-error').textContent).toMatch(/quota exceeded/);
    rerender(<LensAsync status="empty" empty={{ title: 'No courses yet', why: 'You have not published one.' }} />);
    expect(screen.getByTestId('lens-empty').textContent).toMatch(/You have not published one/);
    expect(() => render(<LensAsync status="empty" />)).toThrow(/needs `empty`/);
  });

  it('LensColumns is one column on a phone and keeps every child min-w-0', () => {
    render(<LensColumns cols={3}><div>a</div><div>b</div></LensColumns>);
    const c = screen.getByTestId('lens-columns').className;
    expect(c).toMatch(/grid-cols-1/); expect(c).toMatch(/md:grid-cols-3/); expect(c).toMatch(/\[&>\*\]:min-w-0/);
  });

  it('LensTabStrip is a tablist with one Tab stop and arrow keys', () => {
    const onSelect = vi.fn();
    render(<LensTabStrip label="Rooms" active="a" onSelect={onSelect} tabs={[{ id: 'a', label: 'Write' }, { id: 'b', label: 'Produce' }, { id: 'c', label: 'Mix' }]} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('LensDialog follows the app keyboard contract: aria-modal, labelled, a Close marked for Escape, focus in and back', () => {
    function Host() {
      const [open, set] = useState(false);
      return <><button onClick={() => set(true)}>Open</button><LensDialog open={open} onClose={() => set(false)} title="Edit price"><input aria-label="Price" /></LensDialog></>;
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    act(() => { fireEvent.click(opener); });
    const dlg = screen.getByRole('dialog', { name: 'Edit price' });
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('data-overlay-close')).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText('Price'));
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('contrast contract', () => {
  it('computes WCAG ratios exactly', () => {
    // by hand: white L=1, black L=0 → (1.05)/(0.05) = 21; #767676 on white is the classic 4.54:1
    expect(contrastRatio(parseColor('#fff')!, parseColor('#000')!)).toBeCloseTo(21, 10);
    expect(Math.round(contrastRatio(parseColor('#767676')!, parseColor('#ffffff')!) * 100) / 100).toBe(4.54);
    expect(parseColor('rgb(10 20 30 / 50%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
  });

  it('the kit default tokens pass in both modes', () => {
    const css = fs.readFileSync(path.join(__dirname, '../components/lens-kit/lens-kit.css'), 'utf8');
    const r = checkLensTokens(css);
    expect(r.failures).toEqual([]);
    expect(r.modes).toEqual(['base', 'light']); // base is the app's dark default; light overrides it
  });

  it('a lens whose muted text is too faint, or that forgets a token, fails with the measured ratio', () => {
    const css = `.my-lens { --lk-surface:#ffffff; --lk-surface-raised:#ffffff; --lk-text:#111111; --lk-text-muted:#aaaaaa; --lk-accent:#1d4ed8; --lk-on-accent:#ffffff; --lk-line:#ddd; --lk-ok:#067647; --lk-warn:#93370d; }
      @media (prefers-color-scheme: dark) { .my-lens:not([data-theme='light']) { --lk-surface:#000; --lk-text: var(--lk-on-accent); } }`;
    const r = checkLensTokens(css);
    expect(r.ok).toBe(false);
    const muted = r.failures.find((f) => f.fg === '--lk-text-muted' && f.bg === '--lk-surface' && f.mode === 'base');
    expect(muted?.ratio).toBe(2.32); // #aaa on white: L = 0.4020 → 1.05 / 0.4520 = 2.32
    expect(r.failures.some((f) => f.detail === '--lk-danger is not defined')).toBe(true);
    // dark only overrides surface and text; it inherits muted #aaa on the white raised card, so it fails there too
    expect(r.failures.find((f) => f.mode === 'dark' && f.fg === '--lk-text-muted' && f.bg === '--lk-surface-raised')?.ratio).toBe(2.32);
    expect(r.modes).toEqual(['base', 'dark']);
  });
});

describe('lensCall envelope', () => {
  it('a refusal nested or at the top comes back ok:false with the server’s words; a success comes back with its result', () => {
    expect(unwrapLensResponse({ ok: true, result: { ok: false, error: 'not_found', message: 'That shelf is gone.' } })).toEqual({ ok: false, error: 'That shelf is gone.', reason: undefined, code: undefined });
    expect(unwrapLensResponse({ ok: false, error: 'forbidden', code: 'LENS_AUTH' })).toMatchObject({ ok: false, error: 'forbidden', code: 'LENS_AUTH' });
    expect(unwrapLensResponse({ ok: true, result: { ok: true, result: { items: [1] } } })).toEqual({ ok: true, result: { items: [1] } });
    expect(unwrapLensResponse({ ok: true, result: [1, 2] })).toEqual({ ok: true, result: [1, 2] });
    expect(unwrapLensResponse(undefined)).toMatchObject({ ok: false });
  });
});
