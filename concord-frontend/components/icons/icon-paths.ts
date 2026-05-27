/**
 * Bespoke SVG icon path registry.
 *
 * Each entry is the raw <svg> children — paths, circles, etc — assembled
 * into a 24×24 viewBox. The component wraps them with a single
 * `<svg viewBox="0 0 24 24">` so the registry stays compact.
 *
 * Style: thin line + minimal fill, neon-lattice friendly (matches the
 * tailwind palette in tailwind.config.js: lattice/neon/resonance).
 */

export type IconName =
  // Combat
  | 'sword' | 'shield' | 'arrow' | 'bow' | 'fist' | 'skull' | 'heart' | 'flame'
  // Elements
  | 'fire' | 'ice' | 'lightning' | 'water' | 'earth' | 'poison' | 'energy' | 'wind'
  // World
  | 'compass' | 'map' | 'house' | 'tree' | 'mountain' | 'sun' | 'moon' | 'star'
  // Social
  | 'user' | 'users' | 'chat' | 'speech' | 'wave' | 'crown'
  // Inventory / craft
  | 'pickaxe' | 'hammer' | 'potion' | 'gem' | 'scroll' | 'coin' | 'chest' | 'key'
  // Quest / story
  | 'quest' | 'book' | 'lens' | 'rune' | 'glyph' | 'eye'
  // UI / nav
  | 'menu' | 'settings' | 'search' | 'close' | 'arrow-right' | 'arrow-left' | 'plus' | 'check'
  // Lens categories
  | 'brain' | 'pulse' | 'orbit' | 'network' | 'spark';

/** Body of each <svg> — caller wraps with viewBox + namespace. */
export const ICON_PATHS: Record<IconName, string> = {
  // ── Combat ──────────────────────────────────────────────────────
  sword: `<path d="M14 4l6 6-9.5 9.5-2.5 1 1-2.5L18.5 8.5 14 4z" fill="currentColor" opacity="0.15"/><path d="M14 4l6 6-9.5 9.5-2.5 1 1-2.5L18.5 8.5 14 4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  shield: `<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" fill="currentColor" opacity="0.12"/><path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" fill="none" stroke="currentColor" stroke-width="1.5"/>`,
  arrow: `<path d="M3 12h14m-4-4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  bow: `<path d="M4 4c5 3 5 13 0 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 4l16 8L4 20" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  fist: `<path d="M7 13v-3c0-1 .5-1.5 1.5-1.5S10 9 10 10v-1.5c0-1 .5-1.5 1.5-1.5S13 7.5 13 8.5V10c0-1 .5-1.5 1.5-1.5S16 9 16 10v3c0 3-2 5-4.5 5S7 16 7 13z" fill="currentColor" opacity="0.15"/><path d="M7 13v-3c0-1 .5-1.5 1.5-1.5S10 9 10 10v-1.5c0-1 .5-1.5 1.5-1.5S13 7.5 13 8.5V10c0-1 .5-1.5 1.5-1.5S16 9 16 10v3c0 3-2 5-4.5 5S7 16 7 13z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  skull: `<path d="M12 3c4 0 7 3 7 7v3l-1.5 1.5V18l-2 1v-2l-3.5.5L8.5 17l-3.5-.5v2l-2-1v-3.5L1.5 13V10c0-4 3-7 7-7z" fill="currentColor" opacity="0.15"/><circle cx="9" cy="11" r="1.5" fill="currentColor"/><circle cx="15" cy="11" r="1.5" fill="currentColor"/><path d="M5 10c0-4 3-7 7-7s7 3 7 7v3" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  heart: `<path d="M12 21l-1.5-1.4C5 14.5 2 11.5 2 7.5 2 5 4 3 6.5 3c1.5 0 3 .8 3.5 2 .5-1.2 2-2 3.5-2 2.5 0 4.5 2 4.5 4.5 0 4-3 7-8.5 12.1L12 21z" fill="currentColor" opacity="0.2"/><path d="M12 21l-1.5-1.4C5 14.5 2 11.5 2 7.5 2 5 4 3 6.5 3c1.5 0 3 .8 3.5 2 .5-1.2 2-2 3.5-2 2.5 0 4.5 2 4.5 4.5 0 4-3 7-8.5 12.1L12 21z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  flame: `<path d="M12 3c3 4 6 7 6 11 0 3.5-2.5 6-6 6s-6-2.5-6-6c0-2 1-3.5 2-5 .5 1 1 1.5 2 1.5 1 0 1.5-1 1.5-2.5 0-2 0-3.5.5-5z" fill="currentColor" opacity="0.18"/><path d="M12 3c3 4 6 7 6 11 0 3.5-2.5 6-6 6s-6-2.5-6-6c0-2 1-3.5 2-5 .5 1 1 1.5 2 1.5 1 0 1.5-1 1.5-2.5 0-2 0-3.5.5-5z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  // ── Elements ────────────────────────────────────────────────────
  fire: `<path d="M12 3c2 3 4 5 4 9 0 3-2 5-4 5s-4-2-4-5c0-2 1-3 2-4 .3.7.7 1 1.2 1 .6 0 .9-.5.9-1.3 0-1.5-.2-3 0-4.7z" fill="#ff7a30" opacity="0.85"/><path d="M12 3c2 3 4 5 4 9 0 3-2 5-4 5s-4-2-4-5c0-2 1-3 2-4 .3.7.7 1 1.2 1 .6 0 .9-.5.9-1.3 0-1.5-.2-3 0-4.7z" fill="none" stroke="#cf4500" stroke-width="1.2"/>`,
  ice: `<path d="M12 3v18M5 7l14 10M5 17L19 7" fill="none" stroke="#9ee9ff" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="#9ee9ff" opacity="0.6"/>`,
  lightning: `<path d="M13 2L5 13h5l-2 9 9-12h-5l1-8z" fill="#fff39b" opacity="0.85"/><path d="M13 2L5 13h5l-2 9 9-12h-5l1-8z" fill="none" stroke="#bf9000" stroke-width="1.2"/>`,
  water: `<path d="M12 3c3 4 6 7 6 10.5 0 3.5-3 6.5-6 6.5s-6-3-6-6.5C6 10 9 7 12 3z" fill="#5fbfff" opacity="0.7"/><path d="M12 3c3 4 6 7 6 10.5 0 3.5-3 6.5-6 6.5s-6-3-6-6.5C6 10 9 7 12 3z" fill="none" stroke="#1c6bb3" stroke-width="1.2"/>`,
  earth: `<path d="M3 14l4-4 3 3 3-5 4 4 4-2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 18h18" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  poison: `<path d="M12 3c4 3 6 6 6 10 0 3.5-3 6-6 6s-6-2.5-6-6c0-4 2-7 6-10z" fill="#86d96b" opacity="0.6"/><circle cx="9" cy="13" r="1" fill="#386e1e"/><circle cx="14" cy="11" r="1.2" fill="#386e1e"/><circle cx="13" cy="15" r="1" fill="#386e1e"/>`,
  energy: `<circle cx="12" cy="12" r="6" fill="#c77bff" opacity="0.4"/><circle cx="12" cy="12" r="3" fill="#c77bff" opacity="0.8"/><circle cx="12" cy="12" r="1.5" fill="#fff"/>`,
  wind: `<path d="M3 8c2-2 5-2 7 0s2 5 0 7M3 16c1-1 3-1 4 0M3 12h12c1 0 2 1 2 2s-1 2-2 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  // ── World ───────────────────────────────────────────────────────
  compass: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16 8l-2 6-6 2 2-6 6-2z" fill="currentColor" opacity="0.25"/><path d="M16 8l-2 6-6 2 2-6 6-2z" fill="none" stroke="currentColor" stroke-width="1.3"/>`,
  map: `<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 4v14M15 6v14" stroke="currentColor" stroke-width="1.2"/>`,
  house: `<path d="M3 11l9-7 9 7v9h-6v-6h-6v6H3v-9z" fill="currentColor" opacity="0.12"/><path d="M3 11l9-7 9 7v9h-6v-6h-6v6H3v-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  tree: `<path d="M12 3c-3 2-5 5-5 8h3v3h-2v6h8v-6h-2v-3h3c0-3-2-6-5-8z" fill="currentColor" opacity="0.15"/><path d="M12 3c-3 2-5 5-5 8h3v3h-2v6h8v-6h-2v-3h3c0-3-2-6-5-8z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  mountain: `<path d="M3 19l5-10 4 5 3-3 6 8H3z" fill="currentColor" opacity="0.15"/><path d="M3 19l5-10 4 5 3-3 6 8H3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  sun: `<circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  moon: `<path d="M21 13.5A8.5 8.5 0 0110.5 3 8.5 8.5 0 1021 13.5z" fill="currentColor" opacity="0.2"/><path d="M21 13.5A8.5 8.5 0 0110.5 3 8.5 8.5 0 1021 13.5z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  star: `<path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="currentColor" opacity="0.2"/><path d="M12 2l3 7 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  // ── Social ──────────────────────────────────────────────────────
  user: `<circle cx="12" cy="8" r="4" fill="currentColor" opacity="0.18"/><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  users: `<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="17" cy="9" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 13c2 0 5 1 6 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  chat: `<path d="M3 5h18v12H7l-4 4V5z" fill="currentColor" opacity="0.15"/><path d="M3 5h18v12H7l-4 4V5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  speech: `<path d="M5 4h14v10h-4l-3 4-3-4H5V4z" fill="currentColor" opacity="0.15"/><path d="M5 4h14v10h-4l-3 4-3-4H5V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  wave: `<path d="M3 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M3 11c2-2 4-2 6 0s4 2 6 0 4-2 6 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.6"/>`,
  crown: `<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" fill="currentColor" opacity="0.2"/><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="21" cy="8" r="1" fill="currentColor"/>`,
  // ── Inventory / Craft ────────────────────────────────────────────
  pickaxe: `<path d="M3 20l8-8M14 6l5 5M9 17l-3 3M11 12l1-1M14 6c1-2 5-2 5 0s-3 1-3 1l3 4s-3 0-3-2-1-3-2-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  hammer: `<path d="M3 17l11-11M9 11l2 2M14 6l4-3 3 3-3 4-4-4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
  potion: `<path d="M9 3h6v3l1 1c2 1 3 4 3 6 0 4-3 8-7 8s-7-4-7-8c0-2 1-5 3-6l1-1V3z" fill="currentColor" opacity="0.15"/><path d="M9 3h6v3l1 1c2 1 3 4 3 6 0 4-3 8-7 8s-7-4-7-8c0-2 1-5 3-6l1-1V3z" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  gem: `<path d="M5 9l4-5h6l4 5-7 11L5 9z" fill="currentColor" opacity="0.2"/><path d="M5 9l4-5h6l4 5-7 11L5 9zM5 9h14M9 4l3 5 3-5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`,
  scroll: `<path d="M5 4h11l3 3v13h-14l-3-3V4h3z" fill="currentColor" opacity="0.12"/><path d="M5 4h11l3 3v13h-14l-3-3V4h3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 9h7M8 13h7M8 17h5" stroke="currentColor" stroke-width="1.2"/>`,
  coin: `<circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.15"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 9h6M10 12h4M9 15h6" stroke="currentColor" stroke-width="1.2"/>`,
  chest: `<path d="M3 9V8c0-2 2-4 5-4h8c3 0 5 2 5 4v1H3z" fill="currentColor" opacity="0.15"/><path d="M3 9h18v11H3V9z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="14" r="1.5" fill="currentColor"/>`,
  key: `<circle cx="8" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 12h9M16 12v3M21 12v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  // ── Quest / Story ───────────────────────────────────────────────
  quest: `<path d="M12 2l1.5 6 6.5.5-5 4 1.5 6.5L12 16l-4.5 3 1.5-6.5-5-4 6.5-.5L12 2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  book: `<path d="M4 5c2-1 6-1 8 0v15c-2-1-6-1-8 0V5z" fill="currentColor" opacity="0.12"/><path d="M20 5c-2-1-6-1-8 0v15c2-1 6-1 8 0V5z" fill="currentColor" opacity="0.12"/><path d="M4 5c2-1 6-1 8 0M20 5c-2-1-6-1-8 0M4 5v15c2-1 6-1 8 0V5M20 5v15c-2-1-6-1-8 0" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  lens: `<circle cx="12" cy="12" r="4" fill="currentColor" opacity="0.3"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.2"/>`,
  rune: `<path d="M6 4v16M18 4v16M6 12h12M9 4l9 6M15 20l-9-6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
  glyph: `<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 5v3M12 16v3M5 12h3M16 12h3M7 7l2 2M15 15l2 2M17 7l-2 2M9 15l-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
  eye: `<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" fill="currentColor" opacity="0.15"/><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`,
  // ── UI / Nav ────────────────────────────────────────────────────
  menu: `<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  settings: `<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 15c-.4 1-.2 2.1.6 2.9l.1.1c1 1 1 2.6 0 3.6s-2.6 1-3.6 0l-.1-.1c-.8-.8-1.9-1-2.9-.6-.9.4-1.5 1.3-1.5 2.3v.3c0 1.4-1.1 2.5-2.5 2.5S7 24.4 7 23v-.3c-.1-1-.7-1.9-1.6-2.3-1-.4-2.1-.2-2.9.6l-.1.1c-1 1-2.6 1-3.6 0s-1-2.6 0-3.6l.1-.1c.8-.8 1-1.9.6-2.9-.4-.9-1.3-1.5-2.3-1.5h-.3c-1.4 0-2.5-1.1-2.5-2.5S-4.4 7-3 7h.3c1 0 1.9-.6 2.3-1.5.4-1 .2-2.1-.6-2.9l-.1-.1c-1-1-1-2.6 0-3.6s2.6-1 3.6 0l.1.1c.8.8 1.9 1 2.9.6h.1c.9-.4 1.5-1.3 1.5-2.3v-.3C7-4.4 8.1-5.5 9.5-5.5s2.5 1.1 2.5 2.5v.3c0 1 .6 1.9 1.5 2.3 1 .4 2.1.2 2.9-.6l.1-.1c1-1 2.6-1 3.6 0s1 2.6 0 3.6l-.1.1c-.8.8-1 1.9-.6 2.9.4.9 1.3 1.5 2.3 1.5h.3c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5h-.3c-1 0-1.9.6-2.3 1.5z" fill="none" stroke="currentColor" stroke-width="1.2" transform="scale(0.6) translate(8 8)"/>`,
  search: `<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`,
  'arrow-right': `<path d="M5 12h14m-4-5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  'arrow-left':  `<path d="M19 12H5m4-5l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  plus:  `<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  check: `<path d="M5 13l4 4 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  // ── Lens categories ─────────────────────────────────────────────
  brain: `<path d="M9 4c-2 0-3 1.5-3 3-1 1-1.5 3-1 4 0 2 1 4 3 4-1 1-1 3 1 4 1 1 4 1 5-1 1 2 4 2 5 1 2-1 2-3 1-4 2 0 3-2 3-4 .5-1 0-3-1-4 0-1.5-1-3-3-3-1 0-2 .5-2.5 1-.5-.5-1-1-2.5-1S10 4.5 9.5 5C9 4.5 9.5 4 9 4z" fill="currentColor" opacity="0.18"/><path d="M9 4c-2 0-3 1.5-3 3-1 1-1.5 3-1 4 0 2 1 4 3 4-1 1-1 3 1 4 1 1 4 1 5-1 1 2 4 2 5 1 2-1 2-3 1-4 2 0 3-2 3-4 .5-1 0-3-1-4 0-1.5-1-3-3-3-1 0-2 .5-2.5 1-.5-.5-1-1-2.5-1S10 4.5 9.5 5C9 4.5 9.5 4 9 4z" fill="none" stroke="currentColor" stroke-width="1.3"/>`,
  pulse: `<path d="M3 12h4l2-6 3 14 2-8h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  orbit: `<ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.4"/><ellipse cx="12" cy="12" rx="9" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.4" transform="rotate(60 12 12)"/><circle cx="12" cy="12" r="2" fill="currentColor"/>`,
  network: `<circle cx="6" cy="6" r="2" fill="currentColor" opacity="0.3"/><circle cx="18" cy="6" r="2" fill="currentColor" opacity="0.3"/><circle cx="6" cy="18" r="2" fill="currentColor" opacity="0.3"/><circle cx="18" cy="18" r="2" fill="currentColor" opacity="0.3"/><circle cx="12" cy="12" r="2.5" fill="currentColor" opacity="0.5"/><path d="M6 6l6 6M18 6l-6 6M6 18l6-6M18 18l-6-6" stroke="currentColor" stroke-width="1.3"/>`,
  spark: `<path d="M12 2v6M12 16v6M2 12h6M16 12h6M5 5l4 4M15 15l4 4M19 5l-4 4M9 15l-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
};
