import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { IncidentConsole } from './IncidentConsole';

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async () => ({ ok: true, incidents: [], alerts: [], services: [], edges: [], policies: [], analytics: null, status: null, onCall: null, currentOnCall: null })),
}));

vi.mock('@/components/viz', () => ({
  ChartKit: () => null,
  TimelineView: () => null,
  TreeDiagram: () => null,
}));

const SUBTABS = ['Incidents', 'Alerts', 'Services', 'On-call', 'Escalation', 'Analytics', 'Status page'];

describe('IncidentConsole sub-tab bar (FIX-ops-008, mobile 390)', () => {
  it('keeps all seven sub-tabs on one scrollable row instead of wrapping', () => {
    render(<IncidentConsole />);
    const nav = screen.getByRole('navigation', { name: 'Incident workbench views' });
    expect(nav.className).toContain('flex-nowrap');
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).toContain('no-scrollbar');
    expect(nav.className).not.toContain('flex-wrap');
    for (const label of SUBTABS) {
      const btn = screen.getByRole('button', { name: new RegExp(label, 'i') });
      expect(btn.className).toContain('shrink-0');
      expect(btn.className).toContain('whitespace-nowrap');
    }
  });

  it('sub-tab buttons meet the 40px touch floor', () => {
    render(<IncidentConsole />);
    for (const label of SUBTABS) {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') }).className).toContain('min-h-10');
    }
  });

  it('clicking a sub-tab still switches the workbench view', () => {
    render(<IncidentConsole />);
    fireEvent.click(screen.getByRole('button', { name: /alerts/i }));
    // The alerts view mounts its ingest affordance; the incidents declare
    // form (incidents view) unmounts.
    expect(screen.queryByPlaceholderText('incident title')).toBeNull();
  });
});
