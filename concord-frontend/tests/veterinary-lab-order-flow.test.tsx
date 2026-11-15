/**
 * FIX-veterinary-009 — Lab & Imaging had only 'Attach result': an
 * order had to be faked as a pending result. The panel now has an
 * order flow on the existing substrate: placing an order saves a
 * pending record with no findings, orders list separately as
 * awaiting results, and recording a result against an order
 * replaces it.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-veterinary-009 — lab order flow', () => {
  const s = read('components/veterinary/LabPanel.tsx');

  it('places orders and lists them separately', () => {
    expect(s).toContain('Order test / study');
    expect(s).toContain('Orders awaiting results');
    expect(s).toContain("const isOrder = (r: VetLabResult) => r.flag === 'pending' && !(r.findings || '').trim();");
  });

  it('recording a result completes the order', () => {
    expect(s).toContain('Record result for this order');
    expect(s).toContain("await lensRun('veterinary', 'lab-delete', { id: fulfillingOrderId });");
  });
});
