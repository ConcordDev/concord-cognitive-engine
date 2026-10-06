// Pins the Aviation header chip, empty-state copy and the EFB filing panel's
// honesty. Aircraft, logbook, plans and filing records are the user's own
// persisted records, so the lens must not be labelled DEMO; the manifest must
// only advertise macros the server really registers; and the filing panel must
// say plainly that sending to ATC is not supported yet (no "simulated" filing,
// no "File with ATC" button).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const m = getLensManifest('aviation');

describe('Aviation manifest honesty', () => {
  it('is on the real-data tier with a "Real" chip, not DEMO', () => {
    expect(m?.dataTier).toBe('REAL_FREE');
    const badge = renderHook(() => useDepthBadge('aviation')).result.current;
    expect(badge?.label).toBe('Real');
  });

  it('does not claim maritime or ATC filing; says they are not supported yet', () => {
    expect(m?.label).toBe('Aviation');
    const copy = JSON.stringify([m?.emptyState, m?.firstRunGuide]);
    expect(copy).not.toMatch(/DEMO|regulatoryCompliance|audit pack/);
    expect(m?.emptyState?.caption).toMatch(/ATC and maritime .* aren't supported yet/);
  });

  it('every advertised action is registered by server/domains/aviation.js', () => {
    const src = readFileSync(join(__dirname, '../../server/domains/aviation.js'), 'utf8');
    for (const a of m?.actions || []) {
      expect(src, a).toContain(`"aviation", "${a}"`);
    }
    for (const gone of ['crewSchedule', 'regulatoryCompliance', 'weightBalance', 'flightPlan', 'slipUtilization']) {
      expect(m?.actions || []).not.toContain(gone);
    }
  });
});

describe('EFB filing panel honesty', () => {
  const src = readFileSync(join(__dirname, '../components/aviation/EFBFiling.tsx'), 'utf8');
  const suite = readFileSync(join(__dirname, '../components/aviation/EFBSuite.tsx'), 'utf8');
  it('has no simulated-filing caption or "File with ATC" button', () => {
    expect(src).not.toMatch(/Simulated DUATS|File with ATC/);
    expect(suite).not.toContain("'ATC filing'");
  });
  it('labels ATC submission as not supported yet', () => {
    expect(src).toContain('data-testid="efb-filing-not-supported"');
    expect(src).toMatch(/Sending to ATC isn&apos;t supported yet/);
    expect(src).toContain('Save filing record');
  });
});
