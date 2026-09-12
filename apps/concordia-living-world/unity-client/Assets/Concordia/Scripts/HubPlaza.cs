using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Unburned Court: plaza floor, monument, and gates from imported packs only.
    /// No primitive ring-city, no floating dome cubes. One missing-prop if a mesh is gone.
    /// </summary>
    public static class HubPlaza
    {
        public static void Build(Transform root)
        {
            Floor(root);
            Monument(root);
            Gates(root);
            Clutter(root);
            Dust(root, new Color(1f, 0.88f, 0.62f));
            HubLook.Point(root, "MonumentLight", new Vector3(0f, 4.2f, 0f), new Color(1f, 0.72f, 0.42f), 2.2f, 14f, true);
            HubLook.Point(root, "RimWarm", new Vector3(18f, 4f, -12f), new Color(1f, 0.55f, 0.28f), 1.1f, 16f, false);
            HubLook.Point(root, "RimCool", new Vector3(-16f, 5f, 14f), new Color(0.42f, 0.52f, 0.62f), 0.85f, 14f, false);
        }

        static void Floor(Transform root)
        {
            int placed = 0;
            const float step = 5.6f;
            const float extent = 32f;
            for (float x = -extent; x <= extent; x += step)
            for (float z = -extent; z <= extent; z += step)
            {
                if (x * x + z * z > (extent + 1f) * (extent + 1f)) continue;
                var p = new Vector3(x, 0f, z);
                var tile = FreePacks.SpawnStore("granite_panel", root, p, 0f, 5.4f, required: false, byHeight: false)
                           ?? FreePacks.SpawnStore("platform.001", root, p, 0f, 5.4f, required: false, byHeight: false)
                           ?? FreePacks.SpawnStore("platform", root, p, 0f, 5.4f, required: false, byHeight: false);
                if (!tile) continue;
                tile.name = "CourtTile_" + placed;
                placed++;
            }
            if (placed == 0)
                FreePacks.SpawnStore("plaza_floor", root, Vector3.zero, 0f, 0.35f, required: true, byHeight: false);

            var arena = FreePacks.SpawnStore("granite_panel", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform.001", root, Canon.Arena, 0f, 8f, required: false, byHeight: false)
                        ?? FreePacks.SpawnStore("platform", root, Canon.Arena, 0f, 8f, required: true, byHeight: false);
            if (arena) arena.name = "Arena";
        }

        static void Monument(Transform root)
        {
            var col = FreePacks.SpawnStore("stone_column", root, Vector3.zero, 0f, 5.8f, required: false)
                      ?? FreePacks.SpawnStore("stone_column.001", root, Vector3.zero, 0f, 5.8f, required: true);
            if (col)
            {
                col.name = "Monument";
                UsePlace.Stamp(col, "Commune", "The Court does not speak first. You came anyway.");
            }
            FreePacks.SpawnStore("furnace", root, new Vector3(1.8f, 0f, 0.6f), 25f, 1.6f, required: false);
            FreePacks.SpawnStore("cauldron", root, new Vector3(-1.6f, 0f, 0.8f), -18f, 1.1f, required: false);
        }

        static void Gates(Transform root)
        {
            foreach (var gate in Canon.Gates)
            {
                var p = new Vector3(Mathf.Cos(gate.angle) * Canon.RingRadius, 0f, Mathf.Sin(gate.angle) * Canon.RingRadius);
                var inward = -p.normalized;
                var yaw = Quaternion.LookRotation(inward);
                var hold = new GameObject("Gate_" + gate.shortName).transform;
                hold.SetParent(root, false);
                hold.position = p;
                hold.rotation = yaw;

                var arch = FreePacks.SpawnStore("stone_half_gate", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 8.5f, required: false)
                           ?? FreePacks.SpawnStore("stone_half_gate.001", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 8.5f, required: false)
                           ?? FreePacks.SpawnStore("wood_gate", hold, hold.TransformPoint(Vector3.zero), hold.eulerAngles.y, 6.5f, required: true);
                if (arch)
                {
                    FreePacks.StripColliders(arch);
                    arch.transform.SetParent(hold, true);
                }

                var portalCol = PortalColor(gate);
                Swirl(hold, new Vector3(0f, 2.4f, 0.2f), portalCol);

                var label = new GameObject("Name").AddComponent<TextMesh>();
                label.transform.SetParent(hold, false);
                label.transform.localPosition = new Vector3(0f, 6.4f, 0.2f);
                label.transform.localRotation = Quaternion.identity;
                label.text = gate.shortName;
                label.fontSize = 48;
                label.characterSize = 0.12f;
                label.anchor = TextAnchor.MiddleCenter;
                label.alignment = TextAlignment.Center;
                label.color = Color.Lerp(portalCol, Color.white, 0.35f);
                label.fontStyle = FontStyle.Bold;
                HubLook.DressTextMesh(label);

                var go = hold.gameObject;
                go.AddComponent<WorldGate>().def = gate;
                var box = go.AddComponent<BoxCollider>();
                box.center = new Vector3(0f, 2f, 0f);
                box.size = new Vector3(7.2f, 5f, 2.4f);
                box.isTrigger = true;

                var plaque = FreePacks.SpawnStore("granite_panel", hold, hold.TransformPoint(new Vector3(3.4f, 0f, 0.4f)), hold.eulerAngles.y, 1.2f, required: false);
                var loreHost = plaque ? plaque : go;
                var stone = loreHost.GetComponent<LoreStone>() ?? loreHost.AddComponent<LoreStone>();
                stone.title = gate.name;
                stone.text = gate.refusal + " — " + gate.theNo;

                if (gate.world == WorldId.Frontier || gate.world == WorldId.Cyber)
                    HubLook.Point(hold, "PortalFill", hold.TransformPoint(new Vector3(0f, 4f, 1.2f)), portalCol, 0.55f, 16f, false);

                var flag = FreePacks.SpawnStore("flag-banner-long", hold, hold.TransformPoint(new Vector3(0f, 0f, -0.6f)), hold.eulerAngles.y, 3.2f, required: false)
                           ?? FreePacks.Spawn("flag-banner-long", hold, hold.TransformPoint(new Vector3(0f, 0f, -0.6f)), hold.eulerAngles.y, 3.2f, required: false);
                if (flag)
                {
                    FreePacks.StripColliders(flag);
                    FreePacks.DyeCloth(flag, Color.Lerp(portalCol, new Color(0.55f, 0.22f, 0.16f), 0.4f));
                }
            }
        }

        static Color PortalColor(GateDef gate)
        {
            if (gate.world == WorldId.Frontier) return new Color(0.35f, 0.7f, 1f);
            if (gate.world == WorldId.Cyber) return new Color(0.25f, 0.95f, 0.45f);
            return gate.color;
        }

        static void Swirl(Transform parent, Vector3 local, Color c)
        {
            var go = new GameObject("Swirl");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = local;
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.startLifetime = 1.2f;
            main.startSpeed = 0.04f;
            main.startSize = 0.05f;
            main.startColor = new Color(c.r, c.g, c.b, 0.35f);
            main.maxParticles = 22;
            main.simulationSpace = ParticleSystemSimulationSpace.Local;
            var em = ps.emission;
            em.rateOverTime = 7f;
            var sh = ps.shape;
            sh.shapeType = ParticleSystemShapeType.Circle;
            sh.radius = 0.42f;
            var vol = ps.velocityOverLifetime;
            vol.enabled = true;
            vol.orbitalZ = 1.4f;
            vol.radial = -0.18f;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(
                new[] { new GradientColorKey(c, 0f), new GradientColorKey(Color.Lerp(c, Color.white, 0.35f), 1f) },
                new[] { new GradientAlphaKey(0f, 0f), new GradientAlphaKey(0.28f, 0.3f), new GradientAlphaKey(0f, 1f) });
            col.color = g;
            var r = go.GetComponent<ParticleSystemRenderer>();
            if (r) r.sharedMaterial = HubLook.ParticleMat(c, false);
        }

        static void Dust(Transform parent, Color c)
        {
            var go = new GameObject("Dust");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(0f, 4f, 0f);
            var ps = go.AddComponent<ParticleSystem>();
            var main = ps.main;
            main.startLifetime = 6f;
            main.startSpeed = 0.08f;
            main.startSize = 0.05f;
            main.startColor = new Color(c.r, c.g, c.b, 0.16f);
            main.maxParticles = 28;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var em = ps.emission;
            em.rateOverTime = 3f;
            var sh = ps.shape;
            sh.shapeType = ParticleSystemShapeType.Cone;
            sh.angle = 14f;
            sh.radius = 1.1f;
            sh.rotation = new Vector3(90f, 0f, 0f);
            var r = go.GetComponent<ParticleSystemRenderer>();
            if (r) r.sharedMaterial = HubLook.ParticleMat(c, false);
        }

        static void Clutter(Transform root)
        {
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                HubLook.Lantern(root, dir * 18.5f);
                var flag = FreePacks.SpawnStore("banner", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false)
                           ?? FreePacks.SpawnStore("flag-banner-long", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false);
                if (flag)
                {
                    flag.name = "RefusalBanner_" + g.shortName;
                    FreePacks.DyeCloth(flag, Color.Lerp(g.color, new Color(0.52f, 0.18f, 0.14f), 0.35f));
                }
            }
            var grass = DressVocab.Grass(WorldId.Hub);
            for (int i = 0; i < 16; i++)
            {
                float a = i / 16f * Mathf.PI * 2f + 0.09f;
                var r = 17.6f + (i % 4) * 0.35f;
                var p = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                if (Canon.InArena(p)) continue;
                FreePacks.SpawnStore(grass, root, p, i * 29f, FreePacks.HumanHeight("grass"), required: false);
            }
            for (int i = 0; i < 4; i++)
            {
                float a = i / 4f * Mathf.PI * 2f + 0.48f;
                var p = new Vector3(Mathf.Cos(a) * 22.2f, 0f, Mathf.Sin(a) * 22.2f);
                if (Canon.InArena(p)) continue;
                var tangent = new Vector3(-Mathf.Sin(a), 0f, Mathf.Cos(a));
                var table = FreePacks.SpawnStore(DressVocab.Table(), root, p, a * Mathf.Rad2Deg, FreePacks.HumanHeight("table"), required: false)
                            ?? FreePacks.Spawn(DressVocab.Table(), root, p, a * Mathf.Rad2Deg, FreePacks.HumanHeight("table"), required: false);
                if (table) UsePlace.Stamp(table, "Sit", "A ring table. People leave it as they found it.", true);
                FreePacks.SpawnStore(DressVocab.Chair(), root, p + tangent * 1.05f, a * Mathf.Rad2Deg + 180f, FreePacks.HumanHeight("chair"), required: false);
                FreePacks.SpawnStore(DressVocab.Chair(), root, p - tangent * 1.05f, a * Mathf.Rad2Deg, FreePacks.HumanHeight("chair"), required: false);
            }
            for (int i = 0; i < Canon.Gates.Length; i++)
            {
                var g = Canon.Gates[i];
                var n = Canon.Gates[(i + 1) % Canon.Gates.Length];
                float mid = (g.angle + n.angle) * 0.5f;
                if (Mathf.Abs(n.angle - g.angle) > Mathf.PI) mid += Mathf.PI;
                var grove = new Vector3(Mathf.Cos(mid) * 27.5f, 0f, Mathf.Sin(mid) * 27.5f);
                FreePacks.SpawnStore(DressVocab.Tree(WorldId.Hub), root, grove, mid * Mathf.Rad2Deg, 8f, required: false, byHeight: false);
                FreePacks.SpawnStore(DressVocab.Rock(), root, grove + new Vector3(1.6f, 0f, -0.8f), i * 21f, 1.05f, required: false);
                var col = new Vector3(Mathf.Cos(g.angle + 0.12f) * 31.2f, 0f, Mathf.Sin(g.angle + 0.12f) * 31.2f);
                FreePacks.SpawnStore(DressVocab.Column(WorldId.Hub), root, col, g.angle * Mathf.Rad2Deg, FreePacks.HumanHeight("column"), required: false);
            }
            for (int i = 0; i < 4; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = new Vector3(-dir.z, 0f, dir.x);
                var cart = FreePacks.SpawnStore(DressVocab.Cart(), root, dir * 26.2f + side * 2.2f, -g.angle * Mathf.Rad2Deg + 12f, FreePacks.HumanHeight("cart"), required: false)
                           ?? FreePacks.Spawn(DressVocab.Cart(), root, dir * 26.2f + side * 2.2f, -g.angle * Mathf.Rad2Deg + 12f, FreePacks.HumanHeight("cart"), required: false);
                if (cart) UsePlace.Stamp(cart, "Inspect", "A Ring cart. The invoice is still on the board.");
                FreePacks.SpawnStore(DressVocab.Crate(), root, dir * 26.2f + side * 3.4f, i * 33f, FreePacks.HumanHeight("crate"), required: false);
            }
        }
    }
}
