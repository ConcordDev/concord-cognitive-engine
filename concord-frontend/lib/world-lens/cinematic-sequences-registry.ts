/**
 * Phase W — registers all authored cinematic sequences with the
 * director at module import time. The bridge fires triggers; this
 * module ensures the matching authored sequence beats the generic
 * auto-template.
 *
 * Bundles every JSON in concord-frontend/content/cinematics/ at build
 * time via Next's static-asset import — no fetch round-trip needed.
 * These JSON files live inside the frontend tree (not the repo-root
 * content/ dir) so they're present inside the Docker build context,
 * whose root is ./concord-frontend.
 */

import { registerSequence, type CinematicSequence } from './cinematic-director';

import questLatticeRealised   from '../../content/cinematics/quest-lattice-realised.json';
import questEcologyRealised   from '../../content/cinematics/quest-ecology-realised.json';
import warDeclared            from '../../content/cinematics/war-declared.json';
import townCaptured           from '../../content/cinematics/town-captured.json';
import kingdomTakeover        from '../../content/cinematics/kingdom-takeover.json';
import rebellionFired         from '../../content/cinematics/rebellion-fired.json';
import bossArrival            from '../../content/cinematics/boss-arrival.json';
import velaReveal             from '../../content/cinematics/vela-reveal.json';
import arkArchiveUnlock       from '../../content/cinematics/ark-archive-unlock.json';
import heirAcceded            from '../../content/cinematics/heir-acceded.json';
import concordiaDeepCold      from '../../content/cinematics/concordia-deep-cold.json';

const ALL_SEQUENCES = [
  questLatticeRealised,
  questEcologyRealised,
  warDeclared,
  townCaptured,
  kingdomTakeover,
  rebellionFired,
  bossArrival,
  velaReveal,
  arkArchiveUnlock,
  heirAcceded,
  concordiaDeepCold,
] as unknown as CinematicSequence[];

let _registered = false;

/** Idempotent — safe to call multiple times. The bridge mounts this
 *  on world-lens entry. */
export function ensureCinematicsRegistered(): void {
  if (_registered) return;
  for (const seq of ALL_SEQUENCES) {
    try { registerSequence(seq); } catch { /* malformed sequence — skip */ }
  }
  _registered = true;
}
