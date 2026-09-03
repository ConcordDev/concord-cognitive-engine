using System;
using System.Collections.Generic;
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
}
