import type { StateCreator } from 'zustand';

export interface LayoutSlice {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  commandPaletteOpen: boolean;
  theme: 'dark' | 'light';
  fullPageMode: boolean;
  // Viewport height covered by the PWA install banner while it is showing
  // (px, measured from the banner's real rect — includes the bottom-bar +
  // safe-area clearance it sits above). 0 when hidden/dismissed. Published
  // by InstallPrompt so floating chrome can keep clear of the banner
  // (HelpButton) and <main> can reserve matching scroll padding (AppShell).
  installBannerFootprint: number;

  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setFullPageMode: (mode: boolean) => void;
  setInstallBannerFootprint: (px: number) => void;
}

export const createLayoutSlice: StateCreator<LayoutSlice, [], [], LayoutSlice> = (set) => ({
  sidebarOpen: false,
  // Thin icon rail by default (lens north stars); users can still expand it.
  sidebarCollapsed: true,
  commandPaletteOpen: false,
  theme: 'dark',
  fullPageMode: false,
  installBannerFootprint: 0,

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  setTheme: (theme) => set({ theme }),
  setFullPageMode: (mode) => set({ fullPageMode: mode }),
  setInstallBannerFootprint: (px) => set({ installBannerFootprint: Math.max(0, Math.round(px)) }),
});
