import { create } from "zustand";
import type { WorldId } from "./content";
import { OBJECTIVES } from "./content";
import type { Quality } from "./quality";

export type Phase = "title" | "play" | "pause" | "dialogue";

export type QuestId = (typeof OBJECTIVES)[number]["id"];

export type Overlay = {
  phase: Phase;
  worldId: WorldId;
  hp: number;
  stamina: number;
  poise: number;
  inCombat: boolean;
  telegraph: "thrust" | "sweep" | "grab" | null;
  prompt: string | null;
  toast: { text: string; action?: string; schemeId?: string } | null;
  feed: string[];
  dialogue: { npcId: string; index: number } | null;
  done: Record<QuestId, boolean>;
  gatesWalked: number;
  bargeCount: number;
  muted: boolean;
  shake: boolean;
  quality: Quality;
  billboard: { text: string; until: number } | null;
  flowerWarn: boolean;
  heading: number;
  px: number;
  pz: number;
  hour: number;
  weather: string;
  styleName: string;
  worldTitle: string;
  uncounted: number;
  hostility: number;
  lastEvent: string;
  beastName: string | null;
  arts: { key: string; name: string }[];
  actorN: number;
  questTitle: string;
  questDetail: string;
  poi: string;
  ecology: number;
  km: string;
  plotLine: string;
  politics: string;
  flash: number;
  refusal: string;
  lawText: string;
};

type Actions = {
  set: (p: Partial<Overlay>) => void;
  mark: (id: QuestId) => void;
  pushFeed: (line: string) => void;
};

type Store = Overlay & Actions;

function readSave(): { done: Overlay["done"]; gatesWalked: number } | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem("concordia-save-v1");
    if (!raw) return null;
    return JSON.parse(raw) as { done: Overlay["done"]; gatesWalked: number };
  } catch {
    return null;
  }
}

function createOverlay() {
  const saved = readSave();
  return create<Store>((set, get) => ({
    phase: "title",
    worldId: "concordia-hub",
    hp: 100,
    stamina: 100,
    poise: 12,
    inCombat: false,
    telegraph: null,
    prompt: null,
    toast: null,
    feed: ["The lanterns are already lit."],
    dialogue: null,
    done: saved?.done ?? { lamp: false, ring: false, scheme: false, arena: false, gate: false },
    gatesWalked: saved?.gatesWalked ?? 0,
    bargeCount: 0,
    muted: false,
    shake: true,
    quality: "medium",
    billboard: null,
    flowerWarn: false,
    heading: Math.PI / 2,
    px: 26,
    pz: 0,
    hour: 7.2,
    weather: "clear",
    styleName: "Unarmed Court",
    worldTitle: "The Unburned Court",
    uncounted: 0,
    hostility: 0,
    lastEvent: "The lanterns are already lit.",
    beastName: null,
    arts: [
      { key: "LMB", name: "Palm" },
      { key: "RMB", name: "Heavy" },
      { key: "G", name: "Flower-step" },
      { key: "1", name: "Lantern step" },
    ],
    actorN: 0,
    questTitle: "",
    questDetail: "",
    poi: "",
    ecology: 0.7,
    km: "",
    plotLine: "",
    politics: "",
    flash: 0,
    refusal: "You cannot own the heart.",
    lawText: "No live steel in the Court",
    set: (p) => set(p),
    mark: (id) => {
      const done = { ...get().done, [id]: true };
      set({ done });
      try {
        localStorage.setItem(
          "concordia-save-v1",
          JSON.stringify({ version: 1, done, gatesWalked: get().gatesWalked }),
        );
      } catch {
        /* ignore */
      }
    },
    pushFeed: (line) => set({ feed: [line, ...get().feed].slice(0, 8) }),
  }));
}

const STORE_REV = 8;
const root = globalThis as typeof globalThis & {
  __concordiaOverlay?: ReturnType<typeof createOverlay>;
  __concordiaOverlayRev?: number;
};
if (root.__concordiaOverlayRev !== STORE_REV) {
  root.__concordiaOverlay = createOverlay();
  root.__concordiaOverlayRev = STORE_REV;
}
export const useOverlay = root.__concordiaOverlay!;
