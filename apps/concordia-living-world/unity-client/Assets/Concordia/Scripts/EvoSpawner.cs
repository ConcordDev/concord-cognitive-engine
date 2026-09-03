using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Evo-asset presentation: Kenney/living fauna GLBs when present.
    /// </summary>
    public class EvoSpawner : MonoBehaviour
    {
        public static GameObject SpawnNamed(Transform parent, WorldBook.Critter c, Vector3 pos, WorldDef world)
        {
            var hint = (c.topology_hint ?? "").ToLowerInvariant();
            string kind =
                hint.Contains("quad") ? "wolf" :
                hint.Contains("wing") ? "harpy" :
                hint.Contains("serpent") ? "basilisk" :
                hint.Contains("drone") || hint.Contains("mech") ? "drone" :
                hint.Contains("human") ? "wraith" :
                "hound";
            var go = Spawn(parent, kind, pos, world);
            if (go)
            {
                go.name = string.IsNullOrEmpty(c.name) ? c.id : c.name;
                var dummy = go.GetComponent<TrainingDummy>();
                if (dummy) dummy.unburied = world.id == WorldId.Ruins || world.id == WorldId.Crucible;
            }
            return go;
        }

        public static GameObject Spawn(Transform parent, string kind, Vector3 pos, WorldDef world)
        {
            var stem = StemFor(kind);
            GameObject go = null;
            if (!string.IsNullOrEmpty(stem))
                go = FreePacks.Spawn(stem, parent, pos, Random.Range(0, 360f), ScaleHint(kind));
            if (go == null)
            {
                go = GameObject.CreatePrimitive(KindPrim(kind));
                go.name = "Evo_" + kind;
                go.transform.SetParent(parent, false);
                var fly = IsFly(kind);
                go.transform.position = pos + Vector3.up * (fly ? 2.4f : 0.6f);
                go.transform.localScale = ScaleFor(kind);
                var r = go.GetComponent<Renderer>();
                r.material = new Material(r.sharedMaterial) { color = ColorFor(kind, world) };
            }
            go.name = "Evo_" + kind;
            FreePacks.EnsureCollider(go, 1.2f);
            if (!go.GetComponent<CharacterController>())
                Grounding.EnsureController(go, 1.4f);
            var dummy = go.GetComponent<TrainingDummy>() ?? go.AddComponent<TrainingDummy>();
            dummy.unburied = world.id == WorldId.Ruins || world.id == WorldId.Crucible;
            dummy.hp = 70;
            if (!go.GetComponent<Hostile>()) go.AddComponent<Hostile>();
            var spin = go.GetComponent<EvoDrift>() ?? go.AddComponent<EvoDrift>();
            spin.fly = IsFly(kind);
            return go;
        }

        static bool IsFly(string kind) =>
            kind is "griffin" or "harpy" or "drone" or "sentinel" or "drift" or "wraith";

        static string StemFor(string k) => k switch
        {
            "wolf" or "hound" => "Fox",
            "sealie" => "Flamingo",
            "griffin" => "Horse",
            "harpy" => "Parrot",
            "wraith" => "character-ghost",
            "drone" or "sentinel" => "enemy-ufo-a",
            "construct" => "astronautA",
            "basilisk" => "quadruped_01",
            "drift" => "alien",
            _ => "Fox"
        };

        static float ScaleHint(string k) => k switch
        {
            "griffin" => 2.6f,
            "drone" or "sentinel" => 1.5f,
            "wraith" => 1.85f,
            "wolf" or "hound" => 1.15f,
            "sealie" => 1.4f,
            "harpy" => 1.1f,
            _ => 1.25f
        };

        static PrimitiveType KindPrim(string k) =>
            k is "drone" or "construct" or "golem" ? PrimitiveType.Cube :
            k is "serpent" or "wyrm" or "basilisk" ? PrimitiveType.Capsule :
            PrimitiveType.Sphere;

        static Vector3 ScaleFor(string k) => k switch
        {
            "griffin" or "dragon" or "wyrm" => new Vector3(1.6f, 0.7f, 1.8f),
            "wolf" or "hound" or "sealie" => new Vector3(0.9f, 0.55f, 1.3f),
            "drone" => new Vector3(0.5f, 0.2f, 0.7f),
            _ => Vector3.one * 0.8f
        };

        static Color ColorFor(string k, WorldDef w) => k switch
        {
            "wraith" => new Color(0.7f, 0.85f, 0.9f, 0.7f),
            "drone" => w.sun,
            "sealie" => new Color(0.4f, 0.7f, 0.85f),
            _ => Color.Lerp(w.ground, w.sun, 0.4f)
        };
    }

    public class EvoDrift : MonoBehaviour
    {
        public bool fly;
        Vector3 _home;
        void Start() => _home = transform.position;
        void Update()
        {
            var t = Time.time;
            var o = new Vector3(Mathf.Sin(t * 0.4f), fly ? Mathf.Sin(t) * 0.35f : 0, Mathf.Cos(t * 0.4f));
            transform.position = _home + o;
        }
    }
}
