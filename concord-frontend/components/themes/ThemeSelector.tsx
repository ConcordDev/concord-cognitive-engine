'use client';

import { useState } from 'react';
import {
  Palette,
  Check,
  Moon,
  Sun,
  Monitor,
  Download,
  Upload,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Theme {
  id: string;
  name: string;
  author?: string;
  colors: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    textSecondary: string;
    accent: string;
    accentSecondary: string;
  };
  isBuiltIn?: boolean;
}

const BUILT_IN_THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Concord Dark',
    colors: {
      bg: '#0a0a0f',
      surface: '#12121a',
      border: '#1f1f2e',
      text: '#ffffff',
      textSecondary: '#9ca3af',
      accent: '#00f5d4',
      accentSecondary: '#a855f7'
    },
    isBuiltIn: true
  },
  {
    id: 'light',
    name: 'Concord Light',
    colors: {
      bg: '#ffffff',
      surface: '#f8fafc',
      border: '#e2e8f0',
      text: '#0f172a',
      textSecondary: '#64748b',
      accent: '#0ea5e9',
      accentSecondary: '#8b5cf6'
    },
    isBuiltIn: true
  },
  {
    id: 'nord',
    name: 'Nord',
    colors: {
      bg: '#2e3440',
      surface: '#3b4252',
      border: '#434c5e',
      text: '#eceff4',
      textSecondary: '#d8dee9',
      accent: '#88c0d0',
      accentSecondary: '#b48ead'
    },
    isBuiltIn: true
  },
  {
    id: 'solarized',
    name: 'Solarized Dark',
    colors: {
      bg: '#002b36',
      surface: '#073642',
      border: '#094556',
      text: '#839496',
      textSecondary: '#657b83',
      accent: '#2aa198',
      accentSecondary: '#d33682'
    },
    isBuiltIn: true
  },
  {
    id: 'dracula',
    name: 'Dracula',
    colors: {
      bg: '#282a36',
      surface: '#44475a',
      border: '#6272a4',
      text: '#f8f8f2',
      textSecondary: '#bd93f9',
      accent: '#50fa7b',
      accentSecondary: '#ff79c6'
    },
    isBuiltIn: true
  },
  {
    id: 'monokai',
    name: 'Monokai',
    colors: {
      bg: '#272822',
      surface: '#3e3d32',
      border: '#49483e',
      text: '#f8f8f2',
      textSecondary: '#a6e22e',
      accent: '#66d9ef',
      accentSecondary: '#f92672'
    },
    isBuiltIn: true
  }
];

interface ThemeSelectorProps {
  currentTheme: string;
  customThemes?: Theme[];
  onSelectTheme: (themeId: string) => void;
  onImportTheme?: (theme: Theme) => void;
  onExportTheme?: () => void;
  className?: string;
}

export function ThemeSelector({
  currentTheme,
  customThemes = [],
  onSelectTheme,
  onImportTheme,
  onExportTheme,
  className
}: ThemeSelectorProps) {
  const [systemPreference, setSystemPreference] = useState<'light' | 'dark' | 'system'>('system');

  const allThemes = [...BUILT_IN_THEMES, ...customThemes];
  const selectedTheme = allThemes.find(t => t.id === currentTheme) || BUILT_IN_THEMES[0];

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          const text = await file.text();
          const theme = JSON.parse(text) as Theme;
          onImportTheme?.(theme);
        } catch (err) {
          console.error('Failed to import theme:', err);
        }
      }
    };
    input.click();
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-neon-purple" />
          <span className="font-medium text-white">Themes</span>
        </div>
        <div className="flex items-center gap-2">
          {onImportTheme && (
            <button
              onClick={handleImport}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title="Import theme"
            >
              <Download className="w-4 h-4" />
            </button>
          )}
          {onExportTheme && (
            <button
              onClick={onExportTheme}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
              title="Export current theme"
            >
              <Upload className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* System preference */}
      <div className="px-4 py-3 border-b border-lattice-border">
        <span className="text-xs text-gray-400 uppercase tracking-wider">System Preference</span>
        <div className="flex gap-2 mt-2">
          {[
            { id: 'light', icon: Sun, label: 'Light' },
            { id: 'dark', icon: Moon, label: 'Dark' },
            { id: 'system', icon: Monitor, label: 'System' }
          ].map(option => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                onClick={() => setSystemPreference(option.id as typeof systemPreference)}
                className={cn(
                  'flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border transition-colors',
                  systemPreference === option.id
                    ? 'bg-neon-purple/20 border-neon-purple text-neon-purple'
                    : 'border-lattice-border text-gray-400 hover:text-white'
                )}
              >
                <Icon className="w-4 h-4" />
                <span className="text-xs">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <span className="text-xs text-gray-400 uppercase tracking-wider">Built-in Themes</span>
        <div className="grid grid-cols-2 gap-3 mt-3">
          {BUILT_IN_THEMES.map(theme => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              isSelected={currentTheme === theme.id}
              onSelect={() => onSelectTheme(theme.id)}
            />
          ))}
        </div>

        {customThemes.length > 0 && (
          <>
            <span className="text-xs text-gray-400 uppercase tracking-wider block mt-6">
              Custom Themes
            </span>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {customThemes.map(theme => (
                <ThemeCard
                  key={theme.id}
                  theme={theme}
                  isSelected={currentTheme === theme.id}
                  onSelect={() => onSelectTheme(theme.id)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Preview */}
      <div className="p-4 border-t border-lattice-border">
        <span className="text-xs text-gray-400 uppercase tracking-wider">Preview</span>
        <div
          className="mt-3 p-4 rounded-lg border"
          style={{
            backgroundColor: selectedTheme.colors.bg,
            borderColor: selectedTheme.colors.border
          }}
        >
          <div
            className="p-3 rounded mb-2"
            style={{ backgroundColor: selectedTheme.colors.surface }}
          >
            <p style={{ color: selectedTheme.colors.text }} className="text-sm font-medium">
              Sample Text
            </p>
            <p style={{ color: selectedTheme.colors.textSecondary }} className="text-xs mt-1">
              Secondary text color
            </p>
          </div>
          <div className="flex gap-2">
            <div
              className="px-3 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: selectedTheme.colors.accent,
                color: selectedTheme.colors.bg
              }}
            >
              Primary
            </div>
            <div
              className="px-3 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: selectedTheme.colors.accentSecondary,
                color: '#fff'
              }}
            >
              Secondary
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeCard({
  theme,
  isSelected,
  onSelect
}: {
  theme: Theme;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'relative p-3 rounded-lg border transition-all',
        isSelected
          ? 'ring-2 ring-neon-purple border-neon-purple'
          : 'border-lattice-border hover:border-gray-500'
      )}
    >
      {/* Color preview */}
      <div className="flex gap-1 mb-2">
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: theme.colors.bg }}
        />
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: theme.colors.surface }}
        />
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: theme.colors.accent }}
        />
        <div
          className="w-4 h-4 rounded-full"
          style={{ backgroundColor: theme.colors.accentSecondary }}
        />
      </div>

      {/* Theme name */}
      <div className="text-left">
        <p className="text-sm text-white">{theme.name}</p>
        {theme.author && (
          <p className="text-xs text-gray-400">by {theme.author}</p>
        )}
      </div>

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-neon-purple rounded-full flex items-center justify-center">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}

      {/* Built-in badge */}
      {theme.isBuiltIn && (
        <div className="absolute bottom-2 right-2">
          <Sparkles className="w-3 h-3 text-gray-400" />
        </div>
      )}
    </button>
  );
}
