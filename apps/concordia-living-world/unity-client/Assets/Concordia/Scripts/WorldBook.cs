using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Authored lore / NPC / creature / faction / quest JSON from content/world.
    /// Missing files stay empty — never invents lines.
    /// </summary>
    public static class WorldBook
    {
        [Serializable] public class LoreDoc
        {
            public string world_name, world_description;
            public Beat[] history;
        }
        [Serializable] public class Beat
        {
            public string id, title, type, era, description, significance;
        }
        [Serializable] public class PeopleDoc { public Person[] items; }
        [Serializable] public class Person
        {
            public string id, name, title, archetype, backstory, background, faction_id, dialogue_style;
            public bool quest_giver;
            public string[] quest_hooks;
        }
        [Serializable] public class CritterDoc { public Critter[] items; }
        [Serializable] public class Critter
        {
            public string id, name, topology_hint, description, size_band;
        }
        [Serializable] public class FactionDoc { public Faction[] items; }
        [Serializable] public class Faction
        {
            public string id, name, motto, goal, dialogue_style;
            public string[] npc_ids, controlled_districts, rival_factions;
            public Visual visual;
        }
        [Serializable] public class Visual
        {
            public string primary_color, secondary_color, architecture_style;
            public string[] preferred_weapon_archetypes;
        }
        [Serializable] public class QuestDoc { public Quest[] items; }
        [Serializable] public class Quest
        {
            public string id, title, description, giver_npc_id, difficulty;
            public string[] prerequisites;
            public Objective[] objectives;
        }
        [Serializable] public class Objective
        {
            public string id, type, target, description;
            public int required_count;
        }
        [Serializable] public class CountriesDoc { public Country[] countries; }
        [Serializable] public class Country
        {
            public string country_id, faction_id, name, description, theme;
            public Capital capital;
        }
        [Serializable] public class Capital { public string name; public float x, z; }

        [Serializable]
        public class CityDef
        {
            public string id, name, factionId, description;
            public WorldId world;
            public float x, z;
            public string[] districts;
        }

        public static string Folder(WorldId id) => id switch
        {
            WorldId.Hub => "concordia-hub",
            WorldId.Ruins => "sovereign-ruins",
            WorldId.Tunya => "tunya",
            WorldId.Fantasy => "fantasy",
            WorldId.Crime => "crime",
            WorldId.Cyber => "cyber",
            WorldId.Frontier => "concord-link-frontier",
            WorldId.Superhero => "superhero",
            WorldId.Sere => "sere",
            _ => "lattice-crucible"
        };

        public static LoreDoc Lore(WorldId id)
        {
            var t = Text(id, "lore");
            if (!t) return new LoreDoc { world_name = Canon.Get(id).title, world_description = Canon.Get(id).law, history = Array.Empty<Beat>() };
            try { return JsonUtility.FromJson<LoreDoc>(t.text) ?? new LoreDoc(); }
            catch (Exception e)
            {
                Debug.LogWarning("WorldBook lore " + id + ": " + e.Message);
                return new LoreDoc { history = Array.Empty<Beat>() };
            }
        }

        public static Person[] People(WorldId id)
        {
            var list = new List<Person>();
            AddPeople(list, ArrayFile(id, "npcs"));
            AddPeople(list, ArrayFile(id, "npcs-extra"));
            var seen = new HashSet<string>();
            var uniq = new List<Person>();
            foreach (var p in list)
            {
                if (p == null || string.IsNullOrEmpty(p.name)) continue;
                var key = string.IsNullOrEmpty(p.id) ? p.name : p.id;
                if (!seen.Add(key)) continue;
                uniq.Add(p);
            }
            return uniq.ToArray();
        }

        public static Critter[] Critters(WorldId id) => ArrayFile<CritterDoc, Critter>(id, "creatures", d => d.items);
        public static Faction[] Factions(WorldId id)
        {
            var list = new List<Faction>();
            Add(list, ArrayFile<FactionDoc, Faction>(id, "factions", d => d.items));
            Add(list, ArrayFile<FactionDoc, Faction>(id, "factions-extra", d => d.items));
            return list.ToArray();
        }

        public static Quest[] Quests(WorldId id)
        {
            var list = new List<Quest>();
            var folder = "Concordia/Canon/" + Folder(id) + "/quests";
            var files = Resources.LoadAll<TextAsset>(folder);
            if (files != null)
            {
                foreach (var t in files)
                {
                    if (!t) continue;
                    try
                    {
                        var wrapped = WrapArray(t.text);
                        var doc = JsonUtility.FromJson<QuestDoc>(wrapped);
                        if (doc?.items != null) Add(list, doc.items);
                    }
                    catch (Exception e)
                    {
                        Debug.LogWarning("WorldBook quest " + t.name + ": " + e.Message);
                    }
                }
            }
            return list.ToArray();
        }

        public static Quest QuestById(WorldId id, string questId)
        {
            if (string.IsNullOrEmpty(questId)) return null;
            foreach (var q in Quests(id))
                if (q != null && q.id == questId) return q;
            return null;
        }

        public static Quest[] OfferedBy(WorldId id, string npcId)
        {
            var list = new List<Quest>();
            if (string.IsNullOrEmpty(npcId)) return Array.Empty<Quest>();
            foreach (var q in Quests(id))
            {
                if (q == null) continue;
                if (string.Equals(q.giver_npc_id, npcId, StringComparison.OrdinalIgnoreCase))
                    list.Add(q);
            }
            return list.ToArray();
        }

        public static Country[] Countries(WorldId id)
        {
            var t = Text(id, "countries");
            if (!t) return Array.Empty<Country>();
            try
            {
                var doc = JsonUtility.FromJson<CountriesDoc>(t.text);
                return doc?.countries ?? Array.Empty<Country>();
            }
            catch (Exception e)
            {
                Debug.LogWarning("WorldBook countries " + id + ": " + e.Message);
                return Array.Empty<Country>();
            }
        }

        public static string LineFor(Person p)
        {
            var raw = !string.IsNullOrEmpty(p.backstory) ? p.backstory : p.background;
            if (string.IsNullOrEmpty(raw))
                return string.IsNullOrEmpty(p.title) ? p.name : p.name + ", " + p.title + ".";
            var cut = raw.IndexOf(". ", StringComparison.Ordinal);
            var s = cut > 40 && cut < 280 ? raw.Substring(0, cut + 1) : raw;
            if (s.Length > 360) s = s.Substring(0, 357) + "…";
            return s;
        }

        public static string QuestText(Quest q)
        {
            if (q == null) return "";
            var sb = q.title + "\n" + (q.description ?? "");
            if (q.objectives != null)
            {
                sb += "\n";
                foreach (var o in q.objectives)
                {
                    if (o == null || string.IsNullOrEmpty(o.description)) continue;
                    sb += "\n• " + o.description;
                }
            }
            if (sb.Length > 900) sb = sb.Substring(0, 897) + "…";
            return sb;
        }

        static void AddPeople(List<Person> list, Person[] src)
        {
            if (src == null) return;
            foreach (var p in src) list.Add(p);
        }

        static void Add<T>(List<T> list, T[] src)
        {
            if (src == null) return;
            foreach (var x in src) if (x != null) list.Add(x);
        }

        static TItem[] ArrayFile<TDoc, TItem>(WorldId id, string stem, Func<TDoc, TItem[]> pick) where TDoc : class
        {
            var t = Text(id, stem);
            if (!t) return Array.Empty<TItem>();
            try
            {
                var doc = JsonUtility.FromJson<TDoc>(WrapArray(t.text));
                return pick(doc) ?? Array.Empty<TItem>();
            }
            catch (Exception e)
            {
                Debug.LogWarning("WorldBook " + stem + " " + id + ": " + e.Message);
                return Array.Empty<TItem>();
            }
        }

        static Person[] ArrayFile(WorldId id, string stem) =>
            ArrayFile<PeopleDoc, Person>(id, stem, d => d.items);

        static string WrapArray(string raw)
        {
            var s = (raw ?? "").Trim();
            if (s.StartsWith("[")) return "{\"items\":" + s + "}";
            if (s.StartsWith("{")) return "{\"items\":[" + s + "]}";
            return "{\"items\":[]}";
        }

        static TextAsset Text(WorldId id, string stem) =>
            Resources.Load<TextAsset>("Concordia/Canon/" + Folder(id) + "/" + stem);
    }

    /// <summary>
    /// Every playable city is derived from authored countries + faction districts.
    /// Missing files stay empty — never invents a place.
    /// Dedupes by id, then records the display name (case-insensitive ids were dropping Tunya).
    /// </summary>
    public static class CityAtlas
    {
        static readonly Dictionary<WorldId, WorldBook.CityDef[]> Cache = new Dictionary<WorldId, WorldBook.CityDef[]>();

        public static void Invalidate() => Cache.Clear();

        public static WorldBook.CityDef[] For(WorldId world)
        {
            if (Cache.TryGetValue(world, out var hit)) return hit;
            if (world == WorldId.Hub)
            {
                Cache[world] = Array.Empty<WorldBook.CityDef>();
                return Cache[world];
            }
            var list = new List<WorldBook.CityDef>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var c in WorldBook.Countries(world))
            {
                if (c == null || string.IsNullOrEmpty(c.name)) continue;
                var id = string.IsNullOrEmpty(c.country_id) ? c.name : c.country_id;
                if (!seen.Add(id)) continue;
                seen.Add(c.name);
                var cap = c.capital != null && !string.IsNullOrEmpty(c.capital.name) ? c.capital.name : c.name;
                float x = c.capital != null ? c.capital.x : 0f;
                float z = c.capital != null ? c.capital.z : 0f;
                list.Add(new WorldBook.CityDef
                {
                    id = id,
                    name = cap,
                    factionId = c.faction_id,
                    description = string.IsNullOrEmpty(c.description) ? c.theme : c.description,
                    world = world,
                    x = x,
                    z = z,
                    districts = new[] { cap }
                });
            }

            foreach (var f in WorldBook.Factions(world))
            {
                if (f == null || string.IsNullOrEmpty(f.name)) continue;
                if (!string.IsNullOrEmpty(f.id) && seen.Contains(f.id)) continue;
                if (seen.Contains(f.name)) continue;
                var districts = f.controlled_districts;
                if (districts == null || districts.Length == 0) continue;
                if (!seen.Add(f.id ?? f.name)) continue;
                seen.Add(f.name);
                list.Add(new WorldBook.CityDef
                {
                    id = string.IsNullOrEmpty(f.id) ? districts[0] : f.id,
                    name = f.name,
                    factionId = f.id,
                    description = TrimMotto(f.motto, f.goal),
                    world = world,
                    districts = districts
                });
            }

            PlaceOnRing(list);
            var arr = list.ToArray();
            Cache[world] = arr;
            return arr;
        }

        public static WorldBook.CityDef Nearest(WorldId world, Vector3 pos, float max = 14f)
        {
            WorldBook.CityDef best = null;
            float bestD = max;
            foreach (var c in For(world))
            {
                var d = Vector3.Distance(new Vector3(c.x, 0f, c.z), new Vector3(pos.x, 0f, pos.z));
                if (d < bestD) { bestD = d; best = c; }
            }
            return best;
        }

        public static WorldBook.CityDef ForPerson(WorldId world, WorldBook.Person p)
        {
            var cities = For(world);
            if (cities.Length == 0 || p == null) return null;
            if (!string.IsNullOrEmpty(p.faction_id))
            {
                foreach (var c in cities)
                    if (c.factionId == p.faction_id) return c;
            }
            var key = string.IsNullOrEmpty(p.id) ? p.name : p.id;
            return cities[Mathf.Abs(key.GetHashCode()) % cities.Length];
        }

        public static string Dump()
        {
            var sb = new System.Text.StringBuilder();
            foreach (WorldId id in Enum.GetValues(typeof(WorldId)))
            {
                var cities = For(id);
                sb.AppendLine(id + " " + Canon.Get(id).title + " cities=" + cities.Length);
                foreach (var c in cities)
                    sb.AppendLine("  " + c.name + " @ " + c.x.ToString("0.0") + "," + c.z.ToString("0.0") + " fac=" + c.factionId);
            }
            return sb.ToString();
        }

        static void PlaceOnRing(List<WorldBook.CityDef> list)
        {
            if (list.Count == 0) return;
            float rad = 38f + Mathf.Min(28f, list.Count * 2.2f);
            for (int i = 0; i < list.Count; i++)
            {
                var c = list[i];
                if (Mathf.Abs(c.x) > 2f || Mathf.Abs(c.z) > 2f)
                {
                    c.x = Mathf.Clamp(c.x, -80f, 80f);
                    c.z = Mathf.Clamp(c.z, -80f, 80f);
                    continue;
                }
                float a = i / (float)list.Count * Mathf.PI * 2f + 0.21f;
                c.x = Mathf.Cos(a) * rad;
                c.z = Mathf.Sin(a) * rad;
            }
        }

        public static string Titleize(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "Unnamed";
            var parts = raw.Replace('-', '_').Split('_');
            for (int i = 0; i < parts.Length; i++)
            {
                if (parts[i].Length == 0) continue;
                parts[i] = char.ToUpperInvariant(parts[i][0]) + (parts[i].Length > 1 ? parts[i].Substring(1) : "");
            }
            return string.Join(" ", parts);
        }

        static string TrimMotto(string motto, string goal)
        {
            var s = string.IsNullOrEmpty(motto) ? (goal ?? "") : motto;
            if (!string.IsNullOrEmpty(goal) && !string.IsNullOrEmpty(motto))
                s = motto + "\n\n" + goal;
            if (s.Length > 700) s = s.Substring(0, 697) + "…";
            return s;
        }
    }

    /// <summary>
    /// REAL / BULK / VIRTUAL — AC Origins / KCD scale, not 500 full-AI bodies.
    /// </summary>
    public enum SimLod { Real, Bulk, Virtual }

    /// <summary>
    /// Port of browser kernel.ts — hour, weather, ecology, prices.
    /// The world keeps its hours when the player stands still.
    /// </summary>
    public static class WorldClock
    {
        public static WorldId World;
        public static float Hour = 7.2f;
        public static int Day = 1;
        public static string Weather = "clear";
        public static float Ecology = 0.7f;
        public static float Prices = 1f;
        public static float FactionHeat = 0.2f;
        public static string LastEvent = "";
        public static string NearbyAct = "";
        public static Vector3[] Threats = System.Array.Empty<Vector3>();
        static float _weatherT = 40f;
        static float _dumpAt;
        static float _actAge;
        static float _threatAt;
        static float _eventCd = 16f;

        public static void Enter(WorldId id)
        {
            World = id;
            var slice = WorldMemory.Load(id);
            var away = WorldMemory.AwayHours(slice);
            if (away > 0.05f) WorldMemory.Advance(slice, away, id);
            Hour = slice.hour;
            Day = slice.day;
            Ecology = slice.ecology;
            Prices = slice.prices;
            FactionHeat = slice.factionHeat;
            LastEvent = slice.lastEvent;
            Weather = Canon.Get(id).weather;
            ApplySky();
            NoteAct(Canon.Get(id).title + " kept its hours.");
        }

        public static void Leave()
        {
            WorldMemory.Write(World, Snapshot());
        }

        public static WorldSliceRec Snapshot()
        {
            return new WorldSliceRec
            {
                world = World.ToString(),
                hour = Hour,
                day = Day,
                ecology = Ecology,
                prices = Prices,
                factionHeat = FactionHeat,
                lastEvent = LastEvent,
                savedAt = Now(),
                deadCsv = WorldMemory.DeadCsv(World),
                births = WorldMemory.Births(World)
            };
        }

        public static void Tick(float dt)
        {
            Hour = (Hour + dt * 0.08f) % 24f;
            if (Hour < 0.05f * dt + 0.02f)
            {
                Day += 1;
                Prices = Mathf.Clamp(Prices * (0.96f + UnityEngine.Random.value * 0.1f), 0.7f, 1.6f);
                LastEvent = "Day " + Day + ". Markets " + (Prices > 1.1f ? "tightened" : "eased") + ". The world did not wait.";
            }
            _weatherT -= dt;
            Ecology = Mathf.Clamp(Ecology + dt * 0.004f, 0.15f, 1f);
            FactionHeat = Mathf.Max(0f, FactionHeat - dt * 0.02f);
            if (_weatherT <= 0f)
            {
                _weatherT = 28f + UnityEngine.Random.value * 22f;
                var kit = Canon.Get(World).weather;
                var cycle = new[] { kit, "wind", "clear", kit };
                Weather = cycle[UnityEngine.Random.Range(0, cycle.Length)];
                LastEvent = Canon.Get(World).title + ": weather shifted. Schedules will.";
            }
            _actAge += dt;
            if (_actAge > 8f) NearbyAct = "";
            TickEvents(dt);
            if (Mathf.FloorToInt(Hour * 4f) != Mathf.FloorToInt((Hour - dt * 0.08f) * 4f))
                ApplySky();
            if (Time.unscaledTime >= _threatAt)
            {
                _threatAt = Time.unscaledTime + 0.45f;
                var hs = UnityEngine.Object.FindObjectsByType<Hostile>(FindObjectsInactive.Exclude);
                var list = new List<Vector3>(hs.Length);
                foreach (var h in hs)
                {
                    if (!h) continue;
                    var dummy = h.GetComponent<TrainingDummy>();
                    if (dummy && dummy.hp <= 0f) continue;
                    list.Add(h.transform.position);
                }
                Threats = list.ToArray();
            }
            if (Time.unscaledTime >= _dumpAt)
            {
                _dumpAt = Time.unscaledTime + 2f;
                Dump();
            }
        }

        public static void NoteAct(string line)
        {
            if (string.IsNullOrEmpty(line)) return;
            NearbyAct = line;
            _actAge = 0f;
        }

        public static void NoteKill(string id)
        {
            WorldMemory.MarkDead(World, id);
            Ecology = Mathf.Max(0.15f, Ecology - 0.03f);
            FactionHeat = Mathf.Min(1f, FactionHeat + 0.04f);
            LastEvent = Canon.Get(World).title + ": a pack thinned.";
        }

        /// <summary>Port of events.ts tickEvents / rollEvent — authored strings only.</summary>
        static void TickEvents(float dt)
        {
            _eventCd -= dt;
            if (_eventCd > 0f) return;
            _eventCd = 24f + (World == WorldId.Hub ? 10f : 0f);
            var ev = RollEvent();
            Ecology = Mathf.Clamp(Ecology + ev.ecology, 0.08f, 1f);
            FactionHeat = Mathf.Clamp(FactionHeat + ev.heat, 0f, 1f);
            Prices = Mathf.Clamp(Prices + ev.prices, 0.6f, 1.8f);
            LastEvent = ev.text;
            if (ev.births > 0) WorldMemory.NoteBirth(World, ev.births);
        }

        struct EvRec
        {
            public string text;
            public float ecology, heat, prices;
            public int births;
        }

        static EvRec RollEvent()
        {
            var w = Canon.Get(World);
            var cities = CityAtlas.For(World);
            var town = cities != null && cities.Length > 0 && !string.IsNullOrEmpty(cities[0].name)
                ? cities[0].name : "the rim";
            var lore = WorldBook.Lore(World);
            var beat = lore?.history != null && lore.history.Length > 0 && !string.IsNullOrEmpty(lore.history[0].title)
                ? lore.history[0].title : w.title;
            var creature = w.fauna != null && w.fauna.Length > 0 ? w.fauna[0] : "packs";
            var kinds = EventKinds(World);
            var kind = kinds[Mathf.Abs(Day * 7 + Mathf.FloorToInt(Hour)) % kinds.Length];
            return kind switch
            {
                "migration" => new EvRec
                {
                    text = creature + " shifted toward " + town + ". Territory moved.",
                    ecology = 0.06f, heat = -0.04f, prices = 0.02f, births = 1
                },
                "shortage" => new EvRec
                {
                    text = w.title + ": stores tightened. " + w.refusal,
                    ecology = -0.08f, heat = 0.1f, prices = 0.14f
                },
                "scheme" => new EvRec
                {
                    text = "A faction scheme ripened. " + beat,
                    heat = 0.16f, prices = 0.04f
                },
                "emergence" => new EvRec
                {
                    text = w.title + ": " + creature + " took the hour.",
                    ecology = -0.05f, heat = 0.08f, births = 2
                },
                "treaty" => new EvRec
                {
                    text = w.title + " offered a treaty that will not hold unless someone walks it.",
                    ecology = 0.03f, heat = -0.18f, prices = -0.06f
                },
                "unburial" => new EvRec
                {
                    text = w.title + ": something catalogued stood up and walked the road.",
                    ecology = 0.02f, heat = 0.05f, births = 1
                },
                "census" => new EvRec
                {
                    text = w.title + ": a census skipped four numbers. Someone left a ledger, not a grave.",
                    ecology = -0.02f, heat = 0.12f, prices = 0.05f
                },
                _ => new EvRec
                {
                    text = w.title + ": weather shifted. " + w.refusal,
                    ecology = 0.01f
                }
            };
        }

        static string[] EventKinds(WorldId id) => id switch
        {
            WorldId.Hub => new[] { "scheme", "treaty", "weather" },
            WorldId.Ruins => new[] { "unburial", "emergence", "migration", "scheme" },
            WorldId.Tunya => new[] { "migration", "shortage", "weather", "treaty" },
            WorldId.Fantasy => new[] { "emergence", "scheme", "treaty" },
            WorldId.Crime => new[] { "scheme", "shortage", "census" },
            WorldId.Cyber => new[] { "census", "scheme", "emergence" },
            WorldId.Frontier => new[] { "weather", "migration", "treaty" },
            WorldId.Superhero => new[] { "treaty", "scheme", "emergence" },
            WorldId.Crucible => new[] { "emergence", "weather", "unburial" },
            WorldId.Sere => new[] { "scheme", "census", "weather" },
            _ => new[] { "weather" }
        };

        public static SimLod LodAt(Vector3 pos)
        {
            var player = ConcordiaPlayer.Live;
            if (!player) return SimLod.Virtual;
            var d = Vector3.Distance(player.transform.position, pos);
            if (d < 28f) return SimLod.Real;
            if (d < 70f) return SimLod.Bulk;
            return SimLod.Virtual;
        }

        public static string Phase
        {
            get
            {
                if (Hour < 6f || Hour >= 22f) return "night";
                if (Hour < 12f) return "morning";
                if (Hour < 14f) return "midday";
                if (Hour < 18f) return "afternoon";
                return "evening";
            }
        }

        public static string Line()
        {
            var w = Canon.Get(World);
            var cities = CityAtlas.For(World);
            var facs = WorldBook.Factions(World);
            var hh = Mathf.FloorToInt(Hour);
            var mm = Mathf.FloorToInt((Hour - hh) * 60f);
            var kingdom = w.title + " · " + cities.Length + " settlements · " + facs.Length + " factions";
            var clock = "Day " + Day + " · " + hh.ToString("00") + ":" + mm.ToString("00") + " · " + Weather + " · " + Phase;
            var act = string.IsNullOrEmpty(NearbyAct) ? "the plaza keeps its own hours" : NearbyAct;
            return clock + "\n" + kingdom + "\n" + act;
        }

        public static string HudClock()
        {
            var hh = Mathf.FloorToInt(Hour);
            var mm = Mathf.FloorToInt((Hour - hh) * 60f);
            return "Day " + Day + " · " + hh.ToString("00") + ":" + mm.ToString("00") + " · " + Weather
                + (Ecology < 0.4f ? " · ecology thin" : "");
        }

        static void ApplySky()
        {
            float day = Mathf.Clamp01(1f - Mathf.Abs(Hour - 13f) / 11f);
            RenderSettings.ambientIntensity = 0.28f + 0.72f * day;
            var sun = UnityEngine.Object.FindAnyObjectByType<Light>();
            if (sun && sun.type == LightType.Directional)
                sun.intensity = 0.35f + 0.9f * day;
        }

        static float Now() => (float)(DateTime.UtcNow - new DateTime(2026, 1, 1)).TotalSeconds;

        static void Dump()
        {
            try
            {
                int real = 0, bulk = 0, virt = 0;
                foreach (var n in UnityEngine.Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
                {
                    var l = LodAt(n.transform.position);
                    if (l == SimLod.Real) real++;
                    else if (l == SimLod.Bulk) bulk++;
                    else virt++;
                }
                int open = 0, patrol = 0, talk = 0, deliver = 0, inside = 0, hunt = 0;
                foreach (var n in UnityEngine.Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
                {
                    if (!n) continue;
                    if (n.act == "open") open++;
                    else if (n.act == "patrol") patrol++;
                    else if (n.act == "talk") talk++;
                    else if (n.act == "deliver") deliver++;
                    else if (n.act == "inside") inside++;
                }
                foreach (var f in UnityEngine.Object.FindObjectsByType<FaunaLife>(FindObjectsInactive.Exclude))
                    if (f && f.act == "hunt") hunt++;
                File.WriteAllText("/tmp/concordia-world-life.txt",
                    DateTime.Now.ToString("o") + " world=" + World + " hour=" + Hour.ToString("0.00")
                    + " day=" + Day + " weather=" + Weather + " ecology=" + Ecology.ToString("0.00")
                    + " prices=" + Prices.ToString("0.00") + " lod=" + real + "/" + bulk + "/" + virt
                    + " acts open=" + open + " patrol=" + patrol + " talk=" + talk
                    + " deliver=" + deliver + " inside=" + inside + " hunt=" + hunt
                    + "\n" + Line() + "\n" + LastEvent + "\n");
            }
            catch { }
        }
    }

    [Serializable]
    public class WorldSliceRec
    {
        public string world;
        public float ecology = 0.7f;
        public float prices = 1f;
        public float factionHeat = 0.2f;
        public float hour = 7.2f;
        public int day = 1;
        public int births;
        public string lastEvent = "";
        public float savedAt;
        public string deadCsv = "";
    }

    [Serializable]
    public class LivingSaveRec
    {
        public int v = 1;
        public WorldSliceRec[] slices;
    }

    /// <summary>
    /// Port of persist.ts WorldSlice — per-world memory that survives a gate.
    /// Virtual kingdoms keep hours while the player is elsewhere.
    /// </summary>
    public static class WorldMemory
    {
        static readonly Dictionary<WorldId, WorldSliceRec> Cache = new Dictionary<WorldId, WorldSliceRec>();

        public static WorldSliceRec Load(WorldId id)
        {
            if (Cache.TryGetValue(id, out var hit) && hit != null) return hit;
            var all = ReadFile();
            WorldSliceRec found = null;
            if (all?.slices != null)
                foreach (var s in all.slices)
                    if (s != null && s.world == id.ToString()) found = s;
            if (found == null)
            {
                found = new WorldSliceRec { world = id.ToString(), hour = 7.2f, day = 1, ecology = 0.7f, prices = 1f };
            }
            Cache[id] = found;
            return found;
        }

        public static void Write(WorldId id, WorldSliceRec slice)
        {
            slice.world = id.ToString();
            slice.savedAt = (float)(DateTime.UtcNow - new DateTime(2026, 1, 1)).TotalSeconds;
            Cache[id] = slice;
            var map = new Dictionary<string, WorldSliceRec>();
            foreach (WorldId w in Enum.GetValues(typeof(WorldId)))
                map[w.ToString()] = Load(w);
            map[id.ToString()] = slice;
            var list = new List<WorldSliceRec>();
            foreach (var kv in map) list.Add(kv.Value);
            var rec = new LivingSaveRec { v = 1, slices = list.ToArray() };
            try
            {
                var path = Path.Combine(Application.persistentDataPath, "concordia-living-v1.json");
                File.WriteAllText(path, JsonUtility.ToJson(rec, true));
            }
            catch { }
        }

        public static float AwayHours(WorldSliceRec slice)
        {
            if (slice == null || slice.savedAt <= 1f) return 0f;
            var now = (float)(DateTime.UtcNow - new DateTime(2026, 1, 1)).TotalSeconds;
            return Mathf.Min(18f, (now - slice.savedAt) / 60f);
        }

        public static void Advance(WorldSliceRec slice, float hours, WorldId id)
        {
            var next = slice.hour + hours;
            slice.day += Mathf.FloorToInt(next / 24f);
            slice.hour = next % 24f;
            slice.ecology = Mathf.Clamp(slice.ecology + hours * 0.01f, 0.15f, 1f);
            slice.prices = Mathf.Clamp(slice.prices * (0.96f + UnityEngine.Random.value * 0.08f), 0.7f, 1.6f);
            slice.factionHeat = Mathf.Max(0f, slice.factionHeat - hours * 0.02f);
            if (slice.ecology > 0.55f && !string.IsNullOrEmpty(slice.deadCsv))
            {
                var parts = new List<string>(slice.deadCsv.Split(','));
                if (parts.Count > 0)
                {
                    parts.RemoveAt(0);
                    slice.deadCsv = string.Join(",", parts);
                    slice.births += 1;
                }
            }
            slice.lastEvent = Canon.Get(id).title + ": Day " + slice.day + ". The world continued while you were away.";
        }

        public static void MarkDead(WorldId id, string name)
        {
            if (string.IsNullOrEmpty(name)) return;
            var s = Load(id);
            var key = name.Trim();
            if (string.IsNullOrEmpty(s.deadCsv)) s.deadCsv = key;
            else if (!s.deadCsv.Contains(key)) s.deadCsv += "," + key;
            Cache[id] = s;
        }

        public static bool IsDead(WorldId id, string name)
        {
            if (string.IsNullOrEmpty(name)) return false;
            var s = Load(id);
            if (string.IsNullOrEmpty(s.deadCsv)) return false;
            foreach (var p in s.deadCsv.Split(','))
                if (string.Equals(p.Trim(), name.Trim(), StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public static void NoteBirth(WorldId id, int n)
        {
            var s = Load(id);
            s.births += Mathf.Max(0, n);
            Cache[id] = s;
        }

        public static string DeadCsv(WorldId id) => Load(id).deadCsv ?? "";
        public static int Births(WorldId id) => Load(id).births;

        static LivingSaveRec ReadFile()
        {
            try
            {
                var path = Path.Combine(Application.persistentDataPath, "concordia-living-v1.json");
                if (!File.Exists(path)) return null;
                return JsonUtility.FromJson<LivingSaveRec>(File.ReadAllText(path));
            }
            catch { return null; }
        }
    }
}
