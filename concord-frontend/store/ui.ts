/**
 * FE-009: UI State Store — Zustand (client-only, ephemeral + persisted subset).
 *
 * Composed from focused slices for maintainability:
 *   - layout  — sidebar, command palette, theme, fullPageMode
 *   - toast   — transient notifications
 *   - lens    — active lens tracking
 *   - status  — request errors, auth posture, user role
 *
 * STATE OWNERSHIP BOUNDARIES:
 * ┌──────────────────────────────────────────────────────┐
 * │ Zustand (this store)                                 │
 * │  - UI chrome state (sidebar, palette, theme)         │
 * │  - Ephemeral: toasts, fullPageMode                   │
 * │  - Persisted to localStorage: sidebarCollapsed,      │
 * │    theme, activeLens                                 │
 * ├──────────────────────────────────────────────────────┤
 * │ React Query (TanStack Query)                         │
 * │  - Server data (DTUs, status, resonance, etc.)       │
 * │  - Cached with staleTime / refetchInterval           │
 * │  - Source of truth = backend API                     │
 * ├──────────────────────────────────────────────────────┤
 * │ Dexie / IndexedDB (lib/offline/db.ts)                │
 * │  - Offline persistence of DTUs and chat              │
 * │  - Pending sync queue                                │
 * │  - Source of truth = local when offline, server when  │
 * │    online (sync on reconnect)                        │
 * └──────────────────────────────────────────────────────┘
 *
 * RULE: Never duplicate server data in Zustand.
 * Use React Query for anything that comes from the API.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { createLayoutSlice, type LayoutSlice } from './slices/layout';
import { createToastSlice, type ToastSlice, type Toast } from './slices/toast';
import { createLensSlice, type LensSlice } from './slices/lens';
import {
  createStatusSlice,
  type StatusSlice,
  type RequestError,
  type AuthPosture,
} from './slices/status';
import {
  createAccessibilitySlice,
  type AccessibilitySlice,
  type AccessibilitySettings,
  type ColorblindMode,
  type OneHandedMode,
} from './slices/accessibility';

// Combined state type
export type UIState = LayoutSlice & ToastSlice & LensSlice & StatusSlice & AccessibilitySlice;

// Re-export slice types for direct consumer use
export type { LayoutSlice, ToastSlice, LensSlice, StatusSlice, AccessibilitySlice };
export type { Toast, RequestError, AuthPosture };
export type { AccessibilitySettings, ColorblindMode, OneHandedMode };

export const useUIStore = create<UIState>()(
  persist(
    (...a) => ({
      ...createLayoutSlice(...a),
      ...createToastSlice(...a),
      ...createLensSlice(...a),
      ...createStatusSlice(...a),
      ...createAccessibilitySlice(...a),
    }),
    {
      name: 'concord-ui-store',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        activeLens: state.activeLens,
        accessibility: state.accessibility,
      }),
    },
  ),
);
