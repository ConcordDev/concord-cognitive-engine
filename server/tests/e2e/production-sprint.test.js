// Phase D — Production sprint static-assertion E2E.
//
// Validates that the world lens mounts every new Phase D component
// via dynamic import, and that the new HTTP endpoints + helper functions
// are wired in server.js. This is a structural test: it doesn't boot
// the full server, just greps the working tree for the wires we shipped.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..", "..");

function readFile(p) {
  return readFileSync(path.resolve(ROOT, p), "utf8");
}

const WORLD = readFile("concord-frontend/app/lenses/world/page.tsx");
const SERVER = readFile("server/server.js");

describe("Phase D — Production sprint structural", () => {
  it("DA1 NPC action menu mounted", () => {
    assert.match(WORLD, /NPCActionMenu/);
  });

  it("DA2 station router mounted", () => {
    assert.match(WORLD, /StationInteractionRouter/);
  });

  it("DA3 command palette + DA4 hotbar mounted", () => {
    assert.match(WORLD, /CommandPalette/);
    assert.match(WORLD, /GameModesHotbarGroup/);
  });

  it("DB1 ClimbingTracker mounted + stamina route", () => {
    assert.match(WORLD, /ClimbingTracker/);
    assert.match(SERVER, /\/api\/players\/me\/stamina/);
  });

  it("DB2 BrawlInviteToast + BrawlActiveHUD mounted", () => {
    assert.match(WORLD, /BrawlInviteToast/);
    assert.match(WORLD, /BrawlActiveHUD/);
  });

  it("DB3 RogueliteRunHUD + UnlockShop mounted", () => {
    assert.match(WORLD, /RogueliteRunHUD/);
    assert.match(WORLD, /RogueliteUnlockShop/);
  });

  it("DB4 HordeWaveHUD mounted", () => {
    assert.match(WORLD, /HordeWaveHUD/);
  });

  it("DB5 farming building-scoped routes", () => {
    assert.match(SERVER, /\/api\/farming\/building\/:buildingId/);
    assert.match(SERVER, /\/api\/farming\/building\/:buildingId\/plant/);
    assert.match(SERVER, /\/api\/farming\/building\/:buildingId\/harvest/);
  });

  it("DB6 restaurant building-scoped route", () => {
    assert.match(SERVER, /\/api\/restaurant\/building\/:buildingId/);
  });

  it("DB8 HiddenObjectScenePanel mounted (event-triggered)", () => {
    assert.match(WORLD, /HiddenObjectScenePanel/);
  });

  it("DB9 PartyCombatHUD mounted + active-session route + helper", () => {
    assert.match(WORLD, /PartyCombatHUD/);
    assert.match(SERVER, /\/api\/party-combat\/active/);
    const lib = readFile("server/lib/party-combat.js");
    assert.match(lib, /findActiveSessionForPlayer/);
  });

  it("DB9 fluid combat: NO turn-based mode anywhere in world page", () => {
    // Sanity — the canonical Phase D combat is RTwP via party-combat.
    // Turn-based draft (CC1) was explicitly reverted.
    assert.doesNotMatch(WORLD, /TurnCombatHUD/);
  });

  it("DB11 code-puzzle list + get routes", () => {
    assert.match(SERVER, /\/api\/code-puzzle\/puzzles/);
    assert.match(SERVER, /\/api\/code-puzzle\/:puzzleId/);
  });

  it("DB13 TimeLoopHUD mounted", () => {
    assert.match(WORLD, /TimeLoopHUD/);
  });

  it("DB14 HorrorRoleHUDs mounted + active route + helper", () => {
    assert.match(WORLD, /HorrorRoleHUDs/);
    assert.match(SERVER, /\/api\/horror\/active/);
    const lib = readFile("server/lib/horror.js");
    assert.match(lib, /findActiveSessionForUser/);
  });

  it("DB16 ExtractionRunHUD mounted + active route", () => {
    assert.match(WORLD, /ExtractionRunHUD/);
    assert.match(SERVER, /\/api\/extraction\/active/);
  });

  it("DC1 sports leagues live components", () => {
    const sports = readFile("concord-frontend/app/lenses/sports/page.tsx");
    assert.match(sports, /LeagueStandings/);
    assert.match(sports, /MatchSimulator/);
    assert.match(sports, /'leagues'/);
  });

  it("DC2 courtship lens + overlay + routes", () => {
    assert.match(WORLD, /CourtshipProgressOverlay/);
    assert.match(SERVER, /\/api\/courtship\/propose/);
    assert.match(SERVER, /\/api\/courtship\/wed/);
    assert.match(SERVER, /\/api\/courtship\/marriages\/mine/);
    const lens = readFile("concord-frontend/app/lenses/courtship/page.tsx");
    assert.match(lens, /Heart/);
  });

  it("DC3 fishing hub lens + routes", () => {
    assert.match(SERVER, /\/api\/fishing\/catalog/);
    assert.match(SERVER, /\/api\/fishing\/catches\/mine/);
    assert.match(SERVER, /\/api\/fishing\/cast/);
    const lens = readFile("concord-frontend/app/lenses/fishing/page.tsx");
    assert.match(lens, /Catch log/);
  });

  it("DC6 creatures lens + world list route", () => {
    assert.match(SERVER, /\/api\/creatures\/world\/:worldId/);
    const lens = readFile("concord-frontend/app/lenses/creatures/page.tsx");
    assert.match(lens, /crossbreed|breed/i);
  });

  it("DC7 DriftAlertToast mounted", () => {
    assert.match(WORLD, /DriftAlertToast/);
  });

  it("DC8 reasoning traces lens + route", () => {
    assert.match(SERVER, /\/api\/reasoning\/traces/);
    const lens = readFile("concord-frontend/app/lenses/reasoning/traces/page.tsx");
    assert.match(lens, /HLR/);
  });

  it("DC10 glyph composer routes", () => {
    assert.match(SERVER, /\/api\/glyph-spells\/components/);
    assert.match(SERVER, /\/api\/glyph-spells\/mine/);
  });

  it("DC11 garage lens + spawn route", () => {
    assert.match(SERVER, /\/api\/garage\/spawn/);
    const lens = readFile("concord-frontend/app/lenses/garage/page.tsx");
    assert.match(lens, /vehicle/i);
  });

  it("DC12 FootprintLayer mounted + tracking recent route", () => {
    assert.match(WORLD, /FootprintLayer/);
    assert.match(SERVER, /\/api\/tracking\/recent\/:worldId/);
  });

  it("DC13 BloodlineTreeViewer mounted", () => {
    assert.match(WORLD, /BloodlineTreeViewer/);
  });

  it("DC14 NPCTraitInspector mounted", () => {
    assert.match(WORLD, /NPCTraitInspector/);
  });
});
