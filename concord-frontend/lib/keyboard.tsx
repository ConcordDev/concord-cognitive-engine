'use client';

import { useEffect, useCallback, createContext, useContext, useState, ReactNode } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

// Shortcut definition
export interface Shortcut {
  id: string;
  keys: string;
  description: string;
  category: 'navigation' | 'editing' | 'actions' | 'view' | 'system';
  action: () => void;
  enabled?: boolean;
  global?: boolean;
}

// Shortcut categories
export const SHORTCUT_CATEGORIES = {
  navigation: 'Navigation',
  editing: 'Editing',
  actions: 'Actions',
  view: 'View',
  system: 'System'
};

// Default shortcuts
export const DEFAULT_SHORTCUTS: Omit<Shortcut, 'action'>[] = [
  // Navigation
  { id: 'command-palette', keys: 'mod+k', description: 'Open command palette', category: 'navigation', global: true },
  { id: 'quick-capture', keys: 'mod+shift+n', description: 'Quick capture DTU', category: 'navigation', global: true },
  { id: 'search', keys: 'mod+/', description: 'Focus search', category: 'navigation', global: true },
  { id: 'go-home', keys: 'mod+shift+h', description: 'Go to dashboard', category: 'navigation', global: true },
  { id: 'go-graph', keys: 'mod+shift+g', description: 'Go to graph', category: 'navigation', global: true },
  { id: 'go-chat', keys: 'mod+shift+c', description: 'Go to chat', category: 'navigation', global: true },
  { id: 'toggle-sidebar', keys: 'mod+b', description: 'Toggle sidebar', category: 'navigation', global: true },
  { id: 'next-lens', keys: 'mod+]', description: 'Next lens', category: 'navigation', global: true },
  { id: 'prev-lens', keys: 'mod+[', description: 'Previous lens', category: 'navigation', global: true },

  // Editing
  { id: 'undo', keys: 'mod+z', description: 'Undo', category: 'editing', global: true },
  { id: 'redo', keys: 'mod+shift+z', description: 'Redo', category: 'editing', global: true },
  { id: 'save', keys: 'mod+s', description: 'Save', category: 'editing' },
  { id: 'bold', keys: 'mod+b', description: 'Bold text', category: 'editing' },
  { id: 'italic', keys: 'mod+i', description: 'Italic text', category: 'editing' },
  { id: 'link', keys: 'mod+shift+l', description: 'Insert link', category: 'editing' },
  { id: 'code', keys: 'mod+e', description: 'Inline code', category: 'editing' },

  // Actions
  { id: 'forge-dtu', keys: 'mod+enter', description: 'Forge new DTU', category: 'actions' },
  { id: 'delete', keys: 'mod+backspace', description: 'Delete selected', category: 'actions' },
  { id: 'duplicate', keys: 'mod+d', description: 'Duplicate', category: 'actions' },
  { id: 'archive', keys: 'mod+shift+a', description: 'Archive', category: 'actions' },
  { id: 'export', keys: 'mod+shift+e', description: 'Export', category: 'actions' },

  // View
  { id: 'toggle-focus', keys: 'mod+.', description: 'Toggle focus mode', category: 'view', global: true },
  { id: 'zoom-in', keys: 'mod+=', description: 'Zoom in', category: 'view' },
  { id: 'zoom-out', keys: 'mod+-', description: 'Zoom out', category: 'view' },
  { id: 'zoom-reset', keys: 'mod+0', description: 'Reset zoom', category: 'view' },
  { id: 'toggle-theme', keys: 'mod+shift+t', description: 'Toggle theme', category: 'view', global: true },
  { id: 'split-pane', keys: 'mod+\\', description: 'Split pane', category: 'view' },

  // System
  { id: 'help', keys: 'mod+?', description: 'Show keyboard shortcuts', category: 'system', global: true },
  { id: 'settings', keys: 'mod+,', description: 'Open settings', category: 'system', global: true },
  { id: 'escape', keys: 'escape', description: 'Close/Cancel', category: 'system', global: true },
];

// Context for keyboard shortcuts
interface KeyboardContextType {
  shortcuts: Shortcut[];
  registerShortcut: (shortcut: Shortcut) => void;
  unregisterShortcut: (id: string) => void;
  isShortcutEnabled: (id: string) => boolean;
  enableShortcut: (id: string) => void;
  disableShortcut: (id: string) => void;
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

const KeyboardContext = createContext<KeyboardContextType | null>(null);

export function KeyboardProvider({ children }: { children: ReactNode }) {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  const registerShortcut = useCallback((shortcut: Shortcut) => {
    setShortcuts(prev => {
      const existing = prev.findIndex(s => s.id === shortcut.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = shortcut;
        return updated;
      }
      return [...prev, shortcut];
    });
  }, []);

  const unregisterShortcut = useCallback((id: string) => {
    setShortcuts(prev => prev.filter(s => s.id !== id));
  }, []);

  const isShortcutEnabled = useCallback((id: string) => {
    const shortcut = shortcuts.find(s => s.id === id);
    return shortcut?.enabled !== false;
  }, [shortcuts]);

  const enableShortcut = useCallback((id: string) => {
    setShortcuts(prev => prev.map(s =>
      s.id === id ? { ...s, enabled: true } : s
    ));
  }, []);

  const disableShortcut = useCallback((id: string) => {
    setShortcuts(prev => prev.map(s =>
      s.id === id ? { ...s, enabled: false } : s
    ));
  }, []);

  return (
    <KeyboardContext.Provider value={{
      shortcuts,
      registerShortcut,
      unregisterShortcut,
      isShortcutEnabled,
      enableShortcut,
      disableShortcut,
      showHelp,
      setShowHelp
    }}>
      {children}
      {showHelp && <KeyboardShortcutsModal onClose={() => setShowHelp(false)} />}
    </KeyboardContext.Provider>
  );
}

export function useKeyboard() {
  const context = useContext(KeyboardContext);
  if (!context) {
    throw new Error('useKeyboard must be used within KeyboardProvider');
  }
  return context;
}

// Hook to register a shortcut
export function useShortcut(
  id: string,
  keys: string,
  action: () => void,
  options: Partial<Omit<Shortcut, 'id' | 'keys' | 'action'>> = {}
) {
  const { registerShortcut, unregisterShortcut, isShortcutEnabled } = useKeyboard();

  const description = options.description || id;
  const category = options.category || 'actions';
  const enabled = options.enabled ?? true;
  const global = options.global ?? false;

  useEffect(() => {
    registerShortcut({
      id,
      keys,
      action,
      description,
      category,
      enabled,
      global
    });

    return () => unregisterShortcut(id);
  }, [id, keys, action, description, category, enabled, global, registerShortcut, unregisterShortcut]);

  useHotkeys(keys, (e) => {
    if (isShortcutEnabled(id)) {
      e.preventDefault();
      action();
    }
  }, {
    enableOnFormTags: options.global ? ['INPUT', 'TEXTAREA', 'SELECT'] : [],
    enabled: options.enabled ?? true
  });
}

// Global shortcuts hook
export function useGlobalShortcuts(handlers: Record<string, () => void>) {
  const { setShowHelp } = useKeyboard();

  // Help modal — both `?` (GitHub / Slack / Linear idiom, when not in a
  // text input) and `mod+?` (universal escape hatch from inside an input).
  useHotkeys('mod+?', (e) => {
    e.preventDefault();
    setShowHelp(true);
  });
  useHotkeys('shift+/', (e) => {
    e.preventDefault();
    setShowHelp(true);
  });

  // Escape to close
  useHotkeys('escape', (e) => {
    if (handlers.escape) {
      e.preventDefault();
      handlers.escape();
    }
  });

  // Navigation
  useHotkeys('mod+k', (e) => {
    e.preventDefault();
    handlers['command-palette']?.();
  });

  useHotkeys('mod+shift+n', (e) => {
    e.preventDefault();
    handlers['quick-capture']?.();
  });

  useHotkeys('mod+b', (e) => {
    e.preventDefault();
    handlers['toggle-sidebar']?.();
  });

  // Undo/Redo
  useHotkeys('mod+z', (e) => {
    e.preventDefault();
    handlers.undo?.();
  });

  useHotkeys('mod+shift+z', (e) => {
    e.preventDefault();
    handlers.redo?.();
  });

  // Focus mode
  useHotkeys('mod+.', (e) => {
    e.preventDefault();
    handlers['toggle-focus']?.();
  });
}

// Keyboard shortcuts help modal
function KeyboardShortcutsModal({ onClose }: { onClose: () => void }) {
  const { shortcuts } = useKeyboard();

  // Group by category
  const grouped = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) acc[shortcut.category] = [];
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, Shortcut[]>);

  // Format key display
  const formatKey = (keys: string) => {
    return keys
      .replace('mod', navigator.platform.includes('Mac') ? '⌘' : 'Ctrl')
      .replace('shift', '⇧')
      .replace('alt', '⌥')
      .replace('enter', '↵')
      .replace('backspace', '⌫')
      .replace('escape', 'Esc')
      .replace('+', ' + ')
      .toUpperCase();
  };

  useHotkeys('escape', onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-lattice-bg border border-lattice-border rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-lattice-border">
          <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-lattice-surface text-gray-400 hover:text-white"
          >
            <span className="sr-only">Close</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
          {Object.entries(SHORTCUT_CATEGORIES).map(([key, label]) => (
            <div key={key} className="mb-6 last:mb-0">
              <h3 className="text-sm font-medium text-neon-cyan mb-3">{label}</h3>
              <div className="space-y-2">
                {(grouped[key] || DEFAULT_SHORTCUTS.filter(s => s.category === key)).map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-lattice-surface/50"
                  >
                    <span className="text-gray-300">{shortcut.description}</span>
                    <kbd className="px-2 py-1 text-xs font-mono bg-lattice-surface border border-lattice-border rounded text-gray-400">
                      {formatKey(shortcut.keys)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { KeyboardShortcutsModal };
