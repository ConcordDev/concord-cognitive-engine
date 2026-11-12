using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEngine;

namespace Concordia.Editor
{
    /// <summary>
    /// Aura: lists the MonoBehaviour types that actually exist at runtime, with the script that
    /// owns each one — the evidence behind <c>.Aura/LIVE_PATH.md</c> (roadmap B-08).
    /// </summary>
    public static class ComponentDump
    {
        /// <summary>One line per live MonoBehaviour type, most common first.</summary>
        public static string Dump()
        {
            var found = Object.FindObjectsByType<MonoBehaviour>(FindObjectsInactive.Include, FindObjectsSortMode.None);

            var counts = new Dictionary<string, int>();
            var owners = new Dictionary<string, string>();
            foreach (var mb in found)
            {
                if (mb == null) continue;
                var t = mb.GetType();
                string name = t.Name;
                counts.TryGetValue(name, out int n);
                counts[name] = n + 1;
                if (!owners.ContainsKey(name)) owners[name] = t.Assembly.GetName().Name + "/" + name + ".cs";
            }

            var sb = new StringBuilder();
            sb.Append("live MonoBehaviours=").Append(found.Length)
              .Append(" types=").Append(counts.Count).Append('\n');
            foreach (var kv in counts.OrderByDescending(k => k.Value).ThenBy(k => k.Key))
                sb.Append(kv.Key).Append('(').Append(kv.Value).Append(") ")
                  .Append(owners[kv.Key]).Append('\n');
            return sb.ToString();
        }

        /// <summary>Boot phases ConcordiaGame logged this session, in order.</summary>
        public static string BootPhases()
        {
            // The builder writes progress into Generated/runtime-stage.txt; read it from disk-safe API.
            var path = System.IO.Path.Combine(Application.dataPath, "Concordia/Generated/runtime-stage.txt");
            try
            {
                return System.IO.File.Exists(path) ? System.IO.File.ReadAllText(path).Trim() : "no runtime-stage.txt";
            }
            catch (System.Exception e) { return "stage read failed: " + e.Message; }
        }
    }
}
