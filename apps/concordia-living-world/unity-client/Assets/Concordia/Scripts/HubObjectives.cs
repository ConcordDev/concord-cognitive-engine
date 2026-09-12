using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// P0 Hub + Ruins tracker. Completes only when the walk actually happened.
    /// </summary>
    public static class HubObjectives
    {
        public static bool Lamp;
        public static bool ArenaHit;
        public static bool Ruins;
        public static bool ReturnHub;
        public static int RingGates;
        static readonly HashSet<WorldId> Seen = new HashSet<WorldId>();

        public static void Reset()
        {
            Lamp = ArenaHit = Ruins = ReturnHub = false;
            RingGates = 0;
            Seen.Clear();
            QuestLog.Reset();
            SkillLedger.Reset();
            SkillLattice.Reset();
            KitBag.Reset();
            Bonds.Reset();
            Plots.Reset();
        }

        public static void NoteLamp() => Lamp = true;
        public static void NoteArenaHit() => ArenaHit = true;

        public static void NoteGateWalked(WorldId world)
        {
            if (world == WorldId.Hub) return;
            if (Seen.Add(world)) RingGates = Seen.Count;
        }

        public static void NoteTravel(WorldId from, WorldId to)
        {
            if (to == WorldId.Ruins) Ruins = true;
            if (from == WorldId.Ruins && to == WorldId.Hub) ReturnHub = true;
            if (to != WorldId.Hub) NoteGateWalked(to);
            QuestLog.NoteLocation(WorldBook.Folder(to), Canon.Get(to).title);
        }

        public static string Line()
        {
            string C(bool b) => b ? "done" : "open";
            int ring = Mathf.Min(RingGates, 3);
            return "Lamp " + C(Lamp)
                   + "  ·  Ring " + ring + "/3"
                   + "  ·  Arena " + C(ArenaHit)
                   + "  ·  Ruins " + C(Ruins)
                   + "  ·  Return " + C(ReturnHub);
        }
    }

    /// <summary>
    /// Accept / track / complete against authored WorldBook quests.
    /// Only advances objective types this client can actually do.
    /// Types we cannot run stay open with an honest reason — never auto-complete.
    /// </summary>
    public static class QuestLog
    {
        public const int MaxActive = 3;
        public static readonly List<ActiveQuest> Active = new List<ActiveQuest>();
        public static readonly HashSet<string> Done = new HashSet<string>();
        static readonly HashSet<string> Talked = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<string> Places = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<string> Kills = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        static readonly HashSet<string> Held = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public static void Reset()
        {
            Active.Clear();
            Done.Clear();
            Talked.Clear();
            Places.Clear();
            Kills.Clear();
            Held.Clear();
        }

        public static string Offer(WorldBook.Quest q, WorldId world)
        {
            if (q == null || string.IsNullOrEmpty(q.id)) return null;
            if (Done.Contains(q.id)) return q.title + " — already complete.";
            var live = Find(q.id);
            if (live != null) return ProgressLine(live);
            if (!PrereqsMet(q))
                return q.title + " — locked. Finish " + string.Join(", ", q.prerequisites ?? Array.Empty<string>()) + " first.";
            if (Active.Count >= MaxActive)
                return "Three quests in hand. Complete one before taking another.";
            var a = new ActiveQuest { quest = q, world = world };
            a.SyncFromWorld();
            Active.Add(a);
            if (a.AllDoableDone() && a.NoBlocked())
            {
                Complete(a);
                return "Accepted and finished: " + q.title;
            }
            return "Accepted: " + q.title + ". " + a.NextHint();
        }

        public static void NoteTalk(string id, string name)
        {
            Stamp(Talked, id);
            Stamp(Talked, name);
            Refresh();
        }

        public static void NoteLocation(params string[] tokens)
        {
            if (tokens == null) return;
            foreach (var t in tokens) Stamp(Places, t);
            Refresh();
        }

        public static void NoteDefeat(string name)
        {
            Stamp(Kills, name);
            Stamp(Kills, "any");
            Refresh();
        }

        public static void NoteGather(string id)
        {
            Stamp(Held, id);
            Refresh();
        }

        public static bool HoldingAny() => Held.Count > 0;

        public static bool Holding(string id)
        {
            if (string.IsNullOrEmpty(id)) return Held.Count > 0;
            return Held.Contains(id);
        }

        public static void TickBeacons(Vector3 pos)
        {
            foreach (var b in UnityEngine.Object.FindObjectsByType<QuestBeacon>(FindObjectsInactive.Exclude))
            {
                if (!b || b.tokens == null) continue;
                if (Vector3.Distance(pos, b.transform.position) > b.radius) continue;
                NoteLocation(b.tokens);
            }
        }

        public static string HudBlock()
        {
            if (Active.Count == 0)
                return Done.Count == 0 ? "No quest in hand. E a quest board or a giver." : "Quests done: " + Done.Count;
            var a = Active[0];
            var line = a.quest.title + "  —  " + a.ShortProgress();
            if (WorldClock.Ecology < 0.4f) line += "  ·  ecology thin";
            return line;
        }

        public static ActiveQuest Find(string id)
        {
            foreach (var a in Active)
                if (a.quest != null && a.quest.id == id) return a;
            return null;
        }

        static void Complete(ActiveQuest a)
        {
            if (a?.quest == null) return;
            Done.Add(a.quest.id);
            Active.Remove(a);
        }

        static void Refresh()
        {
            for (int i = Active.Count - 1; i >= 0; i--)
            {
                var a = Active[i];
                a.SyncFromWorld();
                if (a.AllDoableDone() && a.NoBlocked())
                    Complete(a);
            }
        }

        static bool PrereqsMet(WorldBook.Quest q)
        {
            if (q.prerequisites == null || q.prerequisites.Length == 0) return true;
            foreach (var p in q.prerequisites)
                if (!string.IsNullOrEmpty(p) && !Done.Contains(p)) return false;
            return true;
        }

        static void Stamp(HashSet<string> set, string raw)
        {
            var k = Norm(raw);
            if (k.Length == 0) return;
            set.Add(k);
            set.Add(k.Replace(" ", "_"));
            set.Add(k.Replace("_", " "));
            set.Add(k.Replace("-", "_"));
            set.Add(k.Replace("_", "-"));
        }

        public static string Norm(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            return raw.Trim().ToLowerInvariant();
        }

        public static bool Hit(HashSet<string> set, string target)
        {
            var k = Norm(target);
            if (k.Length == 0) return false;
            if (set.Contains(k) || set.Contains(k.Replace(" ", "_")) || set.Contains(k.Replace("_", " ")))
                return true;
            foreach (var s in set)
            {
                if (s.Length < 3) continue;
                if (k.Contains(s) || s.Contains(k)) return true;
            }
            return false;
        }

        public static bool CanDo(string type)
        {
            switch (Norm(type))
            {
                case "talk_to":
                case "interact":
                case "reach_location":
                case "defeat":
                case "gather":
                case "deliver":
                    return true;
                default:
                    return false;
            }
        }

        public static string BlockReason(string type)
        {
            var t = Norm(type);
            if (CanDo(t)) return "";
            return "Unity cannot complete '" + t + "' yet — kernel / other surface.";
        }

        static string ProgressLine(ActiveQuest a) => a.quest.title + " — " + a.ShortProgress();

        public class ActiveQuest
        {
            public WorldBook.Quest quest;
            public WorldId world;
            public bool[] done;

            public void SyncFromWorld()
            {
                var objs = quest?.objectives;
                if (objs == null) { done = Array.Empty<bool>(); return; }
                if (done == null || done.Length != objs.Length) done = new bool[objs.Length];
                for (int i = 0; i < objs.Length; i++)
                    done[i] = Satisfied(objs[i]);
            }

            static bool Satisfied(WorldBook.Objective o)
            {
                if (o == null) return true;
                var t = Norm(o.type);
                var target = o.target ?? "";
                switch (t)
                {
                    case "talk_to":
                    case "interact":
                        return Hit(Talked, target);
                    case "reach_location":
                        return Hit(Places, target);
                    case "defeat":
                        return Hit(Kills, target) || Hit(Kills, "any");
                    case "gather":
                        return Hit(Held, target) || Hit(Held, "chest");
                    case "deliver":
                        return Hit(Held, target) && Hit(Talked, target);
                    default:
                        return false;
                }
            }

            public bool AllDoableDone()
            {
                var objs = quest?.objectives;
                if (objs == null || objs.Length == 0) return true;
                for (int i = 0; i < objs.Length; i++)
                {
                    if (!CanDo(objs[i]?.type)) continue;
                    if (i >= done.Length || !done[i]) return false;
                }
                return true;
            }

            public bool NoBlocked()
            {
                var objs = quest?.objectives;
                if (objs == null) return true;
                foreach (var o in objs)
                    if (!CanDo(o?.type)) return false;
                return true;
            }

            public string NextHint()
            {
                var objs = quest?.objectives;
                if (objs == null) return "";
                for (int i = 0; i < objs.Length; i++)
                {
                    var o = objs[i];
                    if (o == null) continue;
                    if (i < done.Length && done[i]) continue;
                    var block = BlockReason(o.type);
                    if (!string.IsNullOrEmpty(block)) return block;
                    return o.description ?? o.type;
                }
                return "Return to the board.";
            }

            public string ShortProgress()
            {
                var objs = quest?.objectives;
                if (objs == null || objs.Length == 0) return "no steps";
                int have = 0, need = 0, blocked = 0;
                for (int i = 0; i < objs.Length; i++)
                {
                    if (!CanDo(objs[i]?.type)) { blocked++; continue; }
                    need++;
                    if (i < done.Length && done[i]) have++;
                }
                var s = have + "/" + need;
                if (blocked > 0) s += "  ·  " + blocked + " step(s) not in Unity";
                if (need > 0 && have < need) s += "  ·  " + NextHint();
                return s;
            }
        }
    }

    /// <summary>
    /// Use-tracking for the arts this client actually fires. Kingdom Come principle, local only.
    /// </summary>
    public static class SkillLedger
    {
        static readonly Dictionary<string, int> Tries = new Dictionary<string, int>();
        static readonly Dictionary<string, int> Hits = new Dictionary<string, int>();
        public static string LastArt;

        public static void Reset()
        {
            Tries.Clear();
            Hits.Clear();
            LastArt = null;
        }

        public static void Record(string art, bool connected)
        {
            if (string.IsNullOrEmpty(art)) return;
            LastArt = art;
            Tries[art] = Count(Tries, art) + 1;
            if (connected) Hits[art] = Count(Hits, art) + 1;
        }

        public static string Line()
        {
            if (string.IsNullOrEmpty(LastArt)) return "No art used yet.";
            return LastArt + "  " + Count(Hits, LastArt) + "/" + Count(Tries, LastArt) + " connected";
        }

        static int Count(Dictionary<string, int> d, string k) => d.TryGetValue(k, out var n) ? n : 0;
    }

    /// <summary>
    /// T3.1 kernel skill overlay. Bound from skills.mastery over /unity-ws.
    /// Untrained catalog rows stay level 0. Empty until Concord answers —
    /// kit arts are not this lattice.
    /// </summary>
    public static class SkillLattice
    {
        public class Row
        {
            public string skillType, group, tier, element, preset;
            public int level, cameraKickPx;
            public float potency, glow;
            public bool finisher;
        }

        public static readonly List<Row> All = new List<Row>();
        public static readonly List<string> Groups = new List<string>();
        public static bool FromKernel;
        public static string Group = "combat";
        public static string ActiveSkill = "swords";
        public static int CatalogCount;
        public static int TrainedCount;

        public static void Reset()
        {
            All.Clear();
            Groups.Clear();
            FromKernel = false;
            Group = "combat";
            ActiveSkill = "swords";
            CatalogCount = 0;
            TrainedCount = 0;
        }

        public static void Bind(int catalogCount, int trainedCount)
        {
            CatalogCount = catalogCount;
            TrainedCount = trainedCount;
            FromKernel = catalogCount > 0;
            if (string.IsNullOrEmpty(Group)) Group = "combat";
            if (Find(ActiveSkill) == null) ActiveSkill = CombatSlot(0);
            WorldBuilder.PresentSkillPylons();
        }

        public static string FirstInGroup(string group)
        {
            if (string.IsNullOrEmpty(group)) return ActiveSkill;
            for (int i = 0; i < All.Count; i++)
                if (All[i].group == group) return All[i].skillType;
            return group == "combat" ? "swords" : "";
        }

        public static string VfxPath(string skillType)
        {
            var row = Find(skillType);
            var e = row != null ? (row.element ?? "") : "";
            if (string.IsNullOrEmpty(e)) e = skillType ?? "";
            e = e.ToLowerInvariant();
            const string root = "Assets/GabrielAguiarProductions/FreeQuickEffectsVol1/Prefabs/";
            if (e.Contains("fire") || e.Contains("ember") || e.Contains("flame"))
                return root + "vfx_Flamethrower_01.prefab";
            if (e.Contains("lightning") || e.Contains("electric") || e.Contains("shock"))
                return root + "vfx_Lightning_01.prefab";
            if (e.Contains("ice") || e.Contains("water") || e.Contains("frost"))
                return root + "vfx_Shockwave_01.prefab";
            if (e.Contains("poison") || e.Contains("bio") || e.Contains("miasma"))
                return root + "vfx_Smoke_01.prefab";
            if (e.Contains("energy") || e.Contains("heal") || e.Contains("plasma"))
                return root + "vfx_Heal_02.prefab";
            return root + "vfx_Impact_01.prefab";
        }

        public static void Add(Row row)
        {
            if (row == null || string.IsNullOrEmpty(row.skillType)) return;
            All.Add(row);
            if (!string.IsNullOrEmpty(row.group) && !Groups.Contains(row.group))
                Groups.Add(row.group);
        }

        public static Row Find(string skillType)
        {
            if (string.IsNullOrEmpty(skillType)) return null;
            for (int i = 0; i < All.Count; i++)
                if (All[i].skillType == skillType) return All[i];
            return null;
        }

        public static string CombatSlot(int art)
        {
            int n = 0;
            for (int i = 0; i < All.Count; i++)
            {
                if (All[i].group != "combat") continue;
                if (n == art) return All[i].skillType;
                n++;
            }
            if (art == 1) return "fists";
            if (art == 2) return "archery";
            return "swords";
        }

        public static void SelectSlot(int art)
        {
            KitBag.Art = art;
            ActiveSkill = CombatSlot(art);
        }

        public static void CycleGroup(int delta)
        {
            if (Groups.Count == 0) return;
            int i = Groups.IndexOf(Group);
            if (i < 0) i = 0;
            i = (i + delta + Groups.Count * 8) % Groups.Count;
            Group = Groups[i];
        }

        public static string HudLine()
        {
            if (!FromKernel) return "skills.mastery unbound";
            var row = Find(ActiveSkill);
            if (row == null) return CatalogCount + " skills · kernel";
            return row.skillType + "  L" + row.level + "  " + row.tier
                + (row.finisher ? "  finisher" : "");
        }

        public static float KickMul(string skillType)
        {
            var row = Find(skillType);
            if (row == null) return 1f;
            return Mathf.Clamp(0.7f + row.glow * 0.8f + row.cameraKickPx * 0.08f, 0.5f, 2.4f);
        }
    }

    /// <summary>
    /// In-world skill group marker around the training dummy. E selects the
    /// group's first catalog skill. The full 67 live on the K overlay.
    /// </summary>
    public class SkillPylon : MonoBehaviour
    {
        public string group;
        public string skillType;

        public string Take()
        {
            if (!string.IsNullOrEmpty(group)) SkillLattice.Group = group;
            if (!string.IsNullOrEmpty(skillType)) SkillLattice.ActiveSkill = skillType;
            return SkillLattice.HudLine();
        }
    }

    /// <summary>
    /// What the player is actually carrying. Equip swaps the held mesh.
    /// Not a full item-instance economy — that lives in the kernel.
    /// </summary>
    public static class KitBag
    {
        public class Item
        {
            public string id, name, kind, stem;
        }

        public static readonly List<Item> Items = new List<Item>();
        public static string Equipped;
        public static int Art;

        public static void Reset()
        {
            Items.Clear();
            Equipped = null;
            Art = 0;
        }

        public static void HoldWeapon(string stem, string name = null)
        {
            if (string.IsNullOrEmpty(stem)) return;
            if (!Has(stem))
                Items.Add(new Item { id = stem, name = name ?? Pretty(stem), kind = "weapon", stem = stem });
            Equipped = stem;
        }

        public static void AddLoot(string id, string name = null)
        {
            if (string.IsNullOrEmpty(id) || Has(id)) return;
            Items.Add(new Item { id = id, name = name ?? Pretty(id), kind = "loot", stem = id });
        }

        public static Item TakeLoot()
        {
            for (int i = 0; i < Items.Count; i++)
            {
                if (Items[i].kind == "weapon") continue;
                var it = Items[i];
                Items.RemoveAt(i);
                return it;
            }
            return null;
        }

        public static bool HasLoot()
        {
            foreach (var it in Items)
                if (it.kind != "weapon") return true;
            return false;
        }

        public static bool Has(string id)
        {
            foreach (var it in Items)
                if (it.id == id) return true;
            return false;
        }

        public static string ArtName(WorldId world)
        {
            var s = Canon.Get(world).style;
            return Art == 1 ? s.heavy : Art == 2 ? s.special : s.light;
        }

        static string Pretty(string s)
        {
            if (string.IsNullOrEmpty(s)) return "thing";
            s = s.Replace("weapon-", "").Replace('_', ' ').Replace('-', ' ');
            return char.ToUpperInvariant(s[0]) + s.Substring(1);
        }
    }

    /// <summary>
    /// Per-person / per-faction kit. World StyleDef is the floor; faction weapons override the prop.
    /// </summary>
    public static class PersonKit
    {
        public static string WeaponStem(WorldBook.Faction fac, int salt)
        {
            if (fac?.visual?.preferred_weapon_archetypes == null || fac.visual.preferred_weapon_archetypes.Length == 0)
                return "weapon-sword";
            var raw = fac.visual.preferred_weapon_archetypes[Mathf.Abs(salt) % fac.visual.preferred_weapon_archetypes.Length];
            return MapWeapon(raw);
        }

        public static string MapWeapon(string raw)
        {
            var s = (raw ?? "").ToLowerInvariant();
            if (s.Contains("spear") || s.Contains("lance")) return DressVocab.Weapon("spear");
            if (s.Contains("staff") || s.Contains("wand")) return DressVocab.Weapon(s.Contains("wand") ? "wand" : "staff");
            if (s.Contains("dagger") || s.Contains("knife")) return DressVocab.Weapon("dagger");
            if (s.Contains("axe")) return DressVocab.Weapon("axe");
            if (s.Contains("bow")) return DressVocab.Weapon("bow");
            if (s.Contains("mace") || s.Contains("club")) return DressVocab.Weapon("mace");
            if (s.Contains("great")) return DressVocab.Weapon("greatsword");
            if (s.Contains("shield")) return DressVocab.Weapon("shield");
            return DressVocab.Weapon("sword");
        }

        public static WorldBook.Faction FactionOf(WorldId world, string factionId)
        {
            if (string.IsNullOrEmpty(factionId)) return null;
            foreach (var f in WorldBook.Factions(world))
                if (f != null && f.id == factionId) return f;
            return null;
        }
    }

    /// <summary>
    /// Same reaction table as server/lib/gifting.js. Kitchen and kernel
    /// share the math so a gift is never a fabricated success.
    /// </summary>
    public static class GiftFeel
    {
        public static string Category(string itemName)
        {
            var n = itemName ?? "";
            if (Contains(n, "sword", "blade", "dagger", "axe", "mace", "hammer", "spear", "lance", "bow", "whetstone", "arrow")) return "weapon";
            if (Contains(n, "armour", "armor", "shield", "helm", "plate", "mail", "gauntlet", "greave", "boot")) return "armor";
            if (Contains(n, "book", "scroll", "tome", "codex", "ink", "quill", "map", "treatise", "ledger")) return "book";
            if (Contains(n, "herb", "root", "leaf", "flower", "poultice", "salve", "potion", "elixir", "tonic", "remedy")) return "herb";
            if (Contains(n, "gem", "jewel", "crystal", "diamond", "ruby", "sapphire", "emerald", "pearl", "coin", "spark", "gold", "silver")) return "gem";
            if (Contains(n, "relic", "rune", "glyph", "sigil", "talisman", "amulet", "charm", "idol", "fragment")) return "relic";
            if (Contains(n, "bread", "stew", "roast", "soup", "ale", "tea", "pastry", "meat", "fish", "cheese", "wine", "fruit", "meal")) return "food";
            if (Contains(n, "pelt", "hide", "fur", "leather", "bone", "fang", "claw", "feather")) return "pelt";
            if (Contains(n, "tool", "gear", "cog", "wrench", "pick", "kit", "device", "component", "lamp")) return "tool";
            return "misc";
        }

        public static string Reaction(string archetype, string itemName)
        {
            var cat = Category(itemName);
            var arch = string.IsNullOrEmpty(archetype) ? "default" : archetype;
            Prefs(arch, out var loved, out var liked, out var disliked);
            if (Has(loved, cat)) return "loved";
            if (Has(disliked, cat)) return "disliked";
            if (Has(liked, cat)) return "liked";
            return "neutral";
        }

        public static float Delta(string reaction)
        {
            if (reaction == "loved") return 0.15f;
            if (reaction == "liked") return 0.10f;
            if (reaction == "disliked") return -0.05f;
            return 0.03f;
        }

        static bool Contains(string n, params string[] keys)
        {
            var low = (n ?? "").ToLowerInvariant();
            for (int i = 0; i < keys.Length; i++)
                if (low.IndexOf(keys[i], StringComparison.Ordinal) >= 0) return true;
            return false;
        }

        static bool Has(string[] list, string cat)
        {
            if (list == null) return false;
            for (int i = 0; i < list.Length; i++)
                if (list[i] == cat) return true;
            return false;
        }

        static void Prefs(string arch, out string[] loved, out string[] liked, out string[] disliked)
        {
            switch (arch)
            {
                case "scholar": loved = new[] { "book", "relic" }; liked = new[] { "gem", "tool" }; disliked = new[] { "pelt" }; break;
                case "mystic": loved = new[] { "relic", "gem" }; liked = new[] { "book", "herb" }; disliked = new[] { "weapon" }; break;
                case "healer": loved = new[] { "herb", "book" }; liked = new[] { "food", "relic" }; disliked = new[] { "weapon" }; break;
                case "warrior":
                case "warlord":
                case "guard": loved = new[] { "weapon", "armor" }; liked = new[] { "pelt", "food" }; disliked = new[] { "book" }; break;
                case "hunter": loved = new[] { "pelt", "weapon" }; liked = new[] { "food", "herb" }; disliked = new[] { "gem" }; break;
                case "trader":
                case "noble": loved = new[] { "gem", "relic" }; liked = new[] { "book", "food" }; disliked = new[] { "pelt" }; break;
                default: loved = new[] { "gem", "food" }; liked = new[] { "relic", "book" }; disliked = Array.Empty<string>(); break;
            }
        }
    }

    /// <summary>
    /// T1 affinity + F1.2 gifts. Same deltas as gifting.js. Heart beats match
    /// content/heart-events/default.json. Companion walk starts at 0.55.
    /// </summary>
    public static class Bonds
    {
        static readonly Dictionary<string, float> Aff = new Dictionary<string, float>();
        static readonly Dictionary<string, HashSet<string>> Hearts = new Dictionary<string, HashSet<string>>();
        static readonly HeartBeat[] Beats =
        {
            new HeartBeat { id = "small_kindnesses", t = 0.15f, title = "The Second Look" },
            new HeartBeat { id = "first_spark", t = 0.30f, title = "A Shared Quiet" },
            new HeartBeat { id = "learning_the_shape", t = 0.45f, title = "How You Take Your Mornings" },
            new HeartBeat { id = "deepening", t = 0.60f, title = "The Thing Not Said" },
            new HeartBeat { id = "the_harder_conversation", t = 0.75f, title = "What the Silence Cost" },
            new HeartBeat { id = "devotion", t = 0.85f, title = "Before the Asking" },
            new HeartBeat { id = "the_long_field", t = 0.95f, title = "The Long Field" },
        };

        struct HeartBeat { public string id, title; public float t; }

        public static void Reset()
        {
            Aff.Clear();
            Hearts.Clear();
        }

        public static string Key(GuestNpc npc)
        {
            if (npc == null) return "";
            if (!string.IsNullOrEmpty(npc.personId)) return npc.personId;
            if (npc.def != null && !string.IsNullOrEmpty(npc.def.id)) return npc.def.id;
            return npc.def != null ? npc.def.name : npc.name;
        }

        public static float Get(string id)
        {
            if (string.IsNullOrEmpty(id)) return 0f;
            return Aff.TryGetValue(id, out var v) ? v : 0.08f;
        }

        public static void Set(string id, float v)
        {
            if (string.IsNullOrEmpty(id)) return;
            Aff[id] = Mathf.Clamp01(v);
        }

        public static float TalkBump(string id)
        {
            if (string.IsNullOrEmpty(id)) return 0f;
            var prev = Get(id);
            var next = Mathf.Clamp01(prev + 0.02f);
            Aff[id] = next;
            MaybeHeart(id, prev, next, id);
            return next;
        }

        public static string Give(GuestNpc npc)
        {
            var id = Key(npc);
            if (string.IsNullOrEmpty(id)) return "No one to give to.";
            var item = KitBag.TakeLoot();
            if (item == null) return "Empty hands. Take something from the ring first.";
            var person = WorldBook.FindPerson(WorldClock.World, id);
            var arch = person != null ? person.archetype : "";
            var reaction = GiftFeel.Reaction(arch, item.name ?? item.id);
            var bump = GiftFeel.Delta(reaction);
            var prev = Get(id);
            var next = Mathf.Clamp01(prev + bump);
            Aff[id] = next;
            MaybeHeart(id, prev, next, npc.def != null ? npc.def.name : id);
            if (next >= 0.55f)
            {
                var life = npc.GetComponent<NpcLife>();
                if (life) life.job = NpcLife.Job.Companion;
            }
            WorldClock.NoteAct("a gift changed the air");
            var who = npc.def != null ? npc.def.name : "them";
            var client = ConcordClient.Live;
            if (client != null)
                client.SendGift(id, item.id, item.name, arch);
            return "You give " + who + " " + item.name + " (" + reaction + "). Affinity " + Mathf.RoundToInt(next * 100f) + "%.";
        }

        static void MaybeHeart(string id, float prev, float next, string who)
        {
            if (!Hearts.TryGetValue(id, out var seen))
            {
                seen = new HashSet<string>();
                Hearts[id] = seen;
            }
            for (int i = 0; i < Beats.Length; i++)
            {
                var b = Beats[i];
                if (prev < b.t && next >= b.t && seen.Add(b.id))
                    ConcordiaHUD.Announce(b.title, who + " · " + Mathf.RoundToInt(b.t * 100f) + "%");
            }
        }
    }

    /// <summary>
    /// Scheme board. Kernel schemeId from scheme:overheard / secret:weaponised
    /// barges in via scheme:intervene. Kitchen-only plots stay local and never
    /// claim a kernel success.
    /// </summary>
    public static class Plots
    {
        public class Rec
        {
            public string id, text, phase;
            public bool kernel;
        }

        static Rec _live;
        public static Rec Nearby => _live != null && _live.phase == "brewing" ? _live : null;

        public static void Reset() => _live = null;

        public static void Seed(string text, string schemeId = null)
        {
            var kernel = !string.IsNullOrEmpty(schemeId) && !schemeId.StartsWith("local_");
            _live = new Rec
            {
                id = kernel ? schemeId : "local_" + WorldClock.Day + "_" + Mathf.FloorToInt(WorldClock.Hour),
                text = text ?? "A faction scheme ripened.",
                phase = "brewing",
                kernel = kernel
            };
        }

        public static void ResolveKernel(string action)
        {
            if (_live == null) return;
            if (action != "expose" && action != "abet") action = "ignore";
            _live.phase = action == "expose" ? "exposed" : action == "abet" ? "abetted" : "ignored";
        }

        public static string Intervene(string action)
        {
            if (_live == null) return "No plot in the air.";
            if (action != "expose" && action != "abet") action = "ignore";
            var line = action == "expose"
                ? "You name the plot. The air goes still."
                : action == "abet"
                    ? "You put your weight behind it."
                    : "You let it pass.";
            if (_live.kernel)
            {
                var client = ConcordClient.Live;
                if (client != null) client.SendIntervene(_live.id, action);
                WorldClock.NoteAct("waiting on the kernel");
                ConcordiaHUD.Announce(action, "waiting on the kernel");
                return line + (string.IsNullOrEmpty(_live.text) ? "" : " · " + _live.text);
            }
            _live.phase = action == "expose" ? "exposed" : action == "abet" ? "abetted" : "ignored";
            WorldClock.NoteAct(line);
            ConcordiaHUD.Announce(action, line);
            return line + (string.IsNullOrEmpty(_live.text) ? "" : " · " + _live.text);
        }
    }
}
