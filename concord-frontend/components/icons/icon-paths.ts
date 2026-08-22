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
  | 'brain' | 'pulse' | 'orbit' | 'network' | 'spark'
  // Business / professional domains
  | 'ledger' | 'invoice' | 'bank'
  // Progression / tiers
  | 'medal' | 'medal-star'
  // Systems / agents
  | 'agent-node'
  // Diplomacy / governance
  | 'alliance-network'
  // Security / privacy
  | 'cipher-lock'
  // Builder / dev tools
  | 'blueprint' | 'low-poly-cube'
  // Creative
  | 'artist-palette'
  // Trades / vehicles
  | 'car-silhouette'
  // Marketplace
  | 'bounty-target'
  // Food / hospitality
  | 'chef-hat'
  // Environment
  | 'desert-dune'
  // Legal / governance
  | 'scales-of-justice' | 'gavel'
  // Trades — electrical
  | 'circuit-panel'
  // Trades — HVAC
  | 'hvac-duct'
  // Events
  | 'event-ticket'
  // Data / files
  | 'export-package'
  // ── Credentials ─────────────────────────────────────────────────────
  | 'credential-badge'
  // ── Concordia vehicles ──────────────────────────────────────────────
  | 'cart-vehicle' | 'boat-hull' | 'canal-taxi';

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
  // ── Business / professional domains ──────────────────────────────
  ledger: `<path d="M4 4h13a3 3 0 013 3v13a3 3 0 01-3-3H4V4z" fill="currentColor" opacity="0.12"/><path d="M4 4h13a3 3 0 013 3v13a3 3 0 01-3-3H4V4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  invoice: `<path d="M6 2h9l3 3v17H6V2z" fill="currentColor" opacity="0.12"/><path d="M6 2h9l3 3v17H6V2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M15 2v3h3" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M9 11h6M9 14h6M9 17h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  bank: `<path d="M12 2l9 5H3l9-5z" fill="currentColor" opacity="0.15"/><path d="M12 2l9 5H3l9-5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4 9v10M8 9v10M12 9v10M16 9v10M20 9v10M2 21h20" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
  // ── Progression / tiers ───────────────────────────────────────────
  medal: `<path d="M8 3l2 6M16 3l-2 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="12" cy="15" r="6" fill="currentColor" opacity="0.18"/><circle cx="12" cy="15" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 12v6M9 15h6" stroke="currentColor" stroke-width="1.1" opacity="0.7"/>`,
  'medal-star': `<path d="M7 3l2.5 6.5M17 3l-2.5 6.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="12" cy="15" r="6.5" fill="currentColor" opacity="0.2"/><circle cx="12" cy="15" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M12 11.5l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.3-2.1 1.3.5-2.4-1.8-1.6 2.4-.3 1-2.2z" fill="currentColor"/>`,
  // ── Systems / agents ───────────────────────────────────────────────
  'agent-node': `<rect x="7" y="4" width="10" height="9" rx="2" fill="currentColor" opacity="0.15"/><rect x="7" y="4" width="10" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9.5" cy="8.5" r="1" fill="currentColor"/><circle cx="14.5" cy="8.5" r="1" fill="currentColor"/><path d="M12 1v3M9 13v2M15 13v2M6 15h12M6 15v5M18 15v5M6 20h4M14 20h4" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
  // ── Diplomacy / governance ──────────────────────────────────────────
  'alliance-network': `<circle cx="6" cy="6" r="2.6" fill="currentColor" opacity="0.2"/><circle cx="6" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="18" cy="6" r="2.6" fill="currentColor" opacity="0.2"/><circle cx="18" cy="6" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="18" r="2.6" fill="currentColor" opacity="0.2"/><circle cx="12" cy="18" r="2.6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8.3 7.3L15.7 7.3M7.3 8.3L10.7 15.7M16.7 8.3L13.3 15.7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/>`,
  // ── Security / privacy ────────────────────────────────────────────
  'cipher-lock': `<rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.15"/><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 11V7a4 4 0 018 0v4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M9 15.5h.01M12 15.5h.01M15 15.5h.01M9 18h.01M12 18h.01M15 18h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  // ── Builder / dev tools ────────────────────────────────────────────
  blueprint: `<rect x="3" y="3" width="18" height="18" rx="1" fill="currentColor" opacity="0.06"/><path d="M3 8h18M3 13h18M8 3v18M14 3v18" stroke="currentColor" stroke-width="0.8" opacity="0.35"/><path d="M3 3h4M3 3v4M21 3h-4M21 3v4M3 21h4M3 21v-4M21 21h-4M21 21v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="9.5" y="9.5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="1.5 1.5"/>`,
  'low-poly-cube': `<path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" fill="currentColor" opacity="0.1"/><path d="M12 2v9M12 11l8-4.5M12 11l-8-4.5M12 11v11" stroke="currentColor" stroke-width="1.2"/><path d="M12 2l8 4.5v11L12 22l-8-4.5v-11L12 2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  // ── Creative ────────────────────────────────────────────────────────
  'artist-palette': `<path d="M12 3C6.5 3 2 6.8 2 11.5c0 3 2.2 4.5 4.5 4.5.8 0 1.5-.5 1.5-1.3 0-.5-.2-.8-.5-1.2-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H12c4.4 0 8-2.7 8-6C20 3.5 16.5 3 12 3z" fill="currentColor" opacity="0.15"/><path d="M12 3C6.5 3 2 6.8 2 11.5c0 3 2.2 4.5 4.5 4.5.8 0 1.5-.5 1.5-1.3 0-.5-.2-.8-.5-1.2-.2-.3-.4-.6-.4-1 0-.8.7-1.5 1.5-1.5H12c4.4 0 8-2.7 8-6C20 3.5 16.5 3 12 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><circle cx="7" cy="9" r="1.1" fill="currentColor"/><circle cx="10.5" cy="6.5" r="1.1" fill="currentColor"/><circle cx="15" cy="7" r="1.1" fill="currentColor"/><circle cx="17" cy="10.5" r="1.1" fill="currentColor"/>`,
  // ── Trades / vehicles ───────────────────────────────────────────────
  'car-silhouette': `<path d="M4 16v-2.5l2-4.5c.4-.9 1.3-1.5 2.3-1.5h7.4c1 0 1.9.6 2.3 1.5l2 4.5V16" fill="currentColor" opacity="0.15"/><path d="M4 16v-2.5l2-4.5c.4-.9 1.3-1.5 2.3-1.5h7.4c1 0 1.9.6 2.3 1.5l2 4.5V16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 16h16M4 16v2a1 1 0 001 1h1a1 1 0 001-1v-2M17 16v2a1 1 0 001 1h1a1 1 0 001-1v-2M6 10.5h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7.5" cy="16" r="1.3" fill="currentColor"/><circle cx="16.5" cy="16" r="1.3" fill="currentColor"/>`,
  // ── Marketplace ─────────────────────────────────────────────────────
  'bounty-target': `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="5.5" fill="currentColor" opacity="0.12"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  // ── Food / hospitality ──────────────────────────────────────────────
  'chef-hat': `<path d="M7 11c-2 0-3.5-1.6-3.5-3.5S5 4 7 4c.3-1.7 1.8-3 3.6-3 1.3 0 2.5.7 3.1 1.8.5-.4 1.1-.6 1.8-.6 1.7 0 3 1.3 3 3 0 .3 0 .6-.1.9 1.5.4 2.6 1.8 2.6 3.4 0 2-1.6 3.5-3.5 3.5H7z" fill="currentColor" opacity="0.15"/><path d="M7 11c-2 0-3.5-1.6-3.5-3.5S5 4 7 4c.3-1.7 1.8-3 3.6-3 1.3 0 2.5.7 3.1 1.8.5-.4 1.1-.6 1.8-.6 1.7 0 3 1.3 3 3 0 .3 0 .6-.1.9 1.5.4 2.6 1.8 2.6 3.4 0 2-1.6 3.5-3.5 3.5H7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 11v7.5c0 .8.7 1.5 1.5 1.5h8c.8 0 1.5-.7 1.5-1.5V11" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 15h11" stroke="currentColor" stroke-width="1.2"/>`,
  // ── Environment ─────────────────────────────────────────────────────
  'desert-dune': `<circle cx="18" cy="6" r="3" fill="currentColor" opacity="0.3"/><path d="M2 17c2-3 5-4 7-2 2-2.5 5-3 7-.5 1.5-1.5 3.5-1.5 5 .5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2 20c2-2 5-3 7-1.5 2-2 5-2.5 7-.5 1.5-1 3.5-1 5 .3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.6"/>`,
  // ── Legal / governance ──────────────────────────────────────────────
  'scales-of-justice': `<path d="M12 2v18M8 21h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 6l8-2 8 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4 6L1.5 11a3 3 0 005 0L4 6z" fill="currentColor" opacity="0.15"/><path d="M4 6L1.5 11a3 3 0 005 0L4 6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M20 6l-2.5 5a3 3 0 005 0L20 6z" fill="currentColor" opacity="0.15"/><path d="M20 6l-2.5 5a3 3 0 005 0L20 6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`,
  gavel: `<path d="M14 3l6 6-2 2-6-6 2-2z" fill="currentColor" opacity="0.15"/><path d="M14 3l6 6-2 2-6-6 2-2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M11 6l6 6-6.5 6.5-6-6L11 6z" fill="currentColor" opacity="0.12"/><path d="M11 6l6 6-6.5 6.5-6-6L11 6z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 20l4.5-4.5M2 22h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`,
  // ── Trades — electrical ─────────────────────────────────────────────
  'circuit-panel': `<rect x="4" y="3" width="16" height="18" rx="1.5" fill="currentColor" opacity="0.1"/><rect x="4" y="3" width="16" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7h3M8 11h3M8 15h3M13 7h3M13 11h3M13 15h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="19" r="1" fill="currentColor"/>`,
  'hvac-duct': `<rect x="2" y="6" width="9" height="6" rx="1" fill="currentColor" opacity="0.12"/><rect x="2" y="6" width="9" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11 9h4a3 3 0 0 1 3 3v1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="16" y="13" width="6" height="6" rx="1" fill="currentColor" opacity="0.12"/><rect x="16" y="13" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 8v4M6.5 8v4" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/><path d="M18 15v4" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.6"/>`,
  // ── Events ──────────────────────────────────────────────────────────
  'event-ticket': `<path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z" fill="currentColor" opacity="0.14"/><path d="M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M14 6.5v11" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.6"/>`,
  // ── Data / files ────────────────────────────────────────────────────
  'export-package': `<path d="M12 2l8 4v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-4z" fill="currentColor" opacity="0.12"/><path d="M12 2l8 4v6c0 5-3.4 8-8 10-4.6-2-8-5-8-10V6l8-4z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  // A verified-credential seal: circular medallion + checkmark + a ribbon
  // tail beneath it (the classic "certificate/award" silhouette), distinct
  // from `export-package`'s pentagon-shield shape.
  'credential-badge': `<path d="M8 15.5L6 22l6-3 6 3-2-6.5" fill="currentColor" opacity="0.12"/><path d="M8 15.5L6 22l6-3 6 3-2-6.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="10" r="7.5" fill="currentColor" opacity="0.14"/><circle cx="12" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8.5 10.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  // Concordia's three world-vehicle archetypes — distinct real silhouettes
  // (garage lens), not a repurposed generic car/boat icon.
  // A boxy open-air golf-cart-shape: flat deck, small cab frame, big wheels.
  'cart-vehicle': `<path d="M3 15h13l2-5h-3l-1 5" fill="currentColor" opacity="0.12"/><path d="M3 15h13l2-5h-3l-1 5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M13 10V6a1 1 0 011-1h2a1 1 0 011 1v1" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M3 10h10" stroke="currentColor" stroke-width="1.2"/><circle cx="6" cy="17" r="1.8" fill="currentColor"/><circle cx="15" cy="17" r="1.8" fill="currentColor"/>`,
  // A simple dinghy hull — curved bottom, flat gunwale line, small mast.
  'boat-hull': `<path d="M2 14l2.5 4a2 2 0 001.7 1h11.6a2 2 0 001.7-1l2.5-4H2z" fill="currentColor" opacity="0.14"/><path d="M2 14l2.5 4a2 2 0 001.7 1h11.6a2 2 0 001.7-1l2.5-4H2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M12 14V4M12 6l4 2-4 2" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 14V11M18 14V11" stroke="currentColor" stroke-width="1.1"/>`,
  // A longer, flat-bottomed passenger ferry with a cabin roofline + windows —
  // visually distinct from the open dinghy above.
  'canal-taxi': `<path d="M1 15l1.5 3a2 2 0 001.8 1.2h15.4a2 2 0 001.8-1.2l1.5-3H1z" fill="currentColor" opacity="0.12"/><path d="M1 15l1.5 3a2 2 0 001.8 1.2h15.4a2 2 0 001.8-1.2l1.5-3H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 15V9a1 1 0 011-1h12a1 1 0 011 1v6" fill="currentColor" opacity="0.1"/><path d="M5 15V9a1 1 0 011-1h12a1 1 0 011 1v6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M8 11h2M14 11h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>`,
};
