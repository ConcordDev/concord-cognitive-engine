using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// One walkable town per authored city: streets, enterable buildings, a gate.
    /// Geometry is Kenney; the name and text are canon.
    /// </summary>
    public static class CityTown
    {
        public static void BuildAll(Transform root, WorldDef w)
        {
            if (w.id == WorldId.Hub) return;
            var cities = CityAtlas.For(w.id);
            for (int i = 0; i < cities.Length; i++)
                Build(root, w, cities[i], i);
            try
            {
                System.IO.File.WriteAllText("/tmp/concordia-atlas.txt",
                    System.DateTime.Now.ToString("o") + "\n" + CityAtlas.Dump());
            }
            catch { }
        }

        public static void Build(Transform root, WorldDef w, CityDef city, int i)
        {
            var p = new Vector3(city.x, 0f, city.z);
            var inward = -p;
            inward.y = 0f;
            if (inward.sqrMagnitude < 0.2f) inward = Vector3.back;
            inward.Normalize();
            var yaw = Mathf.Atan2(-inward.x, -inward.z) * Mathf.Rad2Deg;
            var hold = new GameObject("City_" + city.id).transform;
            hold.SetParent(root, false);
            hold.position = p;
            hold.rotation = Quaternion.Euler(0f, yaw, 0f);

            var kit = Kit(w.id);
            var plans = Plans(w.id);
            Vector3[] slots =
            {
                new Vector3(-5.2f, 0f, 3.4f),
                new Vector3(5.2f, 0f, 3.6f),
                new Vector3(-6.4f, 0f, -2.2f),
                new Vector3(6.2f, 0f, -2.4f),
                new Vector3(0f, 0f, 6.8f),
                new Vector3(0f, 0f, -7.2f)
            };
            for (int s = 0; s < slots.Length; s++)
            {
                var local = slots[s];
                var world = hold.TransformPoint(local);
                var stem = kit[s % kit.Length];
                float h = stem.Contains("skyscraper") ? 14f : stem.Contains("tent") ? 3.4f : 6.2f;
                var go = FreePacks.Spawn(stem, hold, world, yaw + (s % 2 == 0 ? 0f : 180f), h, required: false);
                if (go) BuildingInterior.Open(go, plans[s % plans.Length], world);
            }

            FreePacks.Spawn("road-straight", hold, hold.TransformPoint(new Vector3(0f, 0f, -10.5f)), yaw + 90f, 5.2f, false, false);
            FreePacks.Spawn("road-straight", hold, hold.TransformPoint(new Vector3(0f, 0f, 0f)), yaw + 90f, 5.2f, false, false);
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(-2.4f, 0f, -4.2f)));
            HubLook.Lantern(hold, hold.TransformPoint(new Vector3(2.4f, 0f, 4.2f)));

            var plaque = HubLook.Prim(hold, PrimitiveType.Cube, new Vector3(0f, 1.1f, -8.6f),
                new Vector3(1.15f, 1.7f, 0.16f), HubLook.Lit(w.sun, 0.25f, 0.4f), "Plaque");
            var stone = plaque.AddComponent<LoreStone>();
            stone.title = city.name;
            var body = city.description ?? "";
            if (city.districts != null && city.districts.Length > 1)
                body += "\n\nStreets: " + string.Join(", ", TitleDistricts(city.districts));
            if (body.Length > 800) body = body.Substring(0, 797) + "…";
            stone.text = body;

            var gateGo = new GameObject("CityGate_" + city.id);
            gateGo.transform.SetParent(hold, false);
            gateGo.transform.localPosition = new Vector3(0f, 0f, -9.2f);
            var gate = gateGo.AddComponent<CityGate>();
            gate.city = city;
            var box = gateGo.AddComponent<BoxCollider>();
            box.center = new Vector3(0f, 1.2f, 0f);
            box.size = new Vector3(4.2f, 2.6f, 2.4f);
            box.isTrigger = true;
        }

        static string[] TitleDistricts(string[] raw)
        {
            var outp = new string[raw.Length];
            for (int i = 0; i < raw.Length; i++) outp[i] = CityAtlas.Titleize(raw[i]);
            return outp;
        }

        static string[] Kit(WorldId id) => id switch
        {
            WorldId.Ruins => new[] { "crypt-a", "crypt-small", "column-large", "crypt-large", "altar-stone", "gravestone" },
            WorldId.Tunya => new[] { "tent_detailedOpen", "tent_smallOpen", "tree_oak", "building-small-a", "crops_cornStageD", "tent_detailedOpen" },
            WorldId.Fantasy => new[] { "building-small-b", "tower-square-base", "hedge-large", "building-small-c", "statue", "tower-square-base" },
            WorldId.Crime => new[] { "building-type-h", "building-type-c", "building-d", "building-small-d", "dumpster", "building-type-h" },
            WorldId.Cyber => new[] { "building-skyscraper-a", "corridor_end", "building-skyscraper-c", "detail-overhang-wide", "column", "building-skyscraper-a" },
            WorldId.Frontier => new[] { "tent_detailedOpen", "cart", "palm-straight", "tent_smallOpen", "barrel", "cart" },
            WorldId.Superhero => new[] { "building-skyscraper-d", "building-type-a", "building-skyscraper-b", "building-small-d", "building-type-a", "building-skyscraper-d" },
            WorldId.Sere => new[] { "building-d", "building-type-h", "building-skyscraper-e", "building-small-c", "dumpster", "building-d" },
            _ => new[] { "detail-crystal-large", "tower-hexagon-mid", "column-large", "crypt-small", "tower-hexagon-base", "detail-crystal-large" }
        };

        static string[] Plans(WorldId id) => id switch
        {
            WorldId.Tunya => new[] { "market", "tavern", "archive", "market", "tavern", "archive" },
            WorldId.Crime => new[] { "market", "tavern", "archive", "market", "tavern", "tower" },
            WorldId.Cyber => new[] { "tower", "archive", "tower", "archive", "tower", "embassy" },
            WorldId.Superhero => new[] { "tower", "archive", "tower", "tavern", "embassy", "tower" },
            WorldId.Sere => new[] { "archive", "market", "tower", "tavern", "archive", "market" },
            _ => new[] { "archive", "tavern", "market", "embassy", "archive", "tavern" }
        };
    }
}
