/**
 * Name-length honesty genus guard (CB-0483) — FIX-alliance-003,
 * FIX-crisis-ops-008, FIX-custom-005, FIX-database-002, FIX-sandbox-004.
 *
 * Each field accepted names far past the limit that actually governs
 * it: the API's name limit (200), a panel's own silent slice (120),
 * or a domain's silent slice (80, 80, 60). The stored name came back
 * truncated or the create died at the API, with no cap, no counter,
 * and no word at the field. The pins hold each field's honest cap —
 * read from the governing code, never invented — and its counter.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel: string) =>
  fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('alliance-003: the alliance name carries the API name limit', () => {
  const src = read('components/alliance/AllianceWorkspace.tsx');
  it('caps at 200 with a counter', () => {
    expect(src).toContain('maxLength={200}');
    expect(src).toContain('{newAllianceName.length}/200');
  });
});

describe('crisis-ops-008: the report title carries the panel\u2019s own 120 cap visibly', () => {
  const src = read('components/crisis-ops/IncidentReportPanel.tsx');
  it('caps at 120 with a counter (the submit slice becomes a backstop)', () => {
    expect(src).toContain('maxLength={120}');
    expect(src).toContain('{title.length}/120');
  });
});

describe('custom-005: the lens name carries the domain\u2019s stored 80', () => {
  const src = read('components/custom/CanvasBuilder.tsx');
  it('caps at 80 with a counter', () => {
    expect(src).toContain('maxLength={80}');
    expect(src).toContain('{newName.length}/80');
  });
});

describe('database-002: the connection name carries the domain\u2019s cleaned 80', () => {
  const src = read('components/database/LiveDbClient.tsx');
  it('caps at 80 with a counter', () => {
    expect(src).toContain('maxLength={80}');
    expect(src).toContain('{connForm.name.length}/80');
  });
});

describe('sandbox-004: the loadout name carries the domain\u2019s 60 and speaks its message', () => {
  const src = read('components/sandbox/LoadoutPicker.tsx');
  it('caps at 60 with a counter, and the save failure prefers the worded message', () => {
    expect(src).toContain('maxLength={60}');
    expect(src).toContain('{name.length}/60');
    expect(src).toContain('?.message || r.data?.error');
  });
});
