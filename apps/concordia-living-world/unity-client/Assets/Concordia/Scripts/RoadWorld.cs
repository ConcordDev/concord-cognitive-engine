using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Mid-ring between the Unburned Court and a civilization Present.
    /// Hills already exist. This puts threat, wrecks, wayfinding, and people
    /// with jobs on those roads — not towns, not a gym dummy.
    /// Authored ModularPerson gait only. A missing pack stays a primitive.
    /// </summary>
    public static class RoadWorld
    {
        /// <summary>Sundering first — the lived road — then around the Ring.</summary>
        static readonly int[] WalkerOrder = { 2, 4, 3, 5, 1, 6, 0, 7 };

        public struct Role
        {
            public string name, title, line;
            public NpcLife.Job job;
            public int outfit;
        }

        public static string WayText(GateDef g, float leftM)
        {
            var dest = g != null && !string.IsNullOrEmpty(g.name) ? g.name : "the Ring";
            var metres = Mathf.Max(0, Mathf.RoundToInt(leftM));
            var hint = leftM < 70f ? "Present close" : "steel ahead";
            return "this way " + dest + "\n" + metres + "m · " + hint;
        }

        public static Role RoleFor(WorldId id, int salt)
        {
            switch (id)
            {
                case WorldId.Fantasy:
                    return salt % 2 == 0
                        ? R("Kest", "Iron Warden", "Ward steel. Don't become the curse.", NpcLife.Job.Watch, 1)
                        : R("Bram", "Sundering Guard", "The road holds. The curse does not.", NpcLife.Job.Watch, 1);
                case WorldId.Tunya:
                    return R("Silo", "Grove merchant", "Take fruit, not the tree.", NpcLife.Job.Wander, 1);
                case WorldId.Frontier:
                    return R("Rill", "Scout", "The road is our door.", NpcLife.Job.Watch, 3);
                case WorldId.Crime:
                    return R("Vetch", "Fixer", "The bill always arrives.", NpcLife.Job.Wander, 5);
                case WorldId.Cyber:
                    return R("Nul", "Uncounted runner", "I will not be counted.", NpcLife.Job.Wander, 2);
                case WorldId.Ruins:
                    return R("Ash", "Glyph keeper", "Catalogue, do not conquer.", NpcLife.Job.Watch, 1);
                case WorldId.Superhero:
                    return R("Sol", "Dawn watcher", "Mercy. They stand.", NpcLife.Job.Watch, 4);
                case WorldId.Crucible:
                    return R("Wren", "Lattice walker", "If it would end, un-end it.", NpcLife.Job.Wander, 2);
                default:
                    return R("Kest", "Iron Warden", "The Ring is long.", NpcLife.Job.Wander, 1);
            }
        }

        static Role R(string name, string title, string line, NpcLife.Job job, int outfit) =>
            new Role { name = name, title = title, line = line, job = job, outfit = outfit };

        public static void Seed(Transform hold)
        {
            if (!hold) return;
            DressSigns(hold);
            if (hold.Find("RoadWorldSeed")) return;
            SeedWrecks(hold);
            SeedThreats(hold);
            SeedDelves(hold);
            SeedTravelers(hold);
            var mark = new GameObject("RoadWorldSeed");
            mark.transform.SetParent(hold, false);
        }

        public static void PlaceSign(Transform hold, GateDef g, Vector3 roadPoint, Vector3 alongDir, int i, float leftM)
        {
            if (!hold || g == null) return;
            var name = "Sign_" + g.shortName + "_" + i;
            var right = Vector3.Cross(Vector3.up, alongDir);
            if (right.sqrMagnitude < 0.01f) right = Vector3.right;
            right.Normalize();
            var at = roadPoint + right * 3.4f;
            var existing = hold.Find(name);
            if (existing)
            {
                existing.position = at + Vector3.up * 2.05f;
                existing.rotation = Quaternion.LookRotation(-right, Vector3.up);
                var tm = existing.GetComponent<TextMesh>();
                if (tm) tm.text = WayText(g, leftM);
                return;
            }
            var stone = HubLook.Pbr("stone_tiles", new Color(0.46f, 0.42f, 0.36f), 0.04f, 0.22f, 12f);
            HubLook.Prim(hold, PrimitiveType.Cube, at + Vector3.up * 0.85f,
                new Vector3(0.22f, 1.7f, 0.22f), stone, "Mark_" + g.shortName + "_" + i);
            var label = new GameObject(name).AddComponent<TextMesh>();
            label.transform.SetParent(hold, false);
            label.transform.position = at + Vector3.up * 2.05f;
            label.transform.rotation = Quaternion.LookRotation(-right, Vector3.up);
            label.text = WayText(g, leftM);
            label.fontSize = 42;
            label.characterSize = 0.09f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = Color.Lerp(g.color, Color.white, 0.35f);
            HubLook.DressTextMesh(label);
        }

        static void DressSigns(Transform hold)
        {
            for (int i = 0; i < hold.childCount; i++)
            {
                var child = hold.GetChild(i);
                if (!child || !child.name.StartsWith("Sign_")) continue;
                var tm = child.GetComponent<TextMesh>();
                if (!tm) continue;
                var g = GateFromSignName(child.name);
                if (g == null) continue;
                var dest = MegaworldMap.Present(g.world);
                var left = Mathf.Max(0f, dest.magnitude - child.position.magnitude);
                var dir = dest.sqrMagnitude > 4f ? dest.normalized : Vector3.forward;
                var right = Vector3.Cross(Vector3.up, dir);
                if (right.sqrMagnitude > 0.01f)
                    child.rotation = Quaternion.LookRotation(-right.normalized, Vector3.up);
                tm.text = WayText(g, left);
            }
        }

        static GateDef GateFromSignName(string name)
        {
            foreach (var g in Canon.Gates)
            {
                if (g != null && name.Contains("_" + g.shortName + "_")) return g;
            }
            return null;
        }

        static void SeedWrecks(Transform hold)
        {
            foreach (var g in Canon.Gates)
            {
                var dest = MegaworldMap.Present(g.world);
                if (dest.sqrMagnitude < 4f) continue;
                var dir = dest.normalized;
                var side = Vector3.Cross(Vector3.up, dir);
                if (side.sqrMagnitude < 0.01f) side = Vector3.right;
                side.Normalize();
                float along = Canon.RingRadius + 48f;
                var berm = dir * along - side * 4.6f;
                var yaw = -g.angle * Mathf.Rad2Deg + 70f;
                var cart = FreePacks.Spawn(DressVocab.Cart(), hold, berm, yaw, 1.6f, required: false);
                if (!cart)
                    cart = HubLook.Prim(hold, PrimitiveType.Cube, berm + Vector3.up * 0.45f,
                        new Vector3(2.2f, 0.9f, 1.1f),
                        HubLook.Lit(new Color(0.32f, 0.22f, 0.12f), 0.12f, 0.28f),
                        "Wreck_" + g.shortName);
                else
                    cart.name = "Wreck_" + g.shortName;
                var crateAt = berm + side * 1.4f;
                var crate = FreePacks.Spawn("crate", hold, crateAt, yaw + 20f, 0.7f, required: false);
                if (!crate)
                    HubLook.Prim(hold, PrimitiveType.Cube, crateAt + Vector3.up * 0.28f,
                        new Vector3(0.7f, 0.55f, 0.7f),
                        HubLook.Lit(new Color(0.4f, 0.28f, 0.14f), 0.1f, 0.25f),
                        "WreckCrate_" + g.shortName);
            }
        }

        static void SeedThreats(Transform hold)
        {
            int cap = ConcordiaHost.RoadThreats;
            if (cap <= 0) return;
            int n = 0;
            foreach (var idx in WalkerOrder)
            {
                if (n >= cap) break;
                if (idx < 0 || idx >= Canon.Gates.Length) continue;
                var g = Canon.Gates[idx];
                if (PlaceWatcher(hold, g, n) || PlaceBandit(hold, g, n)) n++;
            }
        }

        static bool PlaceWatcher(Transform hold, GateDef g, int salt)
        {
            var dest = MegaworldMap.Present(g.world);
            if (dest.sqrMagnitude < 4f) return false;
            var dir = dest.normalized;
            var side = Vector3.Cross(Vector3.up, dir).normalized;
            float along = Canon.RingRadius + 62f + (salt % 3) * 10f;
            var hill = dir * along + side * (8.2f + (salt % 2) * 1.6f) + Vector3.up * 0.05f;
            var w = Canon.Get(g.world);
            var kind = WatchKind(w, salt);
            GameObject go = null;
            if (!string.IsNullOrEmpty(kind))
            {
                go = CreatureCompiler.Compile(hold, new CreatureCard
                {
                    id = kind + "-road-" + g.shortName,
                    speciesId = kind,
                    topology = CreatureCompiler.TopologyFor(kind),
                    generation = 0,
                    predator = true,
                    lifestyle = "carnivore"
                }, hill, w);
            }
            if (!go) return false;
            go.name = "Watcher_" + g.shortName;
            var dummy = go.GetComponent<TrainingDummy>() ?? go.AddComponent<TrainingDummy>();
            dummy.living = true;
            dummy.BindId("road-watch-" + g.shortName);
            dummy.hp = 55f;
            var h = go.GetComponent<Hostile>() ?? go.AddComponent<Hostile>();
            h.aggro = 18f;
            h.damage = 8f + salt;
            return true;
        }

        static bool PlaceBandit(Transform hold, GateDef g, int salt)
        {
            var dest = MegaworldMap.Present(g.world);
            if (dest.sqrMagnitude < 4f) return false;
            var dir = dest.normalized;
            var side = Vector3.Cross(Vector3.up, dir).normalized;
            float along = Canon.RingRadius + 70f;
            var p = dir * along - side * 5.8f + Vector3.up * 0.05f;
            var who = BanditFor(g.world, salt);
            var look = Appearance.Random(8800 + salt * 17);
            look.displayName = who.name;
            look.outfit = who.outfit;
            var yaw = Quaternion.LookRotation(-side, Vector3.up).eulerAngles.y;
            var go = ModularPerson.SpawnNpc(hold, p, yaw, look, false);
            go.name = "Bandit_" + g.shortName;
            var dummy = go.AddComponent<TrainingDummy>();
            dummy.living = true;
            dummy.BindId("road-bandit-" + g.shortName);
            dummy.hp = 64f;
            FreePacks.EnsureCollider(go, 1.8f);
            var hostile = go.AddComponent<Hostile>();
            hostile.aggro = 16f;
            hostile.damage = 10f;
            var guest = go.AddComponent<GuestNpc>();
            guest.def = new GuestDef
            {
                id = "road-bandit-" + g.shortName,
                name = who.name,
                title = who.title,
                line = who.line
            };
            PersonLabel.Attach(go.transform, who.name, who.title);
            return true;
        }

        static void SeedDelves(Transform hold)
        {
            int cap = ConcordiaHost.RoadDelves;
            if (cap <= 0) return;
            int n = 0;
            foreach (var idx in WalkerOrder)
            {
                if (n >= cap) break;
                if (idx < 0 || idx >= Canon.Gates.Length) continue;
                PlaceDelve(hold, Canon.Gates[idx], n);
                n++;
            }
        }

        static void PlaceDelve(Transform hold, GateDef g, int salt)
        {
            var dest = MegaworldMap.Present(g.world);
            if (dest.sqrMagnitude < 4f) return;
            var dir = dest.normalized;
            var side = Vector3.Cross(Vector3.up, dir).normalized;
            float along = Canon.RingRadius + 96f;
            var mouth = dir * along + side * 7.4f;
            var root = new GameObject("Delve_" + g.shortName).transform;
            root.SetParent(hold, false);
            root.position = mouth;
            var stone = HubLook.Pbr("stone_tiles", new Color(0.42f, 0.38f, 0.32f), 0.05f, 0.22f, 10f);
            HubLook.Prim(root, PrimitiveType.Cube, mouth + Vector3.up * 1.1f + dir * 2.4f,
                new Vector3(4.2f, 2.2f, 0.45f), stone, "DelveWall_" + g.shortName);
            HubLook.Prim(root, PrimitiveType.Cube, mouth + Vector3.up * 1.0f + side * 2.6f + dir * 1.2f,
                new Vector3(0.45f, 2.0f, 3.4f), stone, "DelveSide_" + g.shortName);
            var chestPos = mouth + dir * 3.6f + Vector3.up * 0.02f;
            var chest = FreePacks.Spawn("chest", root, chestPos, Quaternion.LookRotation(-dir).eulerAngles.y, 0.9f, required: false);
            if (!chest)
                chest = HubLook.Prim(root, PrimitiveType.Cube, chestPos + Vector3.up * 0.28f,
                    new Vector3(0.7f, 0.45f, 0.5f),
                    HubLook.Lit(new Color(0.45f, 0.32f, 0.12f), 0.2f, 0.35f),
                    "DelveChest_" + g.shortName);
            var loot = chest.GetComponent<Gatherable>() ?? chest.AddComponent<Gatherable>();
            loot.itemId = "delve-" + g.shortName.ToLowerInvariant();
            loot.label = g.name + " camp cache";
            var plaque = HubLook.Prim(root, PrimitiveType.Cube, mouth - dir * 1.4f + Vector3.up * 0.85f,
                new Vector3(0.7f, 1.2f, 0.14f), HubLook.Lit(Canon.Get(g.world).ground, 0.08f, 0.22f),
                "DelvePlaque_" + g.shortName);
            var stoneTxt = plaque.AddComponent<LoreStone>();
            stoneTxt.title = g.name;
            stoneTxt.text = g.name + " roadside hold. Live steel. Someone camped here and did not finish the walk.";
            var bossAt = mouth + dir * 2.2f + Vector3.up * 0.05f;
            var w = Canon.Get(g.world);
            var kind = WatchKind(w, salt + 3);
            GameObject boss = null;
            if (!string.IsNullOrEmpty(kind))
            {
                boss = CreatureCompiler.Compile(root, new CreatureCard
                {
                    id = kind + "-delve-" + g.shortName,
                    speciesId = kind,
                    topology = CreatureCompiler.TopologyFor(kind),
                    generation = 0,
                    predator = true,
                    lifestyle = "carnivore"
                }, bossAt, w);
            }
            if (!boss)
            {
                var role = BanditFor(g.world, salt + 9);
                var look = Appearance.Random(9100 + salt * 13);
                look.displayName = role.name;
                look.outfit = role.outfit;
                boss = ModularPerson.SpawnNpc(root, bossAt, Quaternion.LookRotation(-dir).eulerAngles.y, look, false);
                boss.name = "DelveBoss_" + g.shortName;
                var dummy = boss.AddComponent<TrainingDummy>();
                dummy.living = true;
                dummy.BindId("road-delve-" + g.shortName);
                dummy.hp = 88f;
                FreePacks.EnsureCollider(boss, 1.8f);
                var guest = boss.AddComponent<GuestNpc>();
                guest.def = new GuestDef
                {
                    id = "road-delve-" + g.shortName,
                    name = role.name,
                    title = "camp boss",
                    line = "This stretch was theirs."
                };
            }
            else
            {
                boss.name = "DelveBoss_" + g.shortName;
                var dummy = boss.GetComponent<TrainingDummy>() ?? boss.AddComponent<TrainingDummy>();
                dummy.living = true;
                dummy.BindId("road-delve-" + g.shortName);
                dummy.hp = 88f;
            }
            var hostile = boss.GetComponent<Hostile>() ?? boss.AddComponent<Hostile>();
            hostile.aggro = 14f;
            hostile.damage = 12f;
        }

        static void SeedTravelers(Transform hold)
        {
            if (hold.Find("RoadLife")) return;
            int n = ConcordiaHost.RoadWalkers;
            if (n <= 0 || Canon.Gates.Length == 0) return;
            var root = new GameObject("RoadLife").transform;
            root.SetParent(hold, false);
            int count = Mathf.Min(n, WalkerOrder.Length, Canon.Gates.Length);
            for (int i = 0; i < count; i++)
            {
                var idx = WalkerOrder[i];
                if (idx < 0 || idx >= Canon.Gates.Length) continue;
                var g = Canon.Gates[idx];
                var dest = MegaworldMap.Present(g.world);
                if (dest.sqrMagnitude < 4f) continue;
                var dir = dest.normalized;
                float along = Canon.RingRadius + 28f + (i % 3) * 24f;
                var p = dir * along + Vector3.up * 0.05f;
                var role = RoleFor(g.world, i);
                var look = Appearance.Random(4400 + i * 29);
                look.displayName = role.name;
                look.outfit = role.outfit;
                var go = ModularPerson.SpawnNpc(root, p, -g.angle * Mathf.Rad2Deg + 180f, look, true, 14f);
                go.name = role.name;
                var life = go.AddComponent<NpcLife>();
                life.job = role.job;
                var guest = go.GetComponent<GuestNpc>() ?? go.AddComponent<GuestNpc>();
                guest.def = new GuestDef
                {
                    id = "road-" + g.shortName + "-" + i,
                    name = role.name,
                    title = role.title,
                    line = role.line
                };
                PersonLabel.Attach(go.transform, role.name, role.title);
            }
        }

        static string WatchKind(WorldDef w, int salt)
        {
            if (w == null || w.fauna == null || w.fauna.Length == 0) return "wolf";
            for (int i = 0; i < w.fauna.Length; i++)
            {
                var k = w.fauna[(i + salt) % w.fauna.Length];
                if (string.IsNullOrEmpty(k)) continue;
                if (k == "sealie") continue;
                return k;
            }
            return w.fauna[0];
        }

        static Role BanditFor(WorldId id, int salt)
        {
            var names = new[] { "Marrow", "Hitch", "Dusk", "Nettle" };
            var name = names[Mathf.Abs(salt) % names.Length];
            var role = RoleFor(id, salt);
            role.name = name;
            role.title = "road bandit";
            role.line = "The mid-ring is theirs until it isn't.";
            role.job = NpcLife.Job.Watch;
            return role;
        }

        /// <summary>Kill loot that was not on a menu. Idempotent per body.</summary>
        public static void DropSpoils(Transform at)
        {
            if (!at) return;
            var key = "Spoils_" + at.name;
            if (at.parent && at.parent.Find(key)) return;
            if (GameObject.Find(key)) return;
            var p = at.position + at.right * 0.7f;
            p.y = at.position.y;
            var hold = at.parent ? at.parent : at;
            var crate = FreePacks.Spawn("crate", hold, p, 25f, 0.65f, required: false);
            if (!crate)
                crate = HubLook.Prim(hold, PrimitiveType.Cube, p + Vector3.up * 0.22f,
                    new Vector3(0.5f, 0.38f, 0.45f),
                    HubLook.Lit(new Color(0.4f, 0.28f, 0.14f), 0.1f, 0.25f), key);
            else
                crate.name = key;
            var g = crate.GetComponent<Gatherable>() ?? crate.AddComponent<Gatherable>();
            g.itemId = "road-spoils";
            g.label = "road spoils";
            g.taken = false;
        }
    }
}
