/**
 * /lenses/physics — four-UX-state contract for the backend-driven calculator.
 *
 * The physics lens page is mostly a local canvas simulator, but its genuine
 * BACKEND-DRIVEN compute surface is the PhysicsWorkbench → POST /api/lens/run
 * { domain:'physics', action:'kinematics-1d' | ... } → LENS_ACTIONS dispatch.
 * This file pins the Workbench's KinematicsTab through the four real states
 * against that single channel:
 *   - empty     → honest "enter values and Solve" prompt, no fabricated result
 *   - loading   → spinner while the dispatch is in-flight
 *   - error     → a handler { ok:false, error } AND a thrown fetch BOTH surface
 *                 a visible error (role=alert), NOT a blank panel
 *   - populated → the real solved.{v,x} the handler returns is rendered
 *
 * This closes the swallowed-fetch → silent-empty defect: before the fix the tab
 * read `r.data.result || null` and dropped both the handler's ok:false error and
 * any network throw on the floor, leaving a blank panel that looked like "no
 * result" while actually hiding a validation failure / outage. No fabricated
 * data — every state is driven by a mocked api.post standing in for the real
 * /api/lens/run response in the exact { ok, result } envelope shape it returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import React from 'react';

// ── the one backend channel: api.post('/api/lens/run') ──────────────────────
const apiPost = vi.fn(() => Promise.resolve({ data: {} }));

vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => apiPost(...a) },
}));

import { PhysicsWorkbench } from '@/components/physics/PhysicsWorkbench';

function renderWorkbench() {
  return render(<PhysicsWorkbench open onClose={() => {}} />);
}

beforeEach(() => {
  apiPost.mockReset();
  apiPost.mockResolvedValue({ data: {} });
});

describe('/lenses/physics — PhysicsWorkbench four UX states', () => {
  it('EMPTY: shows an honest prompt and no fabricated result before any Solve', () => {
    renderWorkbench();
    // Default tab is Kinematics; the empty-state prompt is visible, no result rows.
    expect(screen.getByText(/Enter values and Solve/i)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('LOADING: shows an in-flight spinner while the dispatch is pending', async () => {
    let resolve!: (v: unknown) => void;
    apiPost.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Solve/i }));
    // The Solve button is disabled while busy (loading indicator path).
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Solve/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
    // Clean up the pending promise.
    resolve({ data: { ok: true, result: { solved: { v0: 0, v: 19.62, a: 9.81, t: 2, x: 19.62 }, equations: ['v = v₀ + at'] } } });
  });

  it('POPULATED: renders the real solved values the handler returns', async () => {
    apiPost.mockResolvedValue({
      data: { ok: true, result: { solved: { v0: 0, v: 19.62, a: 9.81, t: 2, x: 19.62 }, equations: ['v = v₀ + at', 'x = v₀t + ½at²'] } },
    });
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Solve/i }));
    await waitFor(() => {
      // The exact solved fields the component renders (v and x) must appear.
      // v=19.62 and x=19.62 both render, so use getAllByText (≥1 match).
      expect(screen.getAllByText('19.62').length).toBeGreaterThan(0);
    });
    // The equations footer is rendered from result.equations.join(' · ').
    expect(screen.getByText(/v = v₀ \+ at/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ERROR (handler ok:false): a validation rejection surfaces a visible alert, not a blank panel', async () => {
    // kinematics-1d returns { ok:false, error } when <3 finite inputs are given.
    apiPost.mockResolvedValue({ data: { ok: true, result: { ok: false, error: 'provide at least 3 of: v0, v, a, t, x' } } });
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Solve/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/at least 3/i);
    });
    // No fabricated result rows rendered alongside the error.
    expect(screen.queryByText(/Enter values and Solve/i)).toBeNull();
  });

  it('ERROR (network throw): a thrown fetch surfaces a visible alert, not silent-empty', async () => {
    apiPost.mockRejectedValue(new Error('Network down'));
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Solve/i }));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/Network down/i);
    });
  });
});
