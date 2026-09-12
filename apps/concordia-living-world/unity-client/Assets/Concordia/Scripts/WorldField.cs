using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Presentation of kernel WorldField. Constants match
    /// server/lib/concordia-world-field.js. Travel is still region_rebuild;
    /// in-region metres sample the field around a civilization center.
    /// Never a fabricated "−42% Magic Damage" sticker.
    /// </summary>
    public static class WorldField
    {
        public const float CivilizationRadiusKm = 400f;
        public const float SigmaKm = 410f;
        public const float HubCourtKm = 12f;
        public const float HubMetroKm = 40f;
        public const float BlendSharpness = 8f;
        public const float SceneMetresToKm = 0.4f;
        public const float GeoNativeCap = 200f;

        public struct Sample
        {
            public bool ok;
            public string reason;
            public string dominant;
            public bool flowerLaw;
            public bool steelLive;
            public float magic;
            public float tech;
            public float multiplier;
            public float localPhysics;
            public float homeInfluence;
            public float habitatFitness;
            public string because;
        }

        public static string KernelWorld(WorldId id) => WorldBook.Folder(id);

        public static Vector2 CenterKm(WorldId id)
        {
            if (id == WorldId.Hub) return Vector2.zero;
            if (id == WorldId.Sere)
            {
                float ang = GateAngle(WorldId.Crime) + 0.35f;
                float r = CivilizationRadiusKm * 1.35f;
                return new Vector2(Mathf.Cos(ang) * r, Mathf.Sin(ang) * r);
            }
            float a = GateAngle(id);
            return new Vector2(Mathf.Cos(a) * CivilizationRadiusKm, Mathf.Sin(a) * CivilizationRadiusKm);
        }

        public static float GateAngle(WorldId id) => id switch
        {
            WorldId.Cyber => 0f,
            WorldId.Ruins => Mathf.PI / 4f,
            WorldId.Fantasy => Mathf.PI / 2f,
            WorldId.Tunya => 3f * Mathf.PI / 4f,
            WorldId.Frontier => Mathf.PI,
            WorldId.Crime => 5f * Mathf.PI / 4f,
            WorldId.Superhero => 3f * Mathf.PI / 2f,
            WorldId.Crucible => 7f * Mathf.PI / 4f,
            _ => 0f
        };

        /// <summary>Scene metres → megaworld km. Hub stays in the well.</summary>
        public static Vector2 LocalToMegaworld(WorldId world, float localX, float localZ)
        {
            if (world == WorldId.Hub) return Vector2.zero;
            var c = CenterKm(world);
            float ang = world == WorldId.Sere
                ? GateAngle(WorldId.Crime) + 0.35f
                : GateAngle(world);
            var radial = new Vector2(Mathf.Cos(ang), Mathf.Sin(ang));
            var tan = new Vector2(-Mathf.Sin(ang), Mathf.Cos(ang));
            return c + tan * localX * SceneMetresToKm + radial * localZ * SceneMetresToKm;
        }

        public static Sample At(WorldId world, Vector3 localPos, string domain = "athletics", WorldId origin = WorldId.Hub)
        {
            var mega = LocalToMegaworld(world, localPos.x, localPos.z);
            return AtMegaworld(mega.x, mega.y, domain, origin == WorldId.Hub ? world : origin);
        }

        public static Sample AtWorld(WorldId world, string domain = "athletics", WorldId origin = WorldId.Hub)
        {
            var c = CenterKm(world);
            return AtMegaworld(c.x, c.y, domain, origin == WorldId.Hub ? world : origin);
        }

        static Sample AtMegaworld(float x, float z, string domain, WorldId origin)
        {
            float distHub = Mathf.Sqrt(x * x + z * z);
            float hub = HubWell(distHub);
            var inf = Influences(x, z, hub);
            string dominant = "hub";
            float best = hub;
            foreach (var kv in inf)
            {
                if (kv.Value > best) { best = kv.Value; dominant = kv.Key; }
            }
            bool flower = hub >= 0.85f || distHub <= HubCourtKm;
            float physics = Blend(inf, hub, domain);
            float home = HomeInfluence(inf, origin);
            float floor = 0.10f;
            float coupled = physics * (0.55f + 0.45f * home);
            float mul = Mathf.Clamp01(Mathf.Max(floor, coupled));
            string because;
            if (flower)
                because = "The Unburned Court suppresses regional physics. Flower Law holds. Live steel does not.";
            else
                because = "Local " + domain + " physics is " + physics.ToString("0.00")
                    + " (" + dominant + " field). Distance from " + origin + " couples at " + home.ToString("0.00") + ".";
            return new Sample
            {
                ok = true,
                dominant = dominant,
                flowerLaw = flower,
                steelLive = !flower,
                magic = Blend(inf, hub, "magic"),
                tech = Blend(inf, hub, "tech"),
                multiplier = mul,
                localPhysics = physics,
                homeInfluence = home,
                habitatFitness = home,
                because = because
            };
        }

        static float HubWell(float d)
        {
            if (d <= HubCourtKm) return 1f;
            if (d >= HubMetroKm) return 0f;
            float t = (d - HubCourtKm) / (HubMetroKm - HubCourtKm);
            return Mathf.Clamp01(1f - t * t);
        }

        static System.Collections.Generic.Dictionary<string, float> Influences(float x, float z, float hub)
        {
            var d = new System.Collections.Generic.Dictionary<string, float>();
            void add(WorldId id, string key)
            {
                var c = CenterKm(id);
                float dist = Vector2.Distance(new Vector2(x, z), c);
                d[key] = Mathf.Exp(-((dist / SigmaKm) * (dist / SigmaKm)));
            }
            add(WorldId.Cyber, "cyber");
            add(WorldId.Ruins, "sovereign");
            add(WorldId.Fantasy, "fantasy");
            add(WorldId.Tunya, "tunya");
            add(WorldId.Frontier, "frontier");
            add(WorldId.Crime, "crime");
            add(WorldId.Superhero, "superhero");
            add(WorldId.Crucible, "lattice");
            add(WorldId.Sere, "sere");
            d["hub"] = hub;
            return d;
        }

        static float HomeInfluence(System.Collections.Generic.Dictionary<string, float> inf, WorldId origin)
        {
            string key = origin switch
            {
                WorldId.Hub => "hub",
                WorldId.Ruins => "sovereign",
                WorldId.Frontier => "frontier",
                WorldId.Crucible => "lattice",
                _ => origin.ToString().ToLowerInvariant()
            };
            return inf.TryGetValue(key, out var v) ? v : 0f;
        }

        /// <summary>
        /// Authored center affinities (content/world/*/meta.json). Hub is civil 0.7.
        /// Keep in lockstep with those files — tests pin fantasy magic = 1, crime magic = 0.05.
        /// </summary>
        public static float CenterAffinity(string key, string domain)
        {
            if (key == "hub") return 0.7f;
            if (domain == "magic")
            {
                if (key == "fantasy") return 1f;
                if (key == "crime") return 0.05f;
                if (key == "cyber") return 0.1f;
                if (key == "tunya") return 0.4f;
                return 0.6f;
            }
            if (domain == "tech")
            {
                if (key == "cyber") return 1f;
                if (key == "fantasy") return 0.05f;
                if (key == "crime") return 0.85f;
                return 0.6f;
            }
            if (domain == "swordsmanship")
            {
                if (key == "fantasy") return 1f;
                if (key == "crime") return 0.4f;
                return 0.7f;
            }
            if (domain == "athletics")
            {
                if (key == "crime") return 0.95f;
                if (key == "fantasy") return 0.9f;
                return 0.7f;
            }
            return 0.7f;
        }

        static float Blend(System.Collections.Generic.Dictionary<string, float> inf, float well, string domain)
        {
            float num = 0f, den = 0f;
            foreach (var kv in inf)
            {
                if (kv.Key == "hub") continue;
                if (kv.Value < 0.02f) continue;
                float w = Mathf.Pow(kv.Value, BlendSharpness);
                num += w * CenterAffinity(kv.Key, domain);
                den += w;
            }
            float mixed = den > 0f ? num / den : 0.7f;
            if (well > 0f) mixed = mixed * (1f - well) + 0.7f * well;
            return Mathf.Clamp01(mixed);
        }

        public static float ScaleDamage(float dmg, WorldId world, Vector3 localPos, string domain = "athletics")
        {
            var s = At(world, localPos, domain, world);
            if (!s.ok) return dmg;
            return Mathf.Max(0.1f, dmg * s.multiplier);
        }

        /// <summary>
        /// Physics at the player's feet. Last-hit kernel copy lives on
        /// ConcordClient.FieldBecause for combat toasts — it must not freeze this line.
        /// </summary>
        public static string HudLine(WorldId world, Vector3 localPos)
        {
            var s = At(world, localPos, "athletics", world);
            if (!s.ok) return "";
            return s.because;
        }
    }
}
