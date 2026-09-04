using System.Collections.Generic;
using UnityEngine;

namespace Concordia // keep-spawn-assign
{
    /// <summary>
    /// Drops authored lore, people, factions, quests, creatures, and a
    /// Kenney kit matching the world's law. Geometry is dressing; text is canon.
    /// </summary>
    public static class RealmFill
    {
        public static void Populate(Transform root, WorldId id)
        {
            var w = Canon.Get(id);
            if (id != WorldId.Hub) DressKit(root, w);
            Factions(root, w);
            Kingdoms(root, w);
            if (id != WorldId.Hub) Roads(root, w);
            Lore(root, w);
            People(root, w);
            Quests(root, w);
            if (id != WorldId.Hub)
            {
                Beasts(root, w);
                DungeonHold.Build(root, w);
            }
        }

        static void DressKit(Transform root, WorldDef w)
        {
            switch (w.id)
            {
                case WorldId.Ruins:
                    Ring(root, "crypt-large", 18f, 6, 8f, 20f);
                    Ring(root, "crypt-a", 12f, 7, 5.5f, 10f);
                    Ring(root, "column-large", 8f, 10, 4f, 0f);
                    Scatter(root, "coffin", 8, 6f, 16f, 1.6f);
                    Scatter(root, "altar-stone", 4, 8f, 14f, 1.8f);
                    Scatter(root, "crypt-small", 6, 14f, 24f, 4.2f);
                    Horizon(root, "cliff_large_stone", 52f, 10, 9f);
                    break;
                case WorldId.Tunya:
                    for (int i = 0; i < 36; i++)
                        FreePacks.Spawn("crops_cornStageD", root, new Vector3(-14 + (i % 12) * 1.3f, 0, 7 + (i / 12) * 2.1f), 0, 1.4f);
                    Ring(root, "tent_detailedOpen", 14f, 7, 3.2f, 30f);
                    Ring(root, "tree_oak", 20f, 12, 7f, 15f);
                    Ring(root, "tree_pineTallA", 28f, 10, 9f, 20f);
                    Scatter(root, "bridge_wood", 3, 10f, 16f, 2.4f);
                    Scatter(root, "campfire_stones", 6, 5f, 16f, 1.3f);
                    Horizon(root, "cliff_large_rock", 54f, 8, 10f);
                    break;
                case WorldId.Fantasy:
                    Ring(root, "hedge-large", 16f, 12, 2.8f, 0f);
                    FreePacks.Spawn("fountain-round", root, new Vector3(0, 0, 9), 0, 3.2f);
                    Ring(root, "banner-red", 11f, 8, 2.4f, 0f);
                    Scatter(root, "tower-square-base", 5, 16f, 26f, 7f);
                    Scatter(root, "statue", 5, 8f, 16f, 2.4f);
                    Ring(root, "tree_oak_dark", 22f, 10, 7.5f, 25f);
                    Horizon(root, "tower-hexagon-base", 48f, 6, 12f);
                    break;
                case WorldId.Crime:
                    Ring(root, "building-d", 20f, 6, 11f, 0f);
                    Ring(root, "building-type-h", 14f, 8, 7f, 40f);
                    Scatter(root, "dumpster", 10, 5f, 16f, 1.8f);
                    Scatter(root, "detail-awning", 8, 10f, 18f, 2.2f);
                    Scatter(root, "barrel", 10, 4f, 14f, 0.9f);
                    Horizon(root, "building-skyscraper-e", 50f, 7, 22f);
                    break;
                case WorldId.Cyber:
                    Ring(root, "building-skyscraper-c", 22f, 6, 20f, 0f);
                    Ring(root, "building-skyscraper-a", 16f, 6, 16f, 45f);
                    FreePacks.Spawn("corridor_cross", root, new Vector3(0, 0, 8), 0, 6f);
                    Scatter(root, "detail-overhang-wide", 8, 8f, 18f, 3.4f);
                    Horizon(root, "building-skyscraper-d", 48f, 8, 24f);
                    break;
                case WorldId.Frontier:
                    Ring(root, "tent_detailedOpen", 14f, 8, 3f, 25f);
                    Scatter(root, "palm-detailed-bend", 10, 12f, 22f, 5f);
                    Scatter(root, "campfire_stones", 8, 4f, 14f, 1.4f);
                    Scatter(root, "cart", 6, 8f, 16f, 2f);
                    Scatter(root, "cannon", 4, 10f, 16f, 1.8f);
                    Ring(root, "palm-straight", 24f, 10, 5f, 10f);
                    Horizon(root, "rocks-large", 50f, 8, 8f);
                    break;
                case WorldId.Superhero:
                    Ring(root, "building-skyscraper-a", 20f, 7, 20f, 0f);
                    Ring(root, "building-skyscraper-d", 26f, 6, 18f, 30f);
                    Scatter(root, "building-type-a", 8, 10f, 16f, 8f);
                    Horizon(root, "building-skyscraper-b", 52f, 8, 26f);
                    break;
                case WorldId.Sere:
                    Ring(root, "building-d", 18f, 6, 10f, 0f);
                    Ring(root, "building-type-h", 12f, 7, 7f, 25f);
                    Scatter(root, "dumpster", 8, 5f, 16f, 1.6f);
                    Scatter(root, "barrel", 8, 4f, 14f, 0.9f);
                    Horizon(root, "building-skyscraper-e", 52f, 7, 20f);
                    break;
                default:
                    Ring(root, "detail-crystal-large", 14f, 12, 3.2f, 20f);
                    Scatter(root, "tower-hexagon-mid", 4, 16f, 24f, 8f);
                    Scatter(root, "detail-crystal-large", 10, 6f, 18f, 2.4f);
                    Horizon(root, "cliff_stone", 50f, 8, 9f);
                    break;
            }
        }

        static void Factions(Transform root, WorldDef w)
        {
            var facs = WorldBook.Factions(w.id);
            for (int i = 0; i < facs.Length; i++)
            {
                var f = facs[i];
                float a = i / Mathf.Max(1f, facs.Length) * Mathf.PI * 2f + 0.35f;
                var p = new Vector3(Mathf.Cos(a) * 24f, 0f, Mathf.Sin(a) * 24f);
                Color.RGBToHSV(w.sun, out var hh, out var ss, out var vv);
                var col = w.sun;
                if (f.visual != null && !string.IsNullOrEmpty(f.visual.primary_color))
                    ColorUtility.TryParseHtmlString(f.visual.primary_color, out col);
                var tent = w.id == WorldId.Cyber ? "corridor_end"
                    : w.id == WorldId.Crime ? "building-type-c"
                    : w.id == WorldId.Fantasy ? "windmill"
                    : "tent_detailedOpen";
                FreePacks.Spawn(tent, root, p, -a * Mathf.Rad2Deg, w.id == WorldId.Fantasy ? 6f : 3.4f);
                var banner = HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 3.2f + Vector3.right * 0.01f,
                    new Vector3(0.12f, 3.4f, 0.12f), HubLook.Lit(col, 0.2f, 0.3f), "FactionPole_" + f.id);
                var cloth = HubLook.Prim(root, PrimitiveType.Quad, p + new Vector3(Mathf.Cos(a + 0.2f), 2.6f, Mathf.Sin(a + 0.2f)) * 0.8f,
                    new Vector3(1.6f, 2.2f, 1f), HubLook.Lit(col, 0.05f, 0.25f), "FactionBanner_" + f.id, false);
                cloth.transform.rotation = Quaternion.LookRotation(new Vector3(p.x, 0f, p.z));
                var stone = GameObject.CreatePrimitive(PrimitiveType.Cube);
                stone.name = "Faction_" + f.id;
                stone.transform.SetParent(root, false);
                stone.transform.position = p + new Vector3(Mathf.Cos(a) * -2.2f, 0.9f, Mathf.Sin(a) * -2.2f);
                stone.transform.localScale = new Vector3(0.55f, 1.8f, 0.55f);
                var r = stone.GetComponent<Renderer>();
                if (r) r.material = HubLook.Lit(col, 0.15f, 0.3f);
                var ls = stone.AddComponent<LoreStone>();
                ls.title = f.name;
                var goal = f.goal ?? "";
                if (goal.Length > 500) goal = goal.Substring(0, 497) + "…";
                ls.text = (f.motto ?? "") + "\n\n" + goal;
                _ = banner;
            }
        }

        static void Lore(Transform root, WorldDef w)
        {
            var lore = WorldBook.Lore(w.id);
            if (lore.history == null) return;
            int i = 0;
            foreach (var beat in lore.history)
            {
                if (beat == null || string.IsNullOrEmpty(beat.title)) continue;
                float a = i * 0.55f + 0.2f;
                float rad = (w.id == WorldId.Hub ? 22f : 9f) + (i % 3) * 2.4f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, (w.id == WorldId.Hub ? 0f : 2f) + Mathf.Sin(a) * rad);
                if (w.id == WorldId.Hub && Canon.InArena(p)) continue;
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "Lore_" + beat.id;
                go.transform.SetParent(root, false);
                go.transform.position = p + Vector3.up * 0.85f;
                go.transform.localScale = new Vector3(0.42f, 1.7f, 0.42f);
                var rend = go.GetComponent<Renderer>();
                if (rend) rend.material = HubLook.Lit(w.sun, 0.2f, 0.35f);
                var ls = go.AddComponent<LoreStone>();
                ls.title = beat.title;
                var body = beat.description ?? "";
                if (body.Length > 800) body = body.Substring(0, 797) + "…";
                ls.text = (string.IsNullOrEmpty(beat.era) ? "" : beat.era + " — ") + (beat.type ?? "") + "\n" + body;
                i++;
            }
        }

        static void People(Transform root, WorldDef w)
        {
            var people = WorldBook.People(w.id);
            var facs = WorldBook.Factions(w.id);
            int n = 0;
            foreach (var person in people)
            {
                if (person == null || string.IsNullOrEmpty(person.name)) continue;
                if (w.id == WorldId.Hub && IsHubGuest(person.name)) continue;
                Vector3 p;
                var facI = IndexOfFaction(facs, person.faction_id);
                var city = w.id == WorldId.Hub ? null : CityAtlas.ForPerson(w.id, person);
                if (city != null)
                {
                    var camp = new Vector3(city.x, 0f, city.z);
                    var inward = camp.sqrMagnitude > 0.2f ? camp.normalized : Vector3.forward;
                    var side = Vector3.Cross(Vector3.up, inward);
                    p = camp + side * ((n % 5) - 2) * 1.7f + inward * 3.1f;
                }
                else
                {
                    if (facI >= 0)
                    {
                        float a = facI / Mathf.Max(1f, facs.Length) * Mathf.PI * 2f + 0.35f;
                        var camp = new Vector3(Mathf.Cos(a) * 24f, 0f, Mathf.Sin(a) * 24f);
                        var side = Vector3.Cross(Vector3.up, camp.normalized);
                        p = camp + side * ((n % 5) - 2) * 1.6f + camp.normalized * 2.4f;
                    }
                    else
                    {
                        float a = n * 0.48f + 0.8f;
                        float rad = w.id == WorldId.Hub ? 21f : 7.5f;
                        p = new Vector3(Mathf.Cos(a) * rad, 0f, (w.id == WorldId.Hub ? 0f : 4f) + Mathf.Sin(a) * rad);
                        if (w.id == WorldId.Hub && Canon.InArena(p)) continue;
                    }
                }
                var look = Appearance.Random(person.name.GetHashCode());
                look.displayName = person.name;
                look.outfit = n % 6;
                var job = JobFor(person, n);
                var wander = job == NpcLife.Job.Wander;
                var go = ModularPerson.SpawnNpc(root, p, 180f, look, wander, 5f);
                go.name = person.name;
                var life = go.AddComponent<NpcLife>();
                life.job = job;
                var guest = go.AddComponent<GuestNpc>();
                var line = WorldBook.LineFor(person);
                if (person.quest_giver && person.quest_hooks != null && person.quest_hooks.Length > 0)
                    line += "\nQuest: " + string.Join(", ", person.quest_hooks);
                guest.def = new GuestDef
                {
                    id = person.id,
                    name = person.name,
                    title = string.IsNullOrEmpty(person.title) ? person.archetype : person.title,
                    line = line,
                    x = p.x,
                    z = p.z
                };
                guest.personId = person.id;
                guest.questHooks = person.quest_hooks;
                var weap = PersonKit.WeaponStem(facI >= 0 ? facs[facI] : null, n);
                if (!string.IsNullOrEmpty(weap)) CharacterGear.Attach(go, weap, true, 0.95f);
                if (facI >= 0 && facs[facI].visual != null && !string.IsNullOrEmpty(facs[facI].visual.primary_color)
                    && ColorUtility.TryParseHtmlString(facs[facI].visual.primary_color, out var sash))
                    ModularPerson.StampSash(go, sash);
                StampGiverBeacon(go, w.id, person);
                n++;
            }
        }

        static void Quests(Transform root, WorldDef w)
        {
            var quests = WorldBook.Quests(w.id);
            for (int i = 0; i < quests.Length; i++)
            {
                var q = quests[i];
                if (q == null || string.IsNullOrEmpty(q.title)) continue;
                float a = i * 0.7f - 0.4f;
                float rad = w.id == WorldId.Hub ? 19f : 5.5f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, (w.id == WorldId.Hub ? 0f : 1.5f) + Mathf.Sin(a) * rad);
                if (w.id == WorldId.Hub && Canon.InArena(p)) continue;
                var board = GameObject.CreatePrimitive(PrimitiveType.Cube);
                board.name = "Quest_" + q.id;
                board.transform.SetParent(root, false);
                board.transform.position = p + Vector3.up * 1.35f;
                board.transform.localScale = new Vector3(1.1f, 1.6f, 0.12f);
                var r = board.GetComponent<Renderer>();
                if (r) r.material = HubLook.Lit(new Color(0.42f, 0.28f, 0.14f), 0.05f, 0.22f);
                var ls = board.AddComponent<LoreStone>();
                ls.title = "Quest · " + q.title;
                ls.text = WorldBook.QuestText(q);
                var qb = board.AddComponent<QuestBoard>();
                qb.quest = q;
                qb.world = w.id;
                StoreDress.QuestMark(root, board.transform.position);
            }
        }

        static void Beasts(Transform root, WorldDef w)
        {
            var critters = WorldBook.Critters(w.id);
            int c = 0;
            if (critters != null && critters.Length > 0)
            {
                foreach (var crit in critters)
                {
                    if (crit == null) continue;
                    for (int pack = 0; pack < 2; pack++)
                    {
                        float a = c * 0.85f + pack * 0.4f;
                        var p = new Vector3(Mathf.Cos(a) * (16f + pack * 4f), 0f, 8f + Mathf.Sin(a) * (14f + pack * 3f));
                        var go = EvoSpawner.SpawnNamed(root, crit, p, w);
                        if (go)
                        {
                            var h = go.GetComponent<Hostile>() ?? go.AddComponent<Hostile>();
                            h.damage = 8f + c;
                            h.aggro = 14f + pack * 3f;
                        }
                        c++;
                    }
                }
            }
            else
            {
                for (int i = 0; i < w.fauna.Length; i++)
                {
                    var a = i * 2.1f;
                    var p = new Vector3(Mathf.Cos(a) * 16f, 0, 8f + Mathf.Sin(a) * 12f);
                    var go = EvoSpawner.Spawn(root, w.fauna[i], p, w);
                    if (go) go.AddComponent<Hostile>();
                }
            }
        }

        static void Roads(Transform root, WorldDef w)
        {
            var start = w.id == WorldId.Hub ? Canon.Spawn : new Vector3(0f, 0f, 2f);
            var cities = CityAtlas.For(w.id);
            if (cities.Length > 0)
            {
                for (int i = 0; i < cities.Length; i++)
                    Road(root, start, new Vector3(cities[i].x, 0f, cities[i].z), w.ground, "RoadCity_" + cities[i].id);
                return;
            }
            var facs = WorldBook.Factions(w.id);
            for (int i = 0; i < facs.Length; i++)
            {
                float a = i / Mathf.Max(1f, facs.Length) * Mathf.PI * 2f + 0.35f;
                var camp = new Vector3(Mathf.Cos(a) * 24f, 0f, Mathf.Sin(a) * 24f);
                Road(root, start, camp, w.ground, "RoadFac_" + i);
            }
        }

        static void Road(Transform root, Vector3 a, Vector3 b, Color col, string prefix)
        {
            a.y = 0.07f;
            b.y = 0.07f;
            var dir = b - a;
            dir.y = 0f;
            var len = dir.magnitude;
            if (len < 4f) return;
            var n = Mathf.Max(3, Mathf.CeilToInt(len / 4.2f));
            var lookYaw = Quaternion.LookRotation(dir.normalized).eulerAngles.y;
            for (int i = 0; i < n; i++)
            {
                var t = (i + 0.5f) / n;
                var p = Vector3.Lerp(a, b, t);
                var go = FreePacks.Spawn("road-straight", root, p, lookYaw, 4.2f, false, false)
                         ?? FreePacks.Spawn("road-straight-half", root, p, lookYaw, 4.2f, false, false);
                if (go) continue;
                var mat = HubLook.Lit(Color.Lerp(col, new Color(0.35f, 0.3f, 0.24f), 0.45f), 0.04f, 0.18f);
                var slab = HubLook.Prim(root, PrimitiveType.Cube, p, new Vector3(2.35f, 0.045f, 2.8f), mat, prefix + "_" + i, false);
                slab.transform.rotation = Quaternion.LookRotation(dir.normalized);
            }
        }

        static void Kingdoms(Transform root, WorldDef w)
        {
            CityTown.BuildAll(root, w);
        }

        static void Horizon(Transform root, string stem, float rad, int n, float h)
        {
            for (int i = 0; i < n; i++)
            {
                float a = i / (float)n * Mathf.PI * 2f + 0.07f;
                FreePacks.Spawn(stem, root, new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad), a * Mathf.Rad2Deg, h);
            }
        }

        static bool IsHubGuest(string name)
        {
            foreach (var g in Canon.HubGuests)
                if (string.Equals(g.name, name, System.StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static int IndexOfFaction(WorldBook.Faction[] facs, string id)
        {
            if (string.IsNullOrEmpty(id) || facs == null) return -1;
            for (int i = 0; i < facs.Length; i++)
                if (facs[i] != null && facs[i].id == id) return i;
            return -1;
        }

        static string WeaponFor(WorldBook.Faction[] facs, string factionId, int n)
        {
            var i = IndexOfFaction(facs, factionId);
            if (i >= 0 && facs[i].visual?.preferred_weapon_archetypes != null && facs[i].visual.preferred_weapon_archetypes.Length > 0)
            {
                var raw = facs[i].visual.preferred_weapon_archetypes[n % facs[i].visual.preferred_weapon_archetypes.Length];
                return MapWeapon(raw);
            }
            return n % 2 == 0 ? "weapon-sword" : null;
        }

        static void StampGiverBeacon(GameObject go, WorldId world, WorldBook.Person person)
        {
            var tokens = new List<string>();
            if (!string.IsNullOrEmpty(person.id)) tokens.Add(person.id);
            if (!string.IsNullOrEmpty(person.name)) tokens.Add(person.name);
            foreach (var q in WorldBook.OfferedBy(world, person.id))
            {
                if (q?.objectives == null) continue;
                foreach (var o in q.objectives)
                {
                    if (o == null || string.IsNullOrEmpty(o.target)) continue;
                    if (QuestLog.CanDo(o.type)) tokens.Add(o.target);
                }
            }
            if (tokens.Count == 0) return;
            var b = go.AddComponent<QuestBeacon>();
            b.tokens = tokens.ToArray();
            b.radius = 5.5f;
        }

        public static string Slug(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            return raw.Trim().ToLowerInvariant().Replace(' ', '_');
        }

        static NpcLife.Job JobFor(WorldBook.Person person, int n)
        {
            var raw = ((person.archetype ?? "") + " " + (person.title ?? "")).ToLowerInvariant();
            if (raw.Contains("merchant") || raw.Contains("vendor") || raw.Contains("keeper")
                || raw.Contains("stall") || raw.Contains("trader") || raw.Contains("inn"))
                return NpcLife.Job.Stall;
            if (raw.Contains("guard") || raw.Contains("watch") || raw.Contains("warden")
                || raw.Contains("sentry") || raw.Contains("soldier"))
                return NpcLife.Job.Watch;
            if (raw.Contains("scholar") || raw.Contains("scribe") || raw.Contains("archivist")
                || raw.Contains("priest") || person.quest_giver)
                return NpcLife.Job.Sit;
            if (raw.Contains("sweep") || raw.Contains("clean") || raw.Contains("porter"))
                return NpcLife.Job.Sweep;
            return n % 3 == 0 ? NpcLife.Job.Wander : NpcLife.Job.Watch;
        }

        static string MapWeapon(string raw) => PersonKit.MapWeapon(raw);

        static void Ring(Transform root, string stem, float rad, int n, float h, float yawOff)
        {
            for (int i = 0; i < n; i++)
            {
                float a = i / (float)n * Mathf.PI * 2f + 0.2f;
                FreePacks.Spawn(stem, root, new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad),
                    -a * Mathf.Rad2Deg + yawOff, h);
            }
        }

        static void Scatter(Transform root, string stem, int n, float r0, float r1, float h)
        {
            for (int i = 0; i < n; i++)
            {
                float a = i * 2.399f + 0.7f;
                float r = Mathf.Lerp(r0, r1, (i % 5) / 4f);
                FreePacks.Spawn(stem, root, new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r), i * 37f, h);
            }
        }
    }

    /// <summary>
    /// One walkable town per authored city: streets, enterable buildings, a gate.
    /// Geometry is DressVocab (Store pack first, Kenney fallback). Names stay canon.
    /// </summary>
    public static class CityTown
    {
        public static void BuildAll(Transform root, WorldDef w)
        {
            if (w.id == WorldId.Hub) return;
            var cities = CityAtlas.For(w.id);
            for (int i = 0; i < cities.Length; i++)
                Build(root, w, cities[i], i);
            try
            {
                System.IO.File.WriteAllText("/tmp/concordia-atlas.txt",
                    System.DateTime.Now.ToString("o") + "\n" + CityAtlas.Dump());
                System.IO.File.WriteAllText("/tmp/concordia-visual.txt",
                    System.DateTime.Now.ToString("o") + "\n" + DressVocab.Audit());
            }
            catch { }
        }

        public static void Build(Transform root, WorldDef w, WorldBook.CityDef city, int i)
        {
            var p = new Vector3(city.x, 0f, city.z);
            var inward = -p;
            inward.y = 0f;
            if (inward.sqrMagnitude < 0.2f) inward = Vector3.back;
            inward.Normalize();
            var yaw = Mathf.Atan2(-inward.x, -inward.z) * Mathf.Rad2Deg;
            var hold = new GameObject("City_" + city.id).transform;
            hold.SetParent(root, false);
            hold.position = p;
            hold.rotation = Quaternion.Euler(0f, yaw, 0f);

            PlazaPad(hold, w);
            CrossStreets(hold, yaw);
            Sidewalks(hold);

            var kit = DressVocab.Kit(w.id);
            var plans = Plans(w.id);
            Vector3[] slots =
            {
                new Vector3(-6.2f, 0f, 4.2f),
                new Vector3(6.2f, 0f, 4.4f),
                new Vector3(-7.4f, 0f, -3.0f),
                new Vector3(7.2f, 0f, -3.2f),
                new Vector3(0f, 0f, 8.4f),
                new Vector3(0f, 0f, -8.8f),
                new Vector3(-10.2f, 0f, 0.4f),
                new Vector3(10.2f, 0f, 0.2f),
                new Vector3(-5.4f, 0f, 9.2f),
                new Vector3(5.6f, 0f, -9.4f)
            };
            int interiors = DressVocab.PlayableRooms(i);
            bool fake = DressVocab.WantsFakeWindows(i);
            for (int s = 0; s < slots.Length; s++)
            {
                var local = slots[s];
                var world = hold.TransformPoint(local);
                var stem = kit[s % kit.Length];
                float h = stem.Contains("skyscraper") ? 14f : stem.Contains("tent") ? 3.4f : 6.2f;
                var go = FreePacks.Spawn(stem, hold, world, yaw + (s % 2 == 0 ? 0f : 180f), h, required: false);
                if (go && s < interiors) BuildingInterior.Open(go, plans[s % plans.Length], world);
                else if (go && fake && s < 4) BuildingInterior.FakeWindows(go);
            }

            StreetDress(hold, w, yaw);
            EdgeFlora(hold, w, yaw);
            FortRim(hold, w, yaw);
            Outskirts(hold, w, i);
            AmbientWalkers(hold, w, i);
            var beacon = hold.gameObject.AddComponent<QuestBeacon>();
            var tokens = new List<string> { city.id, city.name, RealmFill.Slug(city.name) };
            if (city.districts != null)
                foreach (var d in city.districts)
                    if (!string.IsNullOrEmpty(d)) tokens.Add(d);
            beacon.tokens = tokens.ToArray();
            beacon.radius = 14f;

            var plaque = HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 1.1f, -8.6f),
                new Vector3(1.15f, 1.7f, 0.16f), HubLook.Lit(w.sun, 0.25f, 0.4f), "Plaque");
            var stone = plaque.AddComponent<LoreStone>();
            stone.title = city.name;
            var body = city.description ?? "";
            if (city.districts != null && city.districts.Length > 1)
                body += "\n\nStreets: " + string.Join(", ", TitleDistricts(city.districts));
            if (body.Length > 800) body = body.Substring(0, 797) + "…";
            stone.text = body;

            var gateGo = new GameObject("CityGate_" + city.id);
            gateGo.transform.SetParent(hold, false);
            gateGo.transform.localPosition = new Vector3(0f, 0f, -9.2f);
            var gate = gateGo.AddComponent<CityGate>();
            gate.city = city;
            var box = gateGo.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 1.2f, 0f);
            box.size = new Vector3(4.2f, 2.6f, 2.4f);
            box.isTrigger = true;
        }

        static string[] TitleDistricts(string[] raw)
        {
            var outp = new string[raw.Length];
            for (int i = 0; i < raw.Length; i++) outp[i] = CityAtlas.Titleize(raw[i]);
            return outp;
        }

        static void PlazaPad(Transform hold, WorldDef w)
        {
            var (stem, tint, tile) = w.id switch
            {
                WorldId.Ruins => ("ash_soil", new Color(0.52f, 0.46f, 0.38f), 6f),
                WorldId.Tunya => ("grove_moss", new Color(0.42f, 0.52f, 0.30f), 5f),
                WorldId.Fantasy => ("stone_tiles", new Color(0.48f, 0.44f, 0.38f), 4f),
                WorldId.Crime => ("wet_asphalt", new Color(0.28f, 0.26f, 0.24f), 5f),
                WorldId.Cyber => ("concrete_floor", new Color(0.42f, 0.48f, 0.55f), 4f),
                WorldId.Frontier => ("packed_earth", new Color(0.68f, 0.54f, 0.36f), 6f),
                WorldId.Superhero => ("concrete_floor", new Color(0.50f, 0.52f, 0.56f), 4f),
                WorldId.Sere => ("wet_asphalt", new Color(0.30f, 0.26f, 0.20f), 5f),
                WorldId.Crucible => ("metal_plate", new Color(0.35f, 0.70f, 0.65f), 4f),
                _ => ("stone_tiles", new Color(0.50f, 0.46f, 0.40f), 5f)
            };
            var mat = HubLook.Pbr(stem, tint, 0.03f, 0.18f, tile);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.03f, 0f), new Vector3(22f, 0.08f, 22f), mat, "PlazaPad", false);
        }

        static void CrossStreets(Transform hold, float yaw)
        {
            float[] along = { -10.5f, 0f, 10.5f };
            for (int i = 0; i < along.Length; i++)
            {
                FreePacks.Spawn("road-straight", hold, hold.TransformPoint(new Vector3(0f, 0f, along[i])), yaw + 90f, 5.2f, false, false);
                FreePacks.Spawn("road-straight", hold, hold.TransformPoint(new Vector3(along[i], 0f, 0f)), yaw, 5.2f, false, false);
            }
            FreePacks.Spawn("road-intersection", hold, hold.position, yaw, 5.4f, false, false);
        }

        static void Sidewalks(Transform hold)
        {
            var mat = HubLook.Pbr("stone_tiles", new Color(0.56f, 0.52f, 0.46f), 0.04f, 0.2f, 8f);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.05f, 3.55f), new Vector3(20f, 0.04f, 1.05f), mat, "Walk", false);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 0.05f, -3.55f), new Vector3(20f, 0.04f, 1.05f), mat, "Walk", false);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(3.55f, 0.05f, 0f), new Vector3(1.05f, 0.04f, 20f), mat, "Walk", false);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(-3.55f, 0.05f, 0f), new Vector3(1.05f, 0.04f, 20f), mat, "Walk", false);
        }

        static void StreetDress(Transform hold, WorldDef w, float yaw)
        {
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(-2.4f, 0f, -4.2f)));
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(2.4f, 0f, 4.2f)));
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(-8.2f, 0f, 2.6f)));
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(8.2f, 0f, -2.8f)));
            var prop = DressVocab.Prop(w.id);
            FreePacks.Spawn(prop, hold, hold.TransformPoint(new Vector3(-3.2f, 0f, -1.2f)), yaw, 1.1f);
            FreePacks.Spawn(prop, hold, hold.TransformPoint(new Vector3(3.4f, 0f, 1.6f)), yaw + 40f, 1.1f);
            FreePacks.Spawn(DressVocab.Crate(), hold, hold.TransformPoint(new Vector3(-4.6f, 0f, 2.2f)), yaw + 15f, 0.9f);
            FreePacks.Spawn(DressVocab.Crate(), hold, hold.TransformPoint(new Vector3(4.8f, 0f, -2.0f)), yaw + 70f, 0.9f);
            FreePacks.Spawn(DressVocab.Table(), hold, hold.TransformPoint(new Vector3(-1.6f, 0f, 1.2f)), yaw, 1.0f);
            FreePacks.Spawn(DressVocab.Chair(), hold, hold.TransformPoint(new Vector3(-1.6f, 0f, 0.2f)), yaw, 0.85f);
            FreePacks.Spawn(DressVocab.Chest(), hold, hold.TransformPoint(new Vector3(2.1f, 0f, -3.4f)), yaw + 90f, 0.85f);
            if (w.id == WorldId.Crime || w.id == WorldId.Sere || w.id == WorldId.Cyber)
                FreePacks.Spawn(DressVocab.FirstStem(new[] { "Dumpster" }, "dumpster"), hold, hold.TransformPoint(new Vector3(-7.2f, 0f, -5.4f)), yaw + 20f, 1.6f);
            if (w.id == WorldId.Tunya || w.id == WorldId.Frontier)
                FreePacks.Spawn(DressVocab.Cart(), hold, hold.TransformPoint(new Vector3(3.8f, 0f, 5.2f)), yaw + 25f, 1.8f);
        }

        static void EdgeFlora(Transform hold, WorldDef w, float yaw)
        {
            var tree = DressVocab.Tree(w.id);
            var grass = DressVocab.Grass(w.id);
            var prop = DressVocab.Prop(w.id);
            var col = DressVocab.Column(w.id);
            var stems = w.id switch
            {
                WorldId.Tunya => new[] { tree, tree, DressVocab.FirstStem(new[] { "Crops" }, "crops_cornStageD"), grass },
                WorldId.Fantasy => new[] { DressVocab.FirstStem(new[] { "Hedge" }, "hedge-large"), tree, DressVocab.FirstStem(new[] { "flower_redA" }, "flower_redA"), grass },
                WorldId.Frontier => new[] { DressVocab.FirstStem(new[] { "Palm" }, "palm-straight"), DressVocab.FirstStem(new[] { "Palm" }, "palm-detailed-bend"), grass, DressVocab.Rock() },
                WorldId.Ruins => new[] { DressVocab.FirstStem(new[] { "Gravestone" }, "gravestone"), col, DressVocab.Rock(), grass },
                WorldId.Crime => new[] { DressVocab.FirstStem(new[] { "Dumpster" }, "dumpster"), prop, DressVocab.FirstStem(new[] { "detail-awning" }, "detail-awning"), grass },
                WorldId.Cyber => new[] { DressVocab.Wall(w.id), col, grass, prop },
                WorldId.Superhero => new[] { DressVocab.Wall(w.id), col, grass, prop },
                WorldId.Sere => new[] { DressVocab.FirstStem(new[] { "Dumpster" }, "dumpster"), prop, col, grass },
                _ => new[] { DressVocab.FirstStem(new[] { "Crystal" }, "detail-crystal-large"), grass, col, DressVocab.Rock() }
            };
            for (int k = 0; k < 8; k++)
            {
                float a = k / 8f * Mathf.PI * 2f + 0.18f;
                var local = new Vector3(Mathf.Cos(a) * 15.4f, 0f, Mathf.Sin(a) * 15.4f);
                var stem = stems[k % stems.Length];
                var key = (stem ?? "").ToLowerInvariant();
                float h = key.Contains("tree") || key.Contains("palm") || key.Contains("fir") ? 7.2f
                    : key.Contains("hedge") || key.Contains("column") ? 2.6f
                    : key.Contains("crops") ? 1.4f : 0.7f;
                FreePacks.Spawn(stem, hold, hold.TransformPoint(local), yaw + k * 28f, h);
            }
            for (int k = 0; k < 14; k++)
            {
                float a = k / 14f * Mathf.PI * 2f + 0.41f;
                var local = new Vector3(Mathf.Cos(a) * 13.1f, 0f, Mathf.Sin(a) * 13.1f);
                FreePacks.Spawn(grass, hold, hold.TransformPoint(local), yaw + k * 19f, 0.55f);
            }
        }

        static void FortRim(Transform hold, WorldDef w, float yaw)
        {
            if (w.id != WorldId.Fantasy && w.id != WorldId.Ruins) return;
            var wall = DressVocab.Wall(w.id);
            var tower = DressVocab.Tower(w.id);
            Vector3[] posts =
            {
                new Vector3(-12.6f, 0f, 12.6f),
                new Vector3(12.6f, 0f, 12.6f),
                new Vector3(-12.6f, 0f, -12.6f),
                new Vector3(12.6f, 0f, -12.6f)
            };
            for (int i = 0; i < posts.Length; i++)
                FreePacks.Spawn(tower, hold, hold.TransformPoint(posts[i]), yaw + i * 90f, 8.4f);
            FreePacks.Spawn(wall, hold, hold.TransformPoint(new Vector3(-12.6f, 0f, 0f)), yaw + 90f, 4.2f);
            FreePacks.Spawn(wall, hold, hold.TransformPoint(new Vector3(12.6f, 0f, 0f)), yaw + 90f, 4.2f);
            FreePacks.Spawn(wall, hold, hold.TransformPoint(new Vector3(0f, 0f, 12.6f)), yaw, 4.2f);
        }

        static void AmbientWalkers(Transform hold, WorldDef w, int cityIndex)
        {
            if (cityIndex >= 4) return;
            int count = cityIndex < 2 ? 3 : 2;
            for (int n = 0; n < count; n++)
            {
                var local = new Vector3((n == 0 ? -3.4f : n == 1 ? 3.6f : 0.2f), 0f, 1.2f + n);
                var world = hold.TransformPoint(local);
                var look = Appearance.Random(w.id.GetHashCode() + cityIndex * 17 + n * 31);
                look.displayName = n == 0 ? "a worker" : n == 1 ? "a traveler" : "a guard";
                look.outfit = (cityIndex + n) % 6;
                var go = ModularPerson.SpawnNpc(hold, world, hold.eulerAngles.y + 180f, look, false);
                go.name = look.displayName;
                var life = go.AddComponent<NpcLife>();
                life.job = n == 0 ? NpcLife.Job.Sweep : n == 1 ? NpcLife.Job.Wander : NpcLife.Job.Watch;
                var guest = go.AddComponent<GuestNpc>();
                guest.def = new GuestDef
                {
                    id = "ambient-" + w.id + "-" + cityIndex + "-" + n,
                    name = look.displayName,
                    title = "unlabeled",
                    line = "They keep their own hours. Not an authored citizen."
                };
            }
        }

        static void Outskirts(Transform hold, WorldDef w, int cityIndex)
        {
            if (!w.steelLive) return;
            if (WorldClock.Ecology < 0.28f) return;
            var critters = WorldBook.Critters(w.id);
            var packs = WorldClock.Ecology < 0.4f ? 1 : (cityIndex < 4 ? 2 : 1);
            for (int n = 0; n < packs; n++)
            {
                var local = new Vector3(16f + n * 3.2f, 0f, -14f - n * 2.4f);
                var world = hold.TransformPoint(local);
                GameObject go = null;
                if (critters != null && critters.Length > 0)
                    go = EvoSpawner.SpawnNamed(hold, critters[(cityIndex + n) % critters.Length], world, w);
                else if (w.fauna != null && w.fauna.Length > 0)
                    go = EvoSpawner.Spawn(hold, w.fauna[(cityIndex + n) % w.fauna.Length], world, w);
                if (go)
                {
                    var h = go.GetComponent<Hostile>() ?? go.AddComponent<Hostile>();
                    h.aggro = 12f;
                    h.damage = 7f + n;
                }
            }
        }

        static string[] Plans(WorldId id) => id switch
        {
            WorldId.Tunya => new[] { "market", "tavern", "archive", "market", "tavern", "archive" },
            WorldId.Crime => new[] { "market", "tavern", "archive", "market", "tavern", "tower" },
            WorldId.Cyber => new[] { "tower", "archive", "tower", "archive", "tower", "embassy" },
            WorldId.Superhero => new[] { "tower", "archive", "tower", "tavern", "embassy", "tower" },
            WorldId.Sere => new[] { "archive", "market", "tower", "tavern", "archive", "market" },
            _ => new[] { "archive", "tavern", "market", "embassy", "archive", "tavern" }
        };
    }

    /// <summary>
    /// Kenney mini-dungeon tiles as a walkable hold. The plaque does not invent a place name.
    /// Hostiles and a chest are real; the hold is dressing for an authored world's steel.
    /// </summary>
    public static class DungeonHold
    {
        public static void Build(Transform root, WorldDef w)
        {
            if (w.id == WorldId.Hub) return;
            var cities = CityAtlas.For(w.id);
            Vector3 mouth;
            if (cities.Length > 0)
                mouth = new Vector3(cities[0].x + 10f, 0f, cities[0].z - 12f);
            else
                mouth = new Vector3(22f, 0f, -18f);

            var hold = new GameObject("Hold_" + w.id).transform;
            hold.SetParent(root, false);
            hold.position = mouth;

            const float tile = 2.2f;
            Room(hold, new Vector3(0f, 0f, 5f), 5, 4, tile, "mouth");
            Room(hold, new Vector3(0f, 0f, 14.4f), 4, 5, tile, "hall");
            Room(hold, new Vector3(0f, 0f, 24.2f), 4, 4, tile, "vault");
            FreePacks.Spawn("wall-opening", hold, hold.TransformPoint(new Vector3(0f, 0f, 9.4f)), 0f, 2.6f);
            FreePacks.Spawn("wall-opening", hold, hold.TransformPoint(new Vector3(0f, 0f, 19.4f)), 0f, 2.6f);
            FreePacks.Spawn("wall-opening", hold, hold.TransformPoint(new Vector3(0f, 0f, 2.6f)), 0f, 2.6f);
            FreePacks.Spawn("stairs", hold, hold.TransformPoint(new Vector3(0f, 0f, 1.2f)), 180f, 1.8f);
            FreePacks.Spawn("column", hold, hold.TransformPoint(new Vector3(-3.2f, 0f, 5.4f)), 0f, 2.8f);
            FreePacks.Spawn("column", hold, hold.TransformPoint(new Vector3(3.2f, 0f, 5.4f)), 0f, 2.8f);
            FreePacks.Spawn("barrel", hold, hold.TransformPoint(new Vector3(-2.4f, 0f, 14.2f)), 20f, 1.0f);
            FreePacks.Spawn("wood-structure", hold, hold.TransformPoint(new Vector3(2.6f, 0f, 15.1f)), 10f, 2.2f);

            var chestPos = hold.TransformPoint(new Vector3(0f, 0f, 25.4f));
            var chest = FreePacks.Spawn("chest", hold, chestPos, 180f, 0.9f);
            if (chest)
            {
                var g = chest.AddComponent<Gatherable>();
                g.itemId = "chest";
                g.label = "chest";
            }

            var inside = hold.TransformPoint(new Vector3(0f, 0.12f, 5.2f));
            var gateGo = new GameObject("DungeonGate_" + w.id);
            gateGo.transform.SetParent(hold, false);
            gateGo.transform.position = mouth;
            var gate = gateGo.AddComponent<DungeonGate>();
            gate.holdName = "the hold";
            gate.inside = inside;
            gate.mouth = mouth + new Vector3(0f, 0.12f, -3.2f);
            var box = gateGo.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 1.1f, 0f);
            box.size = new Vector3(3.6f, 2.4f, 2.2f);
            box.isTrigger = true;

            var plaque = HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 1.05f, -2.6f),
                new Vector3(1.05f, 1.5f, 0.12f), HubLook.Lit(w.ground, 0.08f, 0.22f), "HoldPlaque");
            var stone = plaque.AddComponent<LoreStone>();
            stone.title = "A hold";
            stone.text = "Kenney tiles. Mouth, hall, vault — geometry roles. No authored dungeon name in this world's canon — the geometry is dressing. Live steel applies.";

            var beacon = hold.gameObject.AddComponent<QuestBeacon>();
            beacon.tokens = new[] { "dungeon", "hold", "training_hollow", WorldBook.Folder(w.id) + "_hold" };
            beacon.radius = 16f;

            int packs = w.steelLive ? 3 : 1;
            Vector3[] dens = { new Vector3(-1.6f, 0f, 6.2f), new Vector3(1.4f, 0f, 15.2f), new Vector3(0f, 0f, 23.6f) };
            for (int i = 0; i < packs; i++)
            {
                var p = hold.TransformPoint(dens[i % dens.Length]);
                var kind = w.fauna != null && w.fauna.Length > 0 ? w.fauna[i % w.fauna.Length] : "hound";
                var go = EvoSpawner.Spawn(hold, kind, p, w);
                if (go)
                {
                    var h = go.GetComponent<Hostile>() ?? go.AddComponent<Hostile>();
                    h.aggro = 10f;
                    h.damage = 7f + i;
                }
            }
        }

        static void Room(Transform hold, Vector3 center, int cols, int rows, float tile, string role)
        {
            var origin = center + new Vector3(-(cols - 1) * 0.5f * tile, 0f, -(rows - 1) * 0.5f * tile);
            for (int z = 0; z < rows; z++)
            for (int x = 0; x < cols; x++)
            {
                var p = hold.TransformPoint(origin + new Vector3(x * tile, 0f, z * tile));
                FreePacks.Spawn((x + z) % 5 == 0 ? "floor-detail" : "floor", hold, p, 0f, 2.2f, false, false);
            }
            for (int x = 0; x < cols; x++)
            {
                Wall(hold, origin + new Vector3(x * tile, 0f, -tile * 0.5f), 0f);
                Wall(hold, origin + new Vector3(x * tile, 0f, (rows - 1) * tile + tile * 0.5f), 180f);
            }
            for (int z = 0; z < rows; z++)
            {
                Wall(hold, origin + new Vector3(-tile * 0.5f, 0f, z * tile), 90f);
                Wall(hold, origin + new Vector3((cols - 1) * tile + tile * 0.5f, 0f, z * tile), -90f);
            }
            var mark = hold.gameObject.AddComponent<QuestBeacon>();
            mark.tokens = new[] { role, "hold", role + "_room" };
            mark.radius = 5.5f;
            _ = role;
        }

        static void Wall(Transform hold, Vector3 local, float yaw)
        {
            FreePacks.Spawn("wall", hold, hold.TransformPoint(local), yaw, 2.6f);
        }
    }
}
