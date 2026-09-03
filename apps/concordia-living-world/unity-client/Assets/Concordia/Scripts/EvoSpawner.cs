using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Evo-asset presentation: Kenney/living fauna GLBs when present.
    /// Live path is FaunaLife (wander / graze / flee / hunt / sleep), not a sine orbit.
    /// </summary>
    public class EvoSpawner : MonoBehaviour
    {
        public static GameObject SpawnNamed(Transform parent, WorldBook.Critter c, Vector3 pos, WorldDef world)
        {
            if (c == null) return null;
            if (WorldMemory.IsDead(world.id, c.id) || WorldMemory.IsDead(world.id, c.name))
                return null;
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
                var life = go.GetComponent<FaunaLife>();
                if (life)
                {
                    life.critterId = string.IsNullOrEmpty(c.id) ? c.name : c.id;
                    life.predator = IsPredator(kind);
                }
            }
            return go;
        }

        public static GameObject Spawn(Transform parent, string kind, Vector3 pos, WorldDef world)
        {
            if (WorldMemory.IsDead(world.id, kind) && WorldClock.Ecology < 0.45f)
                return null;
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
            dummy.living = true;
            if (!go.GetComponent<Hostile>()) go.AddComponent<Hostile>();
            var life = go.GetComponent<FaunaLife>() ?? go.AddComponent<FaunaLife>();
            life.fly = IsFly(kind);
            life.predator = IsPredator(kind);
            life.critterId = kind;
            var spin = go.GetComponent<EvoDrift>();
            if (spin) spin.enabled = false;
            return go;
        }

        static bool IsFly(string kind) =>
            kind is "griffin" or "harpy" or "drone" or "sentinel" or "drift" or "wraith";

        static bool IsPredator(string kind) =>
            kind is "wolf" or "hound" or "griffin" or "basilisk" or "wraith" or "drone" or "sentinel";

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

    /// <summary>Legacy sine orbit. Disabled on the live spawn path — FaunaLife owns motion.</summary>
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

    /// <summary>
    /// Visible ecosystem: wander, graze, flee, hunt, sleep. Persist deaths via WorldMemory.
    /// </summary>
    public class FaunaLife : MonoBehaviour
    {
        public bool fly;
        public bool predator;
        public bool hunting;
        public string critterId;
        public string act = "wander";
        Vector3 _home;
        Vector3 _dest;
        CharacterController _cc;
        TrainingDummy _body;
        float _wait;
        float _bulkAt;
        Vector3 _vel;
        Renderer[] _rend;
        bool _hidden;

        void Start()
        {
            _home = transform.position;
            _dest = _home;
            _cc = GetComponent<CharacterController>();
            _body = GetComponent<TrainingDummy>();
            _rend = GetComponentsInChildren<Renderer>(true);
            Pick();
        }

        void Update()
        {
            if (_body && _body.hp <= 0f)
            {
                if (act != "dead")
                {
                    act = "dead";
                    WorldClock.NoteKill(string.IsNullOrEmpty(critterId) ? name : critterId);
                }
                return;
            }

            var lod = WorldClock.LodAt(transform.position);
            Show(lod != SimLod.Virtual);
            if (lod == SimLod.Virtual)
            {
                transform.position = _home;
                return;
            }
            if (lod == SimLod.Bulk && Time.time < _bulkAt) return;
            if (lod == SimLod.Bulk) _bulkAt = Time.time + 0.4f;

            var player = ConcordiaPlayer.Live;
            var toPlayer = player ? player.transform.position - transform.position : Vector3.zero;
            toPlayer.y = 0f;
            var dist = toPlayer.magnitude;
            var night = WorldClock.Hour < 6f || WorldClock.Hour >= 22f;
            var steel = player && Canon.SteelLive(player.world, player.transform.position);

            if (hunting && steel && dist < 18f)
            {
                act = "hunt";
                return;
            }

            if (predator && HuntPrey(lod)) return;

            if (player && dist < (predator ? 7f : 11f) && (!predator || !steel))
            {
                act = "flee";
                var away = transform.position - toPlayer.normalized * 8f;
                Step(away, fly ? 4.2f : 3.6f);
                if (lod == SimLod.Real) WorldClock.NoteAct(Label() + " flees");
                return;
            }

            if (night && !fly)
            {
                act = "sleep";
                Step(_home, 1.4f);
                return;
            }

            if (hunting) { act = "hunt"; return; }

            if (_wait > 0f)
            {
                _wait -= Time.deltaTime;
                Hold();
                if (_wait <= 0f) Pick();
                act = "graze";
                return;
            }

            var to = _dest - transform.position;
            to.y = 0f;
            if (to.magnitude < 1.2f)
            {
                _wait = Random.Range(1.6f, 4.2f);
                Hold();
                return;
            }
            act = "wander";
            Step(_dest, fly ? 2.6f : 1.8f);
            if (lod == SimLod.Real && dist < 18f) WorldClock.NoteAct(Label() + " " + act + "s");
        }

        bool HuntPrey(SimLod lod)
        {
            FaunaLife prey = null;
            float best = 14f;
            foreach (var f in FindObjectsByType<FaunaLife>(FindObjectsInactive.Exclude))
            {
                if (!f || f == this || f.predator) continue;
                if (f.act == "dead") continue;
                var d = Vector3.Distance(transform.position, f.transform.position);
                if (d < best) { best = d; prey = f; }
            }
            if (!prey) return false;
            act = "hunt";
            Step(prey.transform.position, fly ? 3.8f : 3.1f);
            if (lod == SimLod.Real) WorldClock.NoteAct(Label() + " hunts");
            return true;
        }

        void Pick()
        {
            var cities = CityAtlas.For(WorldClock.World);
            if (cities != null && cities.Length > 0 && Random.value < 0.45f)
            {
                var c = cities[Random.Range(0, Mathf.Min(3, cities.Length))];
                _dest = Vector3.Lerp(_home, new Vector3(c.x, 0f, c.z), 0.4f);
                return;
            }
            var a = Random.Range(0f, Mathf.PI * 2f);
            var r = Random.Range(2.4f, 9f);
            _dest = _home + new Vector3(Mathf.Cos(a) * r, 0f, Mathf.Sin(a) * r);
        }

        void Step(Vector3 dest, float speed)
        {
            var to = dest - transform.position;
            to.y = 0f;
            if (to.sqrMagnitude < 0.04f) { Hold(); return; }
            var dir = to.normalized;
            if (_cc)
            {
                if (_cc.isGrounded && _vel.y < 0f) _vel.y = fly ? 0f : -1.5f;
                else if (!fly) _vel.y += -22f * Time.deltaTime;
                _vel.x = Mathf.Lerp(_vel.x, dir.x * speed, 1f - Mathf.Exp(-7f * Time.deltaTime));
                _vel.z = Mathf.Lerp(_vel.z, dir.z * speed, 1f - Mathf.Exp(-7f * Time.deltaTime));
                if (fly) _vel.y = Mathf.Sin(Time.time) * 0.35f;
                _cc.Move(_vel * Time.deltaTime);
            }
            else
                transform.position += dir * speed * Time.deltaTime;
            if (dir.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(dir), Time.deltaTime * 6f);
        }

        void Hold()
        {
            if (!_cc) return;
            if (_cc.isGrounded) _vel.y = fly ? 0f : -1.5f;
            else if (!fly) _vel.y += -22f * Time.deltaTime;
            _vel.x = 0f;
            _vel.z = 0f;
            _cc.Move(_vel * Time.deltaTime);
        }

        void Show(bool on)
        {
            if (_hidden == !on) return;
            _hidden = !on;
            if (_rend == null) _rend = GetComponentsInChildren<Renderer>(true);
            foreach (var r in _rend) if (r) r.enabled = on;
            if (_cc) _cc.enabled = on;
        }

        string Label()
        {
            if (!string.IsNullOrEmpty(critterId)) return critterId;
            return name.Replace("Evo_", "");
        }
    }
}
