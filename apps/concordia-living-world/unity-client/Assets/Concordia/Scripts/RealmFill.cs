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
            Roads(root, w);
            Lore(root, w);
            People(root, w);
            Quests(root, w);
            if (id != WorldId.Hub) Beasts(root, w);
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
                    var fi = IndexOfFaction(facs, person.faction_id);
                    if (fi >= 0)
                    {
                        float a = fi / Mathf.Max(1f, facs.Length) * Mathf.PI * 2f + 0.35f;
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
                var wander = !person.quest_giver && n % 3 == 0;
                var go = ModularPerson.SpawnNpc(root, p, 180f, look, wander, 5f);
                go.name = person.name;
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
                var weap = WeaponFor(facs, person.faction_id, n);
                if (!string.IsNullOrEmpty(weap)) CharacterGear.Attach(go, weap, true, 0.95f);
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

        static string MapWeapon(string raw)
        {
            var s = (raw ?? "").ToLowerInvariant();
            if (s.Contains("spear") || s.Contains("lance")) return "spear";
            if (s.Contains("staff") || s.Contains("wand")) return "staff";
            if (s.Contains("dagger") || s.Contains("knife")) return "dagger";
            if (s.Contains("axe")) return "axe";
            if (s.Contains("bow")) return "bow";
            if (s.Contains("mace") || s.Contains("club")) return "mace";
            if (s.Contains("great")) return "greatsword";
            if (s.Contains("shield")) return "shield-rectangle";
            return "weapon-sword";
        }

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
}
