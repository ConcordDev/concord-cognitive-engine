// concord-frontend/lib/concordia/system-affordances.ts
//
// The "[System]" contextual affordance resolver — the isekai no-learning-curve
// bet made concrete. Given the player's CURRENT context (what's nearby, what
// they hold, what state they're in), it returns the ranked list of things they
// can do RIGHT NOW, each with the key + a one-line why. The naive-newbie never
// has to wonder "what do I do here" — the System tells them, diegetically.
//
// Pure + total so it unit-tests headlessly; the HUD component renders the result.

export interface PlayerContext {
  nearBuilding?: { id: string; type: string } | null;
  nearNpc?: { id: string; name?: string; hostile?: boolean; hasQuest?: boolean } | null;
  nearVehicle?: { id: string; kind: string } | null;
  nearMount?: { id: string } | null;
  nearNode?: { id: string; type: string } | null;
  inWater?: boolean;
  airborne?: boolean;
  inCombat?: boolean;
  hasUnspentSkillPoint?: boolean;
  hasUnreadStake?: boolean;   // a personal-stake moment is waiting
}

export interface Affordance {
  label: string;
  verb: string;      // the action/event id
  key: string;       // suggested keybind
  why: string;       // one-line legible reason
  priority: number;  // higher = surfaced first
}

const BUILDING_VERB: Record<string, { label: string; verb: string; why: string }> = {
  farm_plot:        { label: "Tend the field", verb: "concordia:building-interact", why: "Plant or harvest crops here" },
  restaurant:       { label: "Run the kitchen", verb: "concordia:building-interact", why: "Serve diners for tips" },
  karaoke_booth:    { label: "Take the mic", verb: "concordia:building-interact", why: "Sing for a crowd" },
  mahjong_table:    { label: "Sit at the table", verb: "concordia:building-interact", why: "Play a hand of mahjong" },
  trivia_kiosk:     { label: "Answer trivia", verb: "concordia:building-interact", why: "Win by citing the right DTU" },
  hacking_terminal: { label: "Jack in", verb: "concordia:building-interact", why: "Solve the intrusion puzzle" },
  glyph_altar:      { label: "Compose a glyph", verb: "concordia:building-interact", why: "Mint a spell from base-6 glyphs" },
};

/**
 * Resolve the affordances available in the current context, ranked. PURE.
 */
export function resolveAffordances(ctx: PlayerContext = {}): Affordance[] {
  const out: Affordance[] = [];
  const add = (label: string, verb: string, key: string, why: string, priority: number) =>
    out.push({ label, verb, key, why, priority });

  // Combat dominates when it's happening.
  if (ctx.inCombat) {
    add("Attack", "combat:attack", "E", "You're in a fight — strike", 100);
    add("Dodge", "combat:dodge", "Q", "Roll out of danger", 95);
  }
  if (ctx.nearNpc) {
    if (ctx.nearNpc.hostile) add(`Fight ${ctx.nearNpc.name ?? "them"}`, "combat:attack", "E", "This one is hostile", 90);
    else {
      add(`Talk to ${ctx.nearNpc.name ?? "them"}`, "concordia:open-dialogue", "F", ctx.nearNpc.hasQuest ? "They have something for you" : "See what they say", ctx.nearNpc.hasQuest ? 88 : 60);
      add("Inspect", "concordia:inspect-npc-traits", "T", "Read who they are", 40);
    }
  }
  if (ctx.nearBuilding) {
    const b = BUILDING_VERB[ctx.nearBuilding.type];
    if (b) add(b.label, b.verb, "E", b.why, 70);
    else add("Enter", "concordia:building-interact", "E", "Step inside", 50);
  }
  if (ctx.nearMount) add("Mount", "concordia:mount", "R", "Ride it", 65);
  if (ctx.nearVehicle) add(`Drive the ${ctx.nearVehicle.kind}`, "concordia:proximity-update", "V", "Take the wheel", 64);
  if (ctx.nearNode) add("Gather", "concordia:gather", "E", `Harvest the ${ctx.nearNode.type}`, 55);
  if (ctx.inWater) add("Swim / dive", "concordia:swim", "Shift", "Press to dive; watch your oxygen", 45);
  if (ctx.airborne) add("Glide", "concordia:glide", "Space", "Hold to glide; release to drop", 45);
  if (ctx.hasUnspentSkillPoint) add("Evolve a skill", "concordia:open-skills", "K", "You have a point to spend", 80);
  if (ctx.hasUnreadStake) add("Something concerns you", "concordia:open-stake", "Tab", "A development touches your story", 85);

  if (out.length === 0) {
    add("Explore", "concordia:move", "WASD", "Move to find people, work, and trouble", 10);
  }
  return out.sort((a, b) => b.priority - a.priority);
}

/** The single most-relevant affordance (the one the System whispers first). */
export function primaryAffordance(ctx: PlayerContext): Affordance | null {
  const all = resolveAffordances(ctx);
  return all[0] ?? null;
}
