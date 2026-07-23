/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Repair Cortex discoverability pass (audit item #22) — pins the admin
 * gate added to RepairPanel.tsx: reading status stays open to any
 * authenticated viewer, but "Force Repair Cycle" (a system-wide mutating
 * action, not per-user) is restricted to admin/sovereign roles using the
 * same real `useUIStore.userRole` primitive `lib/lens-registry.ts#isLensVisible`
 * already uses to hide the admin/command-center lenses — not a fabricated
 * gate invented for this panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const fullStatus = vi.fn();
const forceCycle = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    repairExtended: {
      fullStatus: (...args: unknown[]) => fullStatus(...args),
      forceCycle: (...args: unknown[]) => forceCycle(...args),
    },
  },
}));

const { getRole, setRole, addToast } = vi.hoisted(() => {
  let role = 'user';
  return {
    getRole: () => role,
    setRole: (r: string) => {
      role = r;
    },
    addToast: vi.fn(),
  };
});

vi.mock('@/store/ui', () => {
  const state = {
    addToast,
    get userRole() {
      return getRole();
    },
  };
  const useUIStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useUIStore };
});

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const overrides: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    if (key[0] >= 'A' && key[0] <= 'Z' && key !== 'createLucideIcon' && key !== 'default') {
      overrides[key] = make(key);
    }
  }
  return { ...actual, ...overrides };
});

vi.mock('@/components/common/ErrorBoundary', () => ({
  withErrorBoundary: (C: React.ComponentType) => C,
}));

import { RepairPanel } from '@/components/emergent/RepairPanel';

describe('RepairPanel — admin gate on Force Repair Cycle', () => {
  beforeEach(() => {
    fullStatus.mockReset();
    forceCycle.mockReset();
    addToast.mockReset();
    setRole('user');
    fullStatus.mockResolvedValue({
      data: {
        ok: true,
        loopRunning: true,
        cycleCount: 3,
        lastCycleResult: { patternsChecked: 5, fixesApplied: 1 },
        errorAccumulator: { size: 0 },
        executors: { a: { canApply: true } },
      },
    });
  });

  it('renders repair status for any viewer (read is not gated)', async () => {
    render(<RepairPanel />);
    await waitFor(() => expect(screen.getByText('Repair Cortex')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('shows the force-cycle control disabled + admin-only for a non-admin role', async () => {
    setRole('user');
    render(<RepairPanel />);
    await waitFor(() => expect(screen.getByText(/Force Repair Cycle/)).toBeInTheDocument());
    const btn = screen.getByText(/Force Repair Cycle/).closest('button')!;
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/admin only/i);
  });

  it('enables the force-cycle control for an admin role', async () => {
    setRole('admin');
    render(<RepairPanel />);
    await waitFor(() => expect(screen.getByText('Force Repair Cycle')).toBeInTheDocument());
    const btn = screen.getByText('Force Repair Cycle').closest('button')!;
    expect(btn).not.toBeDisabled();
  });

  it('enables the force-cycle control for a sovereign role', async () => {
    setRole('sovereign');
    render(<RepairPanel />);
    await waitFor(() => expect(screen.getByText('Force Repair Cycle')).toBeInTheDocument());
    const btn = screen.getByText('Force Repair Cycle').closest('button')!;
    expect(btn).not.toBeDisabled();
  });
});
