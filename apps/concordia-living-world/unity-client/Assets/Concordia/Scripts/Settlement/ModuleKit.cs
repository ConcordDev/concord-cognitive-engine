using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

namespace Concordia.Settlement
{
    public enum Course { Base, Dado, Wall, Cornice, Crown }

    /// What a bay does, independent of which kit supplies it.
    public enum Bay { Solid, Window, Door, DoorWindow, Pier, End }

    /// How a bay sits in the plan — a straight run, a turn, or a termination.
    public enum Plan { Standard, CornerLarge, CornerSmall, AngledLarge, AngledSmall, End, Pier }

    /// <summary>
    /// A modular facade kit, DISCOVERED from the imported glb rather than hand-typed.
    ///
    /// The three Poly Haven kits carry 361 modules between them and their naming is
    /// regular but not uniform (the apartments kit has one `cornice_` course, the factory
    /// kit has `cornice01/02/03`; the plinth is `base_standard_01`, not the
    /// `base_standard_standard_01` the other courses would predict). Hand-typing 361 names
    /// would rot the first time a kit is re-baked, so this parses HubKit.ModuleNames and
    /// buckets by convention. A name that does not parse is skipped, never guessed at.
    ///
    /// Measured off the glb (see the kit constants): bay pitch and wall-course height are
    /// both exactly 3.0m on the apartments and factory kits.
    /// </summary>
    public sealed class ModuleKit
    {
        public string Stem { get; private set; }
        public bool Ready { get; private set; }

        /// Bay pitch along a wall run, metres. 3.0 on both facade kits.
        public float BayMeters = 3.0f;

        /// Height of one repeating `wall_` course, metres. 3.0 on both facade kits.
        public float StoreyMeters = 3.0f;

        // Trim course heights, measured from the glb bounding boxes.
        public float BaseMeters = 0.75f;
        public float DadoMeters = 0.5f;
        public float CorniceMeters = 0.2f;
        public float CrownMeters = 0.75f;

        // course -> bay -> plan -> variant names, in discovery order.
        readonly Dictionary<Course, Dictionary<Bay, Dictionary<Plan, List<string>>>> _cat =
            new Dictionary<Course, Dictionary<Bay, Dictionary<Plan, List<string>>>>();

        /// Insert meshes (the door leaf / window glazing) keyed by their own name. A punched
        /// wall panel pairs with its insert by dropping the `wall_` prefix —
        /// `wall_window_centered_small_01` -> `window_centered_small_01`. Verified across
        /// every punched panel in both facade kits.
        readonly HashSet<string> _inserts = new HashSet<string>();

        static readonly Dictionary<string, ModuleKit> Cache = new Dictionary<string, ModuleKit>(4);

        public static async Task<ModuleKit> Load(string stem)
        {
            if (string.IsNullOrEmpty(stem)) return null;
            var key = stem.ToLowerInvariant();
            if (Cache.TryGetValue(key, out var hit) && hit != null && hit.Ready) return hit;

            var kit = new ModuleKit { Stem = key };
            Cache[key] = kit;
            if (!await HubKit.Prewarm(key))
            {
                Debug.LogWarning("Concordia ModuleKit: '" + key + "' is not in the HubKit index — no facade from this kit.");
                return kit;   // Ready stays false; callers fall back honestly.
            }
            kit.Build(HubKit.ModuleNames(key));
            return kit;
        }

        /// <summary>
        /// Build a catalog straight from a name list, with no glb import. This is the seam
        /// the EditMode tests use — importing a 46MB glb to assert a string parse would make
        /// the test slow, async, and dependent on StreamingAssets being present.
        /// </summary>
        public static ModuleKit FromNames(string stem, string[] names)
        {
            var kit = new ModuleKit { Stem = (stem ?? "").ToLowerInvariant() };
            kit.Build(names);
            return kit;
        }

        void Build(string[] names)
        {
            if (names == null || names.Length == 0) return;
            foreach (var raw in names)
            {
                if (string.IsNullOrEmpty(raw)) continue;
                var n = raw.ToLowerInvariant();

                // Fort-kit names carry their own stem prefix; facade kits do not.
                if (n.StartsWith("modular_")) continue;

                if (n.StartsWith("door_") || n.StartsWith("window_")) { _inserts.Add(n); continue; }

                if (!TryParse(n, out var course, out var bay, out var plan)) continue;
                if (!_cat.TryGetValue(course, out var byBay))
                    _cat[course] = byBay = new Dictionary<Bay, Dictionary<Plan, List<string>>>();
                if (!byBay.TryGetValue(bay, out var byPlan))
                    byBay[bay] = byPlan = new Dictionary<Plan, List<string>>();
                if (!byPlan.TryGetValue(plan, out var list))
                    byPlan[plan] = list = new List<string>(4);
                list.Add(n);
            }
            foreach (var byBay in _cat.Values)
                foreach (var byPlan in byBay.Values)
                    foreach (var list in byPlan.Values)
                        list.Sort(System.StringComparer.Ordinal);
            Ready = _cat.Count > 0;
        }

        /// `&lt;course&gt;_&lt;bay&gt;_&lt;plan&gt;_&lt;nn&gt;`, with the irregularities the assets actually have.
        static bool TryParse(string n, out Course course, out Bay bay, out Plan plan)
        {
            course = Course.Wall; bay = Bay.Solid; plan = Plan.Standard;

            string rest;
            if (n.StartsWith("base_")) { course = Course.Base; rest = n.Substring(5); }
            else if (n.StartsWith("dado_")) { course = Course.Dado; rest = n.Substring(5); }
            else if (n.StartsWith("wall_")) { course = Course.Wall; rest = n.Substring(5); }
            else if (n.StartsWith("crown_")) { course = Course.Crown; rest = n.Substring(6); }
            else if (n.StartsWith("cornice"))
            {
                // apartments: `cornice_`; factory: `cornice01_` / `cornice02_` / `cornice03_`
                var us = n.IndexOf('_');
                if (us < 0) return false;
                course = Course.Cornice; rest = n.Substring(us + 1);
            }
            else return false;

            // Bay. `door_window` must be tested before `door`.
            if (rest.StartsWith("door_window")) { bay = Bay.DoorWindow; rest = Strip(rest, "door_window"); }
            else if (rest.StartsWith("window")) { bay = Bay.Window; rest = Strip(rest, "window"); }
            else if (rest.StartsWith("door")) { bay = Bay.Door; rest = Strip(rest, "door"); }
            else if (rest.StartsWith("standard")) { bay = Bay.Solid; rest = Strip(rest, "standard"); }
            else if (rest.StartsWith("pier")) { bay = Bay.Pier; rest = Strip(rest, "pier"); }
            else if (rest.StartsWith("end")) { bay = Bay.End; rest = Strip(rest, "end"); }
            else if (rest.StartsWith("garage")) { bay = Bay.Door; rest = Strip(rest, "garage"); }
            else bay = Bay.Solid;
            // ^ the last branch is not a guess: the base course omits the bay token entirely
            // for non-standard plans (`base_angled_large_01`, `base_corner_small_02`), so an
            // unrecognised head IS the plan and the bay is implicitly solid. Returning false
            // here instead dropped 6 apartments modules and 4 factory modules on the floor.

            // Plan is what remains once the trailing variant number is dropped.
            var body = DropVariant(rest);
            if (body.Length == 0) plan = bay == Bay.End ? Plan.End : bay == Bay.Pier ? Plan.Pier : Plan.Standard;
            else if (body == "standard") plan = Plan.Standard;
            else if (body == "corner_large") plan = Plan.CornerLarge;
            else if (body == "corner_small") plan = Plan.CornerSmall;
            else if (body == "angled_large") plan = Plan.AngledLarge;
            else if (body == "angled_small") plan = Plan.AngledSmall;
            else if (body.StartsWith("centered") || body.StartsWith("offset")) plan = Plan.Standard;
            else if (body.StartsWith("corner")) plan = Plan.CornerSmall;
            else if (body.StartsWith("angled")) plan = Plan.AngledSmall;
            else if (body.StartsWith("pedestal")) plan = Plan.Pier;
            else plan = Plan.Standard;
            return true;
        }

        static string Strip(string s, string head)
        {
            var r = s.Substring(head.Length);
            return r.StartsWith("_") ? r.Substring(1) : r;
        }

        /// Drops a trailing `_01` / `_013`. Keeps `corner_small` intact.
        static string DropVariant(string s)
        {
            var us = s.LastIndexOf('_');
            if (us < 0) return AllDigits(s) ? "" : s;
            var tail = s.Substring(us + 1);
            return AllDigits(tail) ? s.Substring(0, us) : s;
        }

        static bool AllDigits(string s)
        {
            if (s.Length == 0) return false;
            foreach (var c in s) if (c < '0' || c > '9') return false;
            return true;
        }

        /// <summary>
        /// Deterministic module choice. `variant` is a stable hash, never Random — the same
        /// world state must rebuild the same street. Seed it PER BUILDING, not per bay, so a
        /// building's windows agree with each other while its neighbour differs.
        ///
        /// `size` is an optional preference matched against the module name ("small",
        /// "large", "double", "tall"). The kits describe opening size inside the plan token
        /// (`wall_window_centered_small_01` vs `..._large_01`), which the Plan axis collapses;
        /// this recovers it without a second dictionary. A size the kit lacks is ignored
        /// rather than failing the pick.
        ///
        /// Falls back along the plan axis (an angled plan the kit lacks degrades to standard)
        /// then the bay axis (a window bay it lacks degrades to solid) rather than nothing.
        /// </summary>
        public string Pick(Course course, Bay bay, Plan plan, int variant, string size = null)
        {
            if (Resolve(course, bay, plan, variant, size, out var name)) return name;
            if (plan != Plan.Standard && Resolve(course, bay, Plan.Standard, variant, size, out name)) return name;
            if (bay != Bay.Solid && Resolve(course, Bay.Solid, plan, variant, null, out name)) return name;
            if (bay != Bay.Solid && Resolve(course, Bay.Solid, Plan.Standard, variant, null, out name)) return name;
            return null;
        }

        bool Resolve(Course course, Bay bay, Plan plan, int variant, string size, out string name)
        {
            name = null;
            if (!_cat.TryGetValue(course, out var byBay)) return false;
            if (!byBay.TryGetValue(bay, out var byPlan)) return false;
            if (!byPlan.TryGetValue(plan, out var list) || list.Count == 0) return false;

            var pool = list;
            if (!string.IsNullOrEmpty(size))
            {
                List<string> sized = null;
                foreach (var m in list)
                    if (m.IndexOf(size, System.StringComparison.Ordinal) >= 0)
                        (sized ??= new List<string>(4)).Add(m);
                if (sized != null) pool = sized;
            }
            name = pool[((variant % pool.Count) + pool.Count) % pool.Count];
            return true;
        }

        /// The door leaf / window glazing that belongs in a punched wall panel, or null.
        public string InsertFor(string wallModule)
        {
            if (string.IsNullOrEmpty(wallModule) || !wallModule.StartsWith("wall_")) return null;
            var candidate = wallModule.Substring(5);
            return _inserts.Contains(candidate) ? candidate : null;
        }

        public GameObject Place(string module, Transform parent, Vector3 pos, float yaw) =>
            string.IsNullOrEmpty(module) ? null : HubKit.PlaceModule(Stem, module, parent, pos, yaw);

        public int CountFor(Course course, Bay bay, Plan plan) =>
            _cat.TryGetValue(course, out var b) && b.TryGetValue(bay, out var p)
            && p.TryGetValue(plan, out var l) ? l.Count : 0;

        public int ModuleCount
        {
            get
            {
                int n = _inserts.Count;
                foreach (var byBay in _cat.Values)
                    foreach (var byPlan in byBay.Values)
                        foreach (var list in byPlan.Values) n += list.Count;
                return n;
            }
        }

        // ---- the kits actually on disk -------------------------------------------------
        public const string Apartments = "modular_urban_apartments_facade_1k";   // 147 modules
        public const string Factory    = "modular_factory_facade_1k";            // 192 modules
        public const string Fort       = "modular_fort_01_1k";                   // 22 modules

        /// <summary>
        /// The fort kit is a curtain-wall system on a different grid (~14.6m straight runs,
        /// ~7.4m halves, ~8.5m tall) with its own stem-prefixed names, so it does not parse
        /// as a facade kit. Named directly — there are only 22.
        /// </summary>
        public static class FortModules
        {
            public const float RunMeters = 14.56f;
            public const float HalfRunMeters = 7.41f;
            public const float HeightMeters = 8.53f;

            public const string ThickStraight = "modular_fort_01_wall_thick_straight_01";
            public const string ThickCorner   = "modular_fort_01_wall_thick_corner_01";
            public const string ThickEnd      = "modular_fort_01_wall_thick_end_02";
            public const string ThinStraight  = "modular_fort_01_wall_thin_straight_01";
            public const string ThinHalf      = "modular_fort_01_wall_thin_straight_04";
            public const string ThinCorner    = "modular_fort_01_wall_thin_corner_01";
            public const string Gate          = "modular_fort_01_wall_thin_gate_01";
            public const string Transition    = "modular_fort_01_wall_thick_thin_transition_01";
            public const string WalkStraight  = "modular_fort_01_wall_walkway_straight_02";
            public const string WalkCorner    = "modular_fort_01_wall_walkway_corner_01";
            public const string WalkEnd       = "modular_fort_01_wall_walkway_end_01";
            public const string Stairs        = "modular_fort_01_wall_stairs_straight_01";
            public const string TowerRound    = "modular_fort_01_tower_round";
        }
    }
}
