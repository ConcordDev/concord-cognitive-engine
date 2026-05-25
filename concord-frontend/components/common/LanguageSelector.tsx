'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';
import {
  type Locale,
} from '@/lib/i18n';

// ── Locale metadata ─────────────────────────────────────────────────────────

interface LocaleInfo {
  code: Locale;
  /** Native language name */
  name: string;
  /** English language name */
  englishName: string;
  /** Flag emoji for visual identification */
  flag: string;
  /** Whether this locale is RTL */
  rtl: boolean;
}

const LOCALE_INFO: LocaleInfo[] = [
  { code: 'en', name: 'English', englishName: 'English', flag: '🇺🇸', rtl: false },
  { code: 'es', name: 'Español', englishName: 'Spanish', flag: '🇪🇸', rtl: false },
  { code: 'fr', name: 'Français', englishName: 'French', flag: '🇫🇷', rtl: false },
  { code: 'de', name: 'Deutsch', englishName: 'German', flag: '🇩🇪', rtl: false },
  { code: 'ja', name: '日本語', englishName: 'Japanese', flag: '🇯🇵', rtl: false },
  { code: 'zh', name: '中文', englishName: 'Chinese', flag: '🇨🇳', rtl: false },
  { code: 'ar', name: 'العربية', englishName: 'Arabic', flag: '🇸🇦', rtl: true },
  { code: 'he', name: 'עברית', englishName: 'Hebrew', flag: '🇮🇱', rtl: true },
  { code: 'pt', name: 'Português', englishName: 'Portuguese', flag: '🇧🇷', rtl: false },
  { code: 'ko', name: '한국어', englishName: 'Korean', flag: '🇰🇷', rtl: false },
];

// ── Component ───────────────────────────────────────────────────────────────

interface LanguageSelectorProps {
  /** Display variant */
  variant?: 'dropdown' | 'compact';
  /** Additional CSS classes */
  className?: string;
  /** Show English name alongside native name */
  showEnglishName?: boolean;
}

/**
 * Language selector dropdown for changing the application locale.
 *
 * Features:
 * - Displays current locale with flag and native name
 * - Dropdown with all 10 supported locales
 * - Saves preference to localStorage
 * - Shows native language names (e.g., "日本語" for Japanese)
 * - Keyboard accessible (Escape to close, Enter/Space to select)
 * - RTL-aware layout
 */
export function LanguageSelector({
  variant = 'dropdown',
  className = '',
  showEnglishName = false,
}: LanguageSelectorProps) {
  const { locale, setLocale, isRTL } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentLocaleInfo = LOCALE_INFO.find((l) => l.code === locale) ?? LOCALE_INFO[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const handleLocaleSelect = useCallback(
    async (newLocale: Locale) => {
      await setLocale(newLocale);
      setIsOpen(false);
      buttonRef.current?.focus();
    },
    [setLocale]
  );

  const handleKeyDownOnItem = useCallback(
    (event: React.KeyboardEvent, localeCode: Locale) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleLocaleSelect(localeCode);
      }
    },
    [handleLocaleSelect]
  );

  if (variant === 'compact') {
    return (
      <div ref={containerRef} className={`relative inline-block ${className}`}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm
                     text-gray-600 hover:bg-gray-100 hover:text-gray-900
                     dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100
                     transition-colors"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-label="Select language"
        >
          <span className="text-base" aria-hidden="true">
            {currentLocaleInfo.flag}
          </span>
          <span className="uppercase font-medium">{locale}</span>
          <ChevronIcon isOpen={isOpen} />
        </button>

        {isOpen && (
          <DropdownMenu
            locales={LOCALE_INFO}
            currentLocale={locale}
            showEnglishName={showEnglishName}
            isRTL={isRTL}
            onSelect={handleLocaleSelect}
            onKeyDown={handleKeyDownOnItem}
          />
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white
                   px-3 py-2 text-sm font-medium text-gray-700 shadow-sm
                   hover:bg-gray-50 hover:border-gray-300
                   dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200
                   dark:hover:bg-gray-750 dark:hover:border-gray-600
                   transition-colors focus:outline-none focus:ring-2
                   focus:ring-blue-500 focus:ring-offset-1"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Select language"
      >
        <span className="text-base" aria-hidden="true">
          {currentLocaleInfo.flag}
        </span>
        <span>{currentLocaleInfo.name}</span>
        <ChevronIcon isOpen={isOpen} />
      </button>

      {isOpen && (
        <DropdownMenu
          locales={LOCALE_INFO}
          currentLocale={locale}
          showEnglishName={showEnglishName}
          isRTL={isRTL}
          onSelect={handleLocaleSelect}
          onKeyDown={handleKeyDownOnItem}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

interface DropdownMenuProps {
  locales: LocaleInfo[];
  currentLocale: Locale;
  showEnglishName: boolean;
  isRTL: boolean;
  onSelect: (locale: Locale) => void;
  onKeyDown: (event: React.KeyboardEvent, locale: Locale) => void;
}

function DropdownMenu({
  locales,
  currentLocale,
  showEnglishName,
  isRTL,
  onSelect,
  onKeyDown,
}: DropdownMenuProps) {
  return (
    <div
      className={`absolute z-50 mt-1 w-56 rounded-lg border border-gray-200 bg-white
                  py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800
                  ${isRTL ? 'right-0' : 'left-0'}`}
      role="listbox"
      aria-label="Available languages"
    >
      {locales.map((info) => {
        const isSelected = info.code === currentLocale;
        return (
          <button
            key={info.code}
            type="button"
            role="option"
            aria-selected={isSelected}
            className={`flex w-full items-center gap-3 px-3 py-2 text-sm
                        transition-colors cursor-pointer
                        ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                            : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-750'
                        }`}
            onClick={() => onSelect(info.code)}
            onKeyDown={(e) => onKeyDown(e, info.code)}
            dir={info.rtl ? 'rtl' : 'ltr'}
          >
            <span className="text-base flex-shrink-0" aria-hidden="true">
              {info.flag}
            </span>
            <span className="flex-1 text-start">
              <span className="font-medium">{info.name}</span>
              {showEnglishName && info.code !== 'en' && (
                <span className="ms-1 text-gray-400 dark:text-gray-400">
                  ({info.englishName})
                </span>
              )}
            </span>
            {isSelected && (
              <svg
                className="h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
