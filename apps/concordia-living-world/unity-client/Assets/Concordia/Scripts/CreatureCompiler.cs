using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Detached genome card. Generation 0 = founding stock, not a fabricated lineage.
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
    /// genome → phenotype → Unity body.
    /// Real pack mesh or no spawn. Wolf is not a Fox. Griffin is not a Horse.
    /// Missing stem returns null — better empty habitat than a Kenney balloon.
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
                if (g) g.Bind(card);
                var life = existing.GetComponent<FaunaLife>();
                if (life && g) life.BindGenome(g);
                return existing;
            }

            var stem = StemFor(card.topology, card.speciesId);
            if (string.IsNullOrEmpty(stem)) return null;

            var height = card.heightM > 0.05f ? card.heightM : HeightFor(card.topology, card.speciesId);
            var go = FreePacks.Spawn(stem, parent, pos, Random.Range(0, 360f), ScaleHint(card.topology, height), required: false);
            if (!go) return null;
            go.name = key;

            var genome = go.GetComponent<CreatureGenome>() ?? go.AddComponent<CreatureGenome>();
            genome.Bind(card);

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
                predator = PredatorHint((c.topology_hint ?? "") + " " + id),
                lifestyle = PredatorHint((c.topology_hint ?? "") + " " + id) ? "carnivore" : "omnivore",
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
            if (s.Contains("wing") || s.Contains("hawk") || s.Contains("harpy") || s.Contains("griffin")
                || s.Contains("drake") || s.Contains("dragon") || s.Contains("wyvern")
                || s.Contains("falcon") || s.Contains("owl") || s.Contains("pigeon") || s.Contains("finch")
                || s.Contains("sparrow") || s.Contains("robin") || s.Contains("cardinal"))
                return s.Contains("quad") || s.Contains("griffin") || s.Contains("drake") || s.Contains("dragon")
                    ? "winged_quadruped" : "winged_biped";
            if (s.Contains("serpent") || s.Contains("snake") || s.Contains("viper") || s.Contains("basilisk") || s.Contains("wyrm"))
                return "serpentine";
            if (s.Contains("drone") || s.Contains("mech") || s.Contains("construct") || s.Contains("sentinel"))
                return "humanoid";
            if (s.Contains("wraith") || s.Contains("drift") || s.Contains("sprite") || s.Contains("ghost")
                || s.Contains("amorphous") || s.Contains("shade") || s.Contains("shadow"))
                return "amorphous";
            if (s.Contains("spider") || s.Contains("scorpion") || s.Contains("crab") || s.Contains("polyp"))
                return "polyped";
            if (s.Contains("human")) return "humanoid";
            if (s.Contains("quad")) return "quadruped";
            return "quadruped";
        }

        /// <summary>
        /// Honest stem. Empty string means do not spawn.
        /// Never maps wolf→Fox, griffin→Horse, harpy→Parrot.
        /// </summary>
        public static string StemFor(string topology, string species)
        {
            var s = ((species ?? "") + " " + (topology ?? "")).ToLowerInvariant();
            if (s.Contains("drone") || s.Contains("sentinel"))
                return Pick(new[] { "enemy-ufo-a" });
            if (s.Contains("wraith") || s.Contains("ghost"))
                return Pick(new[] { "character-ghost" });
            if (s.Contains("construct"))
                return Pick(new[] { "astronautA" });
            if (topology == "amorphous" || s.Contains("drift"))
                return Pick(new[] { "alien" });
            if (topology == "serpentine" || s.Contains("basilisk") || s.Contains("snake") || s.Contains("wyrm"))
                return Pick(new[] { "quadruped_01", "snake", "serpent" });
            if (topology == "winged_biped" || s.Contains("harpy") || s.Contains("sparrow")
                || s.Contains("robin") || s.Contains("cardinal") || s.Contains("finch"))
                return PickBird();
            if (topology == "winged_quadruped" || s.Contains("griffin") || s.Contains("drake") || s.Contains("dragon"))
                return Pick(new[] { "griffin", "wyvern", "dragon" });
            if (s.Contains("wolf") || s.Contains("hound") || s.Contains("dog"))
                return Pick(new[] { "Wolf", "wolf", "Husky", "Dog", "dog" });
            if (s.Contains("sealie"))
                return Pick(new[] { "Flamingo", "seal", "sealie" });
            if (s.Contains("horse"))
                return Pick(new[] { "Horse", "horse" });
            if (s.Contains("fox"))
                return Pick(new[] { "Fox", "fox" });
            if (s.Contains("rabbit"))
                return Pick(new[] { "rabbit", "Rabbit", "hare" });
            if (!string.IsNullOrEmpty(species))
            {
                var self = Pick(new[] { species, species.ToLowerInvariant() });
                if (!string.IsNullOrEmpty(self)) return self;
            }
            return "";
        }

        static string Pick(string[] prefer)
        {
            if (prefer != null)
            {
                foreach (var n in prefer)
                    if (!string.IsNullOrEmpty(n) && FreePacks.HasStem(n)) return n;
            }
            return DressVocab.FirstStem(prefer, "");
        }

        static string PickBird()
        {
            var bird = DressVocab.Bird();
            if (!string.IsNullOrEmpty(bird)) return bird;
            return Pick(new[] { "lb_sparrow", "lb_robin", "lb_cardinal" });
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

        static float ScaleHint(string topology, float height)
        {
            var h = height > 0.05f ? height : 1.15f;
            if (topology != null && topology.StartsWith("winged")) return Mathf.Clamp(h * 1.4f, 1.1f, 2.8f);
            return Mathf.Clamp(h, 0.7f, 2.4f);
        }

        static bool PredatorHint(string s)
        {
            s = (s ?? "").ToLowerInvariant();
            return s.Contains("wolf") || s.Contains("drake") || s.Contains("griffin")
                || s.Contains("basilisk") || s.Contains("hound");
        }

        static bool IsFlyKind(string kind) =>
            kind is "griffin" or "harpy" or "drone" or "sentinel" or "drift" or "wraith";

        static bool IsPredatorKind(string kind) =>
            kind is "wolf" or "hound" or "griffin" or "basilisk" or "wraith" or "drone" or "sentinel";
    }

    /// <summary>
    /// Moves a real Living Birds mesh on a sine orbit. Not a Sphere+Cube dove.
    /// </summary>
    public class FlockOrbit : MonoBehaviour
    {
        public float radius = 12f;
        public float height = 8f;
        float _phase, _speed, _bob;
        Vector3 _origin;

        void Start()
        {
            _origin = transform.position;
            _phase = Random.Range(0f, Mathf.PI * 2f);
            _speed = 0.35f + Random.value * 0.45f;
            _bob = 0.4f + Random.value * 0.6f;
            if (radius <= 0f) radius = 10f + Random.value * 12f;
            if (height <= 0f) height = 6f + Random.value * 5f;
        }

        void Update()
        {
            _phase += Time.deltaTime * _speed;
            var p = _origin + new Vector3(Mathf.Cos(_phase) * radius, height + Mathf.Sin(_phase * 2.4f) * _bob, Mathf.Sin(_phase) * radius);
            var tan = new Vector3(-Mathf.Sin(_phase), 0f, Mathf.Cos(_phase));
            transform.position = p;
            if (tan.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(tan, Vector3.up), Time.deltaTime * 4f);
        }
    }
}
