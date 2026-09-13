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
            WorldAaa.Reset();
            QuestLog.Reset();
            SkillLedger.Reset();
            SkillLattice.Reset();
            KitBag.Reset();
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
            var world = a.world;
            var follows = a.quest.follow_up_quest_ids;
            Done.Add(a.quest.id);
            Active.Remove(a);
            if (follows == null) return;
            foreach (var id in follows)
            {
                var next = WorldBook.QuestById(world, id);
                if (next != null) Offer(next, world);
            }
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
                case "observe":
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
                        return Hit(Talked, target);
                    case "interact":
                        return Hit(Talked, target) || Hit(Places, target);
                    case "observe":
                        return Hit(Talked, target) || Hit(Places, target);
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
}
