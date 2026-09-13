using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Detached genome card (not a MonoBehaviour). Kernel fields only.
    /// Generation 0 = founding stock, not a fabricated lineage.
    /// </summary>
    public class CreatureCard
    {
        public string id, speciesId, topology, parentA, parentB;
        public string dominant, variant, affinity, gaitKind, lifestyle;
        public float massKg = -1f, heightM = -1f, walkMps = -1f, stability = -1f, x, z;
        public int generation;
        public bool predator, fly, hasXz;
    }

    /// <summary>
    /// Persistent genome on a compiled creature.
    /// </summary>
    public class CreatureGenome : MonoBehaviour
    {
        public string id;
        public string speciesId;
        public string topology;
        public float massKg = -1f;
        public float heightM = -1f;
        public int generation;
        public string parentA;
        public string parentB;
        public string dominant;
        public string variant;
        public string affinity;
        public string gaitKind;
        public float walkMps = -1f;
        public string lifestyle;
        public bool predator;
        public bool fly;
        public float stability = -1f;

        public string Label
        {
            get
            {
                var name = string.IsNullOrEmpty(speciesId) ? "creature" : speciesId;
                if (generation > 0) name += " · gen " + generation;
                if (!string.IsNullOrEmpty(variant)) name += " · " + variant;
                else if (!string.IsNullOrEmpty(dominant)) name += " · " + dominant;
                return name;
            }
        }

        public void Bind(CreatureCard card)
        {
            if (card == null) return;
            id = card.id;
            speciesId = card.speciesId;
            topology = card.topology;
            massKg = card.massKg;
            heightM = card.heightM;
            generation = card.generation;
            parentA = card.parentA;
            parentB = card.parentB;
            dominant = card.dominant;
            variant = card.variant;
            affinity = card.affinity;
            gaitKind = card.gaitKind;
            walkMps = card.walkMps;
            lifestyle = card.lifestyle;
            predator = card.predator;
            fly = card.fly || Winged(topology);
            if (string.IsNullOrEmpty(gaitKind) && Winged(topology)) gaitKind = "winged";
            stability = card.stability;
        }

        /// <summary>
        /// Sparse kernel cards omit fly/gait. Do not wipe a winged body back to ground.
        /// </summary>
        public void FillGaps(CreatureCard card)
        {
            if (card == null) return;
            if (string.IsNullOrEmpty(topology) && !string.IsNullOrEmpty(card.topology))
                topology = card.topology;
            if (string.IsNullOrEmpty(speciesId) && !string.IsNullOrEmpty(card.speciesId))
                speciesId = card.speciesId;
            if (string.IsNullOrEmpty(gaitKind))
                gaitKind = string.IsNullOrEmpty(card.gaitKind) ? (Winged(topology) ? "winged" : gaitKind) : card.gaitKind;
            if (Winged(topology) || Winged(card.topology) || card.fly) fly = true;
            if (card.predator) predator = true;
            if (walkMps < 0.1f && card.walkMps > 0.1f) walkMps = card.walkMps;
        }

        public static bool Winged(string topology) =>
            !string.IsNullOrEmpty(topology) && topology.StartsWith("winged", System.StringComparison.OrdinalIgnoreCase);

        public static CreatureGenome Find(string creatureId)
        {
            if (string.IsNullOrEmpty(creatureId)) return null;
            foreach (var g in Object.FindObjectsByType<CreatureGenome>(FindObjectsInactive.Exclude))
            {
                if (!g) continue;
                if (g.id == creatureId) return g;
            }
            return null;
        }
    }

    /// <summary>
    /// genome → phenotype → Unity body. Topology / mass / height / generation
    /// come from the kernel. Extra limbs come from topology, not a second
    /// bestiary. Missing FreePacks stems fall back to primitives.
    /// </summary>
    public static class CreatureCompiler
    {
        public static GameObject Compile(Transform parent, CreatureCard card, Vector3 pos, WorldDef world)
        {
            if (card == null || string.IsNullOrEmpty(card.id)) return null;
            var key = "Evo_" + card.id;
            Normalize(card);
            var existing = GameObject.Find(key);
            if (existing)
            {
                var g = existing.GetComponent<CreatureGenome>();
                if (g)
                {
                    if (card.generation > g.generation || string.IsNullOrEmpty(g.id))
                        g.Bind(card);
                    else
                        g.FillGaps(card);
                }
                var life = existing.GetComponent<FaunaLife>();
                if (life && g) life.BindGenome(g);
                return existing;
            }

            var height = card.heightM > 0.05f ? card.heightM : HeightFor(card.topology, card.speciesId);
            var topology = card.topology;

            GameObject go = null;
            var stem = StemFor(topology, card.speciesId);
            if (!string.IsNullOrEmpty(stem))
                go = FreePacks.Spawn(stem, parent, pos, Random.Range(0, 360f), ScaleHint(topology, height));
            if (go == null)
            {
                go = new GameObject(key);
                go.transform.SetParent(parent, false);
                go.transform.position = pos + Vector3.up * (card.fly ? 2.2f : height * 0.35f);
            }
            go.name = key;

            var genome = go.GetComponent<CreatureGenome>() ?? go.AddComponent<CreatureGenome>();
            genome.Bind(card);

            DressMorphology(go.transform, topology, height, Coat(card, world));
            FreePacks.EnsureCollider(go, Mathf.Max(1.1f, height * 0.7f));
            if (!go.GetComponent<CharacterController>())
                Grounding.EnsureController(go, Mathf.Max(1.2f, height * 0.85f));

            var dummy = go.GetComponent<TrainingDummy>() ?? go.AddComponent<TrainingDummy>();
            dummy.living = true;
            dummy.hp = card.massKg > 0f ? Mathf.Clamp(card.massKg * 0.9f, 24f, 180f) : 70f;
            dummy.unburied = world != null && (world.id == WorldId.Ruins || world.id == WorldId.Crucible);

            if (card.predator && !go.GetComponent<Hostile>()) go.AddComponent<Hostile>();
            var fauna = go.GetComponent<FaunaLife>() ?? go.AddComponent<FaunaLife>();
            fauna.BindGenome(genome);

            PersonLabel.Attach(go.transform, genome.Label, card.lifestyle);
            var spin = go.GetComponent<EvoDrift>();
            if (spin) spin.enabled = false;
            return go;
        }

        public static GameObject FromCritter(Transform parent, WorldBook.Critter c, Vector3 pos, WorldDef world)
        {
            if (c == null) return null;
            var id = string.IsNullOrEmpty(c.id) ? c.name : c.id;
            if (string.IsNullOrEmpty(id)) return null;
            var topology = TopologyFor(c.topology_hint, id);
            return Compile(parent, new CreatureCard
            {
                id = id,
                speciesId = id,
                topology = topology,
                generation = 0,
                fly = CreatureGenome.Winged(topology),
                predator = ((c.topology_hint ?? "") + " " + id).ToLowerInvariant().IndexOf("wolf") >= 0
                    || ((c.topology_hint ?? "") + " " + id).ToLowerInvariant().IndexOf("drake") >= 0
                    || ((c.topology_hint ?? "") + " " + id).ToLowerInvariant().IndexOf("griffin") >= 0
                    || ((c.topology_hint ?? "") + " " + id).ToLowerInvariant().IndexOf("basilisk") >= 0,
                lifestyle = "omnivore",
            }, pos, world);
        }

        public static GameObject FromKind(Transform parent, string kind, Vector3 pos, WorldDef world)
        {
            if (string.IsNullOrEmpty(kind)) return null;
            return Compile(parent, new CreatureCard
            {
                id = kind,
                speciesId = kind,
                topology = TopologyFor(kind),
                generation = 0,
                fly = IsFlyKind(kind),
                predator = IsPredatorKind(kind),
                lifestyle = IsPredatorKind(kind) ? "carnivore" : "omnivore",
            }, pos, world);
        }

        /// <summary>
        /// Kernel snapshot / creature:born. Bodies only at a real presenter xz
        /// or beside a matching parent already in the scene. Far coords stay unplaced.
        /// </summary>
        public static GameObject PresentKernel(Transform parent, CreatureCard card, WorldDef world)
        {
            if (card == null || string.IsNullOrEmpty(card.id)) return null;
            Vector3 p;
            var hostA = CreatureGenome.Find(card.parentA);
            var hostB = CreatureGenome.Find(card.parentB);
            if (card.hasXz && WorldPresence.InPresenter(card.x, card.z))
                p = new Vector3(card.x, 0f, card.z);
            else if (hostA)
                p = hostA.transform.position + hostA.transform.right * 1.4f;
            else if (hostB)
                p = hostB.transform.position + hostB.transform.right * -1.4f;
            else
                return null;
            return Compile(parent, card, p, world);
        }

        static void DressMorphology(Transform root, string topology, float height, Material coat)
        {
            var t = topology ?? "quadruped";
            if (t.StartsWith("winged") || t == "winged_quadruped" || t == "winged_biped")
            {
                Wing(root, -1, height, coat);
                Wing(root, 1, height, coat);
            }
            if (t == "quadruped" || t == "winged_quadruped")
                Tail(root, height, coat);
            if (t == "serpentine" || t == "eel")
                Coil(root, height, coat);
            if (t == "polyped")
            {
                for (int i = 0; i < 6; i++)
                    Leg(root, i, 6, height, coat);
            }
            if (t == "amorphous")
            {
                var blob = HubLook.Prim(root, PrimitiveType.Sphere, new Vector3(0f, height * 0.2f, 0f),
                    Vector3.one * (height * 0.55f), coat, "morph_core", false);
                blob.transform.localScale = new Vector3(height * 0.7f, height * 0.45f, height * 0.7f);
            }
        }

        static void Wing(Transform root, int side, float height, Material coat)
        {
            var go = HubLook.Prim(root, PrimitiveType.Cube,
                new Vector3(side * height * 0.45f, height * 0.35f, 0f),
                new Vector3(height * 0.85f, height * 0.06f, height * 0.32f),
                coat, side < 0 ? "morph_wing_l" : "morph_wing_r", false);
            go.transform.localRotation = Quaternion.Euler(0f, 0f, side * -18f);
        }

        static void Tail(Transform root, float height, Material coat)
        {
            HubLook.Prim(root, PrimitiveType.Capsule,
                new Vector3(0f, height * 0.12f, -height * 0.55f),
                new Vector3(height * 0.12f, height * 0.28f, height * 0.12f),
                coat, "morph_tail", false);
        }

        static void Coil(Transform root, float height, Material coat)
        {
            for (int i = 0; i < 5; i++)
            {
                HubLook.Prim(root, PrimitiveType.Sphere,
                    new Vector3(0f, height * 0.12f, -i * height * 0.28f),
                    Vector3.one * (height * 0.22f),
                    coat, "morph_seg_" + i, false);
            }
        }

        static void Leg(Transform root, int i, int of, float height, Material coat)
        {
            float a = (i / (float)of) * Mathf.PI * 2f;
            HubLook.Prim(root, PrimitiveType.Capsule,
                new Vector3(Mathf.Cos(a) * height * 0.35f, -height * 0.15f, Mathf.Sin(a) * height * 0.35f),
                new Vector3(height * 0.08f, height * 0.28f, height * 0.08f),
                coat, "morph_leg_" + i, false);
        }

        static Material Coat(CreatureCard card, WorldDef world)
        {
            var c = ColorFor(card.variant, card.dominant, card.affinity, world);
            return HubLook.Lit(c, string.IsNullOrEmpty(card.variant) ? 0.08f : 0.22f, 0.28f);
        }

        static Color ColorFor(string variant, string dominant, string affinity, WorldDef world)
        {
            var key = (variant ?? dominant ?? affinity ?? "").ToLowerInvariant();
            return key switch
            {
                "fire" or "heat" or "ember" => new Color(0.86f, 0.28f, 0.08f),
                "ice" or "frost" or "cold" => new Color(0.62f, 0.82f, 0.95f),
                "steam" => new Color(0.78f, 0.82f, 0.86f),
                "brine" or "water" => new Color(0.22f, 0.48f, 0.62f),
                "glitch" or "data" or "neural" => new Color(0.45f, 0.95f, 0.72f),
                "magic" or "curse" => new Color(0.55f, 0.32f, 0.82f),
                "nature" => new Color(0.32f, 0.62f, 0.28f),
                "shadow" or "trauma" => new Color(0.18f, 0.16f, 0.22f),
                _ => world != null ? Color.Lerp(world.ground, world.sun, 0.35f) : new Color(0.45f, 0.4f, 0.32f),
            };
        }

        static void Normalize(CreatureCard card)
        {
            if (card == null) return;
            var topology = TopologyFor(card.topology, card.speciesId);
            card.topology = topology;
            card.fly = card.fly || CreatureGenome.Winged(topology);
            if (string.IsNullOrEmpty(card.gaitKind)) card.gaitKind = GaitFor(topology);
            if (string.IsNullOrEmpty(card.lifestyle))
                card.lifestyle = card.predator ? "carnivore" : "omnivore";
            card.predator = card.predator || card.lifestyle == "carnivore";
        }

        public static string TopologyFor(string hint, string species = null)
        {
            var h = (hint ?? "").Trim().ToLowerInvariant();
            if (h == "winged_quadruped" || h == "winged_biped" || h == "serpentine" || h == "humanoid"
                || h == "quadruped" || h == "amorphous" || h == "polyped" || h == "eel")
                return h;
            var s = (h + " " + (species ?? "")).ToLowerInvariant();
            if (s.Contains("wing") || s.Contains("hawk") || s.Contains("harpy") || s.Contains("griffin") || s.Contains("drake") || s.Contains("dragon") || s.Contains("wyvern") || s.Contains("falcon") || s.Contains("owl") || s.Contains("pigeon") || s.Contains("finch"))
                return s.Contains("quad") || s.Contains("griffin") || s.Contains("drake") || s.Contains("dragon") ? "winged_quadruped" : "winged_biped";
            if (s.Contains("serpent") || s.Contains("snake") || s.Contains("viper") || s.Contains("basilisk") || s.Contains("wyrm"))
                return "serpentine";
            if (s.Contains("drone") || s.Contains("mech") || s.Contains("construct") || s.Contains("sentinel"))
                return "humanoid";
            if (s.Contains("wraith") || s.Contains("drift") || s.Contains("sprite") || s.Contains("ghost") || s.Contains("amorphous") || s.Contains("shade") || s.Contains("shadow"))
                return "amorphous";
            if (s.Contains("spider") || s.Contains("scorpion") || s.Contains("crab") || s.Contains("polyp"))
                return "polyped";
            if (s.Contains("human")) return "humanoid";
            if (s.Contains("quad")) return "quadruped";
            return "quadruped";
        }

        static string GaitFor(string topology)
        {
            if (string.IsNullOrEmpty(topology)) return "quadruped";
            if (topology.StartsWith("winged")) return "winged";
            if (topology == "humanoid") return "biped";
            return topology;
        }

        static float HeightFor(string topology, string species)
        {
            var s = ((topology ?? "") + " " + (species ?? "")).ToLowerInvariant();
            if (s.Contains("bear") || s.Contains("griffin") || s.Contains("wyrm")) return 2.2f;
            if (s.Contains("hawk") || s.Contains("rabbit") || s.Contains("finch") || s.Contains("rat")) return 0.55f;
            if (s.Contains("drone") || s.Contains("sentinel")) return 0.7f;
            return 1.15f;
        }

        static string StemFor(string topology, string species)
        {
            var s = ((species ?? "") + " " + (topology ?? "")).ToLowerInvariant();
            if (s.Contains("drone") || s.Contains("sentinel")) return "enemy-ufo-a";
            if (s.Contains("wraith") || s.Contains("ghost")) return "character-ghost";
            if (s.Contains("construct")) return "astronautA";
            if (s.Contains("drift") || topology == "amorphous") return "alien";
            if (topology == "serpentine" || s.Contains("basilisk")) return "quadruped_01";
            if (topology == "winged_biped" || s.Contains("harpy") || s.Contains("parrot")) return "Parrot";
            if (topology == "winged_quadruped" || s.Contains("griffin") || s.Contains("horse")) return "Horse";
            if (s.Contains("sealie") || s.Contains("flamingo")) return "Flamingo";
            if (topology == "humanoid") return "character-ghost";
            return "Fox";
        }

        static float ScaleHint(string topology, float height)
        {
            var h = height > 0.05f ? height : 1.15f;
            if (topology != null && topology.StartsWith("winged")) return Mathf.Clamp(h * 1.4f, 1.1f, 2.8f);
            return Mathf.Clamp(h, 0.7f, 2.4f);
        }

        static bool IsFlyKind(string kind) =>
            kind is "griffin" or "harpy" or "drone" or "sentinel" or "drift" or "wraith";

        static bool IsPredatorKind(string kind) =>
            kind is "wolf" or "hound" or "griffin" or "basilisk" or "wraith" or "drone" or "sentinel";
    }
}
