using UnityEngine;

namespace Concordia
{
    public class WorldGate : MonoBehaviour
    {
        public GateDef def;
        public string Prompt => "E  ·  " + def.name + "  —  " + def.refusal;

        void Start()
        {
            GatePost.Ensure(this);
        }
    }

    /// <summary>
    /// A gate is a place: owner faction, tariff, inspection, unlabeled guards.
    /// Ownership comes from authored faction / Watch, not a Unity boolean.
    /// </summary>
    public class GatePost : MonoBehaviour
    {
        public string ownerFaction;
        public float tariffRate = 0.05f;
        public int inspectionLevel = 1;
        public bool waystone;

        public static void Ensure(WorldGate gate)
        {
            if (!gate || gate.GetComponent<GatePost>()) return;
            var post = gate.gameObject.AddComponent<GatePost>();
            var dest = gate.def != null ? gate.def.world : WorldId.Hub;
            post.waystone = dest == WorldId.Sere;
            post.tariffRate = post.waystone ? 0f : CrossRing.RingTariff;
            post.inspectionLevel = post.waystone ? 0 : 1;
            if (post.waystone)
            {
                post.ownerFaction = "";
                return;
            }
            if (WorldClock.World == WorldId.Hub)
                post.ownerFaction = "Concordant Watch";
            else
                post.ownerFaction = OwnerOf(WorldClock.World);
            int n = WorldClock.World == WorldId.Hub ? 2 : 1;
            for (int i = 0; i < n; i++)
            {
                var side = (i == 0 ? -1.6f : 1.6f);
                var pos = gate.transform.position + gate.transform.right * side + Vector3.up * 0.05f;
                var look = Appearance.Random(gate.GetHashCode() + i * 17);
                look.displayName = "a guard";
                look.outfit = 1;
                var go = ModularPerson.SpawnNpc(gate.transform, pos, gate.transform.eulerAngles.y + 180f, look, false);
                go.name = "a guard";
                var life = go.AddComponent<NpcLife>();
                life.job = NpcLife.Job.Watch;
                var guest = go.AddComponent<GuestNpc>();
                guest.def = new GuestDef
                {
                    id = "gate-guard-" + dest + "-" + i,
                    name = "a guard",
                    title = post.ownerFaction,
                    line = "They keep their own hours. Not an authored citizen."
                };
            }
        }

        static string OwnerOf(WorldId id)
        {
            if (id == WorldId.Hub) return "Concordant Watch";
            var facs = WorldBook.Factions(id);
            if (facs != null && facs.Length > 0 && !string.IsNullOrEmpty(facs[0].name))
                return facs[0].name;
            return Canon.Get(id).title;
        }
    }

    // City inside the current world. E walks you into that town plaza.
    public class CityGate : MonoBehaviour
    {
        public WorldBook.CityDef city;
        public string Prompt => city == null || string.IsNullOrEmpty(city.name)
            ? "E  ·  town"
            : "E  ·  Enter " + city.name;
    }

    public class LoreStone : MonoBehaviour
    {
        public string title, text;
        public string Prompt => "E  ·  " + title;
    }

    public class GuestNpc : MonoBehaviour
    {
        public GuestDef def;
        public string personId;
        public string[] questHooks;
        public string Prompt => "E  ·  " + def.name + ", " + def.title;
    }

    /// <summary>Authored quest on a board. E accepts or reports progress.</summary>
    public class QuestBoard : MonoBehaviour
    {
        public WorldBook.Quest quest;
        public WorldId world;
        public string Prompt => quest == null || string.IsNullOrEmpty(quest.title)
            ? "E  ·  quest"
            : "E  ·  " + quest.title;
    }

    /// <summary>Reach-location token. Standing inside radius stamps the log.</summary>
    public class QuestBeacon : MonoBehaviour
    {
        public string[] tokens;
        public float radius = 6f;
    }

    /// <summary>Kenney hold mouth. Geometry is dressing; the plaque stays honest.</summary>
    public class DungeonGate : MonoBehaviour
    {
        public string holdName = "the hold";
        public Vector3 inside;
        public Vector3 mouth;
        public bool inHold;
        public string Prompt => inHold
            ? "E  ·  Leave " + holdName
            : "E  ·  Enter " + holdName;
    }

    /// <summary>E picks up. Only stamps what this object actually is.</summary>
    public class Gatherable : MonoBehaviour
    {
        public string itemId = "chest";
        public string label = "chest";
        public bool taken;
        public string Prompt => taken ? null : "E  ·  Take " + label;
    }

    /// <summary>A kitchen you walk to. Cooks only if you actually gathered something.</summary>
    public class CookStation : MonoBehaviour
    {
        public string Prompt => "E  ·  Cook";

        public static void Stamp(GameObject go)
        {
            if (!go || go.GetComponent<CookStation>()) return;
            go.AddComponent<CookStation>();
        }

        public string Use()
        {
            if (!QuestLog.HoldingAny())
                return "The stove is cold. Take ingredients from a chest or market first.";
            QuestLog.NoteGather("meal");
            WorldClock.NoteAct("someone cooks");
            return "You cook what you gathered. The meal is real because the ingredients were.";
        }
    }

    public class CourtBird : MonoBehaviour
    {
        public int seed;
        public float radius = 12f;
        public float height = 8f;
        float _phase, _speed, _bob;
        Transform _wingL, _wingR;

        void Start()
        {
            var rng = new System.Random(seed == 0 ? gameObject.GetHashCode() : seed);
            _phase = (float)rng.NextDouble() * Mathf.PI * 2f;
            _speed = 0.35f + (float)rng.NextDouble() * 0.45f;
            _bob = 0.4f + (float)rng.NextDouble() * 0.6f;
            radius = radius <= 0 ? 10f + (float)rng.NextDouble() * 12f : radius;
            height = height <= 0 ? 6f + (float)rng.NextDouble() * 5f : height;

            var body = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            body.name = "Body";
            body.transform.SetParent(transform, false);
            body.transform.localScale = new Vector3(0.22f, 0.14f, 0.28f);
            Object.Destroy(body.GetComponent<Collider>());
            var cream = HubLook.Lit(new Color(0.92f, 0.88f, 0.78f), 0.02f, 0.35f);
            body.GetComponent<Renderer>().sharedMaterial = cream;
            _wingL = MakeWing(new Vector3(-0.14f, 0.02f, 0f), cream);
            _wingR = MakeWing(new Vector3(0.14f, 0.02f, 0f), cream);
        }

        Transform MakeWing(Vector3 local, Material mat)
        {
            var w = GameObject.CreatePrimitive(PrimitiveType.Cube);
            w.name = "Wing";
            w.transform.SetParent(transform, false);
            w.transform.localPosition = local;
            w.transform.localScale = new Vector3(0.22f, 0.03f, 0.14f);
            Object.Destroy(w.GetComponent<Collider>());
            w.GetComponent<Renderer>().sharedMaterial = mat;
            return w.transform;
        }

        void Update()
        {
            _phase += Time.deltaTime * _speed;
            var p = new Vector3(Mathf.Cos(_phase) * radius, height + Mathf.Sin(_phase * 2.4f) * _bob, Mathf.Sin(_phase) * radius);
            var tan = new Vector3(-Mathf.Sin(_phase), 0f, Mathf.Cos(_phase));
            transform.position = p;
            if (tan.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(tan, Vector3.up), Time.deltaTime * 4f);
            float flap = Mathf.Sin(Time.time * 11f + _phase) * 28f;
            if (_wingL) _wingL.localRotation = Quaternion.Euler(0f, 0f, flap);
            if (_wingR) _wingR.localRotation = Quaternion.Euler(0f, 0f, -flap);
        }
    }
}
