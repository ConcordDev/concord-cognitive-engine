using System;
using System.Collections.Generic;
using UnityEngine;

#if UNITY_EDITOR
using UnityEditor;
#endif

namespace Concordia
{
    /// <summary>
    /// Runtime bind surface for the NativeBible and volume catalogs.
    /// It exposes authored rows without creating parallel gameplay authorities.
    /// WorldBook, QuestLog, CreatureCompiler, NpcLife, vendors, companions, and
    /// density directors consume these rows by their existing stable ids.
    /// </summary>
    public static class ContentBindVolumeCatalog
    {
        [Serializable]
        public sealed class NativeEntry
        {
            public string id;
            public string display_name;
        }

        [Serializable]
        sealed class NativeRoot
        {
            public int count;
            public NativeEntry[] entries;
        }

        [Serializable]
        sealed class BossRoot
        {
            public BossEncounter[] encounters;
        }

        [Serializable]
        public sealed class BossEncounter
        {
            public string id;
            public string name;
            public string world_id;
            public string[] creature_ids;
            public Telegraph telegraph;
            public BossPhase[] phases;
            public string remembrance_item_id;
            public Schedule schedule;
            public string spawn_anchor;
        }

        [Serializable]
        public sealed class Telegraph
        {
            public string board;
            public string scout;
            public string sound;
        }

        [Serializable]
        public sealed class BossPhase
        {
            public int index;
            public string name;
            public string tell;
            public string player_response;
        }

        [Serializable]
        public sealed class Schedule
        {
            public string kind;
            public int open_hour;
            public int close_hour;
            public int every_nth_day;
            public string cron;
            public string label;
        }

        [Serializable]
        sealed class CompanionRoot
        {
            public Companion[] companions;
        }

        [Serializable]
        public sealed class Companion
        {
            public string id;
            public string name;
            public string npc_id;
            public string role_id;
            public string world_home;
            public string assist_verb;
            public string assist_note;
            public BanterFlags banter_flags;
        }

        [Serializable]
        public sealed class BanterFlags
        {
            public BanterLine intro;
            public BanterLine mid;
            public BanterLine postboss;
        }

        [Serializable]
        public sealed class BanterLine
        {
            public string flag;
            public string line;
        }

        [Serializable]
        sealed class VendorRoot
        {
            public int item_count;
            public int vendor_count;
            public Item[] items;
            public Vendor[] vendors;
        }

        [Serializable]
        public sealed class Item
        {
            public string id;
            public string display_name;
            public string kind;
            public string[] world_ids;
            public string extends;
            public string notes;
            public int stack;
            public bool remembrance;
        }

        [Serializable]
        public sealed class Vendor
        {
            public string id;
            public string name;
            public string world_id;
            public string npc_id;
            public string role_id;
            public string stall_prop;
            public string[] stock;
            public StandingTier[] standing_tiers;
            public string law;
        }

        [Serializable]
        public sealed class StandingTier
        {
            public string standing;
            public float price_multiplier;
            public string[] stock_extra;
            public string stock_note;
        }

        [Serializable]
        sealed class DensityRoot
        {
            public DensityWorld[] worlds;
        }

        [Serializable]
        public sealed class DensityWorld
        {
            public string world_id;
            public string law;
            public DensityFauna[] fauna;
            public DensityCrowd[] npc_crowds;
            public string[] unique_npcs_do_not_clone;
        }

        [Serializable]
        public sealed class DensityFauna
        {
            public string id;
            public int weight;
            public string note;
        }

        [Serializable]
        public sealed class DensityCrowd
        {
            public string role_id;
            public int budget;
            public string where;
        }

        [Serializable]
        sealed class MountRoot
        {
            public Mount[] mounts;
            public Vehicle[] vehicles;
        }

        [Serializable]
        public sealed class Mount
        {
            public string id;
            public string creature_id;
            public string[] world_ids;
            public string tack_item_id;
            public string verb;
            public string anim_gap;
            public string call_anchor;
            public string notes;
        }

        [Serializable]
        public sealed class Vehicle
        {
            public string id;
            public string display_name;
            public string[] world_ids;
            public string prop_id;
            public string hitch_mount_id;
            public string part_item_id;
            public string verb;
            public string anim_gap;
            public string gameplay_core;
            public string notes;
        }

        static readonly Dictionary<string, NativeEntry[]> Native = new Dictionary<string, NativeEntry[]>(StringComparer.OrdinalIgnoreCase);
        static bool _loaded;
        static string _source = "Resources/Concordia/ContentBind";

        public static bool Loaded => _loaded;
        public static string Source => _source;
        public static BossEncounter[] Bosses { get; private set; } = Array.Empty<BossEncounter>();
        public static Companion[] Companions { get; private set; } = Array.Empty<Companion>();
        public static Item[] Items { get; private set; } = Array.Empty<Item>();
        public static Vendor[] Vendors { get; private set; } = Array.Empty<Vendor>();
        public static DensityWorld[] Density { get; private set; } = Array.Empty<DensityWorld>();
        public static Mount[] Mounts { get; private set; } = Array.Empty<Mount>();
        public static Vehicle[] Vehicles { get; private set; } = Array.Empty<Vehicle>();

        public static int BossCount => Bosses.Length;
        public static int CompanionCount => Companions.Length;
        public static int ItemCount => Items.Length;
        public static int VendorCount => Vendors.Length;
        public static int DensityCount => Density.Length;
        public static int MountCount => Mounts.Length;
        public static int VehicleCount => Vehicles.Length;
        public static int NativeCount(string family) => Native.TryGetValue(family ?? string.Empty, out var rows) ? rows.Length : 0;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void RuntimePreload()
        {
            Preload();
        }

        public static void Preload()
        {
            if (_loaded) return;
            _loaded = true;

            LoadNative("animals", "Concordia/ContentBind/NativeBible/creatures/ANIMALS");
            LoadNative("monsters", "Concordia/ContentBind/NativeBible/creatures/MONSTERS");
            LoadNative("hybrids", "Concordia/ContentBind/NativeBible/creatures/HYBRIDS");
            LoadNative("npc_roles", "Concordia/ContentBind/NativeBible/npcs/ROLES");
            LoadNative("weapons", "Concordia/ContentBind/NativeBible/weapons/WEAPONS");
            LoadNative("kits", "Concordia/ContentBind/NativeBible/architecture/KITS");
            LoadNative("props", "Concordia/ContentBind/NativeBible/props/PROPS");
            LoadNative("skills", "Concordia/ContentBind/NativeBible/skills/SKILLS");
            LoadNative("prompts", "Concordia/ContentBind/NativeBible/aura/PROMPTS_INDEX");

            Bosses = LoadArray<BossRoot, BossEncounter>("BOSSES_AND_RAIDS", root => root?.encounters) ?? Array.Empty<BossEncounter>();
            Companions = LoadArray<CompanionRoot, Companion>("COMPANIONS", root => root?.companions) ?? Array.Empty<Companion>();
            var vendorRoot = LoadRoot<VendorRoot>("VENDORS_AND_ITEMS");
            Items = vendorRoot?.items ?? Array.Empty<Item>();
            Vendors = vendorRoot?.vendors ?? Array.Empty<Vendor>();
            Density = LoadArray<DensityRoot, DensityWorld>("DENSITY_TABLES", root => root?.worlds) ?? Array.Empty<DensityWorld>();
            var mountRoot = LoadRoot<MountRoot>("MOUNT_AND_VEHICLE");
            Mounts = mountRoot?.mounts ?? Array.Empty<Mount>();
            Vehicles = mountRoot?.vehicles ?? Array.Empty<Vehicle>();

            Debug.Log("[Concordia] ContentBindVolumeCatalog: " + Summary());
        }

        public static NativeEntry[] NativeEntries(string family)
        {
            Preload();
            return Native.TryGetValue(family ?? string.Empty, out var rows) ? rows : Array.Empty<NativeEntry>();
        }

        public static BossEncounter FindBoss(string id)
        {
            Preload();
            foreach (var row in Bosses)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static Companion FindCompanion(string id)
        {
            Preload();
            foreach (var row in Companions)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static Item FindItem(string id)
        {
            Preload();
            foreach (var row in Items)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static Vendor FindVendor(string id)
        {
            Preload();
            foreach (var row in Vendors)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static DensityWorld FindDensity(WorldId world)
        {
            Preload();
            var key = world.ToString();
            foreach (var row in Density)
                if (row != null && string.Equals(row.world_id, key, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static Mount FindMount(string id)
        {
            Preload();
            foreach (var row in Mounts)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static Vehicle FindVehicle(string id)
        {
            Preload();
            foreach (var row in Vehicles)
                if (row != null && string.Equals(row.id, id, StringComparison.OrdinalIgnoreCase)) return row;
            return null;
        }

        public static string Summary()
        {
            Preload();
            return "native=" + NativeCount("animals") + "/" + NativeCount("monsters") + "/" + NativeCount("hybrids")
                + " roles=" + NativeCount("npc_roles")
                + " weapons=" + NativeCount("weapons")
                + " kits=" + NativeCount("kits")
                + " props=" + NativeCount("props")
                + " skills=" + NativeCount("skills")
                + " prompts=" + NativeCount("prompts")
                + " volume bosses=" + BossCount
                + " companions=" + CompanionCount
                + " items=" + ItemCount
                + " vendors=" + VendorCount
                + " density=" + DensityCount
                + " mounts=" + MountCount
                + " vehicles=" + VehicleCount;
        }

        static void LoadNative(string family, string resourcePath)
        {
            var root = LoadRoot<NativeRoot>(resourcePath);
            Native[family] = root?.entries ?? Array.Empty<NativeEntry>();
        }

        static TElement[] LoadArray<TIn, TElement>(string resourceName, Func<TIn, TElement[]> selector) where TIn : class
        {
            var root = LoadRoot<TIn>("Concordia/ContentBind/" + resourceName);
            return root == null ? null : selector(root);
        }

        static T LoadRoot<T>(string resourcePath) where T : class
        {
            var resource = Resources.Load<TextAsset>(resourcePath);
            var raw = resource ? resource.text : LoadEditorFallback(resourcePath);
            if (string.IsNullOrEmpty(raw))
            {
                Debug.LogWarning("[Concordia] ContentBindVolumeCatalog missing " + resourcePath);
                return null;
            }

            try
            {
                return JsonUtility.FromJson<T>(raw);
            }
            catch (Exception e)
            {
                Debug.LogWarning("[Concordia] ContentBindVolumeCatalog failed " + resourcePath + ": " + e.Message);
                return null;
            }
        }

        static string LoadEditorFallback(string resourcePath)
        {
#if UNITY_EDITOR
            var path = "Assets/Concordia/Generated/NativeBible/" + resourcePath.Substring("Concordia/ContentBind/NativeBible/".Length);
            if (resourcePath.StartsWith("Concordia/ContentBind/NativeBible/", StringComparison.Ordinal))
            {
                var asset = AssetDatabase.LoadAssetAtPath<TextAsset>(path);
                return asset ? asset.text : null;
            }
#endif
            return null;
        }
    }
}
