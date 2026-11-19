using System.Collections.Generic;

namespace Concordia
{
    /// <summary>
    /// CP-09 — hero archetypes + KayKit undead (flag cf.cc.archetypes).
    ///
    /// The character-creator preset table and the Ruins NPC binding, as data.
    /// The preset census is the hero mesh folder of record
    /// (concord-frontend/public/meshes/heroes/, 57 GLB): every archetype is a
    /// selectable preset EXCEPT the seven _archetype_legend* files. Those are
    /// byte-identical Xbot placeholders, not distinct heroes — the plan cuts
    /// them until real meshes exist (CONCORDIA_PLAN §12.3 + the closing cut
    /// list), so they are recorded here as excluded, never as presets.
    ///
    /// The Ruins binding is the KayKit undead mapping of record (heroes
    /// CREDITS.md, from KayKit-Character-Pack-Skeletons-1.0, CC0): the four
    /// undead heroes bound to Sovereign Ruins as revenants, matched on the
    /// server archetypes' own data in server/lib/npc-archetypes.js.
    /// plague_bearer has no fifth distinct mesh and reuses `undead` — an
    /// honest reuse, recorded as one, not a fabricated asset.
    ///
    /// Pure data: no UnityEngine, so EditMode tests exercise the tables
    /// without a scene. Preset meshes are Mixamo-sourced (in_game_only);
    /// the KayKit skeletons are CC0.
    /// </summary>
    public static class HeroArchetypes
    {
        /// <summary>Selectable character-creator presets (mesh stems).</summary>
        public static readonly string[] Presets =
        {
            "_archetype_guard",
            "_archetype_guard__concord-link-frontier",
            "_archetype_guard__concordia-hub",
            "_archetype_guard__cyber",
            "_archetype_guard__fantasy",
            "_archetype_guard__lattice-crucible",
            "_archetype_guard__sovereign-ruins",
            "_archetype_hunter",
            "_archetype_hunter__concord-link-frontier",
            "_archetype_hunter__concordia-hub",
            "_archetype_hunter__cyber",
            "_archetype_hunter__fantasy",
            "_archetype_hunter__lattice-crucible",
            "_archetype_hunter__sovereign-ruins",
            "_archetype_lich",
            "_archetype_mystic",
            "_archetype_mystic__concord-link-frontier",
            "_archetype_mystic__concordia-hub",
            "_archetype_mystic__cyber",
            "_archetype_mystic__fantasy",
            "_archetype_mystic__lattice-crucible",
            "_archetype_mystic__sovereign-ruins",
            "_archetype_scholar",
            "_archetype_scholar__concord-link-frontier",
            "_archetype_scholar__concordia-hub",
            "_archetype_scholar__cyber",
            "_archetype_scholar__fantasy",
            "_archetype_scholar__lattice-crucible",
            "_archetype_scholar__sovereign-ruins",
            "_archetype_trader",
            "_archetype_trader__concord-link-frontier",
            "_archetype_trader__concordia-hub",
            "_archetype_trader__cyber",
            "_archetype_trader__fantasy",
            "_archetype_trader__lattice-crucible",
            "_archetype_trader__sovereign-ruins",
            "_archetype_undead",
            "_archetype_warrior",
            "_archetype_warrior__concord-link-frontier",
            "_archetype_warrior__concordia-hub",
            "_archetype_warrior__cyber",
            "_archetype_warrior__fantasy",
            "_archetype_warrior__lattice-crucible",
            "_archetype_warrior__sovereign-ruins",
            "_archetype_wraith",
            "_archetype_zombie",
            "concord_first_thought",
            "concordia_first_breath",
            "sovereign_first_refusal",
            "weaver_of_echoes"
        };

        /// <summary>
        /// The 7 legend placeholders, excluded from presets: byte-identical
        /// Xbot files, cut until real meshes exist.
        /// </summary>
        public static readonly string[] ExcludedLegendPlaceholders =
        {
            "_archetype_legend",
            "_archetype_legend__concord-link-frontier",
            "_archetype_legend__concordia-hub",
            "_archetype_legend__cyber",
            "_archetype_legend__fantasy",
            "_archetype_legend__lattice-crucible",
            "_archetype_legend__sovereign-ruins"
        };

        /// <summary>One undead archetype bound to its KayKit skeleton mesh.</summary>
        public sealed class RuinsBinding
        {
            public readonly string Archetype;
            public readonly string Mesh;
            public readonly string Land;

            public RuinsBinding(string archetype, string mesh, string land)
            {
                Archetype = archetype;
                Mesh = mesh;
                Land = land;
            }
        }

        /// <summary>The 4 undead heroes bound to Sovereign Ruins as revenants.</summary>
        public static readonly RuinsBinding[] RuinsRevenants =
        {
            new RuinsBinding("undead", "Skeleton_Warrior", "sovereign-ruins"),
            new RuinsBinding("zombie", "Skeleton_Minion", "sovereign-ruins"),
            new RuinsBinding("wraith", "Skeleton_Rogue", "sovereign-ruins"),
            new RuinsBinding("lich", "Skeleton_Mage", "sovereign-ruins")
        };

        /// <summary>
        /// plague_bearer has no distinct mesh among the 4 sourced; it reuses
        /// this archetype's binding (CREDITS.md, of record).
        /// </summary>
        public const string PlagueBearerReuses = "undead";

        public static bool Validate(out string error)
        {
            error = null;
            var presets = new HashSet<string>(Presets);
            if (presets.Count != Presets.Length)
            {
                error = "duplicate preset stem";
                return false;
            }
            foreach (var legend in ExcludedLegendPlaceholders)
            {
                if (presets.Contains(legend))
                {
                    error = "legend placeholder is a preset: " + legend;
                    return false;
                }
                if (!legend.StartsWith("_archetype_legend"))
                {
                    error = "excluded stem is not a legend placeholder: " + legend;
                    return false;
                }
            }
            if (ExcludedLegendPlaceholders.Length != 7)
            {
                error = "excluded legend count is not 7";
                return false;
            }
            if (RuinsRevenants.Length != 4)
            {
                error = "Ruins revenant count is not 4";
                return false;
            }
            var meshes = new HashSet<string>();
            foreach (var b in RuinsRevenants)
            {
                if (b.Land != "sovereign-ruins")
                {
                    error = "revenant not bound to the Ruins: " + b.Archetype;
                    return false;
                }
                if (!meshes.Add(b.Mesh))
                {
                    error = "two revenants share a mesh: " + b.Mesh;
                    return false;
                }
            }
            bool plagueOk = false;
            foreach (var b in RuinsRevenants)
                if (b.Archetype == PlagueBearerReuses) plagueOk = true;
            if (!plagueOk)
            {
                error = "plague_bearer reuse target is not a bound archetype";
                return false;
            }
            return true;
        }
    }
}
