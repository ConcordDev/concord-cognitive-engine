// lib/world-lens/color-key.ts
//
// WAVE ART — Layer 3 (UI/Effects/HUD → "clean-toon"). The locked deliverable:
// ONE canonical colour key for the whole readable surface, so an element reads
// the same in a VFX burst, a damage number, and the event feed. Two maps — the
// 7 combat ELEMENTS (matching element-vfx.ts' authored hues) and the 13
// EmergentEventFeed CHANNELS — are unified here as the single source of truth.
// Pure data + accessors; additive (renderer/feed/HUD adopt it). Behind
// CONCORD_ART_UI where it changes existing visuals.

export type ElementId = "fire" | "ice" | "lightning" | "poison" | "water" | "energy" | "physical";

// fire orange→red · ice cyan · lightning yellow-white · poison green · water
// blue-cyan · energy violet · physical grey — the element-vfx.ts authored key.
export const ELEMENT_COLORS: Record<ElementId, string> = {
  fire:      "#ff5a2a",
  ice:       "#5ad0ff",
  lightning: "#fff05a",
  poison:    "#5ad05a",
  water:     "#3aa0ff",
  energy:    "#b05aff",
  physical:  "#9a9a9a",
};

export type EventChannel =
  | "world" | "entity" | "agent" | "evo" | "weather" | "crisis" | "companion"
  | "system_health" | "faction" | "npc" | "self" | "economy" | "social";

// 13 EmergentEventFeed channels — distinct, readable-at-speed hues.
export const EVENT_CHANNEL_COLORS: Record<EventChannel, string> = {
  world:         "#8fb8ff",
  entity:        "#ff8f8f",
  agent:         "#b08fff",
  evo:           "#ffd04a",
  weather:       "#7fd8e8",
  crisis:        "#ff4a4a",
  companion:     "#7fe87f",
  system_health: "#a0a0a0",
  faction:       "#ff9a4a",
  npc:           "#e0c060",
  self:          "#4ad0a0",
  economy:       "#d0e84a",
  social:        "#ff7fd0",
};

export const FALLBACK_COLOR = "#cccccc";

export function colorForElement(e: string | null | undefined): string {
  return (e && (ELEMENT_COLORS as Record<string, string>)[e]) || FALLBACK_COLOR;
}

export function colorForChannel(c: string | null | undefined): string {
  return (c && (EVENT_CHANNEL_COLORS as Record<string, string>)[c]) || FALLBACK_COLOR;
}
