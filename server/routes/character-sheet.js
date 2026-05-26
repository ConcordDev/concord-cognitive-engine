// server/routes/character-sheet.js
//
// GET /api/character-sheet/me
//
// Returns the player's full categorised loadout — weapons (with class +
// category), spells (with school + element), powers (skills whose names
// match the superhero archetype patterns), and skills (bucketed by
// category). All categorisation runs through the taxonomies + loadout
// inferers, so the new 100+ weapon classes / 28 elements / 17 schools /
// 24 powers / 11 skill categories surface to the UI without each
// downstream component needing to know the taxonomy.

import express from "express";
import { getLoadout, getWeaponClassInfo, inferWeaponClass } from "../lib/combat/loadout.js";
import {
  inferElement, inferSpellSchool, inferPowerType, inferSkillType,
  getElementInfo, getSpellSchoolInfo, getPowerTypeInfo, getSkillTypeInfo,
} from "../lib/combat/taxonomies.js";

export default function createCharacterSheetRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/me", requireAuth, (req, res) => {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });

    try {
      // ── Loadout (weapons + cosmetic slots) ────────────────────────
      const loadout = getLoadout(db, userId);
      const decorate = (item) => {
        if (!item) return null;
        let cls = item.weapon_class || null;
        let hand = item.handedness || "either";
        if (!cls) {
          const inf = inferWeaponClass(item.item_name || "", item.meta || null);
          cls = inf.weaponClass;
          hand = inf.handedness;
        }
        const info = cls ? getWeaponClassInfo(cls) : null;
        return {
          ...item,
          weapon_class: cls,
          handedness: hand,
          category: info?.category || null,
          reach_m: info?.reach_m ?? null,
          amorphous: !!info?.amorphous,
        };
      };
      const decoratedLoadout = loadout ? {
        rightHand: decorate(loadout.rightHand),
        leftHand:  decorate(loadout.leftHand),
        head:      decorate(loadout.head),
        body:      decorate(loadout.body),
        accessory: decorate(loadout.accessory),
      } : null;

      // ── Spells (composed glyph chains) ────────────────────────────
      let spellRows = [];
      try {
        spellRows = db.prepare(`
          SELECT id, name, element, max_damage, range_m, composed_glyph,
                 component_chain, mana_cost, stamina_cost, cooldown_s, created_at
          FROM player_glyph_spells WHERE user_id = ?
          ORDER BY created_at DESC LIMIT 200
        `).all(userId);
      } catch { /* table may not exist on a fresh boot — return empty */ }
      const decoratedSpells = spellRows.map((s) => {
        // Element comes from glyph-spells composition; fall back to name infer
        // if the stored value isn't in the registry (e.g. player-invented).
        const elInfo = getElementInfo(s.element);
        const elFromName = elInfo ? null : inferElement(s.name || "");
        const schoolFromName = inferSpellSchool(s.name || "");
        return {
          ...s,
          element_category: elInfo?.category || elFromName?.category || null,
          school: schoolFromName.school,
          school_info: schoolFromName.school ? getSpellSchoolInfo(schoolFromName.school) : null,
          amorphous: !elInfo && !elFromName?.element,
        };
      });

      // ── Skills + Powers — both pulled from player_skill_levels ────
      // A "power" is a skill whose name matches a superhero archetype
      // (flight, telekinesis, super_strength, etc.). Everything else
      // is a regular trainable skill (combat / movement / crafting / ...).
      let skillRows = [];
      try {
        skillRows = db.prepare(`
          SELECT skill_type, native_world_type, level, xp, xp_to_next, last_used_at
          FROM player_skill_levels WHERE user_id = ?
          ORDER BY level DESC, xp DESC
        `).all(userId);
      } catch { /* table may not exist on a fresh boot */ }

      const powers = [];
      const skills = [];
      for (const row of skillRows) {
        const name = row.skill_type || "";
        const powerInf = inferPowerType(name);
        if (powerInf.power) {
          powers.push({
            ...row,
            power: powerInf.power,
            power_category: powerInf.category,
            power_info: getPowerTypeInfo(powerInf.power),
          });
        } else {
          const skillInf = inferSkillType(name);
          skills.push({
            ...row,
            skill_category: skillInf.skill,
            skill_info: skillInf.skill ? getSkillTypeInfo(skillInf.skill) : null,
          });
        }
      }

      return res.json({
        ok: true,
        sheet: {
          userId,
          loadout: decoratedLoadout,
          spells: decoratedSpells,
          powers,
          skills,
        },
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  return router;
}
