import { describe, it, expect } from 'vitest';
import { ds } from '@/lib/design-system';

describe('design-system tokens', () => {
  describe('panel tokens', () => {
    it('panel contains expected base classes', () => {
      expect(ds.panel).toContain('bg-lattice-surface');
      expect(ds.panel).toContain('border');
      expect(ds.panel).toContain('rounded-xl');
      expect(ds.panel).toContain('p-4');
    });

    it('panelHover extends panel with hover styles', () => {
      expect(ds.panelHover).toContain('bg-lattice-surface');
      expect(ds.panelHover).toContain('hover:border-white/15');
      expect(ds.panelHover).toContain('transition-all');
      expect(ds.panelHover).toContain('cursor-pointer');
    });
  });

  describe('button tokens', () => {
    it('btnBase contains core button classes', () => {
      expect(ds.btnBase).toContain('inline-flex');
      expect(ds.btnBase).toContain('items-center');
      expect(ds.btnBase).toContain('justify-center');
      expect(ds.btnBase).toContain('font-medium');
      expect(ds.btnBase).toContain('rounded-lg');
      expect(ds.btnBase).toContain('transition-colors');
      expect(ds.btnBase).toContain('disabled:opacity-50');
      expect(ds.btnBase).toContain('disabled:pointer-events-none');
    });

    it('btnPrimary has flat solid-blue styling', () => {
      // The neon gradient + glow shadow was deliberately retired (a dated
      // cyberpunk tell, per docs/PREMIUM_UI_AUDIT.md P1) in favor of a flat,
      // high-contrast solid accent with a dark label — restrained/Linear-style
      // and WCAG-compliant contrast that white-on-cyan did not clear.
      expect(ds.btnPrimary).toContain('bg-neon-blue');
      expect(ds.btnPrimary).toContain('text-lattice-void');
      expect(ds.btnPrimary).toContain('hover:bg-neon-blue/90');
    });

    it('btnSecondary has elevated styling', () => {
      expect(ds.btnSecondary).toContain('bg-lattice-elevated');
      expect(ds.btnSecondary).toContain('text-gray-200');
      expect(ds.btnSecondary).toContain('hover:border-white/20');
    });

    it('btnDanger extends btnBase with red styling', () => {
      expect(ds.btnDanger).toContain(ds.btnBase);
      expect(ds.btnDanger).toContain('bg-red-500/20');
      expect(ds.btnDanger).toContain('text-red-400');
    });

    it('btnGhost extends btnBase with ghost styling', () => {
      expect(ds.btnGhost).toContain(ds.btnBase);
      expect(ds.btnGhost).toContain('text-gray-400');
      expect(ds.btnGhost).toContain('hover:text-white');
    });

    it('btnSmall extends btnBase with smaller padding', () => {
      expect(ds.btnSmall).toContain(ds.btnBase);
      expect(ds.btnSmall).toContain('px-3');
      expect(ds.btnSmall).toContain('py-1.5');
      expect(ds.btnSmall).toContain('text-sm');
    });

    it('btnNeon returns neon-colored button string', () => {
      expect(typeof ds.btnNeon).toBe('function');
      const blueBtn = ds.btnNeon('blue');
      expect(blueBtn).toContain(ds.btnBase);
      expect(blueBtn).toContain('bg-neon-blue/20');
      expect(blueBtn).toContain('text-neon-blue');
      expect(blueBtn).toContain('border-neon-blue/50');
    });

    it('btnNeon defaults to blue', () => {
      const defaultBtn = ds.btnNeon();
      expect(defaultBtn).toContain('neon-blue');
    });

    it('btnNeon accepts all color variants', () => {
      const colors = ['blue', 'purple', 'cyan', 'green', 'pink'] as const;
      for (const color of colors) {
        const result = ds.btnNeon(color);
        expect(result).toContain(`neon-${color}`);
      }
    });
  });

  describe('input tokens', () => {
    it('input contains expected form classes', () => {
      expect(ds.input).toContain('w-full');
      expect(ds.input).toContain('bg-lattice-surface');
      expect(ds.input).toContain('border-lattice-border');
      expect(ds.input).toContain('rounded-lg');
      expect(ds.input).toContain('text-white');
      expect(ds.input).toContain('focus:border-neon-blue');
    });

    it('textarea extends input with resize-none', () => {
      expect(ds.textarea).toContain(ds.input);
      expect(ds.textarea).toContain('resize-none');
    });

    it('select is the same as input', () => {
      expect(ds.select).toBe(ds.input);
    });
  });

  describe('text tokens', () => {
    it('label has correct styling', () => {
      expect(ds.label).toContain('text-sm');
      expect(ds.label).toContain('text-gray-400');
      expect(ds.label).toContain('mb-1');
    });

    it('heading1 is the largest heading', () => {
      expect(ds.heading1).toContain('text-2xl');
      expect(ds.heading1).toContain('font-bold');
      expect(ds.heading1).toContain('text-white');
    });

    it('heading2 is a medium heading', () => {
      expect(ds.heading2).toContain('text-xl');
      expect(ds.heading2).toContain('font-semibold');
    });

    it('heading3 is a small heading', () => {
      expect(ds.heading3).toContain('text-lg');
      expect(ds.heading3).toContain('font-semibold');
    });

    it('textMuted has muted styling', () => {
      expect(ds.textMuted).toContain('text-sm');
      expect(ds.textMuted).toContain('text-gray-400');
    });

    it('textBody is the AA-passing body-copy tone (gray-300, not the muted gray-400)', () => {
      expect(ds.textBody).toContain('text-gray-300');
      expect(ds.textBody).not.toContain('text-gray-400');
    });

    it('textMono uses monospace font', () => {
      expect(ds.textMono).toContain('font-mono');
      expect(ds.textMono).toContain('text-sm');
    });
  });

  describe('badge function', () => {
    it('returns a badge class string with the given color', () => {
      expect(typeof ds.badge).toBe('function');
      const result = ds.badge('red-400');
      expect(result).toContain('inline-flex');
      expect(result).toContain('items-center');
      expect(result).toContain('rounded-full');
      expect(result).toContain('text-xs');
      expect(result).toContain('bg-red-400/20');
      expect(result).toContain('text-red-400');
    });

    it('works with different color values', () => {
      expect(ds.badge('green-500')).toContain('bg-green-500/20');
      expect(ds.badge('neon-cyan')).toContain('text-neon-cyan');
    });
  });

  describe('layout tokens', () => {
    it('pageContainer has padding and spacing', () => {
      expect(ds.pageContainer).toContain('p-6');
      expect(ds.pageContainer).toContain('space-y-6');
    });

    it('sectionHeader is a flex row with space-between', () => {
      expect(ds.sectionHeader).toContain('flex');
      expect(ds.sectionHeader).toContain('items-center');
      expect(ds.sectionHeader).toContain('justify-between');
    });

    it('grid tokens have responsive columns', () => {
      expect(ds.grid2).toContain('grid');
      expect(ds.grid2).toContain('md:grid-cols-2');

      expect(ds.grid3).toContain('lg:grid-cols-3');

      expect(ds.grid4).toContain('lg:grid-cols-4');
    });
  });

  describe('tab tokens', () => {
    it('tabBar contains flex and border', () => {
      expect(ds.tabBar).toContain('flex');
      expect(ds.tabBar).toContain('border-b');
      expect(ds.tabBar).toContain('overflow-x-auto');
    });

    it('tabActive returns active tab styles with default color', () => {
      expect(typeof ds.tabActive).toBe('function');
      const result = ds.tabActive();
      expect(result).toContain('text-neon-blue');
      expect(result).toContain('border-neon-blue');
    });

    it('tabActive accepts a custom color', () => {
      const result = ds.tabActive('neon-purple');
      expect(result).toContain('text-neon-purple');
      expect(result).toContain('border-neon-purple');
    });

    it('tabInactive has inactive styling', () => {
      expect(ds.tabInactive).toContain('text-gray-400');
      expect(ds.tabInactive).toContain('border-transparent');
      expect(ds.tabInactive).toContain('hover:text-white');
    });
  });

  describe('focus and overlay tokens', () => {
    it('focusRing has focus-visible styles', () => {
      expect(ds.focusRing).toContain('focus-visible:ring-2');
      expect(ds.focusRing).toContain('focus-visible:ring-neon-blue');
    });

    it('modalBackdrop has fixed positioning and blur', () => {
      expect(ds.modalBackdrop).toContain('fixed');
      expect(ds.modalBackdrop).toContain('inset-0');
      expect(ds.modalBackdrop).toContain('backdrop-blur-sm');
      expect(ds.modalBackdrop).toContain('z-50');
    });

    it('modalContainer is centered and fixed', () => {
      expect(ds.modalContainer).toContain('fixed');
      expect(ds.modalContainer).toContain('flex');
      expect(ds.modalContainer).toContain('items-center');
      expect(ds.modalContainer).toContain('justify-center');
    });

    it('modalPanel has panel styling', () => {
      expect(ds.modalPanel).toContain('bg-lattice-surface');
      expect(ds.modalPanel).toContain('border');
      expect(ds.modalPanel).toContain('rounded-xl');
      expect(ds.modalPanel).toContain('shadow-2xl');
    });
  });

  describe('ds object completeness', () => {
    it('exports all expected tokens', () => {
      const expectedKeys = [
        'panel', 'panelHover',
        'btnBase', 'btnPrimary', 'btnSecondary', 'btnDanger', 'btnGhost', 'btnSmall', 'btnNeon',
        'input', 'textarea', 'select',
        'label', 'heading1', 'heading2', 'heading3', 'textMuted', 'textBody', 'textMono',
        'badge',
        'pageContainer', 'sectionHeader', 'grid2', 'grid3', 'grid4',
        'tabBar', 'tabActive', 'tabInactive',
        'focusRing',
        'modalBackdrop', 'modalContainer', 'modalPanel',
      ];

      for (const key of expectedKeys) {
        expect(ds).toHaveProperty(key);
      }
    });

    it('all string tokens are non-empty strings', () => {
      const stringKeys = [
        'panel', 'panelHover', 'btnBase', 'btnPrimary', 'btnSecondary',
        'btnDanger', 'btnGhost', 'btnSmall', 'input', 'textarea', 'select',
        'label', 'heading1', 'heading2', 'heading3', 'textMuted', 'textBody', 'textMono',
        'pageContainer', 'sectionHeader', 'grid2', 'grid3', 'grid4',
        'tabBar', 'tabInactive', 'focusRing',
        'modalBackdrop', 'modalContainer', 'modalPanel',
      ];

      for (const key of stringKeys) {
        expect(typeof ds[key as keyof typeof ds]).toBe('string');
        expect((ds[key as keyof typeof ds] as string).length).toBeGreaterThan(0);
      }
    });

    it('function tokens are callable', () => {
      expect(typeof ds.btnNeon).toBe('function');
      expect(typeof ds.badge).toBe('function');
      expect(typeof ds.tabActive).toBe('function');
    });
  });
});
