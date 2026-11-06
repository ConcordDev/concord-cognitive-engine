/**
 * Creative fix return (F5 re-pass form) — source pins (vitest on the Mac
 * lane; node:test fallback via run-vitest-as-node). The package mint
 * consults the caller's standing package BEFORE creating: a repeat
 * mint resolves to the existing DTU ("Already minted") instead of
 * re-firing a create the platform dedup gate must refuse with
 * duplicate_blocked, and a refusal that still occurs is named honestly
 * instead of the bare "No DTU id.".
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const panel = fs.readFileSync(
  path.resolve(__dirname, '../components/creative/CreativeActionPanel.tsx'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(__dirname, '../../server/domains/creative.js'),
  'utf8',
);

describe('creative package mint — caller-scoped idempotence (F5)', () => {
  it('the server registers the packageStatus verb keyed on the mint source + creator', () => {
    expect(domain).toContain('registerLensAction("creative", "packageStatus"');
    expect(domain).toContain('d.source === "creative:pkg:mint"');
    expect(domain).toContain('d.creatorId === userId');
  });

  it('actMint consults packageStatus before any dtu.create', () => {
    const statusAt = panel.indexOf("callMacro<{ minted: boolean; dtuId?: string }>('packageStatus', {})");
    const createAt = panel.indexOf("source: 'creative:pkg:mint'");
    expect(statusAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(statusAt);
  });

  it('a standing package is named as already minted, with its id', () => {
    expect(panel).toContain('Already minted · DTU');
    expect(panel).toContain('st.result.dtuId');
  });

  it('a duplicate_blocked refusal is surfaced in words, not as a bare missing id', () => {
    expect(panel).toContain("'duplicate_blocked'");
    expect(panel).toContain('A package titled "Production pkg" already exists.');
  });
});
