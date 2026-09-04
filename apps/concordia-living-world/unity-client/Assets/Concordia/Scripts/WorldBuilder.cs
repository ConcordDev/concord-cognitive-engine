using UnityEngine;

namespace Concordia
{
    public class WorldBuilder : MonoBehaviour
    {
        public Transform root;
        public ConcordiaPlayer player;

        static readonly string[] ForestTrees =
        {
            "tree_oak", "tree_default", "tree_pineTallA", "tree_detailed",
            "tree_tall", "tree_fat", "tree_simple", "tree_pineDefaultA",
            "tree-large", "tree-small", "detail-tree-large"
        };
        static readonly string[] Flowers =
        {
            "flower_redA", "flower_yellowA", "flower_purpleA",
            "flower_redB", "flower_yellowB", "flower_purpleC"
        };
        static readonly string[] Houses =
        {
            "building-type-a", "building-type-b", "building-type-c", "building-type-d",
            "building-type-e", "building-type-h", "building-type-k", "building-type-n",
            "building-small-a", "building-small-b", "building-small-c", "building-small-d"
        };
        static readonly string[] Shops =
        {
            "building-a", "building-c", "building-e", "building-g",
            "building-skyscraper-a", "building-skyscraper-c"
        };

        public void Build(WorldId world)
        {
            PurgeWorldRoots();
            CityAtlas.Invalidate();
            root = new GameObject("World").transform;
            ModularPerson.CastingWorld = world;
            FreePacks.Reindex();
            var w = Canon.Get(world);
            BuildGround(w);
            DressSky(w);
            DressAudio(w);
            if (world == WorldId.Hub) BuildHub();
            else BuildRealm(w);
            SpawnFauna(w);
            HubLook.UpgradeStandardMaterials();
            try
            {
                System.IO.File.WriteAllText("/tmp/concordia-atlas.txt",
                    System.DateTime.Now.ToString("o") + " world=" + world + "\n" + CityAtlas.Dump());
            }
            catch { }
        }

        static void PurgeWorldRoots()
        {
            var found = Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            for (int i = 0; i < found.Length; i++)
            {
                var t = found[i];
                if (!t || t.parent != null) continue;
                if (t.name != "World") continue;
                Object.DestroyImmediate(t.gameObject);
            }
        }

        void BuildGround(WorldDef w)
        {
            if (w.id == WorldId.Hub)
            {
                HubLook.MakeSun(root, new Color(1f, 0.94f, 0.82f), 1.18f, new Vector3(42f, -38f, 0f));
                return;
            }
            var g = GameObject.CreatePrimitive(PrimitiveType.Plane);
            g.name = "Ground";
            g.transform.SetParent(root, false);
            g.transform.localScale = Vector3.one * 22;
            var pbrStem = w.id switch
            {
                WorldId.Ruins => "ash_soil",
                WorldId.Tunya => "grove_moss",
                WorldId.Crime => "wet_asphalt",
                WorldId.Cyber => "neon_grid",
                WorldId.Frontier => "packed_earth",
                WorldId.Superhero => "concrete_floor",
                WorldId.Crucible => "metal_plate",
                WorldId.Fantasy => "stone_tiles",
                WorldId.Sere => "wet_asphalt",
                _ => "stone_tiles"
            };
            var pbr = HubLook.Pbr(pbrStem, w.ground, 0.04f, 0.16f, 18f);
            var gr0 = g.GetComponent<Renderer>();
            if (gr0) gr0.sharedMaterial = pbr;

            var sun = w.id switch
            {
                WorldId.Hub => (new Color(1f, 0.84f, 0.58f), 2.05f, new Vector3(18f, 204f, 0f)),
                WorldId.Ruins => (new Color(0.72f, 0.68f, 0.62f), 0.72f, new Vector3(48f, 40f, 0f)),
                WorldId.Tunya => (new Color(1f, 0.94f, 0.72f), 1.45f, new Vector3(58f, 30f, 0f)),
                WorldId.Fantasy => (new Color(1f, 0.55f, 0.28f), 1.55f, new Vector3(8f, 168f, 0f)),
                WorldId.Crime => (new Color(0.55f, 0.42f, 0.62f), 0.42f, new Vector3(12f, 130f, 0f)),
                WorldId.Cyber => (new Color(0.55f, 0.18f, 0.85f), 0.85f, new Vector3(22f, 210f, 0f)),
                WorldId.Frontier => (new Color(1f, 0.88f, 0.55f), 1.85f, new Vector3(38f, 24f, 0f)),
                WorldId.Superhero => (new Color(1f, 0.62f, 0.38f), 1.7f, new Vector3(6f, 92f, 0f)),
                WorldId.Sere => (new Color(0.82f, 0.62f, 0.38f), 0.55f, new Vector3(18f, 140f, 0f)),
                _ => (new Color(0.25f, 1f, 0.85f), 1.2f, new Vector3(28f, 80f, 0f))
            };
            HubLook.MakeSun(root, sun.Item1, sun.Item2, sun.Item3);
        }

        void DressSky(WorldDef w)
        {
            if (!HubLook.ApplySky(w.id))
                FreePacks.Sky(DressVocab.SkyMat(w.id));
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.ExponentialSquared;
            RenderSettings.fogDensity = w.id switch
            {
                WorldId.Hub => 0.0045f,
                WorldId.Crime => 0.018f,
                WorldId.Ruins => 0.016f,
                WorldId.Cyber => 0.014f,
                WorldId.Frontier => 0.007f,
                WorldId.Sere => 0.02f,
                _ => 0.011f
            };
            RenderSettings.fogColor = w.id switch
            {
                WorldId.Hub => new Color(0.62f, 0.68f, 0.74f),
                WorldId.Fantasy => new Color(0.62f, 0.28f, 0.18f),
                WorldId.Cyber => new Color(0.18f, 0.06f, 0.28f),
                WorldId.Crime => new Color(0.12f, 0.08f, 0.10f),
                WorldId.Frontier => new Color(0.78f, 0.62f, 0.38f),
                WorldId.Tunya => new Color(0.42f, 0.52f, 0.28f),
                WorldId.Superhero => new Color(0.72f, 0.42f, 0.28f),
                WorldId.Ruins => new Color(0.32f, 0.28f, 0.24f),
                WorldId.Sere => new Color(0.22f, 0.16f, 0.10f),
                _ => new Color(0.08f, 0.28f, 0.28f)
            };
            DynamicGI.UpdateEnvironment();
            if (w.id == WorldId.Hub)
                DressVocab.PlaceWeather("fireflies", root, new Vector3(0, 2.2f, 0));
            if (w.id == WorldId.Crime || w.weather == "rain")
                DressVocab.PlaceWeather("rain", root, new Vector3(0, 8, 0));
            if (w.id == WorldId.Ruins || w.id == WorldId.Crucible)
                DressVocab.PlaceWeather("snow", root, new Vector3(0, 8, 0));
        }

        void DressAudio(WorldDef w)
        {
            var music = w.id == WorldId.Hub
                ? "Assets/Audio/Background_Music_Ethereal.prefab"
                : w.id == WorldId.Crime || w.id == WorldId.Cyber
                    ? "Assets/Audio/Background_Music_Suspenseful.prefab"
                    : w.id == WorldId.Superhero
                        ? "Assets/Audio/Background_Music_Action.prefab"
                        : "Assets/Audio/Background_Ambient_Wind.prefab";
            FreePacks.Prefab(music, root, Vector3.zero);
            if (w.id == WorldId.Hub || w.id == WorldId.Cyber)
                FreePacks.Prefab("Assets/Audio/Background_Ambient_Sci-Fi.prefab", root, Vector3.zero);
        }

        void BuildHub()
        {
            HubPlaza.Build(root);
            var wdef = Canon.Hub;
            ConcordiaHUD.Announce(wdef.title, wdef.refusal);

            var arena = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            arena.name = "Arena";
            arena.transform.SetParent(root, false);
            arena.transform.position = Canon.Arena + Vector3.up * 0.05f;
            arena.transform.localScale = new Vector3(14f, 0.04f, 14f);
            FreePacks.ApplyMat(arena, "Assets/Materials/Material_SandLumpy.mat");
            TintFallback(arena, Canon.Hex("b89060"));
            FreePacks.FlattenDisc(arena);
            DressArena();

            foreach (var gate in Canon.Gates)
            {
                var p = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0, Mathf.Sin(gate.angle) * Canon.RingRadius);
                var yaw = -gate.angle * Mathf.Rad2Deg;
                DressEmbassy(gate, p, yaw);
            }

            DressGuests();
            DressPillars();
            DressCrowd();
            DressLore();
            RealmFill.Populate(root, WorldId.Hub);
            StoreDress.Hub(root);

            var dummyLook = Appearance.Random(77);
            dummyLook.outfit = 1;
            dummyLook.displayName = "Training Dummy";
            var dummy = ModularPerson.SpawnNpc(root, Canon.Arena + Vector3.forward * 2.2f, 180f, dummyLook, false);
            dummy.AddComponent<TrainingDummy>();
            FreePacks.EnsureCollider(dummy, 1.8f);
            Beacon(root, Canon.Spawn, 8f, "first_cycle_glade", "hub_court", "the_unburned_court");
            Beacon(root, Canon.Arena, 8f, "training_hollow", "arena");
            var east = new Vector3(Mathf.Cos(0f) * Canon.RingRadius, 0f, Mathf.Sin(0f) * Canon.RingRadius);
            Beacon(root, east, 7f, "east_gate");
        }

        static void Beacon(Transform root, Vector3 pos, float radius, params string[] tokens)
        {
            var go = new GameObject("Beacon_" + tokens[0]);
            go.transform.SetParent(root, false);
            go.transform.position = pos;
            var b = go.AddComponent<QuestBeacon>();
            b.tokens = tokens;
            b.radius = radius;
        }

        void DressCrowd()
        {
            // Court stays open. Walkers live on the ring between court and gates.
            for (int i = 0; i < 16; i++)
            {
                var a = i / 16f * Mathf.PI * 2f + 0.4f;
                var rad = 21f + (i % 5) * 2.4f;
                var p = new Vector3(Mathf.Cos(a) * rad, 0f, Mathf.Sin(a) * rad);
                if ((p - Canon.Spawn).sqrMagnitude < 16f) continue;
                if (Canon.InArena(p)) continue;
                var look = Appearance.Random(1100 + i * 17);
                look.displayName = i % 7 == 0 ? "Petitioner" : i % 5 == 0 ? "Merchant" : "Citizen";
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, a * Mathf.Rad2Deg, look, true, 8f + (i % 4));
                var life = go.AddComponent<NpcLife>();
                life.job = i % 9 == 0 ? NpcLife.Job.Sweep : NpcLife.Job.Wander;
                TagCrowd(go, "crowd-walk-" + i, look.displayName, "court");
            }
            for (int i = 0; i < 8; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = Vector3.Cross(Vector3.up, dir).normalized;
                var p = dir * 26f + side * 5.2f;
                var look = Appearance.Random(2200 + i * 31);
                look.outfit = i % 6;
                var go = ModularPerson.SpawnNpc(root, p, -g.angle * Mathf.Rad2Deg + 180f, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Stall;
                TagCrowd(go, "crowd-stall-" + i, look.displayName ?? "Merchant", g.shortName);
            }
            for (int i = 0; i < 4; i++)
            {
                float a = i / 4f * Mathf.PI * 2f + 0.55f;
                var p = new Vector3(Mathf.Cos(a) * 19.4f, 0f, Mathf.Sin(a) * 19.4f);
                if (Canon.InArena(p)) continue;
                HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 0.28f, new Vector3(1.4f, 0.22f, 0.45f),
                    HubLook.Lit(new Color(0.35f, 0.2f, 0.1f), 0.1f, 0.25f), "Bench" + i);
                var look = Appearance.Random(3300 + i * 13);
                var go = ModularPerson.SpawnNpc(root, p + new Vector3(0f, 0f, 0.1f), -a * Mathf.Rad2Deg, look, false);
                go.AddComponent<NpcLife>().job = NpcLife.Job.Sit;
                TagCrowd(go, "crowd-sit-" + i, look.displayName ?? "Citizen", "bench");
            }
        }

        static void TagCrowd(GameObject go, string id, string name, string title)
        {
            if (!go || go.GetComponent<GuestNpc>()) return;
            var guest = go.AddComponent<GuestNpc>();
            guest.def = new GuestDef
            {
                id = id,
                name = string.IsNullOrEmpty(name) ? "Citizen" : name,
                title = string.IsNullOrEmpty(title) ? "unlabeled" : title,
                line = "They keep their own hours. Not an authored citizen."
            };
        }

        void DressArena()
        {
            var c = Canon.Arena;
            var wall = DressVocab.Wall(WorldId.Hub);
            var col = DressVocab.Column(WorldId.Hub);
            var sword = DressVocab.Weapon("sword");
            var tower = DressVocab.Tower(WorldId.Hub);
            for (int i = 0; i < 12; i++)
            {
                var a = (i / 12f) * Mathf.PI * 2;
                FreePacks.Spawn(wall, root, c + new Vector3(Mathf.Cos(a) * 8.4f, 0, Mathf.Sin(a) * 8.4f),
                    -a * Mathf.Rad2Deg + 90, 3.2f);
                if (i % 3 == 0)
                    FreePacks.Spawn(col, root, c + new Vector3(Mathf.Cos(a) * 7.2f, 0, Mathf.Sin(a) * 7.2f), 0, 2.6f);
            }
            FreePacks.Spawn(DressVocab.FirstStem(new[] { "Statue" }, "statue"), root, c + new Vector3(6, 0, 6), 40, 2.2f);
            FreePacks.Spawn("weapon-rack", root, c + new Vector3(-5, 0, 5), 90, 1.8f);
            FreePacks.Spawn(sword, root, c + new Vector3(-5.4f, 0, 5), 90, 1.2f);
            FreePacks.Spawn("banner", root, c + new Vector3(0, 0, -7.4f), 0, 2.4f);
            FreePacks.Spawn("trophy", root, c + new Vector3(4.5f, 0, -3), 0, 1.1f);
            FreePacks.Prefab("Assets/Prefabs/Stairs.prefab", root, c + new Vector3(0, 0, -10), 0);
            FreePacks.Spawn(tower, root, c + new Vector3(10, 0, 0), 0, 4.5f);
            FreePacks.Spawn(tower, root, c + new Vector3(-10, 0, 0), 0, 4.5f);
        }

        void DressEmbassy(GateDef gate, Vector3 p, float yaw)
        {
            var outDir = p.normalized;
            var outPos = p + outDir * 8.5f;
            var side = Vector3.Cross(Vector3.up, outDir);
            GameObject shell = null;
            string plan = "embassy";
            switch (gate.world)
            {
                case WorldId.Ruins:
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Ruins), root, outPos, yaw, 5.5f);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Ruins), root, outPos + side * 3.4f, yaw, 2.4f, required: false);
                    plan = "archive";
                    break;
                case WorldId.Tunya:
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Tunya), root, outPos, yaw, 4.2f);
                    FreePacks.Spawn(DressVocab.FirstStem(new[] { "Crops", "Wheat" }, "crops_wheatStageB"), root, outPos + side * 3.2f, yaw, 1.2f);
                    FreePacks.Spawn(DressVocab.Grass(WorldId.Tunya), root, outPos + side * 4.4f, yaw + 15f, 1.2f, required: false);
                    break;
                case WorldId.Fantasy:
                    FreePacks.Spawn(DressVocab.Tree(WorldId.Fantasy), root, outPos + side * 2.8f, yaw, 9f, required: false);
                    FreePacks.Spawn(DressVocab.Tree(WorldId.Fantasy), root, outPos - side * 3.1f, yaw + 40f, 7.5f, required: false);
                    shell = FreePacks.Spawn(DressVocab.Tower(WorldId.Fantasy), root, outPos, yaw, 7.2f, required: false);
                    break;
                case WorldId.Crime:
                    FreePacks.Spawn(DressVocab.Cart(), root, outPos, yaw + 20f, 2.2f);
                    FreePacks.Spawn(DressVocab.Crate(), root, outPos + side * 2.2f, yaw, 0.9f);
                    FreePacks.Spawn(DressVocab.Prop(WorldId.Crime), root, outPos - side * 1.8f, yaw, 0.8f);
                    FreePacks.Spawn(DressVocab.Crate(), root, outPos + outDir * 1.6f, 15f, 0.9f, required: false);
                    plan = "market";
                    break;
                case WorldId.Cyber:
                    FreePacks.Spawn(DressVocab.Column(WorldId.Cyber), root, outPos + side * 2.4f, yaw, 3.2f);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Cyber), root, outPos - side * 2.4f, yaw, 3.2f);
                    HubLook.Lantern(root, outPos);
                    shell = FreePacks.Spawn(DressVocab.House(WorldId.Cyber), root, outPos + outDir * 1.2f, yaw, 6.4f, required: false);
                    break;
                case WorldId.Frontier:
                    for (int i = 0; i < 5; i++)
                    {
                        var rp = p + outDir * (6f + i * 4.2f);
                        FreePacks.Spawn("road-straight", root, rp, yaw + 90f, 5.5f, required: false, byHeight: false);
                    }
                    PlaceStone(outPos + side * 2.6f, "No embassy",
                        "The frontier keeps no seat. The road is their door. To claim a fixed house here would be to accept a dome.");
                    return;
                case WorldId.Superhero:
                    shell = FreePacks.Spawn(DressVocab.Tower(WorldId.Superhero), root, outPos, yaw, 8.5f);
                    plan = "tower";
                    break;
                case WorldId.Crucible:
                    FreePacks.Spawn(DressVocab.Rock(), root, outPos + side * 2.1f, yaw, 1.2f, required: false);
                    FreePacks.Spawn(DressVocab.Rock(), root, outPos - side * 1.6f, yaw, 1.0f, required: false);
                    FreePacks.Spawn(DressVocab.Column(WorldId.Crucible), root, outPos, yaw, 3.2f, required: false);
                    break;
            }
            if (shell) BuildingInterior.Open(shell, plan, outPos);
        }

        void DressTavern(Vector3 p)
        {
            FreePacks.Spawn(DressVocab.Table(), root, p + new Vector3(3.2f, 0, 2), 20, 1.4f);
            FreePacks.Spawn(DressVocab.Chair(), root, p + new Vector3(2.4f, 0, 2.4f), 40, 0.9f);
            FreePacks.Spawn(DressVocab.Chair(), root, p + new Vector3(3.8f, 0, 1.5f), 200, 0.9f);
            FreePacks.Spawn("loungeSofa", root, p + new Vector3(4.6f, 0, 0.4f), 90, 1.6f);
            FreePacks.Spawn("lampRoundFloor", root, p + new Vector3(5.2f, 0, 2.2f), 0, 1.4f);
            CookStation.Stamp(FreePacks.Spawn("kitchenStove", root, p + new Vector3(-2.4f, 0, 2.2f), 0, 1.2f));
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, p + new Vector3(2.0f, 0, -1.5f), 0, 0.8f);
            FreePacks.Spawn("burger-cheese", root, p + new Vector3(3.2f, 0.9f, 2), 0, 0.25f);
        }

        void DressForge(Vector3 p)
        {
            FreePacks.Spawn("campfire_stones", root, p + new Vector3(3, 0, 2), 0, 1.6f);
            FreePacks.Spawn("campfire_logs", root, p + new Vector3(3, 0, 2), 0, 1.2f);
            FreePacks.Spawn("weapon-rack", root, p + new Vector3(-2, 0, 2), 90, 1.8f);
            FreePacks.Spawn(DressVocab.Weapon("sword"), root, p + new Vector3(2, 0, -1), 0, 1.1f);
        }

        void DressArchive(Vector3 p)
        {
            FreePacks.Spawn("bookcaseOpen", root, p + new Vector3(3, 0, 1), 90, 2.2f);
            FreePacks.Spawn("bookcaseClosed", root, p + new Vector3(3.6f, 0, -1), 90, 2.2f);
            FreePacks.Spawn("desk", root, p + new Vector3(-2, 0, 2), 0, 1.6f);
            FreePacks.Spawn("chairDesk", root, p + new Vector3(-2, 0, 1.2f), 0, 0.9f);
            FreePacks.Spawn("books", root, p + new Vector3(-1.5f, 0.9f, 2), 0, 0.4f);
        }

        void DressMarket(Vector3 p)
        {
            FreePacks.Spawn(DressVocab.Crate(), root, p + new Vector3(3, 0, 1), 0, 0.9f);
            FreePacks.Spawn(DressVocab.Prop(WorldId.Hub), root, p + new Vector3(2.2f, 0, 2), 0, 0.9f);
            FreePacks.Spawn(DressVocab.Crate(), root, p + new Vector3(4, 0, 0), 15, 0.9f);
            FreePacks.Spawn("detail-parasol-a", root, p + new Vector3(3.5f, 0, 2.5f), 0, 2.8f);
            FreePacks.Spawn("apple", root, p + new Vector3(3, 0.7f, 1), 0, 0.2f);
            FreePacks.Spawn("bread", root, p + new Vector3(3.4f, 0.7f, 1.2f), 0, 0.25f);
            FreePacks.Spawn("cheese-cut", root, p + new Vector3(2.6f, 0.7f, 1.4f), 0, 0.2f);
            FreePacks.Spawn(DressVocab.Cart(), root, p + new Vector3(-3, 0, 2), 40, 2.2f);
        }

        void DressRoads()
        {
            for (int i = 0; i < 8; i++)
            {
                var a = (i / 8f) * Mathf.PI * 2 + 0.4f;
                var r = 24f;
                FreePacks.Spawn("road-straight", root,
                    new Vector3(Mathf.Cos(a) * r, 0, Mathf.Sin(a) * r),
                    -a * Mathf.Rad2Deg + 90, 6.5f);
            }
            FreePacks.Spawn("road-straight-lightposts", root, new Vector3(14, 0, 4), 90, 6.5f);
        }

        void DressCityRing()
        {
            for (int i = 0; i < 22; i++)
            {
                var a = (i / 22f) * Mathf.PI * 2 + 0.12f;
                if (Mathf.Sin(a) > 0.55f && Mathf.Abs(Mathf.Cos(a)) < 0.78f) continue;
                var rad = 56f + (i % 3) * 6f;
                var pos = new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad);
                var yaw = Mathf.Atan2(-Mathf.Cos(a), -Mathf.Sin(a)) * Mathf.Rad2Deg;
                if (i % 5 == 0)
                    FreePacks.Spawn(Shops[i % Shops.Length], root, pos, yaw, 9f, required: false, byHeight: true);
                else
                    FreePacks.Spawn(Houses[i % Houses.Length], root, pos, yaw, 6.5f, required: false, byHeight: true);
            }
            EvoCatalog.Spawn(EvoCatalog.SmallA, root, new Vector3(52, 0, 18), Quaternion.Euler(0, 70, 0), 1f);
            EvoCatalog.Spawn(EvoCatalog.Garage, root, new Vector3(48, 0, -12), Quaternion.Euler(0, 90, 0), 1f);
        }

        void DressForest()
        {
            for (int i = 0; i < 40; i++)
            {
                var a = (i / 40f) * Mathf.PI * 2 + 0.51f;
                if (Mathf.Sin(a) > 0.62f) continue;
                var rad = 28 + (i % 4) * 3.4f;
                FreePacks.Spawn(ForestTrees[i % ForestTrees.Length], root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 17f, 4.5f);
                if (i % 3 == 0)
                    FreePacks.Spawn("plant_bush", root,
                        new Vector3(Mathf.Cos(a + 0.08f) * (rad - 2), 0, Mathf.Sin(a + 0.08f) * (rad - 2)), 0, 1.2f);
            }
            FreePacks.Spawn("campfire_logs", root, new Vector3(22, 0, 18), 0, 1.4f);
            FreePacks.Spawn("log_large", root, new Vector3(24, 0, 16), 40, 2.2f);
            EvoCatalog.Spawn(EvoCatalog.Grass, root, new Vector3(22, 0, 18), Quaternion.identity, 1f);
        }

        void DressCliffs()
        {
            for (int i = 0; i < 16; i++)
            {
                var a = (i / 16f) * Mathf.PI * 2 + 0.1f;
                var rad = 52f;
                var stem = i % 2 == 0 ? "cliff_large_rock" : "rocks-large";
                FreePacks.Spawn(stem, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), a * Mathf.Rad2Deg, 6f);
            }
        }

        void DressGuests()
        {
            foreach (var n in Canon.HubGuests)
            {
                var look = Appearance.Random(n.id.GetHashCode());
                look.displayName = n.name;
                look.height = Mathf.Clamp(n.height / 1.8f, 0.88f, 1.14f);
                string weapon = null, off = null;
                var job = NpcLife.Job.Wander;
                switch (n.id)
                {
                    case "warden": weapon = "spear"; off = "shield-rectangle"; job = NpcLife.Job.Watch; look.outfit = 1; look.attitude = 2; break;
                    case "lamplighter": weapon = "staff"; job = NpcLife.Job.Sweep; look.outfit = 0; look.attitude = 3; break;
                    case "elias": weapon = "dagger"; look.outfit = 5; look.attitude = 1; break;
                    case "vesper": weapon = "staff"; look.outfit = 0; look.attitude = 3; break;
                    case "seraphine": weapon = "dagger"; look.outfit = 4; look.attitude = 2; break;
                    case "jax": weapon = "shortsword"; look.outfit = 5; look.attitude = 1; break;
                    case "mama": weapon = "mace"; job = NpcLife.Job.Stall; look.outfit = 4; look.attitude = 3; break;
                    case "zero": weapon = "wand"; look.outfit = 2; look.attitude = 0; break;
                    case "nyx": weapon = "dagger"; look.outfit = 2; look.attitude = 1; break;
                    case "thorne": weapon = "greatsword"; look.outfit = 1; look.attitude = 2; look.height = 1.12f; break;
                    case "lyra": weapon = "staff"; look.outfit = 0; look.attitude = 0; break;
                    case "asbir": weapon = "staff"; job = NpcLife.Job.Watch; look.outfit = 0; look.attitude = 0; break;
                    case "brackish": job = NpcLife.Job.Wander; look.outfit = 5; look.attitude = 1; look.height = 0.9f; break;
                    case "oldseam": job = NpcLife.Job.Sweep; look.outfit = 1; look.attitude = 3; break;
                }
                var wander = job == NpcLife.Job.Wander;
                var go = ModularPerson.SpawnNpc(root, new Vector3(n.x, 0, n.z), 180f, look, wander, n.id == "warden" ? 5f : 10f);
                go.name = n.name;
                if (!string.IsNullOrEmpty(weapon)) CharacterGear.Attach(go, DressVocab.Weapon(weapon), true, 0.95f);
                if (!string.IsNullOrEmpty(off)) CharacterGear.Attach(go, off, false, 0.7f);
                var guest = go.AddComponent<GuestNpc>();
                guest.def = n;
                guest.personId = n.id;
                var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
                life.job = job;
            }
        }

        void DressPillars()
        {
            foreach (var n in Canon.Pillars)
            {
                var look = new Appearance
                {
                    displayName = n.name,
                    height = Mathf.Clamp(n.height / 1.8f, 0.95f, 1.16f),
                    width = 1f,
                    shoulders = n.id == "sovereign" ? 1.18f : 1f,
                    chest = 1f,
                    hips = 1f,
                    head = 1f,
                    jaw = n.id == "sovereign" ? 1.12f : 1f
                };
                float yaw;
                if (n.id == "concordia")
                {
                    look.skin = 0.34f;
                    look.hairHue = 0.07f;
                    look.hairSat = 0.55f;
                    look.hairVal = 0.12f;
                    look.outfit = 0;
                    look.attitude = 3;
                    look.hairStyle = 4;
                    yaw = 0f;
                }
                else if (n.id == "concord")
                {
                    look.skin = 0.86f;
                    look.hairHue = 0.58f;
                    look.hairSat = 0.08f;
                    look.hairVal = 0.22f;
                    look.outfit = 1;
                    look.attitude = 0;
                    look.hairStyle = 0;
                    yaw = 180f;
                }
                else
                {
                    look.skin = 0.26f;
                    look.hairHue = 0.04f;
                    look.hairSat = 0.35f;
                    look.hairVal = 0.08f;
                    look.outfit = 5;
                    look.attitude = 1;
                    look.hairStyle = 1;
                    yaw = 90f;
                }
                var go = ModularPerson.SpawnNpc(root, new Vector3(n.x, 0, n.z), yaw, look, false);
                go.name = n.name;
                var guest = go.AddComponent<GuestNpc>();
                guest.def = n;
                guest.personId = n.id;
                var life = go.GetComponent<NpcLife>() ?? go.AddComponent<NpcLife>();
                life.job = NpcLife.Job.Watch;
                life.pinned = true;
            }
        }

        void DressGrove()
        {
            var oak = DressVocab.Tree(WorldId.Tunya);
            var grass = DressVocab.Grass(WorldId.Tunya);
            for (int i = 0; i < 18; i++)
            {
                var a = (i / 18f) * Mathf.PI * 1.1f + 3.4f;
                var rad = 36 + (i % 4) * 3.2f;
                var h = 9f + (i % 5) * 1.4f;
                FreePacks.Spawn(oak, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 21f, h);
            }
            for (int i = 0; i < 40; i++)
            {
                var a = (i / 40f) * Mathf.PI * 2;
                if (a > 1.1f && a < 2.1f) continue;
                var rad = 14.5f + (i % 5) * 1.7f;
                FreePacks.Spawn(grass, root,
                    new Vector3(Mathf.Cos(a) * rad, 0, Mathf.Sin(a) * rad), i * 40f, 0.55f);
            }
        }

        void BuildRealm(WorldDef w)
        {
            ReturnPortal(w);
            var lore = WorldBook.Lore(w.id);
            var stone = MakeBox("Waystone", new Vector3(2.2f, 0, 1.4f), new Vector3(0.7f, 2.1f, 0.7f), w.sun);
            var ls = stone.AddComponent<LoreStone>();
            ls.title = string.IsNullOrEmpty(lore.world_name) ? w.title : lore.world_name;
            var desc = string.IsNullOrEmpty(lore.world_description) ? w.law : lore.world_description;
            ls.text = desc + "\n\n" + w.law + " Live steel is allowed here. Flower-law is the Unburned Court only.";

            ModularPerson.CastingWorld = w.id;
            WorldKit.Build(root, w);
            RealmFill.Populate(root, w.id);
            StoreDress.Realm(root, w);
            var dummy = FreePacks.Spawn(DressVocab.Dummy(), root, new Vector3(4, 0, 8), 180, 1.85f);
            if (dummy)
            {
                FreePacks.EnsureCollider(dummy);
                dummy.AddComponent<TrainingDummy>().unburied = w.id == WorldId.Ruins || w.id == WorldId.Crucible;
                dummy.AddComponent<Hostile>().damage = 11f;
            }
        }

        void ReturnPortal(WorldDef w)
        {
            var p = new Vector3(0f, 0f, -12f);
            var hold = new GameObject("Gate_HUB").transform;
            hold.SetParent(root, false);
            hold.position = p;
            hold.rotation = Quaternion.LookRotation(Vector3.forward);
            var bronze = HubLook.Lit(new Color(0.55f, 0.32f, 0.14f), 0.7f, 0.45f);
            var gold = HubLook.Lit(new Color(0.78f, 0.58f, 0.22f), 0.85f, 0.7f);
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(-3.2f, 5f, 0f), new Vector3(1.2f, 10f, 1.6f), bronze, "PillarL");
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(3.2f, 5f, 0f), new Vector3(1.2f, 10f, 1.6f), bronze, "PillarR");
            HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 10.2f, 0f), new Vector3(8f, 1.4f, 1.8f), gold, "Lintel");
            var portal = HubLook.Prim(hold, PrimitiveType.Cylinder, Vector3.zero, new Vector3(5.2f, 0.12f, 8.5f), HubLook.Emit(Canon.Hex("d8c8a8"), 3.2f), "Portal", false);
            portal.transform.localPosition = new Vector3(0f, 4.6f, 0.15f);
            portal.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var label = new GameObject("Name").AddComponent<TextMesh>();
            label.transform.SetParent(hold, false);
            label.transform.localPosition = new Vector3(0f, 11.4f, 0.2f);
            label.text = "THE HUB";
            label.fontSize = 48;
            label.characterSize = 0.11f;
            label.anchor = TextAnchor.MiddleCenter;
            label.alignment = TextAlignment.Center;
            label.color = Color.white;
            HubLook.DressTextMesh(label);
            var go = hold.gameObject;
            go.AddComponent<WorldGate>().def = new GateDef
            {
                world = WorldId.Hub,
                name = "The Unburned Court",
                shortName = "HUB",
                refusal = "You cannot own the heart.",
                theNo = "Walk it.",
                color = Canon.Hex("d8c8a8")
            };
            var box = go.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 2f, 0f);
            box.size = new Vector3(6.4f, 5f, 2.2f);
            box.isTrigger = true;
        }

        void DressLore()
        {
            PlaceStone(new Vector3(4.8f, 0f, -3.2f), "The Ground She Made Hers",
                "Dig far enough beneath any district and you reach the same thing: Concordia, listening. The hub is not built on her. It is built of her.");
            PlaceStone(new Vector3(-5.1f, 0f, -2.4f), "The Ring of Doors",
                "Eight gates around the old battlefield, left unpaved. They still call it the Unburned Court, though nothing there ever burned.");
            PlaceStone(new Vector3(0.4f, 0f, 6.6f), "The Night Someone Tried",
                "They held the Court four hours. Then the ground spoke in flowers. No one died. You cannot own the heart.");
            PlaceStone(new Vector3(8.2f, 0f, 2.1f), "Flower-law",
                "No live steel in the Court. Blades die as flowers — except in the Arena sand, where the Warden keeps poise, not luck.");
            PlaceStone(new Vector3(-7.4f, 0f, 3.2f), "The Ninth",
                "Lyra will not teach a ninth Refusal. It is not spoken. It is stood upon. I refuse to let my own refusal win.");
            DressSereWaystone();
        }

        void DressSereWaystone()
        {
            // Not a ninth Refusal door. Sere is extra-canonical satire —
            // the First Launch Cradle from the authored Concord Link anchor.
            var p = new Vector3(14.2f, 0f, -18.4f);
            PlaceStone(p, "The First Launch Cradle",
                "The scorched gantry-field the seven arks left from. Cold for generations. Sere is not on the Ring. No Refusal ever held there.");
            var go = new GameObject("Waystone_Sere");
            go.transform.SetParent(root, false);
            go.transform.position = p + Vector3.up * 0.2f;
            go.AddComponent<WorldGate>().def = new GateDef
            {
                world = WorldId.Sere,
                name = "The First Launch Cradle",
                shortName = "SERE",
                refusal = "No Refusal ever held here.",
                theNo = "The seven arks left from this soil.",
                color = Canon.Hex("8a7a3a")
            };
            var box = go.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 1.2f, 0f);
            box.size = new Vector3(2.8f, 2.4f, 2.2f);
            box.isTrigger = true;
        }

        void PlaceStone(Vector3 pos, string title, string text)
        {
            var plinth = HubLook.Prim(root, PrimitiveType.Cube, pos + Vector3.up * 0.45f, new Vector3(0.85f, 0.9f, 0.22f),
                HubLook.Lit(new Color(0.42f, 0.32f, 0.18f), 0.08f, 0.22f), "Lore_" + title.Replace(" ", ""));
            var stone = plinth.AddComponent<LoreStone>();
            stone.title = title;
            stone.text = text;
            HubLook.Prim(root, PrimitiveType.Cube, pos + Vector3.up * 0.08f, new Vector3(1.1f, 0.12f, 0.4f),
                HubLook.Lit(new Color(0.28f, 0.18f, 0.08f), 0.05f, 0.18f), "LoreBase_" + title.Replace(" ", ""), false);
        }

        void SpawnFauna(WorldDef w)
        {
            if (w.id != WorldId.Hub)
            {
                if (w.fauna == null) return;
                for (int i = 0; i < Mathf.Min(6, w.fauna.Length * 2); i++)
                {
                    var a = i / 6f * Mathf.PI * 2f;
                    var p = new Vector3(Mathf.Cos(a) * 18f, 0f, Mathf.Sin(a) * 18f);
                    var stem = i % 2 == 0 ? "rabbit" : "dog";
                    if (!FreePacks.Spawn(stem, root, p, a * Mathf.Rad2Deg, 1.2f))
                    {
                        var go = HubLook.Prim(root, PrimitiveType.Sphere, p + Vector3.up * 0.35f, Vector3.one * 0.45f,
                            HubLook.Lit(new Color(0.45f, 0.35f, 0.25f)), "Beast" + i);
                        go.AddComponent<CourtBird>().height = 0.4f;
                    }
                }
                DressGroveBirds(w);
                return;
            }
            for (int i = 0; i < 24; i++)
            {
                var go = new GameObject("Dove" + i);
                go.transform.SetParent(root, false);
                var bird = go.AddComponent<CourtBird>();
                bird.seed = 40 + i * 13;
                bird.radius = 10f + (i % 5) * 3.2f;
                bird.height = 6.5f + (i % 4) * 1.4f;
            }
        }

        void DressGroveBirds(WorldDef w)
        {
            if (w.id != WorldId.Tunya && w.id != WorldId.Fantasy) return;
            var bird = DressVocab.Bird();
            if (string.IsNullOrEmpty(bird)) return;
            for (int i = 0; i < 3; i++)
            {
                float a = i / 3f * Mathf.PI * 2f + 0.3f;
                FreePacks.Spawn(bird, root, new Vector3(Mathf.Cos(a) * 9f, 0f, Mathf.Sin(a) * 9f), a * Mathf.Rad2Deg, 0.28f);
            }
        }

        void PlaceLandmark(string path, Vector3 pos, float height, string plan)
        {
            var go = EvoCatalog.Spawn(path, root, pos, Quaternion.identity, 1f, height);
            BuildingInterior.Open(go, plan, pos);
        }

        GameObject MakeBox(string name, Vector3 pos, Vector3 size, Color c)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.position = pos + Vector3.up * (size.y * 0.5f);
            go.transform.localScale = size;
            Tint(go, c);
            return go;
        }

        GameObject MakeCapsule(string name, Vector3 pos, float h, Color c)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Capsule);
            go.name = name;
            go.transform.SetParent(root, false);
            go.transform.position = pos + Vector3.up * (h * 0.5f);
            go.transform.localScale = new Vector3(0.45f, h * 0.5f, 0.45f);
            Tint(go, c);
            return go;
        }

        static void Tint(GameObject go, Color c)
        {
            var r = go.GetComponent<Renderer>();
            if (!r) return;
            r.sharedMaterial = HubLook.Lit(c, 0.04f, 0.22f);
        }

        static void TintFallback(GameObject go, Color c)
        {
            var r = go.GetComponent<Renderer>();
            if (!r || r.sharedMaterial == null) Tint(go, c);
        }
    }
}
