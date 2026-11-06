// Declaration + surface pins for the daily full lens build (F-B row 3).
//
// The lens's declaration already stood (manifest REAL_LIVE + registry
// REAL_LIVE), so these pins assert the scoped honest caption over the
// generic line, the merged read-back's surface marks (Today entries
// badged in Studio, edited only there), the labelled reminder lifecycle
// (Mark done / Completed / Restore / two-step delete), the past-due
// refusal, the in-place Save Entry, and the full own-records export.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useDepthBadge } from '@/hooks/useDepthBadge';

const ROOT = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('daily declarations', () => {
  it('manifest keeps daily at REAL_LIVE', () => {
    expect(getLensManifest('daily')?.dataTier).toBe('REAL_LIVE');
  });

  it('depth badge carries the scoped two-store caption', () => {
    const { result } = renderHook(() => useDepthBadge('daily'));
    expect(result.current.label).toBe('Live');
    expect(result.current.caption).toContain('Today and Studio read the same days from both of its stores');
    expect(result.current.caption).toContain('ZenQuotes');
    expect(result.current.caption).not.toContain('polled live from an external source');
  });

  it('integration registry agrees: daily is REAL_LIVE from substrate', () => {
    const registry = read('../server/lib/integration-registry.js');
    const line = registry.split('\n').find((l) => /^\s*daily:\s*\{/.test(l));
    expect(line).toBeTruthy();
    expect(line).toContain('TIER.REAL_LIVE');
    expect(line).toContain('liveFromSubstrate: true');
  });
});

describe('daily surface pins', () => {
  const studio = read('components/daily/JournalStudio.tsx');
  const today = read('components/daily/DailyTodayPanel.tsx');

  it('Studio badges Today-sourced entries and withholds their edit controls (D1)', () => {
    expect(studio).toContain("e.source === 'today'");
    expect(studio).toContain('from Today — edit it there');
    expect(studio).toContain("e.source !== 'today'");
  });

  it('Studio offers the full own-records export beside the Studio archive (D4)', () => {
    expect(studio).toContain("'export-journal'");
    expect(studio).toContain('Export my journal');
  });

  it('Save Entry updates the day in place instead of minting a copy (D3/F3)', () => {
    expect(today).toContain('updateEntry(entryForDate.id');
  });

  it('reminders: complete is a labelled act, completed rows stay visible + restorable (D5/F6)', () => {
    expect(today).toContain('Mark done');
    expect(today).toContain('Completed');
    expect(today).toContain('Restore');
    expect(today).not.toContain('aria-label="Check circle2"');
  });

  it('reminders: delete is its own two-step act, separate from complete (D5/F6)', () => {
    expect(today).toContain('Delete? Click again');
    expect(today).toContain('handleDeleteReminder');
  });

  it('past-due reminders are refused in words and pending past-dues read OVERDUE (D5/F7)', () => {
    expect(today).toContain('That time has already passed');
    expect(today).toContain('OVERDUE');
  });
});
