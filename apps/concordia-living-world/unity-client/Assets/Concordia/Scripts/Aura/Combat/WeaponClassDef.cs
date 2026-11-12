using System.Collections.Generic;
using Concordia.Core;

namespace Concordia
{
    /// <summary>
    /// C-03: one row per weapon class, copied from the server's own combat
    /// tables so the client's timing, reach and peril reads match what the
    /// server resolves. Regenerate with <c>.Aura/tools/weapon_classes.mjs</c>
    /// whenever those server files change. Sources:
    /// <list type="bullet">
    /// <item>frames: <c>server/lib/combat-frame-data.js</c> FRAME_BY_KIND</item>
    /// <item>bone mass, lever arm (reach), momentum: <c>server/lib/combat-impact.js</c> at tier 1</item>
    /// <item>heavy peril + counter: <c>server/lib/combat/telegraph-peril.js</c> perilFor(heavy)</item>
    /// <item>class + handedness: <c>server/lib/combat/loadout.js</c> NAME_TO_CLASS</item>
    /// </list>
    /// Where the server has no row for a kind it uses its own <c>default</c> row;
    /// <see cref="ServerFrames"/> / <see cref="ServerImpact"/> say so rather than
    /// passing that default off as weapon-specific. The server has no per-weapon
    /// stamina, so none is set here (C-06 owns stamina).
    /// </summary>
    public sealed class WeaponClassDef
    {
        public string Id;
        /// <summary>The kind the server's frame and impact tables are keyed by.</summary>
        public string ServerKind;
        /// <summary>The server's loadout class for this weapon, or null when NAME_TO_CLASS has none.</summary>
        public string ServerWeaponClass;
        /// <summary>right | left | two | either, as loadout.js assigns.</summary>
        public string Handedness;
        public bool ServerFrames;
        public bool ServerImpact;
        public int StartupMs, ActiveMs, RecoveryMs;
        /// <summary>0 means the weapon cannot parry (ranged).</summary>
        public int ParryWindowMs;
        public int DodgeWindowMs;
        public float BoneMassKg;
        public float ReachMeters;
        /// <summary>Tier-1 angular momentum: what the server's poise check resolves against.</summary>
        public float Momentum;
        /// <summary>Peril of a committed (heavy) attack: thrust | sweep | grab.</summary>
        public string HeavyPeril;
        public string HeavyCounter;

        public ActionDef ToActionDef(ActionKind kind)
        {
            return new ActionDef
            {
                Id = Id + "." + kind,
                Kind = kind,
                StartupMs = StartupMs,
                ActiveMs = ActiveMs,
                RecoveryMs = RecoveryMs,
                ReachMeters = ReachMeters,
                PoiseDamage = Momentum,
            };
        }

        static WeaponClassDef Row(string id, string kind, string serverClass, string hand, bool frames, bool impact,
            int startup, int active, int recovery, int parry, int dodge, float mass, float reach, float momentum, string peril)
        {
            return new WeaponClassDef
            {
                Id = id, ServerKind = kind, ServerWeaponClass = serverClass, Handedness = hand,
                ServerFrames = frames, ServerImpact = impact,
                StartupMs = startup, ActiveMs = active, RecoveryMs = recovery,
                ParryWindowMs = parry, DodgeWindowMs = dodge,
                BoneMassKg = mass, ReachMeters = reach, Momentum = momentum,
                HeavyPeril = peril, HeavyCounter = CounterFor(peril),
            };
        }

        /// <summary>telegraph-peril.js PERIL_COUNTER.</summary>
        public static string CounterFor(string peril)
        {
            switch (peril)
            {
                case "thrust": return "dodge";
                case "sweep": return "jump";
                case "grab": return "break";
                default: return null;
            }
        }

        // Generated 2026-10-26 by .Aura/tools/weapon_classes.mjs from server main @ b0c3c05d4.
        //   id           kind          class        hand      frames impact  start act  rec parry dodge  mass reach momentum peril
        public static readonly IReadOnlyList<WeaponClassDef> All = new[]
        {
            Row("sword",      "sword",      "sword",      "either", true,  true,  200, 100, 300, 220, 260, 1.6f, 0.95f,  6.27f,  "sweep"),
            Row("greatsword", "greatsword", "greatsword", "two",    false, false, 220, 100, 280, 200, 260, 2.0f, 0.80f,  6.6f,   "sweep"),
            Row("hammer",     "hammer",     "hammer",     "two",    true,  true,  350, 180, 450, 160, 220, 5.2f, 0.95f, 20.377f, "sweep"),
            Row("dagger",     "dagger",     "dagger",     "either", true,  true,  120,  50, 200, 240, 320, 1.2f, 0.45f,  2.228f, "sweep"),
            Row("spear",      "spear",      null,         "either", true,  true,  240, 120, 320, 200, 240, 2.0f, 1.55f, 12.788f, "thrust"),
            Row("axe",        "axe",        null,         "either", true,  true,  280, 140, 380, 180, 240, 3.6f, 0.85f, 12.622f, "sweep"),
            Row("shield",     "shield",     "shield",     "left",   false, false, 220, 100, 280, 200, 260, 2.0f, 0.80f,  6.6f,   "sweep"),
            Row("staff",      "staff",      "staff",      "two",    true,  true,  320,  80, 280,   0, 300, 2.2f, 1.40f, 12.705f, "sweep"),
            Row("bow",        "bow",        "bow",        "two",    true,  true,  350,  80, 250,   0, 320, 1.0f, 0.70f,  2.887f, "sweep"),
            Row("pistol",     "pistol",     "pistol",     "either", false, false, 220, 100, 280, 200, 260, 2.0f, 0.80f,  6.6f,   "sweep"),
            Row("rifle",      "rifle",      "rifle",      "two",    false, false, 220, 100, 280, 200, 260, 2.0f, 0.80f,  6.6f,   "sweep"),
            Row("unarmed",    "fist",       null,         "either", true,  true,  140,  60, 220, 260, 300, 2.5f, 0.42f,  4.331f, "sweep"),
        };

        public static WeaponClassDef Get(string id)
        {
            foreach (var d in All)
                if (d.Id == id) return d;
            return null;
        }
    }
}
