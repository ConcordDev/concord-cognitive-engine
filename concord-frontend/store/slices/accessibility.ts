import type { StateCreator } from 'zustand';

export type ColorblindMode =
  | 'none'
  | 'protanopia'
  | 'deuteranopia'
  | 'tritanopia'
  | 'achromatopsia';

export type OneHandedMode = 'off' | 'left' | 'right';

export interface AccessibilitySettings {
  colorblindMode: ColorblindMode;
  textScale: number;
  screenReader: boolean;
  keyboardNavigation: boolean;
  reducedMotion: boolean;
  subtitles: boolean;
  subtitleFontSize: number;
  oneHandedMode: OneHandedMode;
  gameSpeed: number;
  highContrast: boolean;
}

export interface AccessibilitySlice {
  accessibility: AccessibilitySettings;
  osReducedMotion: boolean;
  setAccessibility: <K extends keyof AccessibilitySettings>(
    key: K,
    value: AccessibilitySettings[K]
  ) => void;
  setAllAccessibility: (next: Partial<AccessibilitySettings>) => void;
  setOsReducedMotion: (v: boolean) => void;
  resetAccessibility: () => void;
}

export const ACCESSIBILITY_DEFAULTS: AccessibilitySettings = {
  colorblindMode: 'none',
  textScale: 1.0,
  screenReader: false,
  keyboardNavigation: false,
  reducedMotion: false,
  subtitles: true,
  subtitleFontSize: 16,
  oneHandedMode: 'off',
  gameSpeed: 1.0,
  highContrast: false,
};

export const createAccessibilitySlice: StateCreator<
  AccessibilitySlice,
  [],
  [],
  AccessibilitySlice
> = (set) => ({
  accessibility: ACCESSIBILITY_DEFAULTS,
  osReducedMotion: false,
  setAccessibility: (key, value) =>
    set((state) => ({
      accessibility: { ...state.accessibility, [key]: value },
    })),
  setAllAccessibility: (next) =>
    set((state) => ({ accessibility: { ...state.accessibility, ...next } })),
  setOsReducedMotion: (v) => set({ osReducedMotion: v }),
  resetAccessibility: () => set({ accessibility: ACCESSIBILITY_DEFAULTS }),
});
