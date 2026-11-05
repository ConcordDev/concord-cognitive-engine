/**
 * lib/creative/dashboard-bus — tiny window-CustomEvent pub/sub that lets
 * mutation call sites (ProductionSuite tabs, CreativeBoardsSection) tell
 * CreativeDashboardStrip its headline stats are stale (F8 fix).
 */

import { describe, it, expect, vi } from 'vitest';
import { notifyCreativeDashboardDirty, onCreativeDashboardDirty } from '@/lib/creative/dashboard-bus';

describe('creative dashboard-bus', () => {
  it('invokes a subscribed handler when dirty is notified', () => {
    const handler = vi.fn();
    const unsubscribe = onCreativeDashboardDirty(handler);
    notifyCreativeDashboardDirty();
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('stops invoking the handler after unsubscribe', () => {
    const handler = vi.fn();
    const unsubscribe = onCreativeDashboardDirty(handler);
    unsubscribe();
    notifyCreativeDashboardDirty();
    expect(handler).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscribers', () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = onCreativeDashboardDirty(a);
    const unsubB = onCreativeDashboardDirty(b);
    notifyCreativeDashboardDirty();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    unsubA(); unsubB();
  });
});
