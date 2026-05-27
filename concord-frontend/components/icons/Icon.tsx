'use client';

import { ICON_PATHS, type IconName } from './icon-paths';

export type { IconName };

export interface IconProps {
  name:        IconName;
  size?:       number | string;
  className?:  string;
  ariaLabel?:  string;
  title?:      string;
  style?:      React.CSSProperties;
}

/**
 * Bespoke 24×24 SVG icon. The registry in icon-paths.ts owns the body;
 * this component wraps it in <svg> with viewBox + a11y. Uses
 * `currentColor` so text-color CSS controls the icon stroke/fill,
 * keeping Tailwind className-based theming working with no extra props.
 */
export function Icon({ name, size = 18, className, ariaLabel, title, style }: IconProps) {
  const body = ICON_PATHS[name];
  if (!body) return null;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      role={ariaLabel ? 'img' : 'presentation'}
      aria-label={ariaLabel}
      className={className}
      style={style}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${escapeHtml(title)}</title>` : '') + body }}
    />
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;'
    : c === '<' ? '&lt;'
    : c === '>' ? '&gt;'
    : c === '"' ? '&quot;'
    : c,
  );
}

/**
 * Map common emoji literals to icon names. Use this in component
 * codemod sweeps or per-call replacement where emoji are used as label
 * affordances (not where they're semantic content).
 */
export const EMOJI_TO_ICON: Record<string, IconName> = {
  '⚔️': 'sword',
  '🗡': 'sword',
  '🛡': 'shield',
  '🏹': 'bow',
  '➡️': 'arrow-right',
  '⬅️': 'arrow-left',
  '✊': 'fist',
  '💀': 'skull',
  '❤️': 'heart',
  '🔥': 'fire',
  '❄️': 'ice',
  '⚡': 'lightning',
  '💧': 'water',
  '🌍': 'earth',
  '☠️': 'poison',
  '🔋': 'energy',
  '💨': 'wind',
  '🧭': 'compass',
  '🗺': 'map',
  '🏠': 'house',
  '🌳': 'tree',
  '⛰': 'mountain',
  '☀️': 'sun',
  '🌙': 'moon',
  '⭐': 'star',
  '👤': 'user',
  '👥': 'users',
  '💬': 'chat',
  '🗨': 'speech',
  '👋': 'wave',
  '👑': 'crown',
  '⛏': 'pickaxe',
  '🔨': 'hammer',
  '🧪': 'potion',
  '💎': 'gem',
  '📜': 'scroll',
  '🪙': 'coin',
  '🎁': 'chest',
  '🔑': 'key',
  '🎯': 'quest',
  '📖': 'book',
  '🔍': 'search',
  '⚙️': 'settings',
  '☰': 'menu',
  '❌': 'close',
  '✖': 'close',
  '➕': 'plus',
  '✔': 'check',
  '✅': 'check',
  '🧠': 'brain',
  '📈': 'pulse',
  '🌐': 'network',
  '✨': 'spark',
  '👁': 'eye',
};
