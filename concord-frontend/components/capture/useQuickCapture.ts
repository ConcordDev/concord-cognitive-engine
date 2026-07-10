'use client';

/**
 * useQuickCapture — state hook for the Quick Capture modal, split out of
 * QuickCapture.tsx (shell-diet pass) so it can be statically imported (it
 * owns the global Mod+Shift+N shortcut, so it must always be live) without
 * pulling in the modal's heavy render tree (framer-motion, lucide icons,
 * the AI-suggestion fetch logic). AppShell keeps this hook import static
 * and lazily `next/dynamic`-imports the `QuickCapture` component itself,
 * only once `isOpen` first goes true.
 */

import { useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export function useQuickCapture() {
  const [isOpen, setIsOpen] = useState(false);

  useHotkeys('mod+shift+n', (e) => {
    e.preventDefault();
    setIsOpen(true);
  }, { enableOnFormTags: ['INPUT', 'TEXTAREA'] });

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen(!isOpen)
  };
}
