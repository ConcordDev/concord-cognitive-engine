namespace Concordia.Animation
{
    public static partial class AnimationVerbCatalog
    {
        static void RegisterHumanoid()
        {
            // L0 locomotion is driven by the Humanoid UAL1 clips bound in ConcordiaLocomotion.
            V("loc.idle", "locomotion", "humanoid", Hum, Auth, loop: true, loco: "idle", notes: "UAL1 Idle_Loop.");
            V("loc.idle_variant", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.idle_alert", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.idle_combat", "locomotion", "humanoid", Hum, Proc, loop: true, notes: "FightStyle stance overlay.");
            V("loc.idle_injured", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.walk", "locomotion", "humanoid", Hum, Auth, loop: true, loco: "walk", notes: "UAL1 Walk_Loop.");
            V("loc.walk_back", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "back");
            V("loc.walk_left", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "left");
            V("loc.walk_right", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "right");
            V("loc.jog", "locomotion", "humanoid", Hum, Missing, loop: true, loco: "jog");
            V("loc.run", "locomotion", "humanoid", Hum, Auth, loop: true, loco: "run", notes: "UAL1 Jog_Fwd_Loop.");
            V("loc.sprint", "locomotion", "humanoid", Hum, Auth, loop: true, loco: "sprint", notes: "UAL1 Sprint_Loop.");
            V("loc.strafe_left", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "left");
            V("loc.strafe_right", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "right");
            V("loc.backpedal", "locomotion", "humanoid", Hum, Missing, loop: true, direction: "back");
            V("loc.turn_45", "locomotion", "humanoid", Hum, Missing, direction: "turn");
            V("loc.turn_90", "locomotion", "humanoid", Hum, Missing, direction: "turn");
            V("loc.turn_180", "locomotion", "humanoid", Hum, Missing, direction: "turn");
            V("loc.start", "locomotion", "humanoid", Hum, Missing);
            V("loc.stop", "locomotion", "humanoid", Hum, Missing);
            V("loc.crouch", "locomotion", "humanoid", Hum, Missing, loop: true, notes: "Ethan HumanoidCrouch exists, unwired.");
            V("loc.crouch_walk", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.prone", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.crawl", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.limp", "locomotion", "humanoid", Hum, Missing, loop: true);
            V("loc.sit", "locomotion", "humanoid", Hum, Proc, loop: true, notes: "ModularPerson sit overlay.");

            // Traversal
            V("trav.jump_start", "traversal", "humanoid", Hum, Auth, interruptible: false, evt: "jump");
            V("trav.jump_air", "traversal", "humanoid", Hum, Proc, loop: true, notes: "MixamoAvatar airborne overlay; Ethan HumanoidMidAir unwired.");
            V("trav.jump_land", "traversal", "humanoid", Hum, Auth, notes: "UAL1 Jump_Land.");
            V("trav.fall", "traversal", "humanoid", Hum, Missing, loop: true);
            V("trav.dodge", "traversal", "humanoid", Hum, Auth, rootMotion: true, interruptible: false, evt: "dodge",
                notes: "UAL1 Roll bound to the Dodge state; motor still owns i-frames.");
            V("trav.dodge_forward", "traversal", "humanoid", Hum, Missing, direction: "forward", evt: "dodge");
            V("trav.dodge_back", "traversal", "humanoid", Hum, Missing, direction: "back", evt: "dodge");
            V("trav.dodge_left", "traversal", "humanoid", Hum, Missing, direction: "left", evt: "dodge");
            V("trav.dodge_right", "traversal", "humanoid", Hum, Missing, direction: "right", evt: "dodge");
            V("trav.dodge_roll", "traversal", "humanoid", Hum, Missing, rootMotion: true, evt: "dodge_roll");
            V("trav.roll_forward", "traversal", "humanoid", Hum, Missing, direction: "forward");
            V("trav.roll_back", "traversal", "humanoid", Hum, Missing, direction: "back");
            V("trav.roll_left", "traversal", "humanoid", Hum, Missing, direction: "left");
            V("trav.roll_right", "traversal", "humanoid", Hum, Missing, direction: "right");
            V("trav.vault_low", "traversal", "humanoid", Hum, Missing);
            V("trav.vault_medium", "traversal", "humanoid", Hum, Missing);
            V("trav.mantle", "traversal", "humanoid", Hum, Missing);
            V("trav.climb_ladder", "traversal", "humanoid", Hum, Missing, loop: true);
            V("trav.climb_ledge", "traversal", "humanoid", Hum, Missing);
            V("trav.slide", "traversal", "humanoid", Hum, Missing);
            V("trav.swim", "traversal", "humanoid", Hum, Missing, loop: true);
            V("trav.swim_fast", "traversal", "humanoid", Hum, Missing, loop: true);
            V("trav.dive", "traversal", "humanoid", Hum, Missing);
            V("trav.surface", "traversal", "humanoid", Hum, Missing);

            // L0 combat/reaction clips are authored UAL1 states; gameplay timing remains authoritative.
            V("combat.light", "combat", "unarmed", Hum, Auth, intensity: "light", evt: "attack",
                notes: "UAL1 Sword_Attack bound to LightAttack.");
            V("combat.light_2", "combat", "unarmed", Hum, Proc, intensity: "light");
            V("combat.light_3", "combat", "unarmed", Hum, Proc, intensity: "light");
            V("combat.heavy", "combat", "unarmed", Hum, Proc, intensity: "heavy", evt: "attack_heavy");
            V("combat.jab", "combat", "unarmed", Hum, Missing, weapon: "unarmed");
            V("combat.cross", "combat", "unarmed", Hum, Missing, weapon: "unarmed");
            V("combat.hook", "combat", "unarmed", Hum, Missing, weapon: "unarmed");
            V("combat.uppercut", "combat", "unarmed", Hum, Missing, weapon: "unarmed");
            V("combat.kick", "combat", "unarmed", Hum, Proc, weapon: "unarmed", notes: "Capoeira/MuayThai beat overlay.");
            V("combat.grapple", "combat", "unarmed", Hum, Missing);
            V("combat.shove", "combat", "unarmed", Hum, Missing);
            V("combat.block", "combat", "defense", Hum, Proc, evt: "guard", notes: "Guard action exists; no clip.");
            V("combat.parry", "combat", "defense", Hum, Proc, evt: "parry");
            V("combat.counter", "combat", "defense", Hum, Missing);

            foreach (var w in new[] { "sword", "greatsword", "axe", "mace", "hammer", "polearm", "spear", "halberd", "scythe", "shield" })
            {
                V("combat." + w + ".idle", "combat", w, Hum, Missing, weapon: w, loop: true);
                V("combat." + w + ".light", "combat", w, Hum, Missing, weapon: w, intensity: "light");
                V("combat." + w + ".heavy", "combat", w, Hum, Missing, weapon: w, intensity: "heavy");
                V("combat." + w + ".thrust", "combat", w, Hum, Missing, weapon: w);
                V("combat." + w + ".block", "combat", w, Hum, Missing, weapon: w);
                V("combat." + w + ".parry", "combat", w, Hum, Missing, weapon: w);
                V("combat." + w + ".finisher", "combat", w, Hum, Missing, weapon: w, interruptible: false);
            }
            V("combat.sword.slash", "combat", "sword", Hum, Auth, weapon: "sword", notes: "UAL1 Sword_Attack bound to LightAttack.");
            V("combat.shield.bash", "combat", "shield", Hum, Missing, weapon: "shield");

            // Firearms
            foreach (var w in new[] { "pistol", "revolver", "smg", "shotgun", "rifle", "sniper" })
            {
                V("fire." + w + ".draw", "firearms", w, Hum, Missing, weapon: w);
                V("fire." + w + ".holster", "firearms", w, Hum, Missing, weapon: w);
                V("fire." + w + ".aim", "firearms", w, Hum, Missing, weapon: w, loop: true);
                V("fire." + w + ".hip_fire", "firearms", w, Hum, Missing, weapon: w);
                V("fire." + w + ".reload", "firearms", w, Hum, Missing, weapon: w);
            }

            // Magic — verbs, not per-spell clips.
            V("magic.cast_start", "magic", "spell", Hum, Missing, evt: "cast_start");
            V("magic.cast_loop", "magic", "spell", Hum, Missing, loop: true, evt: "cast_channel");
            V("magic.cast_release", "magic", "spell", Hum, Missing, evt: "cast_release");
            V("magic.cast_interrupt", "magic", "spell", Hum, Missing);
            V("magic.cast_fail", "magic", "spell", Hum, Missing);
            V("magic.projectile", "magic", "spell", Hum, Missing);
            V("magic.beam", "magic", "spell", Hum, Missing, loop: true);
            V("magic.area", "magic", "spell", Hum, Missing);
            V("magic.ritual", "magic", "spell", Hum, Missing, loop: true);
            V("magic.summon", "magic", "spell", Hum, Missing);

            // Reactions — UAL1 supplies the front hit clip; stagger remains procedural until authored.
            V("react.hit_front", "reaction", "hit", Hum, Auth, direction: "front", intensity: "light", evt: "hit",
                notes: "UAL1 Hit_Chest bound to HitChest.");
            V("react.hit_back", "reaction", "hit", Hum, Missing, direction: "back");
            V("react.hit_left", "reaction", "hit", Hum, Missing, direction: "left");
            V("react.hit_right", "reaction", "hit", Hum, Missing, direction: "right");
            V("react.stagger", "reaction", "hit", Hum, Proc, intensity: "medium", evt: "stagger");
            V("react.knockback", "reaction", "hit", Hum, Missing, intensity: "heavy");
            V("react.knockdown", "reaction", "hit", Hum, Proc, intensity: "critical", notes: "MixamoAvatar.Knockdown overlay only.");
            V("react.getup", "reaction", "hit", Hum, Missing);
            V("death.front", "reaction", "death", Hum, Auth, interruptible: false, notes: "UAL1 Death01 bound to Death.");
            V("death.back", "reaction", "death", Hum, Missing, interruptible: false);
            V("death.ragdoll", "reaction", "death", Hum, Layer, interruptible: false, notes: "Physics ragdoll, not a clip.");

            // Interaction / crafting / furniture
            foreach (var id in new[]
            {
                "int.door_open", "int.door_close", "int.door_kick", "int.lock_pick",
                "int.chest_open", "int.loot", "int.pickup", "int.drop", "int.equip", "int.consume",
                "craft.forge", "craft.hammer", "craft.cook", "craft.sew", "craft.repair", "craft.enchant",
                "furn.sit", "furn.lie", "furn.sleep", "furn.eat", "furn.drink", "furn.read", "furn.write"
            })
                V(id, id.StartsWith("craft") ? "crafting" : id.StartsWith("furn") ? "furniture" : "interaction",
                    "humanoid", Hum, id == "furn.sit" ? Proc : Missing, loop: id.Contains("sleep") || id.Contains("read"));

            // NPC life + archetypes
            foreach (var id in new[]
            {
                "npc.farm", "npc.mine", "npc.chop", "npc.smith", "npc.cook", "npc.clean", "npc.haul",
                "npc.fish", "npc.trade", "npc.guard", "npc.teach", "npc.heal", "npc.perform",
                "soc.greet", "soc.wave", "soc.point", "soc.argue", "soc.laugh", "soc.cry", "soc.bow",
                "soc.handshake", "soc.hug", "soc.pray", "soc.dance",
                "life.wake", "life.wash", "life.dress", "life.relax"
            })
                V(id, id.StartsWith("soc") ? "social" : id.StartsWith("life") ? "daily" : "work",
                    "npc", Hum, Missing, actor: "npc", loop: !id.StartsWith("soc"));

            V("arch.guard.patrol", "archetype", "guard", Hum, Missing, actor: "npc", loop: true);
            V("arch.guard.salute", "archetype", "guard", Hum, Missing, actor: "npc");
            V("arch.guard.arrest", "archetype", "guard", Hum, Missing, actor: "npc");
            V("arch.merchant.greet", "archetype", "merchant", Hum, Missing, actor: "npc");
            V("arch.merchant.display", "archetype", "merchant", Hum, Missing, actor: "npc");
            V("arch.thief.sneak", "archetype", "thief", Hum, Missing, actor: "npc", loop: true);
            V("arch.thief.pickpocket", "archetype", "thief", Hum, Missing, actor: "npc");
            V("arch.mage.study", "archetype", "mage", Hum, Missing, actor: "npc", loop: true);
            V("arch.blacksmith.hammer", "archetype", "blacksmith", Hum, Missing, actor: "npc", loop: true);

            // Gear modifiers — layers, not new skeletons.
            V("gear.light.dodge", "gear", "light_armor", Hum, Layer, notes: "Locomotion modifier, not a new rig.");
            V("gear.heavy.idle", "gear", "heavy_armor", Hum, Layer, loop: true);
            V("gear.heavy.land", "gear", "heavy_armor", Hum, Layer);
            V("gear.robe.cast", "gear", "robes", Hum, Layer);
            V("gear.gunslinger.draw", "gear", "gunslinger", Hum, Missing);

            // Facial / IK layers
            V("face.blink", "facial", "face", Hum, Proc, loop: true, notes: "ModularPerson lid scale.");
            V("face.talk", "facial", "face", Hum, Proc, notes: "Talking idle arm overlay, not visemes.");
            V("ik.hands_weapon", "procedural", "ik", Hum, Layer, notes: "PresentationIkGripAdapter / CharacterGear.");
            V("ik.look_at", "procedural", "ik", Hum, Layer);
            V("ik.feet_ground", "procedural", "ik", Hum, Layer, notes: "PlantFeet overlay.");

            // Vehicles / mounts / sports
            V("mount.mount", "vehicle", "mount", Hum, Missing);
            V("mount.dismount", "vehicle", "mount", Hum, Missing);
            V("veh.enter", "vehicle", "vehicle", Hum, Missing);
            V("veh.steer", "vehicle", "vehicle", Hum, Layer, loop: true);
            V("sport.warmup", "sports", "generic", Hum, Missing);
            V("sport.sprint", "sports", "generic", Hum, Missing);
            V("sport.tackle", "sports", "generic", Hum, Missing);
            V("sport.celebrate", "sports", "generic", Hum, Missing);
        }
    }
}
