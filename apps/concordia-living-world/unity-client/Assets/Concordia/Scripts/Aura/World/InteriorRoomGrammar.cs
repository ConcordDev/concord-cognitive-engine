using System;
using System.Collections.Generic;

namespace Concordia
{
    /// <summary>
    /// S9 — interior room grammar (CP-INT-01, flag cf.interiors).
    ///
    /// BuildingInterior builds ONE hollow room and furnishes it by plan. This
    /// grammar is the missing floorplan layer above it: for each building plan
    /// it declares a room graph — the rooms the interior contains, the entry
    /// room the court-facing door opens into, and the doors between rooms —
    /// and it validates that graph before anything is built from it.
    ///
    /// The six plans are exactly the plans BuildingInterior.Furnish switches
    /// on (tavern, forge, archive, market, tower) plus "hall", the graph for
    /// its default case. An unknown plan resolves to "hall", mirroring that
    /// default — a plan string can never produce no interior.
    ///
    /// Pure model: no UnityEngine, so EditMode tests exercise the graphs
    /// without a scene. Validity (the acceptance shape): at least three
    /// rooms, unique room ids, the entry is one of the rooms, every door
    /// endpoint is a room, no self-doors, no duplicate doors, and every room
    /// reachable from the entry — a room no door reaches is a room no player
    /// reaches.
    /// </summary>
    public enum RoomKind
    {
        Entry,
        MainHall,
        ShopFloor,
        Workshop,
        Library,
        Kitchen,
        Cellar,
        GuestRoom,
        Storage,
        Shrine,
        Vault,
        Study
    }

    public sealed class RoomDef
    {
        public readonly string Id;
        public readonly RoomKind Kind;

        public RoomDef(string id, RoomKind kind)
        {
            Id = id;
            Kind = kind;
        }
    }

    public sealed class RoomGraph
    {
        public readonly string Plan;
        public readonly string EntryRoomId;
        public readonly RoomDef[] Rooms;
        public readonly string[] Doors; // "a>b", undirected

        public RoomGraph(string plan, string entryRoomId, RoomDef[] rooms, string[] doors)
        {
            Plan = plan;
            EntryRoomId = entryRoomId;
            Rooms = rooms;
            Doors = doors;
        }

        public bool Validate(out string error)
        {
            error = null;
            if (Rooms == null || Rooms.Length < 3)
            {
                error = "graph needs at least three rooms";
                return false;
            }
            var ids = new HashSet<string>();
            foreach (var r in Rooms)
            {
                if (r == null || string.IsNullOrEmpty(r.Id))
                {
                    error = "room with no id";
                    return false;
                }
                if (!ids.Add(r.Id))
                {
                    error = "duplicate room id: " + r.Id;
                    return false;
                }
            }
            if (!ids.Contains(EntryRoomId))
            {
                error = "entry room is not one of the rooms: " + EntryRoomId;
                return false;
            }
            var adjacency = new Dictionary<string, List<string>>();
            foreach (var id in ids) adjacency[id] = new List<string>();
            var seenDoors = new HashSet<string>();
            foreach (var d in Doors ?? new string[0])
            {
                var parts = (d ?? "").Split('>');
                if (parts.Length != 2 || parts[0] == parts[1])
                {
                    error = "malformed or self door: " + d;
                    return false;
                }
                if (!ids.Contains(parts[0]) || !ids.Contains(parts[1]))
                {
                    error = "door endpoint is not a room: " + d;
                    return false;
                }
                var key = string.CompareOrdinal(parts[0], parts[1]) < 0
                    ? parts[0] + ">" + parts[1]
                    : parts[1] + ">" + parts[0];
                if (!seenDoors.Add(key))
                {
                    error = "duplicate door: " + d;
                    return false;
                }
                adjacency[parts[0]].Add(parts[1]);
                adjacency[parts[1]].Add(parts[0]);
            }
            // Every room reachable from the entry (BFS over the door graph).
            var reached = new HashSet<string> { EntryRoomId };
            var queue = new Queue<string>();
            queue.Enqueue(EntryRoomId);
            while (queue.Count > 0)
            {
                var cur = queue.Dequeue();
                foreach (var next in adjacency[cur])
                    if (reached.Add(next)) queue.Enqueue(next);
            }
            if (reached.Count != ids.Count)
            {
                foreach (var id in ids)
                    if (!reached.Contains(id))
                    {
                        error = "room unreachable from entry: " + id;
                        return false;
                    }
            }
            return true;
        }
    }

    public static class InteriorRoomGrammar
    {
        public static readonly string[] Plans =
            { "tavern", "forge", "archive", "market", "tower", "hall" };

        public static RoomGraph For(string plan)
        {
            switch (plan)
            {
                case "tavern": return Tavern();
                case "forge": return Forge();
                case "archive": return Archive();
                case "market": return Market();
                case "tower": return Tower();
                default: return Hall();
            }
        }

        static RoomDef R(string id, RoomKind kind) => new RoomDef(id, kind);

        static RoomGraph Tavern() => new RoomGraph("tavern", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("main_hall", RoomKind.MainHall),
                R("kitchen", RoomKind.Kitchen),
                R("cellar", RoomKind.Cellar),
                R("guest_room", RoomKind.GuestRoom),
                R("guest_storage", RoomKind.Storage)
            },
            new[] { "entry>main_hall", "main_hall>kitchen", "main_hall>cellar", "main_hall>guest_room", "guest_room>guest_storage" });

        static RoomGraph Forge() => new RoomGraph("forge", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("shop_floor", RoomKind.ShopFloor),
                R("workshop", RoomKind.Workshop),
                R("storage", RoomKind.Storage),
                R("vault", RoomKind.Vault)
            },
            new[] { "entry>shop_floor", "shop_floor>workshop", "workshop>storage", "workshop>vault" });

        static RoomGraph Archive() => new RoomGraph("archive", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("library", RoomKind.Library),
                R("study", RoomKind.Study),
                R("vault", RoomKind.Vault),
                R("storage", RoomKind.Storage)
            },
            new[] { "entry>library", "library>study", "library>vault", "library>storage" });

        static RoomGraph Market() => new RoomGraph("market", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("shop_floor", RoomKind.ShopFloor),
                R("storage", RoomKind.Storage),
                R("workshop", RoomKind.Workshop),
                R("cellar", RoomKind.Cellar)
            },
            new[] { "entry>shop_floor", "shop_floor>storage", "shop_floor>workshop", "storage>cellar" });

        static RoomGraph Tower() => new RoomGraph("tower", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("main_hall", RoomKind.MainHall),
                R("shrine", RoomKind.Shrine),
                R("vault", RoomKind.Vault),
                R("library", RoomKind.Library)
            },
            new[] { "entry>main_hall", "main_hall>shrine", "main_hall>vault", "shrine>library" });

        static RoomGraph Hall() => new RoomGraph("hall", "entry",
            new[]
            {
                R("entry", RoomKind.Entry),
                R("main_hall", RoomKind.MainHall),
                R("kitchen", RoomKind.Kitchen),
                R("study", RoomKind.Study)
            },
            new[] { "entry>main_hall", "main_hall>kitchen", "main_hall>study" });
    }
}
