/**
 * Phoneme-driven lip sync.
 *
 * NPCs in Concordia don't have pre-recorded voices — they're agentic. Their
 * dialogue is streamed text. To still get convincing mouth movement the
 * audit called for, this module turns text into a phoneme schedule and
 * drives the existing facial-blend-shapes mouth visemes accordingly.
 *
 * Pipeline:
 *   1. textToPhonemes(text) — coarse English-grapheme → phoneme mapping.
 *      Not linguistically rigorous; engineered for plausible mouth shapes.
 *   2. phonemesToVisemes(phonemes, opts) — schedules viseme keyframes:
 *      "AA" / "AE" / "EE" / "OO" / "MM" / "FV" / "TH" / "REST".
 *   3. drivePhonemes(controller, schedule) — feeds keyframes into the
 *      facial controller each frame; lerps morphTargetInfluences for the
 *      current and next viseme.
 *
 * Typical usage at the call site:
 *   const schedule = buildLipSyncSchedule(npcSpokenText, { wpm: 180 });
 *   driver.run(schedule, facialController);
 *
 * The viseme names align with the facial-blend-shapes dictionary; missing
 * morph targets degrade gracefully to no-op.
 */

const VISEMES = ["REST", "AA", "AE", "EE", "OO", "MM", "FV", "TH"] as const;
type Viseme = typeof VISEMES[number];

interface VisemeKeyframe {
  startMs: number;
  duration: number;
  viseme: Viseme;
  weight: number; // peak influence
}

export interface LipSyncSchedule {
  durationMs: number;
  keyframes: VisemeKeyframe[];
}

/* ── Text → phoneme (coarse) ──────────────────────────────────────── */

const PHONEME_MAP: Record<string, Viseme> = {
  // Vowels
  a: "AA", á: "AA", à: "AA", â: "AA",
  e: "EE", é: "EE", è: "EE", ê: "EE",
  i: "EE", í: "EE", ì: "EE", î: "EE",
  o: "OO", ó: "OO", ò: "OO", ô: "OO",
  u: "OO", ú: "OO", ù: "OO", û: "OO",
  y: "EE",

  // Bilabial / labiodental
  m: "MM", b: "MM", p: "MM",
  f: "FV", v: "FV", w: "OO",

  // Dental / interdental
  th: "TH", t: "TH", d: "TH",

  // Sibilants → use AE which is open with teeth visible
  s: "AE", z: "AE", c: "AE", x: "AE",

  // Defaults
  k: "AE", g: "AE", h: "AE", n: "AE", r: "AE", l: "AE", j: "EE", q: "AE",
};

function tokenize(text: string): string[] {
  // Normalize, lowercase, split into syllable-ish chunks.
  const t = String(text).toLowerCase().replace(/[^a-z0-9áéíóúàèìòùâêîôû\s]/g, " ");
  return t.split(/\s+/).filter(Boolean);
}

function wordToVisemes(word: string): Viseme[] {
  const out: Viseme[] = [];
  let i = 0;
  while (i < word.length) {
    const two = word.slice(i, i + 2);
    if (two === "th") { out.push("TH"); i += 2; continue; }
    if (two === "ch" || two === "sh") { out.push("AE"); i += 2; continue; }
    if (two === "oo") { out.push("OO"); i += 2; continue; }
    if (two === "ee" || two === "ea") { out.push("EE"); i += 2; continue; }
    const c = word[i];
    out.push(PHONEME_MAP[c] ?? "REST");
    i += 1;
  }
  return out;
}

/**
 * Build a lip-sync schedule for spoken text.
 *
 * @param text Text the NPC is speaking
 * @param opts wpm — words per minute (default 180); peakWeight — max morph
 *             influence (default 0.85); restGapMs — silence between words.
 */
export function buildLipSyncSchedule(text: string, opts: { wpm?: number; peakWeight?: number; restGapMs?: number } = {}): LipSyncSchedule {
  const wpm = opts.wpm ?? 180;
  const peakWeight = opts.peakWeight ?? 0.85;
  const restGapMs = opts.restGapMs ?? 90;
  const words = tokenize(text);
  if (words.length === 0) return { durationMs: 0, keyframes: [] };

  // Average chars-per-word × per-char duration.
  const charMs = (60_000 / wpm) / 5; // ~5 chars/word
  const keyframes: VisemeKeyframe[] = [];
  let cursor = 0;

  for (const w of words) {
    const visemes = wordToVisemes(w);
    for (const v of visemes) {
      const duration = Math.max(40, charMs);
      keyframes.push({
        startMs:  cursor,
        duration,
        viseme:   v,
        weight:   v === "REST" ? 0 : peakWeight,
      });
      cursor += duration;
    }
    // Inter-word gap
    keyframes.push({ startMs: cursor, duration: restGapMs, viseme: "REST", weight: 0 });
    cursor += restGapMs;
  }

  return { durationMs: cursor, keyframes };
}

/* ── Driver ──────────────────────────────────────────────────────── */

interface FacialController {
  setMorphTarget?: (name: string, weight: number) => void;
  // Some controllers expose direct mesh access:
  mesh?: {
    morphTargetDictionary?: Record<string, number>;
    morphTargetInfluences?: number[];
  };
}

function _setVisemeWeight(controller: FacialController, viseme: Viseme, weight: number): void {
  // Try the controller's named API first
  if (controller.setMorphTarget) {
    try { controller.setMorphTarget(viseme.toLowerCase(), weight); return; } catch { /* fall through */ }
  }
  // Direct mesh fallback
  const dict = controller.mesh?.morphTargetDictionary;
  const infl = controller.mesh?.morphTargetInfluences;
  if (!dict || !infl) return;
  const idx = dict[viseme.toLowerCase()];
  if (typeof idx === "number") infl[idx] = weight;
}

/**
 * Run a lip-sync schedule against a facial controller. Returns a stop()
 * function. Lerps between consecutive visemes (no popping). Cancels itself
 * on schedule completion.
 */
export function drivePhonemes(controller: FacialController, schedule: LipSyncSchedule): () => void {
  if (!controller || !schedule || schedule.keyframes.length === 0) return () => {};
  const start = performance.now();
  let cancelled = false;
  let lastSet: Viseme | null = null;

  const tick = () => {
    if (cancelled) return;
    const elapsed = performance.now() - start;
    if (elapsed >= schedule.durationMs) {
      // Reset all visemes
      for (const v of VISEMES) _setVisemeWeight(controller, v, 0);
      return;
    }

    // Find current keyframe
    let kf: VisemeKeyframe | undefined;
    for (let i = schedule.keyframes.length - 1; i >= 0; i--) {
      const k = schedule.keyframes[i];
      if (elapsed >= k.startMs) { kf = k; break; }
    }
    if (kf) {
      const tInKf = (elapsed - kf.startMs) / kf.duration;
      // Triangle envelope: ramp up first half, ramp down second half
      const env = tInKf < 0.5 ? tInKf * 2 : (1 - tInKf) * 2;
      _setVisemeWeight(controller, kf.viseme, kf.weight * Math.max(0, env));

      if (lastSet && lastSet !== kf.viseme) {
        _setVisemeWeight(controller, lastSet, 0);
      }
      lastSet = kf.viseme;
    }

    requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelled = true;
    for (const v of VISEMES) _setVisemeWeight(controller, v, 0);
  };
}

export const LIP_SYNC_VISEMES = VISEMES;
