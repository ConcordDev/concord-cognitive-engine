// server/domains/kingdoms.js
//
// Sprint C / Track D — macro surface for kingdoms / decrees / takeover /
// rebellion. The RulerHUD and DecreeComposer frontend lenses read these.

import {
  listKingdomsForWorld,
  getKingdom,
  recomputeCitizenLoyalty,
  decreesActiveForRegion,
  kingdomLoyaltySummary,
} from "../lib/kingdoms.js";
import {
  proposeDecree,
  issueDecree,
  revokeDecree,
} from "../lib/kingdom-decrees.js";
import {
  takeoverByConquest,
  takeoverByInheritance,
  takeoverByElection,
  deposeRuler,
} from "../lib/kingdom-takeover.js";
import {
  evaluateRebellionRisk,
  listRebellionsForKingdom,
} from "../lib/kingdom-rebellion.js";

export default function registerKingdomsMacros(register) {
  register("kingdoms", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId;
    if (!worldId) return { ok: false, reason: "no_world" };
    return { ok: true, kingdoms: listKingdomsForWorld(db, worldId) };
  });

  register("kingdoms", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    const k = getKingdom(db, input.kingdomId);
    if (!k) return { ok: false, reason: "not_found" };
    const loyalty = kingdomLoyaltySummary(db, input.kingdomId);
    const rebellions = listRebellionsForKingdom(db, input.kingdomId);
    return { ok: true, kingdom: k, loyalty, rebellions };
  });

  register("kingdoms", "kingdom_status", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return {
      ok: true,
      kingdom: getKingdom(db, input.kingdomId),
      loyalty: kingdomLoyaltySummary(db, input.kingdomId),
      rebellionRisk: evaluateRebellionRisk(db, input.kingdomId),
    };
  });

  // kingdoms.my_realm — used by the in-world RulerHUD. Returns the
  // first realm where ruler_kind='player' AND ruler_id=actor.userId,
  // bundled with loyalty + rebellion risk + active decrees +
  // pending-threat (rebellion-leader) list. Null if player rules
  // nothing.
  register("kingdoms", "my_realm", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: true, realm: null };
    let realm;
    try {
      realm = db.prepare(`
        SELECT id, name, world_id, capital_settlement_id, faction_id,
               ruler_kind, ruler_id, legitimacy, treasury, tax_rate,
               founded_at, next_decree_at, updated_at
        FROM realms WHERE ruler_kind = 'player' AND ruler_id = ?
        ORDER BY founded_at ASC LIMIT 1
      `).get(userId);
    } catch { return { ok: true, realm: null }; }
    if (!realm) return { ok: true, realm: null };

    let loyalty = null, rebellionRisk = null, activeDecrees = [], rebellions = [];
    try { loyalty = kingdomLoyaltySummary(db, realm.id); } catch { /* noop */ }
    try { rebellionRisk = evaluateRebellionRisk(db, realm.id); } catch { /* noop */ }
    try {
      activeDecrees = db.prepare(`
        SELECT id, kind, body_json, issued_at, expires_at, popularity_delta
        FROM realm_decrees WHERE kingdom_id = ? AND effect_state = 'active'
        ORDER BY issued_at DESC LIMIT 10
      `).all(realm.id);
    } catch { /* noop */ }
    try { rebellions = listRebellionsForKingdom(db, realm.id); } catch { /* noop */ }

    return { ok: true, realm, loyalty, rebellionRisk, activeDecrees, rebellions };
  });

  register("kingdoms", "decrees_for_region", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.regionId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, decrees: decreesActiveForRegion(db, input.regionId) };
  });

  register("kingdoms", "propose_decree", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.kingdomId || !input.kind) return { ok: false, reason: "missing_inputs" };
    // Player ruler check is enforced inside proposeDecree (issuedByKind +
    // ruler_id match).
    const r = proposeDecree(db, input.kingdomId, {
      kind: input.kind,
      body: input.body || {},
      issuedByKind: "player",
      issuedById: userId,
    });
    if (r?.ok && r.id) {
      issueDecree(db, r.id, { io: ctx?.app?.locals?.io });
    }
    return r;
  });

  register("kingdoms", "revoke_decree", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.decreeId) return { ok: false, reason: "missing_inputs" };
    const userId = ctx?.actor?.userId;
    return revokeDecree(db, input.decreeId, userId);
  });

  register("kingdoms", "recompute_loyalty", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return recomputeCitizenLoyalty(db, input.kingdomId);
  });

  // Takeover paths.
  register("kingdoms", "takeover_conquest", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByConquest(db, userId, input.kingdomId, input.proof || {});
  });

  register("kingdoms", "takeover_inheritance", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByInheritance(db, userId, input.kingdomId, {
      viaSchemeId: input.viaSchemeId, heirOfNpcId: input.heirOfNpcId,
    });
  });

  register("kingdoms", "takeover_election", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByElection(db, userId, input.kingdomId, {
      proposalId: input.proposalId, voterTurnoutOk: input.voterTurnoutOk !== false,
    });
  });

  register("kingdoms", "depose_ruler", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return deposeRuler(db, input.kingdomId, input.reason);
  });

  // ─────────────────────────────────────────────────────────────────────
  // 2026 parity — Crusader Kings III realm-management surface.
  //
  // Adds dynasty/succession, council/vassals, diplomacy, war/casus-belli,
  // realm economy, intrigue/schemes, and a law editor. All per-user
  // persistent state lives on globalThis._concordSTATE Maps keyed by
  // userId — the kingdoms lens did not own a migration for these layers,
  // and CK-style realm play is per-player anyway.
  // ─────────────────────────────────────────────────────────────────────

  function kdState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.kingdomsLens) {
      STATE.kingdomsLens = {
        characters: new Map(), // userId -> Map<charId, character>
        marriages: new Map(),  // userId -> Array<marriage>
        council: new Map(),    // userId -> Map<seat, appointment>
        treaties: new Map(),   // userId -> Map<treatyId, treaty>
        claims: new Map(),     // userId -> Map<claimId, claim>
        wars: new Map(),       // userId -> Map<warId, war>
        economy: new Map(),    // userId -> economy record
        schemes: new Map(),    // userId -> Map<schemeId, scheme>
        law: new Map(),        // userId -> law record
      };
    }
    return STATE.kingdomsLens;
  }
  function kdSave() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* best effort */ }
    }
  }
  function kdActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function kdId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function kdNow() { return Date.now(); }

  // ── Character / dynasty system ──────────────────────────────────────

  const COUNCIL_SEATS = Object.freeze(["chancellor", "steward", "marshal", "spymaster", "court_chaplain"]);
  const SUCCESSION_LAWS = Object.freeze(["primogeniture", "gavelkind", "elective", "ultimogeniture", "seniority"]);
  const CASUS_BELLI = Object.freeze(["conquest", "claim_press", "holy_war", "de_jure", "raid", "subjugation"]);

  function ensureMap(rootMap, userId) {
    let m = rootMap.get(userId);
    if (!m) { m = new Map(); rootMap.set(userId, m); }
    return m;
  }

  register("kingdoms", "char_create", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const name = String(input.name || "").trim();
      if (!name) return { ok: false, error: "name_required" };
      const m = ensureMap(s.characters, userId);
      const id = kdId("char");
      const char = {
        id,
        name,
        gender: input.gender === "female" ? "female" : "male",
        bornAt: kdNow(),
        age: Number.isFinite(input.age) ? Math.max(0, Math.min(110, Math.round(input.age))) : 25,
        parentIds: Array.isArray(input.parentIds) ? input.parentIds.slice(0, 2) : [],
        spouseId: null,
        alive: true,
        traits: Array.isArray(input.traits) ? input.traits.slice(0, 8).map(String) : [],
        martial: clamp01to20(input.martial),
        diplomacy: clamp01to20(input.diplomacy),
        stewardship: clamp01to20(input.stewardship),
        intrigue: clamp01to20(input.intrigue),
        isRuler: !!input.isRuler && ![...m.values()].some((c) => c.isRuler),
      };
      m.set(id, char);
      kdSave();
      return { ok: true, result: { character: char } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  function clamp01to20(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 5;
    return Math.max(0, Math.min(20, Math.round(n)));
  }

  register("kingdoms", "dynasty_tree", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.characters.get(userId);
      const chars = m ? [...m.values()] : [];
      const marriages = s.marriages.get(userId) || [];
      const law = s.law.get(userId) || { succession: "primogeniture" };
      // succession heir computation
      const ruler = chars.find((c) => c.isRuler && c.alive) || null;
      let heir = null;
      if (ruler) {
        const kids = chars.filter((c) => c.alive && c.parentIds.includes(ruler.id));
        if (kids.length) {
          const sorted = [...kids].sort((a, b) => a.age - b.age);
          if (law.succession === "primogeniture") heir = sorted[sorted.length - 1];
          else if (law.succession === "ultimogeniture") heir = sorted[0];
          else if (law.succession === "seniority") heir = chars.filter((c) => c.alive).sort((a, b) => b.age - a.age)[0];
          else heir = sorted[sorted.length - 1];
        }
      }
      return {
        ok: true,
        result: { characters: chars, marriages, ruler, heir, successionLaw: law.succession, count: chars.length },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "char_marry", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.characters.get(userId);
      const a = m?.get(input.aId);
      const b = m?.get(input.bId);
      if (!a || !b) return { ok: false, error: "character_not_found" };
      if (a.id === b.id) return { ok: false, error: "cannot_self_marry" };
      if (a.spouseId || b.spouseId) return { ok: false, error: "already_married" };
      a.spouseId = b.id; b.spouseId = a.id;
      const marriages = s.marriages.get(userId) || [];
      const marriage = { id: kdId("mar"), aId: a.id, bId: b.id, weddedAt: kdNow(), alliance: !!input.alliance };
      marriages.push(marriage);
      s.marriages.set(userId, marriages);
      kdSave();
      return { ok: true, result: { marriage } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "char_death", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.characters.get(userId);
      const c = m?.get(input.charId);
      if (!c) return { ok: false, error: "character_not_found" };
      c.alive = false;
      c.diedAt = kdNow();
      let successionTriggered = false;
      let newRuler = null;
      if (c.isRuler) {
        c.isRuler = false;
        successionTriggered = true;
        const law = s.law.get(userId) || { succession: "primogeniture" };
        const heirs = [...m.values()].filter((x) => x.alive && x.parentIds.includes(c.id));
        if (heirs.length) {
          const sorted = heirs.sort((a, b) => a.age - b.age);
          newRuler = law.succession === "ultimogeniture" ? sorted[0] : sorted[sorted.length - 1];
          newRuler.isRuler = true;
        }
      }
      kdSave();
      return { ok: true, result: { character: c, successionTriggered, newRuler } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Law / succession-type editor ────────────────────────────────────

  register("kingdoms", "law_get", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const law = s.law.get(userId) || { succession: "primogeniture", genderLaw: "male_preference", crownAuthority: 1 };
      return { ok: true, result: { law, successionOptions: SUCCESSION_LAWS } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "law_set", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const succession = SUCCESSION_LAWS.includes(input.succession) ? input.succession : "primogeniture";
      const genderLaw = ["male_preference", "female_preference", "equal", "agnatic", "enatic"].includes(input.genderLaw)
        ? input.genderLaw : "male_preference";
      const crownAuthority = Math.max(0, Math.min(4, Math.round(Number(input.crownAuthority) || 1)));
      const law = { succession, genderLaw, crownAuthority, updatedAt: kdNow() };
      s.law.set(userId, law);
      kdSave();
      return { ok: true, result: { law } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Council / vassal management ─────────────────────────────────────

  register("kingdoms", "council_list", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.council.get(userId) || new Map();
      const seats = COUNCIL_SEATS.map((seat) => ({ seat, appointment: m.get(seat) || null }));
      return { ok: true, result: { seats, openSeats: seats.filter((x) => !x.appointment).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "council_appoint", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const seat = String(input.seat || "");
      if (!COUNCIL_SEATS.includes(seat)) return { ok: false, error: "invalid_seat" };
      const charId = String(input.charId || "");
      const chars = s.characters.get(userId);
      const c = chars?.get(charId);
      if (!c) return { ok: false, error: "character_not_found" };
      const m = ensureMap(s.council, userId);
      // each councilor pursues their own agenda, derived from their best stat
      const stats = { martial: c.martial, diplomacy: c.diplomacy, stewardship: c.stewardship, intrigue: c.intrigue };
      const topStat = Object.entries(stats).sort((a, b) => b[1] - a[1])[0][0];
      const AGENDAS = {
        martial: "raise levies and expand the borders",
        diplomacy: "broker alliances and smooth vassal relations",
        stewardship: "raise taxes and fill the treasury",
        intrigue: "uncover secrets and weaken rivals",
      };
      const appointment = {
        seat, charId, charName: c.name, appointedAt: kdNow(),
        agenda: AGENDAS[topStat], competence: stats[topStat],
        loyalty: 50 + Math.round((c.diplomacy - 10) * 2),
      };
      m.set(seat, appointment);
      kdSave();
      return { ok: true, result: { appointment } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "council_dismiss", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.council.get(userId);
      const seat = String(input.seat || "");
      if (!m || !m.has(seat)) return { ok: false, error: "seat_not_filled" };
      m.delete(seat);
      kdSave();
      return { ok: true, result: { dismissed: seat } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Diplomacy — alliances, treaties, tributes, fabricated claims ─────

  register("kingdoms", "diplomacy_list", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const treaties = [...(s.treaties.get(userId) || new Map()).values()];
      const claims = [...(s.claims.get(userId) || new Map()).values()];
      return { ok: true, result: { treaties, claims } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "treaty_propose", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const kind = ["alliance", "non_aggression", "tribute", "trade_pact", "vassalage"].includes(input.kind)
        ? input.kind : null;
      if (!kind) return { ok: false, error: "invalid_treaty_kind" };
      const counterparty = String(input.counterparty || "").trim();
      if (!counterparty) return { ok: false, error: "counterparty_required" };
      const m = ensureMap(s.treaties, userId);
      const id = kdId("trt");
      const treaty = {
        id, kind, counterparty,
        tributeAmount: kind === "tribute" ? Math.max(0, Math.round(Number(input.tributeAmount) || 0)) : 0,
        status: "proposed", createdAt: kdNow(),
      };
      m.set(id, treaty);
      kdSave();
      return { ok: true, result: { treaty } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "treaty_resolve", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.treaties.get(userId);
      const t = m?.get(input.treatyId);
      if (!t) return { ok: false, error: "treaty_not_found" };
      const status = ["accepted", "rejected", "broken"].includes(input.status) ? input.status : "rejected";
      t.status = status; t.resolvedAt = kdNow();
      kdSave();
      return { ok: true, result: { treaty: t } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "claim_fabricate", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const target = String(input.target || "").trim();
      if (!target) return { ok: false, error: "target_required" };
      const m = ensureMap(s.claims, userId);
      const id = kdId("clm");
      // a fabricated claim takes time to mature, then is press-able in war
      const claim = {
        id, target,
        title: String(input.title || `Claim on ${target}`),
        strength: Math.max(1, Math.min(100, Math.round(Number(input.strength) || 25))),
        fabricatedAt: kdNow(),
        maturesAt: kdNow() + 1000 * 60 * 30,
        status: "fabricating",
      };
      m.set(id, claim);
      kdSave();
      return { ok: true, result: { claim } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── War / casus belli with troop levies + battle resolution ─────────

  register("kingdoms", "war_list", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const wars = [...(s.wars.get(userId) || new Map()).values()];
      return { ok: true, result: { wars, casusBelli: CASUS_BELLI } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "war_declare", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const target = String(input.target || "").trim();
      if (!target) return { ok: false, error: "target_required" };
      const cb = CASUS_BELLI.includes(input.casusBelli) ? input.casusBelli : null;
      if (!cb) return { ok: false, error: "invalid_casus_belli" };
      const m = ensureMap(s.wars, userId);
      const id = kdId("war");
      const levies = Math.max(0, Math.round(Number(input.levies) || 0));
      const war = {
        id, target, casusBelli: cb,
        attackerLevies: levies,
        defenderLevies: Math.max(0, Math.round(Number(input.defenderLevies) || Math.round(levies * (0.6 + Math.random() * 0.8)))),
        warScore: 0,
        battles: [],
        status: "active",
        declaredAt: kdNow(),
      };
      m.set(id, war);
      kdSave();
      return { ok: true, result: { war } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "war_battle", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.wars.get(userId);
      const war = m?.get(input.warId);
      if (!war) return { ok: false, error: "war_not_found" };
      if (war.status !== "active") return { ok: false, error: "war_not_active" };
      // deterministic-ish battle: levy advantage + commander martial bonus
      const commanderMartial = clamp01to20(input.commanderMartial);
      const atkStr = war.attackerLevies * (1 + commanderMartial / 25);
      const defStr = war.defenderLevies * (1 + 0.3);
      const total = atkStr + defStr || 1;
      const atkRoll = atkStr / total + (Math.random() - 0.5) * 0.3;
      const attackerWon = atkRoll > 0.5;
      const intensity = 0.15 + Math.random() * 0.25;
      const atkLoss = Math.round(war.attackerLevies * intensity * (attackerWon ? 0.6 : 1.2));
      const defLoss = Math.round(war.defenderLevies * intensity * (attackerWon ? 1.2 : 0.6));
      war.attackerLevies = Math.max(0, war.attackerLevies - atkLoss);
      war.defenderLevies = Math.max(0, war.defenderLevies - defLoss);
      war.warScore = Math.max(-100, Math.min(100, war.warScore + (attackerWon ? 18 : -14)));
      const battle = {
        id: kdId("btl"), at: kdNow(), attackerWon,
        attackerLosses: atkLoss, defenderLosses: defLoss, warScore: war.warScore,
      };
      war.battles.push(battle);
      if (war.warScore >= 100 || war.defenderLevies === 0) war.status = "attacker_victory";
      else if (war.warScore <= -100 || war.attackerLevies === 0) war.status = "defender_victory";
      kdSave();
      return { ok: true, result: { battle, war } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "war_end", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.wars.get(userId);
      const war = m?.get(input.warId);
      if (!war) return { ok: false, error: "war_not_found" };
      war.status = input.outcome === "white_peace" ? "white_peace"
        : war.warScore >= 0 ? "attacker_victory" : "defender_victory";
      war.endedAt = kdNow();
      kdSave();
      return { ok: true, result: { war } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Realm economy — taxes, treasury, building construction ──────────

  const BUILDINGS = Object.freeze({
    keep: { cost: 400, taxBonus: 0.02, levyBonus: 80, label: "Keep" },
    market: { cost: 350, taxBonus: 0.05, levyBonus: 0, label: "Market" },
    barracks: { cost: 300, taxBonus: 0, levyBonus: 150, label: "Barracks" },
    temple: { cost: 280, taxBonus: 0.03, levyBonus: 20, label: "Temple" },
    walls: { cost: 500, taxBonus: 0, levyBonus: 60, label: "City Walls" },
  });

  function ensureEconomy(s, userId) {
    let e = s.economy.get(userId);
    if (!e) {
      e = { treasury: 1000, taxRate: 0.10, buildings: [], updatedAt: kdNow() };
      s.economy.set(userId, e);
    }
    return e;
  }

  register("kingdoms", "economy_get", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const e = ensureEconomy(s, userId);
      const taxBonus = e.buildings.reduce((a, b) => a + (BUILDINGS[b.kind]?.taxBonus || 0), 0);
      const levyBonus = e.buildings.reduce((a, b) => a + (BUILDINGS[b.kind]?.levyBonus || 0), 0);
      const monthlyIncome = Math.round(1000 * (e.taxRate + taxBonus));
      return {
        ok: true,
        result: {
          economy: e,
          catalog: BUILDINGS,
          derived: { monthlyIncome, totalLevyBonus: levyBonus, effectiveTaxRate: e.taxRate + taxBonus },
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "economy_set_tax", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const e = ensureEconomy(s, userId);
      const rate = Number(input.taxRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 0.5) return { ok: false, error: "tax_rate_out_of_range" };
      e.taxRate = Math.round(rate * 100) / 100;
      e.updatedAt = kdNow();
      kdSave();
      return { ok: true, result: { economy: e } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "economy_build", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const kind = String(input.kind || "");
      const spec = BUILDINGS[kind];
      if (!spec) return { ok: false, error: "invalid_building" };
      const e = ensureEconomy(s, userId);
      if (e.treasury < spec.cost) return { ok: false, error: "insufficient_treasury" };
      e.treasury -= spec.cost;
      const building = { id: kdId("bld"), kind, label: spec.label, builtAt: kdNow() };
      e.buildings.push(building);
      e.updatedAt = kdNow();
      kdSave();
      return { ok: true, result: { building, treasury: e.treasury } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "economy_collect", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const e = ensureEconomy(s, userId);
      const taxBonus = e.buildings.reduce((a, b) => a + (BUILDINGS[b.kind]?.taxBonus || 0), 0);
      const income = Math.round(1000 * (e.taxRate + taxBonus));
      e.treasury += income;
      e.updatedAt = kdNow();
      kdSave();
      return { ok: true, result: { collected: income, treasury: e.treasury } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Intrigue / schemes — plots, secrets, assassination ──────────────

  const SCHEME_KINDS = Object.freeze({
    murder: { baseSuccess: 0.18, label: "Murder", discoveryRisk: 0.45 },
    seduce: { baseSuccess: 0.40, label: "Seduce", discoveryRisk: 0.25 },
    fabricate_hook: { baseSuccess: 0.55, label: "Fabricate Hook", discoveryRisk: 0.30 },
    abduct: { baseSuccess: 0.25, label: "Abduct", discoveryRisk: 0.50 },
    sway: { baseSuccess: 0.60, label: "Sway", discoveryRisk: 0.15 },
  });

  register("kingdoms", "scheme_list", async (ctx) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const schemes = [...(s.schemes.get(userId) || new Map()).values()];
      return { ok: true, result: { schemes, kinds: SCHEME_KINDS } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "scheme_start", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const kind = String(input.kind || "");
      const spec = SCHEME_KINDS[kind];
      if (!spec) return { ok: false, error: "invalid_scheme_kind" };
      const target = String(input.target || "").trim();
      if (!target) return { ok: false, error: "target_required" };
      const m = ensureMap(s.schemes, userId);
      const id = kdId("sch");
      const agentIntrigue = clamp01to20(input.agentIntrigue);
      const scheme = {
        id, kind, label: spec.label, target,
        progress: 0,
        successChance: Math.min(0.95, spec.baseSuccess + agentIntrigue / 40),
        discoveryRisk: spec.discoveryRisk,
        status: "plotting",
        startedAt: kdNow(),
      };
      m.set(id, scheme);
      kdSave();
      return { ok: true, result: { scheme } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  register("kingdoms", "scheme_advance", async (ctx, input = {}) => {
    try {
      const s = kdState();
      if (!s) return { ok: false, error: "state_unavailable" };
      const userId = kdActor(ctx);
      const m = s.schemes.get(userId);
      const sc = m?.get(input.schemeId);
      if (!sc) return { ok: false, error: "scheme_not_found" };
      if (sc.status !== "plotting") return { ok: false, error: "scheme_concluded" };
      sc.progress = Math.min(100, sc.progress + 20 + Math.round(Math.random() * 15));
      let discovered = false;
      if (Math.random() < sc.discoveryRisk * 0.4) { sc.status = "discovered"; discovered = true; }
      else if (sc.progress >= 100) {
        sc.status = Math.random() < sc.successChance ? "succeeded" : "failed";
      }
      kdSave();
      return { ok: true, result: { scheme: sc, discovered } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
