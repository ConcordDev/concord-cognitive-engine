namespace Concordia.Animation
{
    public static partial class AnimationVerbCatalog
    {
        static void RegisterCreatures()
        {
            // CreatureCompiler spawns pack meshes + FaunaLife. No Generic locomotion controller yet.
            CreatureFamily("quad", "quadruped", new[]
            {
                "idle", "alert", "walk", "trot", "run", "sprint", "turn", "jump", "land",
                "sniff", "stalk", "pounce", "bite", "howl", "flee", "sleep", "eat", "drink", "groom"
            });
            CreatureFamily("pred", "predator", new[]
            {
                "heavy_walk", "charge", "roar", "bite", "claw", "maul", "pounce", "rear",
                "intimidate", "stagger", "knockdown", "death"
            });
            CreatureFamily("bird", "avian", new[]
            {
                "idle", "hop", "walk", "peck", "preen",
                "takeoff", "flap", "glide", "soar", "dive", "hover", "land", "perch",
                "dive_attack", "claw"
            });
            CreatureFamily("bug", "insectoid", new[]
            {
                "crawl", "scuttle", "climb", "burrow", "leap", "bite", "sting", "swarm", "emerge", "death",
                "hover", "takeoff", "orbit"
            });
            CreatureFamily("reptile", "reptile", new[]
            {
                "crawl", "slither", "stalk", "sprint", "bite", "tail", "hiss", "coil", "bask", "swim", "ambush"
            });
            CreatureFamily("serpent", "serpent", new[]
            {
                "slither", "coil", "strike", "rear", "sway", "burrow", "swim", "constrict", "bite", "death"
            });
            CreatureFamily("aqua", "aquatic", new[]
            {
                "swim", "turn", "accelerate", "brake", "surface", "dive", "breach", "attack", "flee", "feed", "idle"
            });
            CreatureFamily("brute", "monster", new[]
            {
                "heavy_walk", "charge", "slam", "roar", "grab", "throw", "stomp", "stagger", "enrage", "death"
            });
            CreatureFamily("crawler", "monster", new[]
            {
                "crawl", "climb", "leap", "pounce", "bite", "retreat", "wall"
            });
            CreatureFamily("flyer", "monster", new[]
            {
                "hover", "soar", "dive", "claw", "bite", "projectile", "land", "takeoff"
            });
            CreatureFamily("multi", "monster", new[]
            {
                "locomotion", "limb_attack", "grab", "slam", "sweep", "recoil", "stagger", "death"
            });

            // Humanoid-shaped monsters may use Humanoid if Avatar validates.
            V("mon.humanoid.idle", "monsters", "humanoid_monster", Hum, Missing, actor: "monster", loop: true,
                notes: "Humanoid pipeline only after Avatar.isValid.");
            V("mon.humanoid.walk", "monsters", "humanoid_monster", Hum, Missing, actor: "monster", loop: true);
            V("mon.humanoid.attack", "monsters", "humanoid_monster", Hum, Missing, actor: "monster");

            // Bosses — phases, not extra HP.
            foreach (var phase in new[] { "1", "2", "3" })
            {
                V("boss.p" + phase + ".idle", "boss", "boss", Gen, Missing, actor: "boss", loop: true);
                V("boss.p" + phase + ".attack", "boss", "boss", Gen, Missing, actor: "boss");
                V("boss.p" + phase + ".stagger", "boss", "boss", Gen, Missing, actor: "boss");
            }
            V("boss.p2.transform", "boss", "boss", Gen, Missing, actor: "boss", interruptible: false, evt: "phase_2");
            V("boss.p3.enrage", "boss", "boss", Gen, Missing, actor: "boss", evt: "enrage");
            V("boss.ultimate", "boss", "boss", Gen, Missing, actor: "boss", interruptible: false);
            V("boss.death", "boss", "boss", Gen, Missing, actor: "boss", interruptible: false);
            V("boss.roar", "boss", "boss", Gen, Missing, actor: "boss");
            V("boss.ground_slam", "boss", "boss", Gen, Missing, actor: "boss");
            V("boss.summon", "boss", "boss", Gen, Missing, actor: "boss");

            // Hybrids inherit a base family + layers.
            V("hyb.wolfman.loco", "hybrid", "wolf_human", Hum, Layer, actor: "hybrid", loop: true,
                notes: "Humanoid loco + digitigrade/tail/claw layers.");
            V("hyb.wolfman.pounce", "hybrid", "wolf_human", Hum, Missing, actor: "hybrid");
            V("hyb.wolfman.sniff", "hybrid", "wolf_human", Hum, Missing, actor: "hybrid");
            V("hyb.eagle.wing_idle", "hybrid", "eagle_human", Hum, Layer, actor: "hybrid", loop: true);
            V("hyb.eagle.takeoff", "hybrid", "eagle_human", Hum, Missing, actor: "hybrid");
            V("hyb.naga.slither", "hybrid", "serpent_human", Gen, Missing, actor: "hybrid", loop: true,
                notes: "Upper-body Humanoid + Generic tail. Do not force one Avatar.");
            V("hyb.naga.strike", "hybrid", "serpent_human", Gen, Missing, actor: "hybrid");

            // Creature social
            foreach (var id in new[]
            {
                "fauna.greet", "fauna.aggression", "fauna.submit", "fauna.mate", "fauna.parent",
                "fauna.feed", "fauna.groom", "fauna.sleep", "fauna.territory", "fauna.curious",
                "fauna.fear", "fauna.flee", "fauna.follow", "fauna.play", "fauna.pack", "fauna.flock", "fauna.herd"
            })
                V(id, "fauna_social", "fauna", Gen, Missing, actor: "fauna", loop: id == "fauna.sleep" || id == "fauna.herd");

            // Environment / secondary — mostly not skeletal.
            V("env.cloth", "environment", "secondary", Gen, Layer, actor: "prop");
            V("env.flag", "environment", "secondary", Gen, Layer, actor: "prop", loop: true);
            V("env.tree_wind", "environment", "secondary", Gen, Layer, actor: "prop", loop: true);
            V("env.door", "environment", "prop", Gen, Missing, actor: "prop");
            V("env.trap", "environment", "prop", Gen, Missing, actor: "prop");
            V("sec.hair", "secondary", "character", Hum, Layer);
            V("sec.cloth", "secondary", "character", Hum, Layer);
            V("sec.tail", "secondary", "character", Gen, Layer);
            V("sec.wings", "secondary", "character", Gen, Layer);
            V("sec.cape", "secondary", "character", Hum, Layer);
        }

        static void CreatureFamily(string prefix, string family, string[] verbs)
        {
            for (var i = 0; i < verbs.Length; i++)
            {
                var name = verbs[i];
                var loop = name == "idle" || name == "walk" || name == "trot" || name == "run" ||
                           name == "sprint" || name == "swim" || name == "hover" || name == "glide" ||
                           name == "soar" || name == "flap" || name == "crawl" || name == "slither" ||
                           name == "scuttle" || name == "heavy_walk" || name == "locomotion";
                V(prefix + "." + name, "creatures", family, Gen, Missing, actor: family, loop: loop,
                    notes: "Generic rig. CreatureCompiler has no Mecanim family yet.");
            }
        }
    }
}
