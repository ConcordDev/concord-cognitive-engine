using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Concordia
{
    [Serializable]
    public class CityDef
    {
        public string id, name, factionId, description;
        public WorldId world;
        public float x, z;
        public string[] districts;
    }

    /// <summary>
    /// Every playable city is derived from authored countries + faction districts.
    /// Missing files stay empty — never invents a place.
    /// </summary>
    public static class CityAtlas
    {
        static readonly Dictionary<WorldId, CityDef[]> Cache = new Dictionary<WorldId, CityDef[]>();

        public static CityDef[] For(WorldId world)
        {
            if (Cache.TryGetValue(world, out var hit)) return hit;
            if (world == WorldId.Hub)
            {
                Cache[world] = Array.Empty<CityDef>();
                return Cache[world];
            }
            var list = new List<CityDef>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var c in WorldBook.Countries(world))
            {
                if (c == null || string.IsNullOrEmpty(c.name)) continue;
                var id = string.IsNullOrEmpty(c.country_id) ? c.name : c.country_id;
                if (!seen.Add(id) || !seen.Add(c.name)) continue;
                var cap = c.capital != null && !string.IsNullOrEmpty(c.capital.name) ? c.capital.name : c.name;
                float x = c.capital != null ? c.capital.x : 0f;
                float z = c.capital != null ? c.capital.z : 0f;
                list.Add(new CityDef
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
                if (!seen.Add(f.id ?? f.name) || !seen.Add(f.name)) continue;
                list.Add(new CityDef
                {
                    id = string.IsNullOrEmpty(f.id) ? districts[0] : f.id,
                    name = f.name,
                    factionId = f.id,
                    description = Trim(f.motto, f.goal),
                    world = world,
                    districts = districts
                });
            }

            PlaceOnRing(list, world);
            var arr = list.ToArray();
            Cache[world] = arr;
            return arr;
        }

        public static CityDef Nearest(WorldId world, Vector3 pos, float max = 14f)
        {
            CityDef best = null;
            float bestD = max;
            foreach (var c in For(world))
            {
                var d = Vector3.Distance(new Vector3(c.x, 0f, c.z), new Vector3(pos.x, 0f, pos.z));
                if (d < bestD) { bestD = d; best = c; }
            }
            return best;
        }

        public static CityDef ForPerson(WorldId world, WorldBook.Person p)
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
            var sb = new StringBuilder();
            foreach (WorldId id in Enum.GetValues(typeof(WorldId)))
            {
                var cities = For(id);
                sb.AppendLine(id + " " + Canon.Get(id).title + " cities=" + cities.Length);
                foreach (var c in cities)
                    sb.AppendLine("  " + c.name + " @ " + c.x.ToString("0.0") + "," + c.z.ToString("0.0") + " fac=" + c.factionId);
            }
            return sb.ToString();
        }

        static void PlaceOnRing(List<CityDef> list, WorldId world)
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

        static string Trim(string motto, string goal)
        {
            var s = string.IsNullOrEmpty(motto) ? (goal ?? "") : motto;
            if (!string.IsNullOrEmpty(goal) && !string.IsNullOrEmpty(motto))
                s = motto + "\n\n" + goal;
            if (s.Length > 700) s = s.Substring(0, 697) + "…";
            return s;
        }
    }
}
