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
            KingdomBook.Dump();
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
                births = WorldMemory.Births(World),
                stock = WorldMemory.Load(World).stock,
                need = WorldMemory.Load(World).need,
                staple = WorldMemory.Load(World).staple,
                imports = WorldMemory.Load(World).imports,
                population = WorldMemory.Load(World).population
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
            CrossRing.TickCaravans(dt * 0.08f);
            CrossRing.PresentNearPlayer();
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
            // Trilight already carries HubLook's sky/equator/ground. Scaling
            // ambientIntensity on top crushed the HDR sky to mud.
            if (RenderSettings.ambientMode == UnityEngine.Rendering.AmbientMode.Trilight)
                RenderSettings.ambientIntensity = 0.92f + 0.08f * day;
            else
                RenderSettings.ambientIntensity = 0.28f + 0.72f * day;
            var suns = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Exclude);
            Light sun = null;
            for (int i = 0; i < suns.Length; i++)
            {
                var l = suns[i];
                if (!l || l.type != LightType.Directional) continue;
                if (l.name == "Sun") { sun = l; break; }
                if (sun == null && l.shadows != LightShadows.None) sun = l;
            }
            if (sun)
            {
                if (World == WorldId.Hub)
                    sun.intensity = 0.92f + 0.38f * day;
                else
                    sun.intensity = 0.35f + 0.9f * day;
            }
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
                int open = 0, patrol = 0, talk = 0, deliver = 0, inside = 0, hunt = 0, walking = 0;
                foreach (var n in UnityEngine.Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
                {
                    if (!n) continue;
                    if (n.act == "open") open++;
                    else if (n.act == "patrol") patrol++;
                    else if (n.act == "talk") talk++;
                    else if (n.act == "deliver") deliver++;
                    else if (n.act == "inside") inside++;
                    var person = n.GetComponent<ModularPerson>() ?? n.GetComponentInChildren<ModularPerson>();
                    if (person && person.PlanarSpeed > 0.35f) walking++;
                }
                foreach (var f in UnityEngine.Object.FindObjectsByType<FaunaLife>(FindObjectsInactive.Exclude))
                    if (f && f.act == "hunt") hunt++;
                File.WriteAllText("/tmp/concordia-world-life.txt",
                    DateTime.Now.ToString("o") + " world=" + World + " hour=" + Hour.ToString("0.00")
                    + " day=" + Day + " weather=" + Weather + " ecology=" + Ecology.ToString("0.00")
                    + " prices=" + Prices.ToString("0.00") + " lod=" + real + "/" + bulk + "/" + virt
                    + " acts open=" + open + " patrol=" + patrol + " talk=" + talk
                    + " deliver=" + deliver + " inside=" + inside + " hunt=" + hunt
                    + " walking=" + walking
                    + "\n" + Line() + "\n" + KingdomBook.HudLine() + "\n" + LastEvent + "\n");
                KingdomBook.Dump();
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
        public float stock = 1f;
        public float need = 0.4f;
        public string staple = "";
        public string imports = "";
        public int population;
    }

    [Serializable]
    public class LivingSaveRec
    {
        public int v = 1;
        public WorldSliceRec[] slices;
        public string plotsCsv = "";
        public string travelersCsv = "";
        public string crossCsv = "";
        public string caravansCsv = "";
        public string tariffsCsv = "";
    }

    /// <summary>
    /// Port of persist.ts WorldSlice — per-world memory that survives a gate.
    /// Virtual kingdoms keep hours while the player is elsewhere.
    /// </summary>
    public static class WorldMemory
    {
        static readonly Dictionary<WorldId, WorldSliceRec> Cache = new Dictionary<WorldId, WorldSliceRec>();
        static LivingSaveRec FileCache;

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
            KingdomBook.Ensure(found, id);
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
            var rec = All();
            rec.v = 1;
            rec.slices = list.ToArray();
            FileCache = rec;
            try
            {
                var path = Path.Combine(Application.persistentDataPath, "concordia-living-v1.json");
                File.WriteAllText(path, JsonUtility.ToJson(rec, true));
            }
            catch { }
        }

        public static LivingSaveRec All()
        {
            if (FileCache != null) return FileCache;
            FileCache = ReadFile() ?? new LivingSaveRec { v = 1 };
            if (FileCache.plotsCsv == null) FileCache.plotsCsv = "";
            if (FileCache.travelersCsv == null) FileCache.travelersCsv = "";
            if (FileCache.crossCsv == null) FileCache.crossCsv = "";
            if (FileCache.caravansCsv == null) FileCache.caravansCsv = "";
            if (FileCache.tariffsCsv == null) FileCache.tariffsCsv = "";
            return FileCache;
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
            KingdomBook.Ensure(slice, id);
            CrossRing.AwayTick(slice, hours, id);
            slice.lastEvent = string.IsNullOrEmpty(slice.lastEvent)
                ? Canon.Get(id).title + ": Day " + slice.day + ". The world continued while you were away."
                : slice.lastEvent;
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

        public static void Put(WorldId id, WorldSliceRec slice)
        {
            if (slice == null) return;
            slice.world = id.ToString();
            Cache[id] = slice;
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

    /// <summary>
    /// A Concordia world is a kingdom, not a map. Identity is derived from
    /// Canon + CityAtlas + factions + people — never invented.
    /// Audit: WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR.
    /// </summary>
    public static class KingdomBook
    {
        public static string Staple(WorldId id) => id switch
        {
            WorldId.Hub => "lanterns",
            WorldId.Ruins => "remnants",
            WorldId.Tunya => "harvest",
            WorldId.Fantasy => "ward",
            WorldId.Crime => "invoices",
            WorldId.Cyber => "census",
            WorldId.Frontier => "road",
            WorldId.Superhero => "mercy",
            WorldId.Sere => "marks",
            WorldId.Crucible => "drift",
            _ => "lanterns"
        };

        public static void Ensure(WorldSliceRec slice, WorldId id)
        {
            if (slice == null) return;
            if (string.IsNullOrEmpty(slice.staple)) slice.staple = Staple(id);
            if (slice.stock <= 0.01f) slice.stock = 1f;
            if (slice.need <= 0.01f) slice.need = id == WorldId.Hub ? 0.2f : 0.45f;
            if (slice.population <= 0)
            {
                var people = WorldBook.People(id);
                var cities = CityAtlas.For(id);
                slice.population = people.Length + (id == WorldId.Hub ? Canon.HubGuests.Length : cities.Length * 2);
            }
        }

        public static string HudLine()
        {
            var s = WorldMemory.Load(WorldClock.World);
            var w = Canon.Get(WorldClock.World);
            var cities = CityAtlas.For(WorldClock.World);
            var seat = WorldClock.World == WorldId.Hub
                ? "The Court is the city"
                : cities.Length + " settlements";
            var caravan = CrossRing.HudCaravan();
            return w.title + " · " + s.staple + " " + s.stock.ToString("0.0")
                + " · need " + s.need.ToString("0.0") + " · " + seat
                + (string.IsNullOrEmpty(caravan) ? "" : " · " + caravan);
        }

        public static void Dump()
        {
            try
            {
                File.WriteAllText("/tmp/concordia-kingdom.txt", Audit());
            }
            catch { }
        }

        public static string Audit()
        {
            var sb = new System.Text.StringBuilder();
            sb.AppendLine("WORLD → KINGDOM → REGION → SETTLEMENT → ACTIVITY → ACTOR");
            sb.AppendLine("derived from Canon + CityAtlas + WorldBook. Never invented.");
            foreach (WorldId id in Enum.GetValues(typeof(WorldId)))
            {
                var w = Canon.Get(id);
                var slice = WorldMemory.Load(id);
                Ensure(slice, id);
                var cities = CityAtlas.For(id);
                var facs = WorldBook.Factions(id);
                var people = WorldBook.People(id);
                var lore = WorldBook.Lore(id);
                var gate = GateName(id);
                sb.AppendLine();
                sb.AppendLine("WORLD " + w.title + " (" + id + ")");
                sb.AppendLine("  identity  " + w.refusal);
                sb.AppendLine("  rules     " + w.law);
                sb.AppendLine("  weather   " + w.weather + " · fauna " + (w.fauna == null ? "none" : string.Join(",", w.fauna)));
                sb.AppendLine("  gate      " + gate);
                sb.AppendLine("  state     day " + slice.day + " hour " + slice.hour.ToString("0.0")
                    + " ecology " + slice.ecology.ToString("0.00") + " prices " + slice.prices.ToString("0.00"));
                sb.AppendLine("  KINGDOM   staple " + slice.staple + " stock " + slice.stock.ToString("0.00")
                    + " need " + slice.need.ToString("0.00") + " pop " + slice.population
                    + " factions " + facs.Length);
                if (id == WorldId.Hub)
                    sb.AppendLine("  REGION    The Unburned Court (the Court is the city; unpaved)");
                else if (cities.Length == 0)
                    sb.AppendLine("  REGION    no authored settlement seated");
                else
                {
                    sb.AppendLine("  REGION    capital " + cities[0].name + " · wilderness outskirts · hold Kenney graph");
                    foreach (var c in cities)
                        sb.AppendLine("  SETTLEMENT  " + c.name + " fac=" + c.factionId);
                }
                sb.AppendLine("  ACTOR     authored people " + people.Length
                    + " · lore beats " + (lore?.history == null ? 0 : lore.history.Length));
                if (!string.IsNullOrEmpty(slice.imports))
                    sb.AppendLine("  IMPORTS   " + slice.imports);
                if (!string.IsNullOrEmpty(slice.lastEvent))
                    sb.AppendLine("  EVENT     " + slice.lastEvent);
            }
            var all = WorldMemory.All();
            sb.AppendLine();
            sb.AppendLine("CROSS plots=" + (all.plotsCsv ?? "") + " travelers=" + (all.travelersCsv ?? ""));
            sb.AppendLine("CARAVANS " + (string.IsNullOrEmpty(all.caravansCsv) ? "(none — economy has not dispatched)" : all.caravansCsv));
            sb.AppendLine("TARIFFS " + (string.IsNullOrEmpty(all.tariffsCsv) ? "(none)" : all.tariffsCsv));
            return sb.ToString();
        }

        public static string GateName(WorldId id)
        {
            if (id == WorldId.Hub) return "The Ring (eight doors)";
            if (id == WorldId.Sere) return "Court waystone — not a ninth Refusal gate";
            foreach (var g in Canon.Gates)
                if (g.world == id) return g.name + " · " + g.refusal;
            return "no authored gate";
        }
    }

    /// <summary>
    /// Port of cross.ts + a local-economy pulse. The gate is a connection:
    /// cargo, rumor, and travelers persist after the scene rebuilds.
    /// Does not invent weaponsmiths or kingdoms — only authored titles and staples.
    /// </summary>
    public static class CrossRing
    {
        public static string Walk(WorldId from, WorldId to, string carried)
        {
            if (from == to) return null;
            var fromSlice = WorldMemory.Load(from);
            var toSlice = WorldMemory.Load(to);
            KingdomBook.Ensure(fromSlice, from);
            KingdomBook.Ensure(toSlice, to);

            if (fromSlice.stock > 0.85f)
            {
                float ship = Mathf.Min(0.18f, fromSlice.stock - 0.7f);
                DispatchCaravan(from, to, fromSlice, ship, "walk");
            }

            if (!string.IsNullOrEmpty(carried))
            {
                toSlice.factionHeat = Mathf.Clamp(toSlice.factionHeat + 0.08f, 0f, 1f);
                toSlice.imports = (string.IsNullOrEmpty(toSlice.imports) ? "" : toSlice.imports + " · ")
                    + carried + " from " + Canon.Get(from).title;
                toSlice.lastEvent = Canon.Get(to).title + " noticed " + carried + " walked in from "
                    + Canon.Get(from).title + ".";
            }

            AdvancePlot(from, to);
            NudgeTraveler(from, to);
            MarkCross("seen:" + from + ":" + to);
            WorldMemory.Write(from, fromSlice);
            WorldMemory.Write(to, toSlice);
            WorldClock.LastEvent = toSlice.lastEvent;
            return toSlice.lastEvent;
        }

        public static void AwayTick(WorldSliceRec slice, float hours, WorldId id)
        {
            if (slice == null || hours < 0.05f) return;
            KingdomBook.Ensure(slice, id);
            slice.stock = Mathf.Clamp(slice.stock + hours * 0.045f * (0.4f + slice.ecology), 0.2f, 2.2f);
            slice.need = Mathf.Clamp(slice.need + hours * 0.03f - hours * 0.01f * slice.stock, 0.05f, 1.4f);
            slice.population = Mathf.Max(1, slice.population + (slice.ecology > 0.6f ? 1 : 0) * Mathf.FloorToInt(hours / 8f));
            if (hours >= 2f && slice.stock > 1.2f && id != WorldId.Hub)
                DispatchCaravan(id, WorldId.Hub, slice, 0.12f, "away");
            if (hours >= 4f) AdvanceTravelers(hours);
        }

        public static string[] LivingLines(string npcId)
        {
            if (string.IsNullOrEmpty(npcId)) return Array.Empty<string>();
            var extra = new List<string>();
            var bill = Plot("plot-bill");
            if (bill > 0 && (npcId == "mama" || npcId == "jax"))
                extra.Add(bill >= 2
                    ? "The invoice followed you through a door. I said it would. My people are still split."
                    : "Someone walked a delayed hit out of the yard. The Court will pretend it was etiquette.");
            var uncounted = Plot("plot-uncounted");
            if (uncounted > 0 && (npcId == "nyx" || npcId == "zero"))
                extra.Add(uncounted >= 2
                    ? "The Grid skipped four numbers after you left. I filed you as a guest who would not stay counted."
                    : "Walk the Blackout Stack. Then come back. I want the census to fail in public.");
            var curse = Plot("plot-curse");
            if (curse > 0 && npcId == "thorne")
                extra.Add(curse >= 2
                    ? "The hostility you fed in the grove followed you home as a rumor. I am still not the dragon."
                    : "If you meet the drake, do not finish it. That is the whole plot.");
            var road = Plot("plot-road");
            if (road > 0 && npcId == "lamplighter")
                extra.Add(road >= 2
                    ? "Frontier walkers still have no seat. Every road you walked is the argument. I am lighting it anyway."
                    : "They will not get a ninth door. They will get a road. Walk it so the Ring has to notice.");
            var eighth = Plot("plot-eighth");
            if (eighth > 0 && npcId == "lyra")
                extra.Add(eighth >= 2
                    ? "You have seen the Second Hour and the grove that wrote the Refusals. I still will not teach a ninth."
                    : "Iyatte says the Refusals were written in Tunya. I keep the door. Do not ask me to close it.");
            var traveler = TravelerWhere(npcId);
            if (!string.IsNullOrEmpty(traveler)) extra.Add(traveler);
            return extra.ToArray();
        }

        public static int Plot(string id)
        {
            var csv = WorldMemory.All().plotsCsv ?? "";
            foreach (var part in csv.Split(';'))
            {
                var kv = part.Split(':');
                if (kv.Length >= 2 && kv[0].Trim() == id && int.TryParse(kv[1], out var n)) return n;
            }
            return 0;
        }

        static void AdvancePlot(WorldId from, WorldId to)
        {
            TryPlot("plot-eighth", from, to, WorldId.Crucible, WorldId.Tunya, WorldId.Hub);
            TryPlot("plot-uncounted", from, to, WorldId.Cyber, WorldId.Hub);
            TryPlot("plot-curse", from, to, WorldId.Fantasy, WorldId.Hub);
            TryPlot("plot-road", from, to, WorldId.Frontier, WorldId.Hub);
            TryPlot("plot-bill", from, to, WorldId.Crime, WorldId.Hub);
        }

        static void TryPlot(string id, WorldId from, WorldId to, params WorldId[] worlds)
        {
            bool a = false, b = false;
            foreach (var w in worlds)
            {
                if (w == from) a = true;
                if (w == to) b = true;
            }
            if (!a || !b) return;
            var n = Mathf.Min(3, Plot(id) + 1);
            SetCsv(ref WorldMemory.All().plotsCsv, id, n.ToString());
            MarkCross(id);
        }

        static void NudgeTraveler(WorldId from, WorldId to)
        {
            var tag = TravelerTag(from) ?? TravelerTag(to);
            if (string.IsNullOrEmpty(tag)) return;
            SetCsv(ref WorldMemory.All().travelersCsv, tag, to + ":1");
        }

        static void AdvanceTravelers(float hours)
        {
            var all = WorldMemory.All();
            if (string.IsNullOrEmpty(all.travelersCsv)) return;
            var parts = new List<string>();
            foreach (var part in all.travelersCsv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(part)) continue;
                var kv = part.Split(':');
                if (kv.Length < 2) { parts.Add(part); continue; }
                int stage = 1;
                if (kv.Length >= 3) int.TryParse(kv[kv.Length - 1], out stage);
                if (hours >= 4f) stage = Mathf.Min(3, stage + 1);
                parts.Add(kv[0] + ":" + kv[1] + ":" + stage);
            }
            all.travelersCsv = string.Join(";", parts);
        }

        static string TravelerTag(WorldId id) => id switch
        {
            WorldId.Crime => "mama",
            WorldId.Cyber => "nyx",
            WorldId.Fantasy => "thorne",
            WorldId.Crucible => "lyra",
            WorldId.Frontier => "lamplighter",
            WorldId.Superhero => "elias",
            WorldId.Ruins => "seraphine",
            WorldId.Tunya => "vesper",
            _ => null
        };

        static string TravelerWhere(string npcId)
        {
            var csv = WorldMemory.All().travelersCsv ?? "";
            foreach (var part in csv.Split(';'))
            {
                var kv = part.Split(':');
                if (kv.Length < 2 || kv[0].Trim() != npcId) continue;
                var where = kv[1].Trim();
                return npcId + " is walking a door toward " + where + ". The scene change did not end the errand.";
            }
            return null;
        }

        static void MarkCross(string key)
        {
            var all = WorldMemory.All();
            var csv = all.crossCsv ?? "";
            if (csv.Contains(key)) return;
            all.crossCsv = string.IsNullOrEmpty(csv) ? key : csv + ";" + key;
        }

        static void SetCsv(ref string csv, string key, string value)
        {
            var map = new Dictionary<string, string>();
            if (!string.IsNullOrEmpty(csv))
                foreach (var part in csv.Split(';'))
                {
                    var kv = part.Split(new[] { ':' }, 2);
                    if (kv.Length == 2) map[kv[0].Trim()] = kv[1].Trim();
                }
            map[key] = value;
            var list = new List<string>();
            foreach (var kv in map) list.Add(kv.Key + ":" + kv.Value);
            csv = string.Join(";", list);
        }

        public const float RingTariff = 0.05f;

        public static string HudCaravan()
        {
            foreach (var c in ListCaravans())
            {
                if (c.status == "arrived" || c.status == "returned") continue;
                return "Caravan " + c.id + " · " + c.staple + " " + Canon.Get(c.from).title
                    + " → " + Canon.Get(c.to).title + " · " + c.status;
            }
            return "";
        }

        public static void TickCaravans(float hours)
        {
            if (hours < 0.001f) return;
            var all = WorldMemory.All();
            var list = ListCaravans();
            if (list.Count == 0) return;
            bool dirty = false;
            for (int i = 0; i < list.Count; i++)
            {
                var c = list[i];
                if (c.status == "arrived" || c.status == "returned" || c.status == "raided") continue;
                c.hoursLeft -= hours;
                if (c.status == "loading" && c.hoursLeft <= 1.75f)
                {
                    c.status = "traveling";
                    dirty = true;
                }
                if (c.status == "traveling" && c.hoursLeft <= 0.35f)
                {
                    c.status = "at_gate";
                    dirty = true;
                }
                if (c.status == "at_gate" && c.hoursLeft <= 0f)
                {
                    Arrive(c);
                    dirty = true;
                }
                list[i] = c;
            }
            if (dirty) WriteCaravans(list);
        }

        public static void PresentNearPlayer()
        {
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            foreach (var c in ListCaravans())
            {
                if (c.status != "traveling" && c.status != "at_gate") continue;
                if (c.from != WorldClock.World && c.to != WorldClock.World) continue;
                if (GameObject.Find("Caravan_" + c.id)) continue;
                WorldGate near = null;
                float best = 80f;
                foreach (var g in UnityEngine.Object.FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude))
                {
                    if (!g) continue;
                    var match = g.def.world == c.from || g.def.world == c.to || g.def.world == WorldId.Hub;
                    if (!match) continue;
                    var d = Vector3.Distance(player.transform.position, g.transform.position);
                    if (d < best) { best = d; near = g; }
                }
                if (!near || best > 70f)
                {
                    var line = HudCaravan();
                    if (!string.IsNullOrEmpty(line)) WorldClock.NoteAct(line);
                    continue;
                }
                var hold = near.transform;
                var pos = hold.position + hold.forward * 3.4f + hold.right * 1.6f;
                var cart = FreePacks.Spawn("cart", hold, pos, hold.eulerAngles.y, 2.2f)
                           ?? GameObject.CreatePrimitive(PrimitiveType.Cube);
                cart.name = "Caravan_" + c.id;
                cart.transform.SetParent(hold, true);
                cart.transform.position = pos;
                if (!cart.GetComponent<RingCaravan>())
                {
                    var tag = cart.AddComponent<RingCaravan>();
                    tag.id = c.id;
                    tag.staple = c.staple;
                    tag.status = c.status;
                }
                WorldClock.NoteAct("Caravan of " + c.staple + " " + c.status + " at " + near.def.name + ".");
            }
        }

        static void DispatchCaravan(WorldId from, WorldId to, WorldSliceRec fromSlice, float qty, string why)
        {
            if (qty <= 0.01f || from == to) return;
            fromSlice.stock = Mathf.Max(0.2f, fromSlice.stock - qty);
            fromSlice.prices = Mathf.Clamp(fromSlice.prices * (1f + qty * 0.1f), 0.6f, 1.8f);
            fromSlice.lastEvent = Canon.Get(from).title + " loaded a caravan of " + fromSlice.staple
                + " toward " + Canon.Get(to).title + ".";
            var c = new CaravanRec
            {
                id = "cv-" + from + "-" + to + "-" + WorldClock.Day + "-" + Mathf.FloorToInt(WorldClock.Hour),
                from = from,
                to = to,
                staple = fromSlice.staple,
                qty = qty,
                value = qty * 100f,
                status = "loading",
                guards = 2,
                hoursLeft = 2f,
                owner = OwnerOf(from)
            };
            var list = ListCaravans();
            list.Add(c);
            WriteCaravans(list);
            if (why == "away") WorldMemory.Put(from, fromSlice);
        }

        static void Arrive(CaravanRec c)
        {
            var dest = WorldMemory.Load(c.to);
            KingdomBook.Ensure(dest, c.to);
            dest.need = Mathf.Max(0.05f, dest.need - c.qty);
            dest.stock = Mathf.Clamp(dest.stock + c.qty * 0.6f, 0.2f, 2.2f);
            dest.prices = Mathf.Clamp(dest.prices * (1f - c.qty * 0.15f), 0.6f, 1.8f);
            dest.imports = c.staple + " from " + Canon.Get(c.from).title;
            float paid = c.value * RingTariff;
            dest.lastEvent = Canon.Get(c.to).title + " received " + dest.imports
                + ". Ring tariff " + paid.ToString("0.0") + " on cargo " + c.value.ToString("0.0") + ".";
            WorldMemory.Put(c.to, dest);
            if (c.to == WorldClock.World) WorldClock.LastEvent = dest.lastEvent;
            c.status = "arrived";
            c.hoursLeft = 0f;
            var all = WorldMemory.All();
            var row = c.id + "|" + c.from + "|" + c.to + "|" + c.value.ToString("0.00")
                + "|" + RingTariff.ToString("0.00") + "|" + paid.ToString("0.00")
                + "|" + WorldClock.Day + ":" + Mathf.FloorToInt(WorldClock.Hour);
            all.tariffsCsv = string.IsNullOrEmpty(all.tariffsCsv) ? row : all.tariffsCsv + ";" + row;
        }

        static string OwnerOf(WorldId id)
        {
            if (id == WorldId.Hub) return "Concordant Watch";
            var facs = WorldBook.Factions(id);
            if (facs != null && facs.Length > 0 && !string.IsNullOrEmpty(facs[0].name))
                return facs[0].name;
            return Canon.Get(id).title;
        }

        public static List<CaravanRec> ListCaravans()
        {
            var list = new List<CaravanRec>();
            var csv = WorldMemory.All().caravansCsv ?? "";
            if (string.IsNullOrEmpty(csv)) return list;
            foreach (var part in csv.Split(';'))
            {
                if (string.IsNullOrWhiteSpace(part)) continue;
                var f = part.Split('|');
                if (f.Length < 10) continue;
                if (!Enum.TryParse(f[1], out WorldId from)) continue;
                if (!Enum.TryParse(f[2], out WorldId to)) continue;
                float.TryParse(f[4], out var qty);
                float.TryParse(f[5], out var value);
                int.TryParse(f[7], out var guards);
                float.TryParse(f[8], out var hours);
                list.Add(new CaravanRec
                {
                    id = f[0],
                    from = from,
                    to = to,
                    staple = f[3],
                    qty = qty,
                    value = value,
                    status = f[6],
                    guards = guards,
                    hoursLeft = hours,
                    owner = f[9]
                });
            }
            return list;
        }

        static void WriteCaravans(List<CaravanRec> list)
        {
            var parts = new List<string>();
            foreach (var c in list)
                parts.Add(c.id + "|" + c.from + "|" + c.to + "|" + c.staple + "|"
                    + c.qty.ToString("0.000") + "|" + c.value.ToString("0.00") + "|"
                    + c.status + "|" + c.guards + "|" + c.hoursLeft.ToString("0.00") + "|" + c.owner);
            WorldMemory.All().caravansCsv = string.Join(";", parts);
        }

        public struct CaravanRec
        {
            public string id, staple, status, owner;
            public WorldId from, to;
            public float qty, value, hoursLeft;
            public int guards;
        }
    }

    /// <summary>Presentation tag. The caravan exists because CrossRing dispatched it.</summary>
    public class RingCaravan : MonoBehaviour
    {
        public string id, staple, status;
    }
}
