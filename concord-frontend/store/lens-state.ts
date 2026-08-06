/**
 * Lens State Persistence Store
 *
 * Each lens page re-mounts on navigation (Next.js app router). Without
 * this store, scroll position, filters, tab selection, search query, and
 * in-flight drafts are wiped every time the user switches lenses. Users
 * lose their context constantly.
 *
 * This store keeps a snapshot of UI state per lens domain and restores
 * it when the user returns. It persists to localStorage so state
 * survives hard refreshes too.
 *
 * Persisted per lens:
 *   • scroll position     • active tab         • view mode
 *   • search query        • sort field/order   • filters
 *   • expanded sections   • selected items     • form/draft data
 *   • lens-specific       customState          • lastVisited timestamp
 *
 * NOT persisted: loading states, error states, modals, tooltips — that's
 * ephemeral UI chrome that should reset naturally.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type LensViewMode = 'grid' | 'list' | 'board';
export type LensSortOrder = 'asc' | 'desc';

export interface LensDomainState {
  scrollPosition: number;
  activeTab: string;
  filters: Record<string, unknown>;
  selectedItems: string[];
  expandedSections: string[];
  formData: Record<string, unknown>;
  viewMode: LensViewMode;
  sortBy: string;
  sortOrder: LensSortOrder;
  searchQuery: string;
  lastVisited: number;
  /** Lens-specific opaque state bag (chat history, drafts, etc.) */
  customState: Record<string, unknown>;
}

export function getDefaultLensState(): LensDomainState {
  return {
    scrollPosition: 0,
    activeTab: 'overview',
    filters: {},
    selectedItems: [],
    expandedSections: [],
    formData: {},
    viewMode: 'grid',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    searchQuery: '',
    lastVisited: Date.now(),
    customState: {},
  };
}

interface LensStateStore {
  /** Map of lens domain → persisted state snapshot. */
  lensStates: Record<string, LensDomainState>;

  /** Shallow-merge a partial state update for a given lens. */
  saveLensState: (domain: string, partial: Partial<LensDomainState>) => void;

  /** Read the full state for a lens (null if never visited). */
  getLensState: (domain: string) => LensDomainState | null;

  /** Wipe a single lens's state (e.g. after logout or reset action). */
  clearLensState: (domain: string) => void;

  /** Wipe all lens state. */
  clearAllLensStates: () => void;
}

export const useLensStateStore = create<LensStateStore>()(
  persist(
    (set, get) => ({
      lensStates: {},

      saveLensState: (domain, partial) =>
        set((state) => ({
          lensStates: {
            ...state.lensStates,
            [domain]: {
              ...(state.lensStates[domain] || getDefaultLensState()),
              ...partial,
              lastVisited: Date.now(),
            },
          },
        })),

      getLensState: (domain) => get().lensStates[domain] || null,

      clearLensState: (domain) =>
        set((state) => {
          const next = { ...state.lensStates };
          delete next[domain];
          return { lensStates: next };
        }),

      clearAllLensStates: () => set({ lensStates: {} }),
    }),
    {
      name: 'concord-lens-state',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.localStorage : (undefined as unknown as Storage),
      ),
      // Only persist the snapshot map — actions are re-created.
      partialize: (state) => ({ lensStates: state.lensStates }),
      // Keep lens states for 30 days; older entries get garbage collected
      // at rehydration time.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        const now = Date.now();
        const cleaned: Record<string, LensDomainState> = {};
        for (const [domain, snap] of Object.entries(state.lensStates)) {
          if (now - (snap.lastVisited || 0) < maxAge) {
            cleaned[domain] = snap;
          }
        }
        state.lensStates = cleaned;
      },
    },
  ),
);
