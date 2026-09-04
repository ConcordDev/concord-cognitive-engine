using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Unburned Court: the old battlefield, left unpaved, under her dome.
    /// Eight named doors. No town of houses on the ring.
    /// </summary>
    public static class HubPlaza
    {
        const float DomeR = 42f;
        const float DomeH = 32f;

        public static void Build(Transform root)
        {
            var bronze = HubLook.Pbr("rusty_metal", new Color(0.62f, 0.42f, 0.28f), 0.78f, 0.38f, 4f);
            var bronzeDark = HubLook.Pbr("metal_plate", new Color(0.32f, 0.22f, 0.16f), 0.82f, 0.28f, 3f);
            var copper = HubLook.Pbr("rusty_metal", new Color(0.55f, 0.34f, 0.22f), 0.7f, 0.34f, 5f);
            var earth = HubLook.Pbr("packed_earth", Canon.Hub.ground, 0.02f, 0.12f, 14f);
            var earthDark = HubLook.Pbr("ash_soil", new Color(0.38f, 0.30f, 0.22f), 0.02f, 0.10f, 12f);
            var gold = HubLook.Pbr("metal_plate", new Color(0.62f, 0.50f, 0.28f), 0.85f, 0.42f, 2.5f);
            var masonry = HubLook.Pbr("plastered_wall", new Color(0.72f, 0.64f, 0.52f), 0.04f, 0.18f, 3.5f);
            var brick = HubLook.Pbr("brick_wall_02", new Color(0.62f, 0.42f, 0.32f), 0.03f, 0.16f, 2.8f);
            var stone = HubLook.Pbr("stone_tiles", new Color(0.58f, 0.52f, 0.44f), 0.04f, 0.2f, 6f);
            var moss = HubLook.Pbr("grove_moss", new Color(0.34f, 0.40f, 0.24f), 0.02f, 0.14f, 9f);
            var glass = HubLook.Lit(new Color(0.22f, 0.26f, 0.28f, 0.55f), 0.12f, 0.92f);

            Floor(root, earth, earthDark, stone, moss);
            Monument(root, bronze, gold);
            Dome(root, masonry, brick, gold, glass);
            Balcony(root, bronze, copper);
            Gates(root, bronze, gold);
            Clutter(root);
            GodRays(root);
            Dust(root, new Color(1f, 0.88f, 0.62f));
            HubLook.Point(root, "MonumentLight", new Vector3(0f, 6.5f, 0f), new Color(1f, 0.72f, 0.42f), 2.2f, 14f, true);
            HubLook.Point(root, "OculusLight", new Vector3(0f, 28f, 0f), new Color(1f, 0.86f, 0.68f), 2.4f, 28f, false);
            HubLook.Point(root, "RimWarm", new Vector3(18f, 4f, -12f), new Color(1f, 0.55f, 0.28f), 1.1f, 16f, false);
            HubLook.Point(root, "RimCool", new Vector3(-16f, 5f, 14f), new Color(0.42f, 0.52f, 0.62f), 0.85f, 14f, false);
        }

        static void Floor(Transform root, Material earth, Material dark, Material stone, Material moss)
        {
            var bed = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.01f, 0f), new Vector3(DomeR * 2.05f, 0.04f, DomeR * 2.05f), dark, "Battlefield");
            FreePacks.FlattenDisc(bed);
            var disc = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.03f, 0f), new Vector3(Canon.CourtRadius * 2.15f, 0.04f, Canon.CourtRadius * 2.15f), earth, "UnpavedCourt");
            FreePacks.FlattenDisc(disc);
            // Stone ring between the unpaved court and the gates — not a paved court.
            var ring = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.035f, 0f), new Vector3(42f, 0.035f, 42f), stone, "RingWalk");
            FreePacks.FlattenDisc(ring);
            var verge = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.038f, 0f), new Vector3(Canon.CourtRadius * 2.45f, 0.03f, Canon.CourtRadius * 2.45f), moss, "MossVerge");
            FreePacks.FlattenDisc(verge);
            var keep = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.04f, 0f), new Vector3(Canon.CourtRadius * 2.08f, 0.05f, Canon.CourtRadius * 2.08f), earth, "UnpavedKeep");
            FreePacks.FlattenDisc(keep);
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                for (int s = 6; s <= 12; s++)
                {
                    var p = dir * (s * 2.85f);
                    var path = HubLook.Prim(root, PrimitiveType.Cube, p + Vector3.up * 0.05f, new Vector3(2.6f, 0.05f, 1.35f), stone, "Track_" + g.world + "_" + s, false);
                    path.transform.rotation = Quaternion.LookRotation(dir);
                }
            }
        }

        static void Monument(Transform root, Material bronze, Material gold)
        {
            var plinth = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 0.4f, 0f), new Vector3(7.2f, 0.8f, 7.2f), bronze, "Plinth");
            UsePlace.Stamp(plinth, "Commune", "The Court does not speak first. You came anyway.");
            HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 1.2f, 0f), new Vector3(5.4f, 0.5f, 5.4f), gold, "PlinthRim");
            HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 2.6f, 0f), new Vector3(2.2f, 3.4f, 2.2f), bronze, "Column");
            HubLook.Prim(root, PrimitiveType.Sphere, new Vector3(0f, 5.6f, 0f), new Vector3(2.8f, 1.6f, 2.8f), bronze, "Bowl");
            HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 6.4f, 0f), new Vector3(0.35f, 1.8f, 0.35f), gold, "Spire");
            HubLook.Prim(root, PrimitiveType.Sphere, new Vector3(0f, 8.2f, 0f), new Vector3(0.7f, 0.7f, 0.7f), HubLook.Emit(new Color(1f, 0.78f, 0.35f), 4f), "Flame", false);
            // fountain water suggestion
            HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, 1.55f, 0f), new Vector3(4.6f, 0.08f, 4.6f), HubLook.UnlitAlpha(new Color(0.45f, 0.7f, 0.85f, 0.35f)), "Water", false);
        }

        static void Dome(Transform root, Material bronze, Material dark, Material gold, Material glass)
        {
            int rings = 11;
            int segs = 28;
            for (int i = 0; i < rings; i++)
            {
                float t = i / (float)(rings - 1);
                float theta = t * 1.22f; // leave oculus
                float y = 6.5f + Mathf.Sin(theta) * DomeH;
                float r = Mathf.Cos(theta) * DomeR;
                var mat = i % 2 == 0 ? bronze : dark;
                RingBoxes(root, r, y, segs, new Vector3(3.4f, 1.15f, 1.6f), mat, "Dome" + i, 0f);
            }
            // oculus rim + glass
            HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, DomeH + 5.2f, 0f), new Vector3(16f, 0.35f, 16f), gold, "OculusRim");
            var pane = HubLook.Prim(root, PrimitiveType.Cylinder, new Vector3(0f, DomeH + 5.15f, 0f), new Vector3(14.5f, 0.08f, 14.5f), glass, "OculusGlass", false);
            // ribs
            for (int i = 0; i < 12; i++)
            {
                float a = i / 12f * Mathf.PI * 2f;
                for (int k = 0; k < 8; k++)
                {
                    float t = k / 8f;
                    float theta = t * 1.22f;
                    float y = 6.5f + Mathf.Sin(theta) * DomeH;
                    float r = Mathf.Cos(theta) * (DomeR + 0.4f);
                    var p = new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r);
                    HubLook.Prim(root, PrimitiveType.Cube, p, new Vector3(0.55f, 1.4f, 0.55f), gold, "Rib" + i + "_" + k, false);
                }
            }
        }

        static void GodRays(Transform root)
        {
            var tex = HubLook.SoftRay();
            var mat = HubLook.UnlitAlpha(new Color(1f, 0.9f, 0.7f, 0.22f));
            mat.mainTexture = tex;
            if (mat.HasProperty("_BaseMap")) mat.SetTexture("_BaseMap", tex);
            var hold = new GameObject("GodRays").transform;
            hold.SetParent(root, false);
            for (int i = 0; i < 7; i++)
            {
                float a = i / 7f * Mathf.PI * 2f + 0.2f;
                var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
                q.name = "Ray" + i;
                q.transform.SetParent(hold, false);
                q.transform.position = new Vector3(Mathf.Cos(a) * 3.2f, 17f, Mathf.Sin(a) * 3.2f);
                q.transform.localScale = new Vector3(3.4f, 28f, 1f);
                q.transform.rotation = Quaternion.LookRotation(new Vector3(Mathf.Cos(a), -0.15f, Mathf.Sin(a)), Vector3.up);
                Object.Destroy(q.GetComponent<Collider>());
                q.GetComponent<Renderer>().sharedMaterial = mat;
            }
            Dust(hold, new Color(1f, 0.88f, 0.62f));
        }

        static void Dust(Transform parent, Color c)
        {
            var go = new GameObject("Dust");
            go.transform.SetParent(parent, false);
            go.transform.position = new Vector3(0f, 12f, 0f);
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

        static void Balcony(Transform root, Material bronze, Material copper)
        {
            const float y = 9.2f;
            const float r = 36.5f;
            RingBoxes(root, r, y, 32, new Vector3(4.2f, 0.28f, 2.4f), bronze, "Balcony", 0f);
            RingBoxes(root, r, y + 1.15f, 32, new Vector3(0.18f, 1.1f, 2.2f), copper, "Rail", 0f);
            for (int i = 0; i < 16; i++)
            {
                float a = i / 16f * Mathf.PI * 2f + 0.1f;
                var p = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                HubLook.Prim(root, PrimitiveType.Cylinder, p + Vector3.up * 4.6f, new Vector3(0.7f, 4.6f, 0.7f), bronze, "BalcCol" + i);
                HubLook.Lantern(root, p + Vector3.up * 0.02f);
            }
        }

        static void Gates(Transform root, Material bronze, Material gold)
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

                float h = 12.5f;
                float w = 7.2f;
                HubLook.Prim(hold, PrimitiveType.Cube, Vector3.zero, new Vector3(1.4f, h, 1.8f), bronze, "PillarL");
                hold.Find("PillarL").localPosition = new Vector3(-w * 0.5f, h * 0.5f, 0f);
                HubLook.Prim(hold, PrimitiveType.Cube, Vector3.zero, new Vector3(1.4f, h, 1.8f), bronze, "PillarR");
                hold.Find("PillarR").localPosition = new Vector3(w * 0.5f, h * 0.5f, 0f);
                HubLook.Prim(hold, PrimitiveType.Cube, Vector3.zero, new Vector3(w + 2.2f, 1.6f, 2.0f), gold, "Lintel");
                hold.Find("Lintel").localPosition = new Vector3(0f, h + 0.2f, 0f);
                // arched voussoirs
                for (int k = 0; k < 7; k++)
                {
                    float t = (k / 6f) * Mathf.PI;
                    var ap = new Vector3(Mathf.Cos(t) * (w * 0.5f), h * 0.72f + Mathf.Sin(t) * 2.6f, 0f);
                    var brick = HubLook.Prim(hold, PrimitiveType.Cube, Vector3.zero, new Vector3(1.1f, 0.7f, 1.7f), k % 2 == 0 ? bronze : gold, "Arch" + k, false);
                    brick.transform.localPosition = ap;
                    brick.transform.localRotation = Quaternion.Euler(0f, 0f, (k / 6f) * 180f - 90f);
                }

                var portalCol = PortalColor(gate);
                var portal = HubLook.Prim(hold, PrimitiveType.Cylinder, Vector3.zero, new Vector3(2.4f, 0.06f, 4.2f), HubLook.Emit(portalCol, 0.4f), "Portal", false);
                portal.transform.localPosition = new Vector3(0f, h * 0.42f, 0.15f);
                portal.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                Swirl(hold, new Vector3(0f, h * 0.42f, 0.2f), portalCol);

                var label = new GameObject("Name").AddComponent<TextMesh>();
                label.transform.SetParent(hold, false);
                label.transform.localPosition = new Vector3(0f, h + 1.5f, 0.2f);
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
                box.size = new Vector3(w, 5f, 2.4f);
                box.isTrigger = true;

                var plaque = HubLook.Prim(hold, PrimitiveType.Cube, Vector3.zero, new Vector3(0.7f, 1.3f, 0.12f), gold, "Plaque");
                plaque.transform.localPosition = new Vector3(w * 0.5f + 1.1f, 1.4f, 0.4f);
                var stone = plaque.AddComponent<LoreStone>();
                stone.title = gate.name;
                stone.text = gate.refusal + " — " + gate.theNo;

                if (gate.world == WorldId.Frontier || gate.world == WorldId.Cyber)
                    HubLook.Point(hold, "PortalFill", hold.TransformPoint(new Vector3(0f, 4f, 1.2f)), portalCol, 0.55f, 16f, false);

                var flag = FreePacks.Spawn("flag-banner-long", hold, hold.TransformPoint(new Vector3(0f, 0f, -0.6f)), hold.eulerAngles.y, 3.2f);
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

        static void Clutter(Transform root)
        {
            foreach (var g in Canon.Gates)
            {
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                HubLook.Lantern(root, dir * 18.5f);
                var flag = FreePacks.Spawn("banner", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false)
                           ?? FreePacks.Spawn("flag-banner-long", root, dir * 22f, -g.angle * Mathf.Rad2Deg, 2.8f, required: false);
                if (flag)
                {
                    flag.name = "RefusalBanner_" + g.shortName;
                    FreePacks.DyeCloth(flag, Color.Lerp(g.color, new Color(0.52f, 0.18f, 0.14f), 0.35f));
                }
            }
            for (int i = 0; i < 16; i++)
            {
                float a = i / 16f * Mathf.PI * 2f + 0.17f;
                var r = 9.4f + (i % 4) * 0.85f;
                var p = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                if (Canon.InArena(p)) continue;
                FreePacks.Spawn("flower_redA", root, p, i * 37f, FreePacks.HumanHeight("flower"), required: false);
            }
            for (int i = 0; i < 16; i++)
            {
                float a = i / 16f * Mathf.PI * 2f + 0.09f;
                var r = 17.6f + (i % 4) * 0.35f;
                var p = new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
                if (Canon.InArena(p)) continue;
                FreePacks.Spawn(DressVocab.Grass(WorldId.Hub), root, p, i * 29f, FreePacks.HumanHeight("grass"), required: false);
            }
            // Four hearths on the stone ring — sit-able, not scattered junk.
            for (int i = 0; i < 4; i++)
            {
                float a = i / 4f * Mathf.PI * 2f + 0.48f;
                var p = new Vector3(Mathf.Cos(a) * 22.2f, 0f, Mathf.Sin(a) * 22.2f);
                if (Canon.InArena(p)) continue;
                var tangent = new Vector3(-Mathf.Sin(a), 0f, Mathf.Cos(a));
                var table = FreePacks.Spawn(DressVocab.Table(), root, p, a * Mathf.Rad2Deg, FreePacks.HumanHeight("table"), required: false);
                UsePlace.Stamp(table, "Sit", "A ring table. People leave it as they found it.", true);
                FreePacks.Spawn(DressVocab.Chair(), root, p + tangent * 1.05f, a * Mathf.Rad2Deg + 180f, FreePacks.HumanHeight("chair"), required: false);
                FreePacks.Spawn(DressVocab.Chair(), root, p - tangent * 1.05f, a * Mathf.Rad2Deg, FreePacks.HumanHeight("chair"), required: false);
            }
            // Groves between gates — trees belong in the gaps, not on the court.
            for (int i = 0; i < Canon.Gates.Length; i++)
            {
                var g = Canon.Gates[i];
                var n = Canon.Gates[(i + 1) % Canon.Gates.Length];
                float mid = (g.angle + n.angle) * 0.5f;
                if (Mathf.Abs(n.angle - g.angle) > Mathf.PI) mid += Mathf.PI;
                var grove = new Vector3(Mathf.Cos(mid) * 27.5f, 0f, Mathf.Sin(mid) * 27.5f);
                FreePacks.Spawn(DressVocab.Tree(WorldId.Hub), root, grove, mid * Mathf.Rad2Deg, FreePacks.HumanHeight("tree"), required: false);
                FreePacks.Spawn(DressVocab.Rock(), root, grove + new Vector3(1.6f, 0f, -0.8f), i * 21f, 1.05f, required: false);
                var col = new Vector3(Mathf.Cos(g.angle + 0.12f) * 31.2f, 0f, Mathf.Sin(g.angle + 0.12f) * 31.2f);
                FreePacks.Spawn(DressVocab.Column(WorldId.Hub), root, col, g.angle * Mathf.Rad2Deg, FreePacks.HumanHeight("column"), required: false);
            }
            for (int i = 0; i < 4; i++)
            {
                var g = Canon.Gates[i];
                var dir = new Vector3(Mathf.Cos(g.angle), 0f, Mathf.Sin(g.angle));
                var side = new Vector3(-dir.z, 0f, dir.x);
                var cart = FreePacks.Spawn(DressVocab.Cart(), root, dir * 26.2f + side * 2.2f, -g.angle * Mathf.Rad2Deg + 12f, FreePacks.HumanHeight("cart"), required: false);
                UsePlace.Stamp(cart, "Inspect", "A Ring cart. The invoice is still on the board.");
                FreePacks.Spawn(DressVocab.Crate(), root, dir * 26.2f + side * 3.4f, i * 33f, FreePacks.HumanHeight("crate"), required: false);
            }
        }

        static void RingBoxes(Transform root, float r, float y, int n, Vector3 scale, Material mat, string prefix, float yawOff)
        {
            for (int i = 0; i < n; i++)
            {
                float a = i / (float)n * Mathf.PI * 2f + yawOff;
                var p = new Vector3(Mathf.Cos(a) * r, y, Mathf.Sin(a) * r);
                var go = HubLook.Prim(root, PrimitiveType.Cube, p, scale, mat, prefix + "_" + i, false);
                go.transform.rotation = Quaternion.LookRotation(new Vector3(p.x, 0f, p.z));
            }
        }
    }
}
