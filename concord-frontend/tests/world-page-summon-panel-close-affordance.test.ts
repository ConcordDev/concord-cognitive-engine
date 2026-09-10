// World Lens plan Phase 5 (Panels: Glance → Summon → Sanctum) — converting
// showPanel==='X' modals to the shared SummonDrawer primitive.
//
// Auditing every showPanel branch found a real, repeated interaction bug,
// not just a code-consistency nit: 14 panels (chat, map, players, profile,
// collaboration, livecollab, socialproof, notifications, smartnotify,
// moderation, ownership, federation, voice, voiceassist) rendered their
// inner component with NO onClose prop passed, and — verified by grep —
// none of those inner components (ChatSystem, MapNavigation,
// PlayerPresence, PlayerProfile, CollaborationTools, LiveCollaboration,
// SocialProofFeed, NotificationFeed, SmartNotifications, ModerationPanel,
// OwnershipProfile, FederationPanel, VoiceInterface, VoiceAssistant)
// implement a close button internally either. Once opened via the
// toolbar, the only way to close any of them was re-toggling the exact
// same toolbar button — no visible close affordance at all.
//
// Every one of these now renders inside <SummonDrawer>, which supplies a
// real close button wired to setShowPanel('none') without touching any of
// the 14 inner component files. The `timeline` panel (which already had
// its own working close button, just hand-rolled shell markup duplicating
// what SummonDrawer now provides) was also standardized onto the shared
// primitive.
//
// Panels NOT converted (inventory, character, quests, questlog, crafting,
// guild, season, leaderboard, eventboard, auctions, arena, jobs, lore, and
// the players/guild CoopPanel branch) were individually verified (grep for
// onClose in each inner component) to already implement real, working
// close functionality internally — mechanically wrapping them in a SECOND
// shell would have produced a double header/close-button, so they were
// correctly left alone rather than force-converted for the sake of using
// one shared component everywhere.
//
// page.tsx is too large to mount in jsdom — this file follows the
// established source-pinning pattern used throughout this plan's work.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'),
  'utf8'
);

const CONVERTED_PANELS = [
  'chat', 'map', 'timeline',
  'players', 'profile', 'collaboration', 'livecollab', 'socialproof',
  'notifications', 'smartnotify', 'moderation', 'ownership', 'federation',
  'voice', 'voiceassist',
];

describe('Phase 5 fix — 15 panels now have a real dismiss affordance via SummonDrawer (source-shape pins; page.tsx is too large to mount in this suite)', () => {
  it('page.tsx source imports SummonDrawer', () => {
    expect(pageSrc).toMatch(/import \{ SummonDrawer \} from '@\/components\/lens\/SummonDrawer';/);
  });

  it('every converted panel branch renders inside <SummonDrawer open ... onClose={() => setShowPanel(\'none\')}>', () => {
    for (const key of CONVERTED_PANELS) {
      const branchStart = pageSrc.indexOf(`showPanel === '${key}' &&`);
      expect(branchStart, `showPanel === '${key}' branch not found`).toBeGreaterThan(-1);
      // The SummonDrawer open tag should appear within a short window after
      // the branch condition (same JSX block, not some unrelated later use).
      const window_ = pageSrc.slice(branchStart, branchStart + 400);
      // `\s+` between the tag and `open`, not a literal space: several panels
      // (profile, among others) are formatted multi-line —
      //     <SummonDrawer
      //       open
      //       title={...}
      // — and a matcher requiring them adjacent fails on correct source. The
      // claim being pinned is "this branch opens a SummonDrawer", which is
      // formatting-independent; encoding one specific line break into the
      // regex made the test brittle rather than stricter.
      expect(window_, `${key} branch does not open a SummonDrawer nearby`).toMatch(/<SummonDrawer\s+open/);
      // Likewise, don't demand ONE exact onClose spelling. Several panels do
      // real extra teardown alongside the dismiss —
      //     onClose={() => { setShowPanel('none'); clearViewedProfile(); }}
      // — which is MORE correct than the bare form, not a deviation from it.
      // The pinned claim is "closing this drawer returns showPanel to 'none'",
      // so match an onClose whose body reaches setShowPanel('none'), and keep
      // the window tight enough that it's this branch's own handler.
      expect(window_, `${key} branch's SummonDrawer does not close via setShowPanel\\('none'\\)`)
        .toMatch(/onClose=\{\(\)\s*=>\s*\{?[^}]*setShowPanel\('none'\)/);
    }
  });

  it('the old ad-hoc "absolute top-4 left-4 z-20 ... pointer-events-auto" wrapper is gone from the chat/map/players/profile region (replaced, not duplicated)', () => {
    // Spot-check a couple of the converted branches specifically, rather
    // than asserting the substring is absent globally — other, correctly
    // NOT-converted panels legitimately still use this exact wrapper.
    const chatBranch = pageSrc.slice(
      pageSrc.indexOf("showPanel === 'chat' &&"),
      pageSrc.indexOf("showPanel === 'chat' &&") + 300
    );
    expect(chatBranch).not.toMatch(/absolute top-4 left-4 z-20 w-96 max-h-\[70vh\] overflow-auto pointer-events-auto/);
  });
});

describe('Phase 5 — panels correctly left unconverted already have their own real, working dismiss functionality (verified via source review, not re-tested here)', () => {
  it('lists the deliberately-unconverted panels and the inner component each one already implements its own dismiss affordance for (structural inventory pin, not a behavioral assertion — see the body comment)', () => {
    // Not a behavioral assertion (these components live in separate files,
    // individually verified via `grep -c onClose` before this decision was
    // made) — this test exists so a future pass that DOES convert one of
    // these has to consciously touch this list, not silently regress the
    // "don't double-wrap components with their own shell" invariant.
    const unconverted = [
      'inventory', 'character', 'quests', 'questlog', 'crafting',
      'guild', 'season', 'leaderboard', 'eventboard', 'auctions',
      'arena', 'jobs', 'lore',
    ];
    for (const key of unconverted) {
      expect(pageSrc).toMatch(new RegExp(`showPanel === '${key}'`));
    }
  });
});
