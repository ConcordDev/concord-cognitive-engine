using System;
using System.Collections.Generic;
using UnityEngine;

#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Runtime bridge for the authored NativeBible volume pack.
    /// The generated JSON remains the source of truth; this class only normalizes its
    /// volume schema into the existing WorldBook/QuestLog contract.
    /// </summary>
    public static class ContentBindCatalog
    {
        [Serializable]
        sealed class VolumeRoot
        {
            public WorldBuckets quests_by_world;
        }

        [Serializable]
        sealed class WorldBuckets
        {
            public VolumeQuest[] Hub;
            public VolumeQuest[] Fantasy;
            public VolumeQuest[] Tunya;
            public VolumeQuest[] Crime;
            public VolumeQuest[] Cyber;
            public VolumeQuest[] Ruins;
            public VolumeQuest[] Frontier;
            public VolumeQuest[] Superhero;
            public VolumeQuest[] Crucible;
            public VolumeQuest[] Sere;
        }

        [Serializable]
        sealed class VolumeQuest
        {
            public string id;
            public string title;
            public string world_id;
            public string giver_npc_id;
            public VolumeObjective[] objectives;
            public string[] prerequisites;
            public VolumeTurnIn turn_in;
            public string loop;
        }

        [Serializable]
        sealed class VolumeObjective
        {
            public string id;
            public string verb;
            public string target;
            public int count;
            public string text;
        }

        [Serializable]
        sealed class VolumeTurnIn
        {
            public string npc_id;
            public bool requires_all_objectives;
        }

        static readonly Dictionary<WorldId, WorldBook.Quest[]> Cache = new Dictionary<WorldId, WorldBook.Quest[]>();
        static bool _loaded;
        static string _source;
        public static int QuestCount { get; private set; }
        public static bool Loaded => _loaded;
        public static string Source => _source ?? "(not loaded)";

        public static void Preload()
        {
            EnsureLoaded();
        }

        public static WorldBook.Quest[] Quests(WorldId world)
        {
            EnsureLoaded();
            return Cache.TryGetValue(world, out var rows) ? rows : Array.Empty<WorldBook.Quest>();
        }

        public static string Summary()
        {
            EnsureLoaded();
            return "volume quests=" + QuestCount + " source=" + Source;
        }

        static void EnsureLoaded()
        {
            if (_loaded) return;
            _loaded = true;

            var raw = LoadText();
            if (string.IsNullOrEmpty(raw))
            {
                Debug.LogWarning("[Concordia] ContentBindCatalog: QUESTS_BY_WORLD.json not found; volume quests remain unavailable.");
                return;
            }

            try
            {
                var root = JsonUtility.FromJson<VolumeRoot>(raw);
                if (root == null || root.quests_by_world == null)
                {
                    Debug.LogWarning("[Concordia] ContentBindCatalog: volume quest document had no quests_by_world object.");
                    return;
                }

                Add(WorldId.Hub, root.quests_by_world.Hub);
                Add(WorldId.Fantasy, root.quests_by_world.Fantasy);
                Add(WorldId.Tunya, root.quests_by_world.Tunya);
                Add(WorldId.Crime, root.quests_by_world.Crime);
                Add(WorldId.Cyber, root.quests_by_world.Cyber);
                Add(WorldId.Ruins, root.quests_by_world.Ruins);
                Add(WorldId.Frontier, root.quests_by_world.Frontier);
                Add(WorldId.Superhero, root.quests_by_world.Superhero);
                Add(WorldId.Crucible, root.quests_by_world.Crucible);
                Add(WorldId.Sere, root.quests_by_world.Sere);

                Debug.Log("[Concordia] ContentBindCatalog: " + Summary());
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Concordia] ContentBindCatalog failed: " + e.Message);
            }
        }

        static void Add(WorldId world, VolumeQuest[] rows)
        {
            var list = new List<WorldBook.Quest>();
            if (rows != null)
            {
                foreach (var row in rows)
                {
                    if (row == null || string.IsNullOrEmpty(row.id)) continue;
                    var objectives = new List<WorldBook.Objective>();
                    if (row.objectives != null)
                    {
                        foreach (var o in row.objectives)
                        {
                            if (o == null) continue;
                            objectives.Add(new WorldBook.Objective
                            {
                                id = o.id,
                                type = MapVerb(o.verb),
                                target = o.target,
                                description = o.text,
                                required_count = Mathf.Max(1, o.count)
                            });
                        }
                    }

                    list.Add(new WorldBook.Quest
                    {
                        id = row.id,
                        title = row.title,
                        description = row.loop,
                        giver_npc_id = row.giver_npc_id,
                        prerequisites = row.prerequisites ?? Array.Empty<string>(),
                        objectives = objectives.ToArray()
                    });
                }
            }

            Cache[world] = list.ToArray();
            QuestCount += list.Count;
        }

        static string MapVerb(string verb)
        {
            switch ((verb ?? "").Trim().ToLowerInvariant())
            {
                case "reach":
                case "reach_location": return "reach_location";
                case "talk":
                case "talk_to": return "talk_to";
                case "interact": return "interact";
                case "defeat": return "defeat";
                case "gather": return "gather";
                case "deliver": return "deliver";
                default: return verb ?? "";
            }
        }

        static string LoadText()
        {
            var resource = Resources.Load<TextAsset>("Concordia/ContentBind/QUESTS_BY_WORLD");
            if (resource)
            {
                _source = "Resources/Concordia/ContentBind/QUESTS_BY_WORLD.json";
                return resource.text;
            }

#if UNITY_EDITOR
            const string path = "Assets/Concordia/Generated/NativeBible/volume/QUESTS_BY_WORLD.json";
            var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
            if (asset)
            {
                _source = path;
                return asset.text;
            }
#endif
            return null;
        }
    }
}
