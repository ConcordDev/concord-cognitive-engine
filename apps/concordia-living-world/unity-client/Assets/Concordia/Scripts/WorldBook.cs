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
            public Objective[] objectives;
        }
        [Serializable] public class Objective
        {
            public string id, type, target, description;
        }
        [Serializable] public class CountriesDoc { public Country[] countries; }
        [Serializable] public class Country
        {
            public string country_id, faction_id, name, description, theme;
            public Capital capital;
        }
        [Serializable] public class Capital { public string name; public float x, z; }

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
}
