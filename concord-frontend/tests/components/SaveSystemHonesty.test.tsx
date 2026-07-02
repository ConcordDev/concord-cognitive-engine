import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SaveSystem from '@/components/world-lens/SaveSystem';

/**
 * G1 — SaveSystem honesty (gap-closure plan).
 *
 * The save surface previously seeded status:'saved' + lastSaved:now BEFORE
 * /api/save/status resolved, and the component's header hardcoded
 * "All changes saved" whenever it wasn't actively saving — so the page
 * claimed a green saved state it had not verified. The header is now a pure
 * function of the subsystem statuses in props: pending → checking, error →
 * unavailable, all-saved → saved. Timestamps render only when real.
 */

const subs = (status: 'saved' | 'saving' | 'pending' | 'error') => ([
  { name: 'Player inventory', status, lastSaved: status === 'saved' ? '2026-07-02T10:00:00Z' : '—' },
  { name: 'World buildings', status, lastSaved: status === 'saved' ? '2026-07-02T10:00:00Z' : '—' },
]);

describe('SaveSystem — honest header derived from real subsystem statuses', () => {
  it('pending subsystems → "Checking save status…", never a green saved claim', () => {
    render(
      <SaveSystem
        saveState={{ autoSaving: false, lastSaveTime: '', subsystems: subs('pending') }}
        offlineCalcs={null}
        worldPersistence={{ entries: [] }}
      />
    );
    expect(screen.getByText(/Checking save status/)).toBeInTheDocument();
    expect(screen.queryByText(/All changes saved/)).toBeNull();
    // No fabricated timestamp line when lastSaveTime is empty.
    expect(screen.queryByText(/Last saved:/)).toBeNull();
  });

  it('errored subsystems → "Save status unavailable" (unknown is not saved)', () => {
    render(
      <SaveSystem
        saveState={{ autoSaving: false, lastSaveTime: '', subsystems: subs('error') }}
        offlineCalcs={null}
        worldPersistence={{ entries: [] }}
      />
    );
    expect(screen.getByText(/Save status unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/All changes saved/)).toBeNull();
  });

  it('all subsystems genuinely saved → "All changes saved" + the real timestamp', () => {
    render(
      <SaveSystem
        saveState={{ autoSaving: false, lastSaveTime: '2026-07-02T10:00:00Z', subsystems: subs('saved') }}
        offlineCalcs={null}
        worldPersistence={{ entries: [] }}
      />
    );
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.getByText(/Last saved: 2026-07-02T10:00:00Z/)).toBeInTheDocument();
  });

  it('autoSaving wins the header regardless of subsystem state', () => {
    render(
      <SaveSystem
        saveState={{ autoSaving: true, lastSaveTime: '', subsystems: subs('pending') }}
        offlineCalcs={null}
        worldPersistence={{ entries: [] }}
      />
    );
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });
});
