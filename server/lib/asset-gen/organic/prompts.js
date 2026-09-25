// server/lib/asset-gen/organic/prompts.js
//
// Native-bible entry → concept-image prompt + triangle budget.
//
// The bible's prompts (~/.zuko/native-bible/aura/PROMPTS_INDEX.json) were
// written for 2D reference SHEETS ("orthographic turnaround plus one hero
// pose, pure-black silhouette inset"). An image-to-3D model needs the
// opposite: ONE subject, whole body, three-quarter view, plain background.
// So the sheet-composition clause is dropped, the creature description and
// the entry-specific silhouette constraints ("no chicken legs", "hood as a
// single diamond") are kept, and the boilerplate every entry shares is
// removed so it doesn't crowd out the constraints that make it Concordia.

import fs from "fs";
import os from "os";
import path from "path";

export const DEFAULT_BIBLE_PATH = path.join(os.homedir(), ".zuko/native-bible/aura/PROMPTS_INDEX.json");

const SHEET_MARKER = "PBR albedo without baked light.";
// Sentences present in every entry's silhouette_notes; they describe the
// reference sheet, not the creature.
const BOILERPLATE = [
  /Must read as a pure-black silhouette at 100m and at chase-camera distance\.\s*/i,
  /Windup \/ strike \/ recover poses stay distinct\.\s*/i,
];

// A handful of fauna entries end silhouette_notes with a sentence about how
// a GROUP of the species reads at a distance — "Pack silhouette is staggered
// chevrons", "Flock is a low ragged line over water", "Swarm reads as floor
// movement" (mon_grid_drone has the same pattern: "Swarm forms a triangle").
// That's animation/AI design language (how a pack/flock/swarm should be laid
// out when many are on screen at once) — it does not describe the single
// reference subject this prompt asks FLUX for. Left in, it reliably pulled
// FLUX toward drawing a whole flock/pack/swarm instead of the one creature
// the pipeline needs to mesh (found 2026-09-24, B3_spoke_fauna review:
// faun_rain_gull and faun_sodium_rat both rendered a full background flock
// on every seed). Stripped the same way BOILERPLATE is, so the sentence
// never reaches the image prompt; nothing else in these entries' notes talks
// about groups, so this never removes real per-creature constraint text.
const GROUP_BEHAVIOR_SENTENCE = /[^.]*\b(flock|pack|swarm|herd|murder|colony|school|troop)\b[^.]*\.\s*/gi;

const FRAMING = "Single full-body {noun}, three-quarter front view, centered, entire body in frame, "
  + "plain white background, soft even studio light, no text, no watermark, 3D game asset concept render.";
const STYLE = "Stylized realism, worn weathered surfaces, bold readable silhouette, Concordia native design.";

let cache = null;
// CONCORD_NATIVE_BIBLE is read per call so tests/other hosts can point at a fixture.
export function loadBible(biblePath = process.env.CONCORD_NATIVE_BIBLE || DEFAULT_BIBLE_PATH) {
  if (cache?.path === biblePath) return cache.byId;
  const data = JSON.parse(fs.readFileSync(biblePath, "utf8"));
  const byId = new Map(data.entries.map((e) => [e.id, e]));
  cache = { path: biblePath, byId };
  return byId;
}

// B18/B19/B20 (the 2026-09-24 lookfeel pack: env/arch/flora, not creatures) are
// tagged with a vocabulary budgetFor() never handled before this pack existed —
// left unhandled, every one of these 139 entries would fall through to the
// generic 10000-tri fauna default below, which is wrong on every axis (not
// fauna, and the pack's own PIPELINE_FEED.md specifies distinct budgets per
// family). Flora rows don't tag tree vs. shrub/grass/moss separately, so a
// tree is told apart from a clump by display name, per that doc's own worked
// list (Court Linden, Thornwood Oak, Dust Cottonwood, Dawn Park Plane, Roof
// Olive, etc. are trees; reed/grass/scrub/moss/lichen/sage/fern/vine/thorn/
// stubble entries are clumps).
const FLORA_TREE_WORDS = /\b(pine|oak|willow|tree|fig|cypress|cottonwood|plane|olive|linden)\b/i;

/** Category + LOD0 triangle budget (companion order H4 / earlier Meshy runs). */
export function budgetFor(entry) {
  const tags = new Set(entry.taxonomy_tags || []);
  const batch = entry.batch || "";
  if (tags.has("boss")) return { category: "bosses", lod0MaxTris: 32000 };
  if (batch.startsWith("B6") || tags.has("hybrid")) return { category: "hybrids", lod0MaxTris: 15000 };
  if (tags.has("monster")) {
    const heavy = ["tank", "mech", "brute", "artillery"].some((t) => tags.has(t));
    return { category: "monsters", lod0MaxTris: heavy ? 20000 : 15000 };
  }
  if (tags.has("mount") || tags.has("livestock")) return { category: "fauna", lod0MaxTris: 15000 };
  if (tags.has("critter")) return { category: "fauna", lod0MaxTris: 6000 };
  if (tags.has("architecture")) return { category: "architecture", lod0MaxTris: 15000 };
  if (tags.has("landmark")) return { category: "environment", lod0MaxTris: 20000 };
  if (tags.has("environment")) return { category: "environment", lod0MaxTris: 8000 };
  if (tags.has("flora")) {
    const isTree = FLORA_TREE_WORDS.test(String(entry.display_name || ""));
    return { category: "flora", lod0MaxTris: isTree ? 12000 : 4000 };
  }
  return { category: "fauna", lod0MaxTris: 10000 };
}

function noun(entry) {
  const tags = new Set(entry.taxonomy_tags || []);
  if (tags.has("mech")) return "machine creature";
  if (tags.has("humanoid")) return "humanoid creature";
  if (tags.has("amorphous")) return "creature";
  return "creature";
}

// Hand-corrected overrides for ids where the auto-derived prompt (bible
// description + silhouette_notes, verbatim) was reviewed against the actual
// FLUX output (3 seeds each, 2026-09-24 monster batch) and consistently
// produced the wrong structure — not seed noise, the same miss on every
// seed. Each entry names the failure so the next reviewer can tell whether
// a future model still needs the override or has outgrown it.
//
//   mon_sunder_basilisk: "diamond hood" read as a literal gemstone glued to
//     the skull on 3/3 seeds; "no chicken legs" was not enough to suppress
//     clawed dragon legs on 3/3 seeds (bible wants a true legless serpent).
//   mon_ruins_wraith: "bell silhouette" / "cowl is a bell" read as a
//     hand-held or hanging bell prop (1 seed) or was dropped entirely in
//     favor of a generic horned hood-demon (2 seeds) — none made the HOOD
//     ITSELF bell-shaped, which is what the bible actually specifies.
//   mon_grid_drone: the word "drone" pulled in quadcopter propellers/rotors
//     on 3/3 seeds despite "no spaghetti antennae"; propellers aren't
//     antennae so that constraint never fired on the real problem.
//   mon_frontier_domebreaker: "single horizontal horn bar" read as an
//     ordinary bison's two separate curved horns on 3/3 seeds — the "single
//     bar" framing lost to the much stronger bison-anatomy prior.
//
// A first fix pass wrote longer, more explicit versions of all four (below)
// and reran 3 seeds each: basilisk 2/3 fixed, grid_drone 3/3 fixed,
// wraith only 1/3 fixed (2/3 still grew a skull under the hood), domebreaker
// 0/3 fixed (still a plain two-horned bison every time). The gen server's
// own log surfaced why the last two held out: FLUX's CLIP text encoder only
// ever sees the first 77 tokens of a prompt and silently drops the rest —
// confirmed from `gen_server.log`'s own truncation warnings, which showed
// the corrective clause for wraith and domebreaker landing well past that
// cutoff (both prompts open with ~35 words of generic framing boilerplate
// before reaching the actual constraint). CLIP's pooled embedding still
// feeds FLUX's conditioning alongside T5 (which does see the full prompt via
// `max_sequence_length=256`), so a constraint CLIP never sees is fighting
// the training prior with half the intended signal. basilisk and grid_drone
// happened to place their key constraint in the second sentence, inside the
// window — which lines up with why those two mostly worked and these two
// didn't. Fix: wraith and domebreaker below open with the corrective clause
// FIRST, ahead of the framing boilerplate, so it survives the CLIP cutoff;
// basilisk and grid_drone are left as-is since they already work.
//
// Reverified with 3 fresh seeds each (2026-09-24, later same day):
//   domebreaker: 3/3 fixed — every seed now shows a real rigid bar mounted
//     across the horns, the "single horizontal bar" silhouette the bible
//     wants. Approved on seed 6.
//   wraith: 0/2 valid new seeds fixed (a 3rd hit a cold-load timeout before
//     generating) — both still grew a full skull under the hood, one even
//     added horns despite the explicit ban. Front-loading the constraint
//     fixed a geometric/structural ask (domebreaker) but did not reliably
//     override "wraith"'s own strong skull association, which read at the
//     time as a genuine text-to-image negation limit independent of prompt
//     position. That diagnosis turned out to be WRONG (see below) —
//     reordering just wasn't the fix this constraint needed.
//
// ROOT CAUSE FOUND AND FIXED 2026-09-24 (engines/concord-gen-pod/
// concord_gen_server.py `do_concept` + `_clip_safe_prompt`): FLUX's CLIP-L
// encoder has a hard, unconfigurable 77-token limit; diffusers'
// FluxPipeline.encode_prompt() silently reuses the SAME string for CLIP and
// T5 (`prompt_2 = prompt_2 or prompt`) whenever only `prompt` is given — so
// every override above was ALSO truncating what T5 saw (T5 has no 77-token
// limit; it was `max_sequence_length=256`, comfortably long enough for these
// prompts, but was never being reached because the same truncated string was
// fed to both encoders). The gen server now passes the FULL prompt via
// `prompt_2` (T5, uncapped at 512 tokens — verified via the response's
// `t5_tokens`/`t5_truncated` fields, never true for any prompt here) and a
// short whole-sentence-greedy CLIP-safe prefix via `prompt` (never a
// mid-word truncation warning again). This is a bridge fix, not a prompt
// edit — it applies to every future generation automatically, no manual
// per-prompt reordering needed.
//
// Reverified 2026-09-24 against the fixed bridge (seed 42, no override
// changes): wraith's PRIMARY constraint — no face/skull/eyes/mask — is now
// satisfied cleanly (genuinely empty hood, nothing visible underneath),
// something NO prior attempt achieved including the manual front-load
// reorder above. Two secondary constraints (hood silhouette reading as a
// bell shape, and "does not carry a separate bell object") still fail — the
// image renders a literal hanging bell prop despite the explicit negation
// being fully present and untruncated in what T5 sees. That remaining
// failure IS a genuine trained-association/negation limit (FLUX wants
// "bell" + "wraith" to mean an object and a skull respectively) — the
// token-budget bug that was masking it is gone, so what's left is the real,
// harder problem or a rewording. Needs another seed/wording pass on those
// two clauses specifically, not a reordering pass.
const PROMPT_OVERRIDES = {
  mon_sunder_basilisk:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A massive legless serpent, thick "
    + "muscular coiled body, no legs, no arms, no claws, no limbs of any kind — a true snake body, moss and old resin "
    + "crusted along its dark scales, pale unblinking eye. Behind its head, a wide flared hood of skin like a cobra's "
    + "hood, held open so its outline traces a diamond/kite shape — this hood is skin and scale, not a gemstone, not "
    + "a crystal, nothing sparkly or transparent anywhere on the head. Stylized realism, worn weathered surfaces, "
    + "bold readable silhouette, Concordia native design.",
  mon_ruins_wraith:
    "No face. No mask. No skull. No horns. No eyes. The head is completely hidden and featureless, hooded over, "
    + "nothing visible underneath at all. Single full-body creature, three-quarter front view, centered, entire body "
    + "in frame, plain white background, soft even studio light, no text, no watermark, 3D game asset concept "
    + "render. A tall robed figure whose entire head and shoulders are one heavy ash-grey hooded cowl shaped exactly "
    + "like a bell: a narrow domed top that flares outward into a wide bell mouth at the shoulder line, like a "
    + "ship's bell inverted over the head. The bell-shaped cowl IS the head. Its arms are thick twisted ropes of "
    + "solid grey ash ending in simple clawed hands, cold iron bangles at the wrists; no other limbs. It does not "
    + "carry or wear any separate bell object. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "Concordia native design.",
  mon_grid_drone:
    "Single full-body object, three-quarter front view, centered, entire object in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A thick solid disc-shaped "
    + "automaton, like a flattened turtle shell or a heavy manhole cover, scratched dark acrylic and gunmetal, "
    + "standing on short mechanical legs. Absolutely no propellers, no rotors, no spinning blades, no quadcopter "
    + "arms of any kind — this does not fly, it is a solid grounded disc. One single round cyan lens centered on its "
    + "front face, no other eyes or lenses. Exactly two short rigid antenna stubs on top, each shorter than the "
    + "disc's own radius — thick and stubby, not long, not thin, not wire-like. Stylized realism, worn weathered "
    + "surfaces, bold readable silhouette, Concordia native design.",
  mon_frontier_domebreaker:
    "One single straight rigid iron bar mounted horizontally across the forehead from temple to temple, where horns "
    + "would normally be — not two horns, a single unbroken bar only, like a bull-bar bolted across the skull. "
    + "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A bison-like brute with a tall "
    + "muscular hump as the highest point of its body, dust-scarred hide, wagon-nail scars along its flank, the "
    + "single straight horn-bar its only head ornament. Stylized realism, worn weathered surfaces, bold readable "
    + "silhouette, Concordia native design.",
  // The three ids below were never reviewed before the 2026-09-24 bridge fix
  // (see the ROOT CAUSE note above) — this is their FIRST review, run against
  // the corrected dual-encoder bridge, so unlike basilisk/wraith/grid_drone/
  // domebreaker there is no "did the old bug cause this" question: their
  // auto-derived prompts are 447-582 chars (~90-120 tokens), already well
  // under even CLIP's un-split 77-token window, so the bug was never in play
  // for these three. All three failed their bible's core constraint on 3/3
  // fresh seeds (seed 0/1/2) on the auto-derived prompt, the same
  // needs-an-explicit-override pattern basilisk/grid_drone needed originally:
  //   mon_tunya_harpy: every seed rendered a straight bird-of-prey head
  //     (eagle/owl), not the bible's "person-like face with a short bill" —
  //     "harpy" carries too strong a full-bird-head prior for a soft
  //     "short bill" clause to override.
  //   mon_grid_construct: 2/3 seeds put a literal skull (eye sockets, jaw,
  //     teeth) under the hood despite "not a skeleton robot"; all 3 gave
  //     both arms matching claw/tool hands instead of the required
  //     tool-arm/hand-arm asymmetry.
  //   mon_crucible_drift: all 3 seeds rendered exactly 2 large wing/ring
  //     shapes (not "three fat orbiting shards"), and all 3 added a face,
  //     eyes, and clawed legs the bible never specifies — "drift mass" read
  //     as a generic creature body instead of an abstract floating rock mass.
  // Overrides below are unreviewed as of this writing — the next step is
  // regenerating 2-3 seeds each against these and checking against the same
  // bible constraints before approving any seed.
  mon_tunya_harpy:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A winged humanoid harpy with a "
    + "HUMAN face — human eyes, a human nose, a human mouth and expression, weathered skin — with only a short "
    + "blunt bird bill added right at the mouth, not a full beak. Absolutely no bird head, no eagle head, no owl "
    + "head, no raptor face, no feathers anywhere on the face. Human-scale torso wrapped in plain pollen-stained "
    + "grove cloth, rough and utilitarian, not decorative armor, not a costume. Its arms ARE its wings — large "
    + "feathered wings grow directly from the shoulders where arms would be, no separate human arms underneath the "
    + "wings. Thick clawed bird legs, sturdy enough to strike with. Stylized realism, worn weathered surfaces, bold "
    + "readable silhouette, Concordia native design.",
  mon_grid_construct:
    "Single full-body object, three-quarter front view, centered, entire object in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A boxy asymmetric construct. Its "
    + "head is a smooth sheet-metal hood shaped like a welding hood, a plain riveted metal box with one narrow "
    + "glowing slit for eyes — absolutely no skull shape, no eye sockets, no exposed jaw, no teeth, nothing bone-"
    + "like or face-like underneath the hood. One arm ends in a plain articulated hand with fingers. The other arm "
    + "ends in a heavy fixed tool head — a drill bit or a blade — welded on with no fingers. The two arms must look "
    + "clearly different from each other. A ground-off serial number is stenciled on its chest. Bulky and solid, not "
    + "skeletal, not a skeleton robot, no visible bones or ribs anywhere on its body. Stylized realism, worn "
    + "weathered surfaces, bold readable silhouette, Concordia native design.",
  mon_crucible_drift:
    "Single full-body object, three-quarter front view, centered, entire object in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A solid teardrop-shaped mass, "
    + "like a smooth polished river stone or a fat water droplet, no face, no eyes, no mouth, no head, no legs, no "
    + "arms, no limbs of any kind — not a creature, not an animal, not a robot. One thin glowing teal crack-seam "
    + "runs down its surface like unfinished raw material showing through. Exactly three smaller fat egg-shaped "
    + "shard chunks of the same dark stone material, each about a third the size of the core, hover and orbit close "
    + "around the core at different points — not wings, not blades, not fins, not rings, just loose orbiting chunks "
    + "of the same rock. The whole thing reads as a solid drifting mass, never sparkles, never particles, never a "
    + "cloud. Stylized realism, worn weathered surfaces, bold readable silhouette, Concordia native design.",
  // B3_spoke_fauna review (2026-09-24, run against the fixed dual-encoder
  // bridge — see the ROOT CAUSE note above). Real-animal-based fauna have a
  // much lower failure rate than the monsters (20/24 passed on their
  // auto-derived prompt with only seed selection, no override needed) — the
  // four below are the genuine misses, each failing on 0/2-3 seeds:
  //   faun_terrace_goat: every seed grows long curved ibex/ram horns; the
  //     bible wants "short comma horns" (two short hooks, not a rack).
  //   faun_ash_wolf: reads as a clean, glossy pine-wolf recolor on both
  //     seeds checked — no visible ash/dust crust on the coat, ears intact
  //     (not "ragged"), so it's indistinguishable from faun_sunder_wolf/
  //     faun_dust_wolf beyond base color.
  //   faun_lattice_moth: wings render as a perfectly symmetric "bowtie" on
  //     both seeds checked — the bible's own silhouette_notes explicitly
  //     bans this exact shape ("never becomes a perfect bowtie") — and the
  //     "unfinished teal vein" reads as a small decorative eye-spot mark at
  //     best, never an asymmetric vein stopping short of the wing edge.
  //   faun_smog_roach: both seeds grow long thin spider/mantis legs — the
  //     bible's own notes explicitly ban this ("thin legs are forbidden;
  //     this is a pebble with feet") and both seeds also added fanged
  //     mandibles the bible never specifies.
  faun_terrace_goat:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A blocky short-legged terrace "
    + "goat standing sure-footed on a stone vineyard wall. Its horns are two SHORT horns shaped like commas or "
    + "hooks, each shorter than the goat's own ear — absolutely no long curved ibex horns, no ram horns, no ridged "
    + "sweeping rack, nothing that extends past the head. A carved wooden bell hangs from its neck on a braided "
    + "cord — the bell itself is pale wood, not bronze, not brass, not any metal. Sunlit, blocky compact body. "
    + "Stylized realism, worn weathered surfaces, bold readable silhouette, Concordia native design.",
  faun_ash_wolf:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A lean wolf whose entire coat is "
    + "visibly caked and dusted in pale grey ash — dry powdery ash crust clinging thick in patches along the back "
    + "and shoulders, not just a grey fur color but a literal dust coating sitting on top of the fur, some of it "
    + "sifting off in a light cloud. Its ears are ragged and torn at the tips, notched from wear, not clean or "
    + "pointed. Same lean build and pale chevron flank marking as a pine wolf, standing in Sovereign Ruins rubble, "
    + "dull light. Stylized realism, worn weathered surfaces, bold readable silhouette, Concordia native design.",
  faun_lattice_moth:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A dusty tan moth at rest with "
    + "wings spread, deliberately ASYMMETRIC left and right wings — the two sides must look visibly different in "
    + "shape and size from each other, never a mirrored pair, never a symmetric bowtie silhouette. Running through "
    + "one wing only, a single glowing teal vein-line that starts near the body and stops abruptly partway across "
    + "the wing, well before reaching the wing's outer edge — an unfinished line of light, not a spot, not a dot, "
    + "not a completed circuit or pattern, just one bright teal crack of light that trails off into nothing. Crucible "
    + "dark background tones. Stylized realism, worn weathered surfaces, bold readable silhouette, Concordia native "
    + "design.",
  faun_smog_roach:
    "Single full-body creature, three-quarter front view, centered, entire object in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A small oval-bodied roach shaped "
    + "like a smooth thick pebble with a faint grease sheen, Sere furnace soot dusted on its shell. Exactly six legs, "
    + "all SHORT and THICK stubby legs tucked close under the body — absolutely no long legs, no thin wire-like legs, "
    + "no spindly spider legs, no visible knee joints sticking outward. No fangs, no mandibles, no visible mouthparts "
    + "at all, just a smooth rounded head blending into the shell. Reads as a heavy pebble that happens to have feet, "
    + "not an insect with a delicate build. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "Concordia native design.",
  // B2_hub_ring_fauna review (2026-09-24): faun_pinewood_stag's antlers grew
  // a normal wide branching red-deer rack on both seeds checked — the bible
  // calls for a narrow "tuning fork" (two simple prongs, no branching) that
  // stays inside the body's own width; a full rack is both the wrong shape
  // and reads wider than the shoulders, which the notes explicitly ban.
  faun_pinewood_stag:
    "Single full-body creature, three-quarter front view, centered, entire body in frame, plain white background, "
    + "soft even studio light, no text, no watermark, 3D game asset concept render. A salt-dusted stag standing on a "
    + "dusty pine road at dusk. Its antlers are two simple straight prongs rising close together and staying narrow "
    + "— shaped exactly like a tuning fork, NOT a branching rack: no extra tines, no side branches, no wide spread. "
    + "Both prongs stay directly above the head, never spreading out past the width of the stag's own shoulders. "
    + "Long neck, deep chest, worn dusty hide. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "Concordia native design.",
  // B19_lookfeel_arch review (2026-09-24, the 10 SoftEnter hero halls, one
  // per world). These entries pass through verbatim via the aura_prompt
  // branch in conceptPrompt() (see PIPELINE_FEED.md) — the overrides below
  // follow that same "Single subject... plain warm-gray studio backdrop...
  // albedo has no baked lighting" register rather than the creature-sheet
  // FRAMING/STYLE constants, so they stay consistent with the rest of the
  // pack. 7/10 passed on the auto/verbatim prompt; these 3 needed a fix:
  //   arch_hero_sunder_shrine_hall: every seed rendered an East Asian pagoda
  //     (curved upturned eave corners) — the Fantasy/Sunder style board
  //     (STYLE_Fantasy.md) specifies "granite, moss, timber, a thin gold
  //     vein," no Asian-temple language at all, so this is a genuine style
  //     clash, not a design choice. The gold vein itself never appeared
  //     either.
  //   arch_hero_dawn_spire_hall: 0/2 seeds rendered the "single glass slot"
  //     or "chrome edge" — both seeds gave a plain painted composite door
  //     with no metal trim and no glass at all.
  //   arch_hero_crucible_lattice_hall: seed 0 nailed the hard part (the
  //     vault genuinely stops short of closing, a real gap at the apex) but
  //     no seed put the "teal seam" glow in that gap — worth preserving the
  //     working structural idea and only adding the missing glow.
  arch_hero_sunder_shrine_hall:
    "One short granite shrine hall, a plain gothic gabled roofline — NOT a pagoda, not East Asian temple "
    + "architecture, no upturned curling eave corners, just a plain triangular gable. A single dark timber door "
    + "under the gable, flanked by two mossed granite pillars with real moss growing in their cracks. A thin vein "
    + "of gold leaf worn down to bare stone runs along one edge of the door frame — a scar of gold showing through, "
    + "not a painted symbol, not a rune. Single subject, three-quarter view, centered, entire subject in frame, "
    + "plain warm-gray studio backdrop, ground contact shadow only, soft even light, no text, no watermark, 3D game "
    + "asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, visible bevels, "
    + "Concordia native design, albedo has no baked lighting.",
  arch_hero_dawn_spire_hall:
    "One pale composite hall bay wall. Set into the wall, one tall vertical glass slot window with a bright "
    + "polished chrome edge trim running all the way around the slot's frame — the chrome must read as a distinct "
    + "shiny metal band, a clearly different material from the pale composite wall around it, not paint. Warm light "
    + "glows out from inside the glass slot. One small chip or scuff mark on the composite panel. Single subject, "
    + "three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, ground contact shadow "
    + "only, soft even light, no text, no watermark, 3D game asset concept render. Stylized realism, worn weathered "
    + "surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
  arch_hero_crucible_lattice_hall:
    "One basalt and dark-oak hall bay. A tall pointed gothic vault arch built of dark basalt stone and dark oak "
    + "beams, but the arch does NOT fully close at its peak — there is a visible open gap right at the top where the "
    + "two sides of the vault stop short of meeting, as if a keystone was never placed. Inside that exact gap, a "
    + "thin glowing teal crack of light runs through the opening — a seam of teal energy showing through the "
    + "unfinished stonework, the only colored light in the image. Bevelled stone edges throughout. Single subject, "
    + "three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, ground contact shadow "
    + "only, soft even light, no text, no watermark, 3D game asset concept render. Stylized realism, worn weathered "
    + "surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
  // B18_lookfeel_env review (2026-09-24): env_hub_pinewood_milepost is the
  // ONE entry in the whole pack that WANTS text (GLOBAL_LOOK_RULES.md: "the
  // one plank allowed to say its name") — but the source aura_prompt is
  // self-contradictory, pairing "the plank reading Pinewood Crossing" with
  // the shared framing boilerplate's "no text" a sentence later. 0/3 seeds
  // got both right: seed 0 read "PINEWOOD" only (missing "CROSSING"), seed 1
  // read "PINEWOOD" only AND added a second small arrow sign (explicitly
  // banned by "no second sign"), seed 2 got the full "PINEWOOD CROSSING"
  // text right but also added a second star-decorated sign. This override
  // drops the contradictory "no text" clause and states the exact two-word
  // text and the single-plank constraint as their own explicit sentences.
  env_hub_pinewood_milepost:
    "One timber milepost. A single wooden plank is nailed across the post, carved with the exact words \"PINEWOOD "
    + "CROSSING\" in large legible letters — both words, spelled exactly that way, nothing added or missing. There is "
    + "only ONE plank on the whole post — no second sign, no small arrow board, no second smaller plank, nothing "
    + "else attached anywhere on the post besides the one lettered plank and a worn brass nail. Salt crust dusts the "
    + "wood. Single subject, three-quarter view, centered, entire subject in frame, pine verge at dusk, clear "
    + "background, soft even light, no watermark, 3D game asset concept render. Pine needles at the foot, no city "
    + "skyline. Stylized realism, worn weathered surfaces, bold readable silhouette, visible bevels, Concordia "
    + "native design, albedo has no baked lighting.",
  // env_ruins_unfinished_arch: 0/3 seeds actually left the keystone missing
  // — every seed rendered a fully closed, intact arch. Same fix that worked
  // for arch_hero_crucible_lattice_hall's "vault stops short of closing":
  // describe the actual visible gap explicitly instead of naming the
  // missing part abstractly.
  env_ruins_unfinished_arch:
    "One limestone arch built into a ruined wall, with a visible open gap right at the top center of the arch where "
    + "the keystone should be — the topmost wedge-shaped stone is simply absent, leaving a hole straight through the "
    + "wall at the arch's peak, sky or backdrop visible through that gap. The rest of the arch and both jambs are "
    + "still standing intact around that one missing stone. Single subject, three-quarter view, centered, entire "
    + "subject in frame, ruin street, soft even light, no text, no watermark, 3D game asset concept render. A crack "
    + "runs from the gap down one side, a vine grows in the joint, ash dust sits on the tread. Stylized realism, "
    + "worn weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no "
    + "baked lighting.",
  // env_cyber_census_plinth: 0/2 seeds rendered any digit ring at all —
  // "digit ring with one missing numeral" is too abstract for the model to
  // invent unprompted. Naming it as a clock-face-like ring of engraved
  // numerals with one gap, the same "describe the literal visible shape"
  // fix that worked for the arch/vault gaps above.
  env_cyber_census_plinth:
    "One low gunmetal plinth, a flat wide disc. Set into its top face, a thin ring like a clock face, engraved with "
    + "a full circle of number digits evenly spaced around the rim — except at one single point on the ring, one "
    + "digit is missing, leaving a conspicuous blank gap in the sequence of numbers. One small round cyan lens is "
    + "set into the plinth's front face, glowing softly. Scratched dark acrylic surface. Single subject, "
    + "three-quarter view, centered, entire subject in frame, dark plaza, soft even light, no text besides the ring's "
    + "own digits, no watermark, 3D game asset concept render. No drone, nothing hovering. Stylized realism, worn "
    + "weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no baked "
    + "lighting.",
  // flora_sunder_thorn_oak: 0/3 seeds gave a single low torso-thick limb —
  // every seed grew a normal symmetric branching oak crown instead. The gold
  // scar and moss both land reliably on their own; only the limb asymmetry
  // needed forcing, the same class of fix as the moth's asymmetric wings.
  flora_sunder_thorn_oak:
    "One thornwood oak with a thick pillar-straight trunk. Sticking out from low on one side of the trunk, ONE "
    + "single massive limb as thick as a human torso, jutting out almost horizontally like a bar — this is the only "
    + "limb low on the trunk; the opposite side of the trunk at that height is bare bark with no limb at all. Higher "
    + "up, the crown gathers into one single rounded mass of foliage. Moss grows thick on the trunk and the one "
    + "limb. A thin bright vein of gold shows through a crack in the bark. Single subject, three-quarter view, "
    + "centered, entire subject in frame, forest daylight, soft even light, no text, no watermark, 3D game asset "
    + "concept render. No castle. Stylized realism, worn weathered surfaces, bold readable silhouette, visible "
    + "bevels, Concordia native design, albedo has no baked lighting.",
  // flora_ruins_ash_cypress: 0/3 seeds gave the narrow flame crown — every
  // seed grew a wide rounded/umbrella pine canopy instead. Naming the real
  // reference tree (Italian cypress, Cupressus sempervirens) is what finally
  // pulls the model toward the right silhouette instead of a generic conifer.
  flora_ruins_ash_cypress:
    "One tree shaped exactly like an Italian cypress (Cupressus sempervirens) — extremely narrow and tall, a thin "
    + "vertical column of dark foliage that stays almost the same narrow width from bottom to top, tapering to a "
    + "point only at the very tip. The crown must NOT widen or spread out anywhere along its height — no wide "
    + "umbrella shape, no rounded pine-tree canopy, just one slender flame-shaped spire of foliage. Thick trunk at "
    + "the base, dust caught in the dark bark. Single subject, three-quarter view, centered, entire subject in "
    + "frame, ash daylight, soft even light, no text, no watermark, 3D game asset concept render. Limestone forum in "
    + "the backdrop, no bones. Stylized realism, worn weathered surfaces, bold readable silhouette, visible bevels, "
    + "Concordia native design, albedo has no baked lighting.",
  // flora_sere_furnace_scrub: 0/2 seeds rendered a plant at all — "furnace
  // scrub" read as an industrial gas-scrubber building both times (a whole
  // brick structure with a smokestack). The bible means a low shrub growing
  // near a furnace, blackened on the side that faces it — a botanical
  // "scrub" (scrubland vegetation), not a mechanical scrubber. Naming it as
  // a bush explicitly and banning building/architecture readings outright.
  flora_sere_furnace_scrub:
    "One low scrubland bush — a real PLANT, a shrub with woody stems and leaves, growing directly out of bare "
    + "ground. This is NOT a building, NOT a furnace, NOT a machine, NOT a brick structure, NOT a chimney or smoke "
    + "stack of any kind — just a low bush, roughly knee to waist height. The side of the bush that would face a "
    + "furnace is scorched black and leafless; the rest of the bush is normal dusty green-brown scrub foliage. "
    + "Cinder and brick dust scattered on the ground around its base. Single subject, three-quarter view, centered, "
    + "entire subject in frame, smog yard, soft even light, no text, no watermark, 3D game asset concept render. "
    + "Stylized realism, worn weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, "
    + "albedo has no baked lighting.",
  // arch_hero_ruins_ash_door: 0/3 seeds honored "No skull knocker" — every
  // seed added a skull (one seed added four). Front-loading the negation,
  // the same fix that worked for mon_ruins_wraith's skull problem earlier
  // this session.
  arch_hero_ruins_ash_door:
    "No skull. No skull knocker. No bone shapes anywhere, on the door or on the surrounding stone. A plain stone-"
    + "and-iron door — one vertical edge of the door sits slightly proud, sticking out past the stone frame instead "
    + "of sitting flush. Grey ash dust has settled into the gap along that proud edge. The door's only hardware is "
    + "plain iron bands and a plain handle — no ornamental fixture, no face, no carved decoration of any kind. "
    + "Single subject, three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, "
    + "ground contact shadow only, soft even light, no text, no watermark, 3D game asset concept render. Stylized "
    + "realism, worn weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo "
    + "has no baked lighting.",
  // arch_hero_crime_escape_stair: 0/3 seeds rendered a staircase at all —
  // every seed read "switchback" + "thick bars" as a barred window grate or
  // prison gate instead. Describing the literal staircase structure (steps,
  // a landing, a zigzag turn) and explicitly banning the grate/gate reading.
  arch_hero_crime_escape_stair:
    "One iron fire-escape staircase module bolted to a brick wall — real steps you could climb, NOT a barred window, "
    + "NOT a gate, NOT a grate, NOT a cage, no vertical prison bars anywhere. A flight of flat iron step treads "
    + "rises at an angle, turns once at a small landing platform in a zigzag switchback, then continues up at the "
    + "same angle on the other side. Thick iron support beams frame the steps on each side. Brick wall-mount clips "
    + "anchor the frame to the brick at top and bottom. Single subject, three-quarter view, centered, entire subject "
    + "in frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no text, no "
    + "watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "visible bevels, Concordia native design, albedo has no baked lighting.",
  // arch_hero_cyber_hatch_door: 0/3 seeds rendered a wheel handle — every
  // seed gave an ordinary door lever instead. Naming the specific real-world
  // object (a submarine/vault hatch wheel) the same way "Italian cypress"
  // fixed the flora silhouette earlier.
  arch_hero_cyber_hatch_door:
    "One short steel service door. In place of any lever or knob, its only handle is a large round metal wheel, "
    + "like a submarine hatch wheel or a bank-vault wheel — a flat disc with several spokes radiating from a center "
    + "hub, mounted flush on the door face, meant to be gripped and turned to open the door. No lever handle, no "
    + "door knob, no handle of any other shape. Single subject, three-quarter view, centered, entire subject in "
    + "frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no text, no watermark, "
    + "3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, visible "
    + "bevels, Concordia native design, albedo has no baked lighting.",
  // arch_hero_frontier_wagon_stair: 0/2 seeds rendered a step — both seeds
  // rendered an entire four-wheeled wagon instead ("wagon step" read as "a
  // wagon", the vehicle, not the accessory step-stool used to climb into
  // one). Same category-confusion class as flora_sere_furnace_scrub; fixed
  // the same way, by naming the object and banning the wrong-category
  // reading outright.
  arch_hero_frontier_wagon_stair:
    "One small wooden mounting step-stool, the kind bolted to the side of a wagon so a rider can climb up into the "
    + "seat. NOT a wagon, NOT a cart, NOT a full vehicle — no wheels, no wagon bed, no axle, nothing that rolls. "
    + "Just three stacked flat wooden treads, each one a little higher and set back from the one below it, forming "
    + "three steps. A single bent iron handle rail is bolted beside the steps to hold onto while climbing. Single "
    + "subject, three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, ground "
    + "contact shadow only, soft even light, no text, no watermark, 3D game asset concept render. Stylized realism, "
    + "worn weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no "
    + "baked lighting.",
  // arch_hero_dawn_launch_lip: 0/3 seeds rendered an architectural piece —
  // every seed rendered a standalone rocket-nosecone or UFO-shaped object
  // floating with no ground contact. "Launch lip" is architecture (a raised
  // rim section of a rooftop landing pad, matching the already-approved
  // env_dawn_roof_pad landmark's language), not a vehicle or prop. Naming
  // the architectural context explicitly and banning the object reading.
  arch_hero_dawn_launch_lip:
    "One curved section of a rooftop landing-pad's raised edge rim — a piece of ARCHITECTURE, part of a building's "
    + "roof, NOT a standalone object, NOT a rocket, NOT a nosecone, NOT a UFO, NOT anything that looks like it could "
    + "fly or launch on its own. A thick chamfered concrete-and-composite curb, angled like a ramp lip, sitting flat "
    + "on a roof surface with visible ground contact. Along its outer edge, a strip of chrome trim is chipped and "
    + "worn back in patches to reveal the pale composite underneath. Single subject, three-quarter view, centered, "
    + "entire subject in frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no "
    + "text, no watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable "
    + "silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
  // arch_hero_ix_foundry: 0/3 seeds rendered any quartz — the Crucible-side
  // blend material (a thick translucent crystal rib, established and
  // working in arch_hero_crucible_quartz_facade) never appeared at all, and
  // one seed rendered two clocks instead of the specified one. Naming the
  // rib explicitly the same way the pure Crucible facade already works.
  arch_hero_ix_foundry:
    "One foundry bay of soot brick and brass. Set into the brick, one single thick translucent quartz crystal rib — "
    + "the same glassy green crystal material as raw quartz, embedded vertically in the wall like a support beam — "
    + "but the rib stops short partway up the wall instead of reaching the top, an unfinished crystal vein. Exactly "
    + "one analogue clock face is mounted on the brick, with one of its numerals conspicuously missing from the "
    + "ring of numbers — do not render a second clock anywhere. Brass pipes and fittings elsewhere on the wall. "
    + "Single subject, three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, "
    + "ground contact shadow only, soft even light, no text besides the clock's own numerals, no watermark, 3D game "
    + "asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, visible bevels, "
    + "Concordia native design, albedo has no baked lighting.",
  // B18_lookfeel_env review (2026-09-25):
  //   env_hub_ring_door: 0/3 seeds avoided a swinging door — every seed
  //     rendered an actual hinged wooden door (one seed showed a visible
  //     center seam splitting it into two leaves). "Drum" means a solid,
  //     fixed, doorless cylindrical gate SECTION — describing that directly
  //     instead of the word "gate" alone, which keeps pulling toward "door."
  //   env_hub_arena_arch: 0/2 seeds honored "weapon racks empty" — one seed
  //     planted two rifles in the sand, the next floated four guns in mid-
  //     air. Firearm meshes are explicitly out of scope for this project
  //     right now (GLOBAL_LOOK_RULES.md: "Firearm hero meshes stay out while
  //     firearm verb coverage is zero") — banning weapons outright, not just
  //     asking for "empty" racks, since "empty rack" alone wasn't enough.
  env_hub_ring_door:
    "One short limestone gate drum — a solid, fixed cylindrical section of wall, like a thick stone barrel built "
    + "into the gate opening. It does NOT open, it has no hinges, no door leaves, no seam down the middle, nothing "
    + "that looks like it could swing — it is simply solid stone from top to bottom, a wall, not a door. Set into "
    + "the face of the drum, one single circular brass plaque, flush with the stone. Single subject, three-quarter "
    + "view, centered, entire subject in frame, plain warm-gray studio backdrop, ground contact shadow only, soft "
    + "even light, no text, no watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, "
    + "bold readable silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
  env_hub_arena_arch:
    "One thick limestone archway with a curved stone arch overhead, framing a flat sand floor beyond. Mounted on "
    + "the inside of one pillar, a wooden weapon rack with rows of empty pegs and hooks — the rack itself is visible "
    + "wooden framework, but every peg and hook is bare. Absolutely NO weapons of any kind anywhere in the image — "
    + "no rifles, no guns, no swords, no spears, no blades, nothing held, nothing floating, nothing leaning, nothing "
    + "planted in the sand. The rack is simply empty. Single subject, three-quarter view, centered, entire subject "
    + "in frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no text, no "
    + "watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "visible bevels, Concordia native design, albedo has no baked lighting.",
  // env_hub_salt_verge: 0/3 seeds rendered a road piece — "wedge" read as a
  // literal cut log wedge every time, with a small forest sprouting from it.
  // Describing the terrain-module shape directly (a flat ground chunk, not
  // an object called a wedge) and banning the log/lumber reading outright.
  env_hub_salt_verge:
    "One flat triangular-wedge-shaped chunk of ground, a piece of terrain — NOT a log, NOT a cut piece of wood, NOT "
    + "lumber, nothing with tree rings or bark. The wedge is a slice of dusty pine road: hard-packed dirt road "
    + "surface tapering to a point on one side, with a shoulder of pine needle duff (fallen brown pine needles) "
    + "along the road's edge, dusted with fine pale salt crystals. One small single pine sapling grows at the wide "
    + "end of the wedge — only one, not a cluster of trees. Single subject, three-quarter view, centered, entire "
    + "subject in frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no text, no "
    + "watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "visible bevels, Concordia native design, albedo has no baked lighting.",
  // env_ruins_catalogue_stele: 0/3 seeds honored "no skull motif" — every
  // seed carved a skull into the face, one also added fake gibberish
  // lettering. Same class of failure as arch_hero_ruins_ash_door earlier —
  // front-loading the negation, same fix that worked for mon_ruins_wraith.
  env_ruins_catalogue_stele:
    "No skull. No skull carving. No face, no bone shapes, nothing skeletal anywhere on the stone. A plain limestone "
    + "stele (an upright memorial slab) with a set of horizontal incised lines carved across its lower face — the "
    + "lines run most of the width of the stone but stop short before reaching the very bottom edge, leaving a "
    + "plain blank margin at the base. No letters, no words, no carved figures of any kind, just the plain "
    + "horizontal incised lines. Single subject, three-quarter view, centered, entire subject in frame, ash forum "
    + "daylight, soft even light, no text, no watermark, 3D game asset concept render. Ash dust, moss. Stylized "
    + "realism, worn weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo "
    + "has no baked lighting.",
  // env_ruins_forum_column: 0/3 seeds rendered ONE column — every seed
  // rendered three separate whole columns side by side instead of a single
  // column built from three stacked drum segments. Describing the stack
  // structure directly and explicitly banning the multi-column reading.
  env_ruins_forum_column:
    "One single fluted limestone column, and only one — do NOT render two or three separate columns standing side "
    + "by side. This one column's shaft is built from exactly three cylindrical stone drum segments stacked "
    + "directly on top of each other, with a visible horizontal seam line where each drum meets the next. The "
    + "topmost drum is cracked and split, a broken edge instead of a flat top. Moss on the seams. Single subject, "
    + "three-quarter view, centered, entire subject in frame, plain warm-gray studio backdrop, ground contact "
    + "shadow only, soft even light, no text, no watermark, 3D game asset concept render. Stylized realism, worn "
    + "weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no baked "
    + "lighting.",
  // env_crime_warehouse_door: 0/3 seeds left the door raised — every seed
  // rendered it fully closed, and every seed added fake lettering (a rust-
  // stain word, a painted graffiti letter, a full marquee sign) despite
  // "no text." Describing the actual gap explicitly (the fix that worked
  // for the arch/vault gaps earlier) and banning any lettering outright.
  env_crime_warehouse_door:
    "One rusted corrugated steel rolling door, on a brick warehouse bay. The door is raised open about one third of "
    + "the way up from the ground — there is a clear open gap at the bottom of the doorway, dark shadow visible "
    + "underneath the raised door edge, with the coiled-up door mechanism visible in the housing above. No text, no "
    + "letters, no words, no graffiti, no painted signage, no marquee, no stains that form readable shapes anywhere "
    + "on the door or the wall — just plain rusted corrugated metal. Single subject, three-quarter view, centered, "
    + "entire subject in frame, plain warm-gray studio backdrop, ground contact shadow only, soft even light, no "
    + "watermark, 3D game asset concept render. Stylized realism, worn weathered surfaces, bold readable silhouette, "
    + "visible bevels, Concordia native design, albedo has no baked lighting.",
  // flora_sunder_rune_pine: 0/3 seeds gave a full tree — every seed cropped
  // tight on a bark-texture close-up instead (no crown, no needle-plate
  // silhouette at all), and "no glow" was ignored on all 3 (a bright lit
  // orange/yellow scar every time) — the same negation failure class as the
  // wraith/ash-door skulls. Fix: explicitly frame it as a full, distant tree
  // (naming the failure mode directly, the technique that worked for the
  // cypress crown), and replace the "no glow" negation with a positive
  // description of the correct material (matte pale healed wood) instead of
  // just forbidding light.
  flora_sunder_rune_pine:
    "One whole pine tree seen from a distance, base to crown fully visible — like a distant nature photograph of an "
    + "entire tree, NOT a close-up of bark texture, NOT a cropped trunk detail shot. A tall conical silhouette built "
    + "from layered plates of needles, single straight trunk. Partway up the trunk, one small closed healed scar in "
    + "the bark: this scar is plain matte pale-gray dead wood, the same dry matte finish as a knot in old timber, "
    + "cool in color, completely unlit and non-reflective — it must NOT be bright, NOT glowing, NOT emitting light, "
    + "NOT colored orange or yellow, nothing warm or luminous anywhere on the tree. Single subject, three-quarter "
    + "view, centered, entire subject in frame, alpine edge, soft even light, no text, no watermark, 3D game asset "
    + "concept render. Needle plates, forest floor. Stylized realism, worn weathered surfaces, bold readable "
    + "silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
  // flora_tunya_nil_fig: 0/3 seeds honored "no village" — "buttress walls"
  // read as literal built stone architecture every time (castle turrets,
  // then a stone doorway with pillars and steps). Naming the real reference
  // tree (a strangler fig / banyan) and describing buttress roots as living
  // wood, plus banning built structures outright, the same fix pattern that
  // worked for furnace_scrub's building misread.
  flora_tunya_nil_fig:
    "One tree exactly like a real strangler fig or banyan tree — its lower trunk is made of thick, smooth, living "
    + "wooden buttress roots that fan outward and flow into the ground like solid drapery, all one continuous "
    + "organic wood surface. This is a TREE, not a building: no bricks, no cut stone, no masonry, no pillars, no "
    + "steps, no doorway frame, no castle, no turret, no crenellation, no walls of any kind — every surface is bark "
    + "and root wood, nothing constructed. Between two of the buttress roots, one dark hollow opening in the wood "
    + "itself, like a natural cave in the roots. Above the buttresses, a single leafy crown fills the top of the "
    + "frame. Single subject, three-quarter view, centered, entire subject in frame, dark wet grove, soft even "
    + "light, no text, no watermark, 3D game asset concept render. Wet bark, one dim lichen. Stylized realism, worn "
    + "weathered surfaces, bold readable silhouette, visible bevels, Concordia native design, albedo has no baked "
    + "lighting.",
  // flora_tunya_ash_scrub: 0/3 seeds rendered a shrub — "ash scrub" plus
  // "forge yard"/"cinder ground" pulled every seed toward a rock/boulder or
  // ash-pile with a few sparse twigs on top, never a twiggy dome bush. Same
  // failure class as furnace_scrub's scrubber misread: naming it as a real
  // plant explicitly and banning the rock/boulder reading outright.
  flora_tunya_ash_scrub:
    "One low shrub — a real PLANT, a dense dome-shaped bush made of many thin woody twigs packed close together, "
    + "growing directly out of bare ground. This is NOT a rock, NOT a boulder, NOT a pile of stone, NOT a mound of "
    + "ash or cinder shaped like a hill — the bulk and volume of the silhouette is twig and branch, packed dense "
    + "enough to read as one solid dome, roughly knee height. One side of the dome (the side that would face a "
    + "forge) is coated in black soot and bare of small twig-tips; the other side is normal dusty gray-brown scrub "
    + "wood. Single subject, three-quarter view, centered, entire subject in frame, forge yard, soft even light, no "
    + "text, no watermark, 3D game asset concept render. Cinder ground. Stylized realism, worn weathered surfaces, "
    + "bold readable silhouette, visible bevels, Concordia native design, albedo has no baked lighting.",
};

export function conceptPrompt(entry) {
  if (PROMPT_OVERRIDES[entry.id]) return PROMPT_OVERRIDES[entry.id];
  // The lookfeel pack (B18/B19/B20 env/arch/flora) ships its own render-ready
  // `aura_prompt` per PIPELINE_FEED.md — these are buildings/landmarks/plants,
  // not creature sheets, so the framing/description/notes/style assembly
  // below (which prepends "Single full-body {noun}…" and expects a sheet
  // marker these entries deliberately don't have) would double-frame them and
  // silently corrupt the constraint sentence. Pass verbatim instead.
  if (entry.aura_prompt) return entry.aura_prompt;
  const raw = String(entry.prompt || "");
  const i = raw.indexOf(SHEET_MARKER);
  const description = (i >= 0 ? raw.slice(i + SHEET_MARKER.length) : raw).trim();
  let notes = String(entry.silhouette_notes || "");
  for (const re of BOILERPLATE) notes = notes.replace(re, "");
  notes = notes.replace(GROUP_BEHAVIOR_SENTENCE, "");
  const prompt = [FRAMING.replace("{noun}", noun(entry)), description, notes.trim(), STYLE]
    .filter(Boolean).join(" ");
  return prompt.length > 1400 ? prompt.slice(0, 1400) : prompt;
}

export function planFor(id, biblePath) {
  let bible;
  try {
    bible = loadBible(biblePath);
  } catch (err) {
    // No native bible on this host (CI, fresh box) — an honest failure, not a throw.
    return { ok: false, reason: "no_native_bible", error: String(err?.code || err?.message || err) };
  }
  const entry = bible.get(id);
  if (!entry) return { ok: false, reason: "unknown_bible_id", id };
  return {
    ok: true,
    id,
    displayName: entry.display_name,
    batch: entry.batch,
    worldIds: entry.world_ids || [],
    tags: entry.taxonomy_tags || [],
    prompt: conceptPrompt(entry),
    ...budgetFor(entry),
  };
}

const MAX_PROMPT_CHARS = 600;

/**
 * planForPrompt — the ad-hoc sibling of planFor: builds a plan from free text
 * instead of a curated native-bible id, so a live caller (ConKay's design
 * surface) can request organic generation for something that was never
 * pre-authored. Reuses the same FRAMING/STYLE contract every bible entry gets
 * — a caller's raw description can't accidentally omit the single-subject/
 * plain-backdrop/no-text constraints the pipeline depends on.
 *
 * `opts.tags` hints budgetFor()'s category vocabulary (e.g. ["architecture"],
 * ["flora"], ["monster"]) — defaults to ["environment"] (a moderate 8000-tri
 * general-purpose prop budget) when the caller doesn't know the shape of what
 * they're asking for. `opts.lod0MaxTris` overrides the budget outright but is
 * capped at 20000 — an unreviewed ad-hoc request never gets boss-tier budget.
 */
export function planForPrompt(text, opts = {}) {
  const prompt = String(text || "").trim();
  if (!prompt) return { ok: false, reason: "empty_prompt" };
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, reason: "prompt_too_long" };
  const tags = Array.isArray(opts.tags) && opts.tags.length ? opts.tags.map(String) : ["environment"];
  const displayName = typeof opts.displayName === "string" && opts.displayName.trim()
    ? opts.displayName.trim().slice(0, 80)
    : prompt.slice(0, 60);
  const budget = budgetFor({ display_name: displayName, taxonomy_tags: tags, batch: "adhoc" });
  const lod0MaxTris = Number.isInteger(opts.lod0MaxTris) && opts.lod0MaxTris > 0
    ? Math.min(opts.lod0MaxTris, 20000)
    : budget.lod0MaxTris;
  const full = [FRAMING.replace("{noun}", "object"), prompt, STYLE].filter(Boolean).join(" ");
  return {
    ok: true,
    id: null, // ad-hoc: no bible id — the caller (jobs layer) assigns a synthetic one
    displayName,
    batch: "adhoc",
    worldIds: [],
    tags,
    prompt: full.length > 1400 ? full.slice(0, 1400) : full,
    category: budget.category,
    lod0MaxTris,
  };
}
