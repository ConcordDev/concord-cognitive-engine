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

        void Start()
        {
            var name = def != null ? def.name : "someone";
            var role = def != null ? def.title : null;
            PersonLabel.Attach(transform, name, role);
        }
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
        public string encounterId = "hollow_warden";
        public string holdName = "The Hollow Warden";
        public Vector3 inside;
        public Vector3 mouth;
        public bool inHold;
        public string Prompt => inHold
            ? "E  ·  Leave " + holdName
            : "E  ·  Enter " + holdName;

        /// <summary>
        /// F5.1 lockout: kernel said locked_out after dungeon:open.
        /// Geometry is local; eject instead of staying in a sealed hold.
        /// </summary>
        public static void EjectIfInside()
        {
            var player = ConcordiaPlayer.Live;
            if (!player || !player.cc) return;
            foreach (var g in FindObjectsByType<DungeonGate>(FindObjectsInactive.Exclude))
            {
                if (!g || !g.inHold) continue;
                g.inHold = false;
                player.cc.enabled = false;
                player.transform.position = g.mouth;
                player.cc.enabled = true;
                Grounding.Snap(player.cc);
            }
        }
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

    /// <summary>T1 nameplate. World-space name over a living person.</summary>
    public class PersonLabel : MonoBehaviour
    {
        public string title;
        public string role;
        TextMesh _mesh;
        const float MaxDist = 22f;

        public static PersonLabel Attach(Transform host, string title, string role = null)
        {
            if (!host) return null;
            var existing = host.GetComponentInChildren<PersonLabel>();
            if (existing)
            {
                existing.title = title;
                existing.role = role;
                existing.Apply();
                return existing;
            }
            var go = new GameObject("Nameplate");
            go.transform.SetParent(host, false);
            go.transform.localPosition = new Vector3(0f, 2.15f, 0f);
            var lab = go.AddComponent<PersonLabel>();
            lab.title = title;
            lab.role = role;
            lab.Build();
            return lab;
        }

        void Build()
        {
            _mesh = gameObject.AddComponent<TextMesh>();
            _mesh.anchor = TextAnchor.LowerCenter;
            _mesh.alignment = TextAlignment.Center;
            _mesh.characterSize = 0.045f;
            _mesh.fontSize = 42;
            _mesh.color = new Color(1f, 0.94f, 0.82f, 0.95f);
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (font)
            {
                _mesh.font = font;
                var matRend = _mesh.GetComponent<Renderer>();
                if (matRend && font.material) matRend.sharedMaterial = font.material;
            }
            var rend = _mesh.GetComponent<Renderer>();
            if (rend)
            {
                rend.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                rend.receiveShadows = false;
            }
            Apply();
        }

        void Apply()
        {
            if (!_mesh) _mesh = GetComponent<TextMesh>();
            if (!_mesh) return;
            var line = string.IsNullOrEmpty(title) ? "someone" : title;
            if (!string.IsNullOrEmpty(role)) line += "\n" + role;
            _mesh.text = line;
        }

        void LateUpdate()
        {
            var cam = Camera.main;
            var rend = _mesh ? _mesh.GetComponent<Renderer>() : GetComponent<Renderer>();
            if (!cam)
            {
                if (rend) rend.enabled = false;
                return;
            }
            var d = Vector3.Distance(cam.transform.position, transform.position);
            var show = d < MaxDist;
            if (rend) rend.enabled = show;
            if (!show) return;
            transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
        }
    }

    public static class WorldPresence
    {
        public static GuestNpc FindGuest(string id)
        {
            if (string.IsNullOrEmpty(id)) return null;
            foreach (var n in Object.FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude))
            {
                if (!n) continue;
                if (n.personId == id) return n;
                if (n.def != null && n.def.id == id) return n;
            }
            return null;
        }

        public static WorldGate GateToward(string kernelWorld)
        {
            if (string.IsNullOrEmpty(kernelWorld)) return null;
            foreach (var g in Object.FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude))
            {
                if (!g || g.def == null) continue;
                if (WorldBook.Folder(g.def.world) == kernelWorld) return g;
            }
            return null;
        }

        public static bool InPresenter(float x, float z)
        {
            var mag = new Vector2(x, z).magnitude;
            return mag > 0.4f && mag <= Canon.RingRadius + 16f;
        }
    }

    /// <summary>
    /// Kernel tomb from world:snapshot.tombs. Coords outside the presenter
    /// stay unplaced. Matching GuestNpc feet win over a far kernel xz.
    /// </summary>
    public class KernelTomb : MonoBehaviour
    {
        public string npcId;
        public string lastWords;
        public string Prompt => string.IsNullOrEmpty(lastWords)
            ? "E  ·  a grave"
            : "E  ·  last words";

        public static KernelTomb Place(string npcId, string lastWords, float x, float z)
        {
            if (string.IsNullOrEmpty(npcId)) return null;
            var existing = GameObject.Find("KernelTomb_" + npcId);
            if (existing) return existing.GetComponent<KernelTomb>();
            var guest = WorldPresence.FindGuest(npcId);
            Vector3 p;
            if (guest)
                p = guest.transform.position + guest.transform.right * 0.9f;
            else if (WorldPresence.InPresenter(x, z))
                p = new Vector3(x, 0.08f, z);
            else
                return null;
            var root = Object.FindFirstObjectByType<WorldBuilder>();
            var parent = root ? root.transform : null;
            var stone = HubLook.Prim(parent, PrimitiveType.Cube, p + Vector3.up * 0.55f,
                new Vector3(0.55f, 1.1f, 0.22f),
                HubLook.Lit(new Color(0.38f, 0.34f, 0.3f), 0.04f, 0.18f),
                "KernelTomb_" + npcId);
            var tomb = stone.AddComponent<KernelTomb>();
            tomb.npcId = npcId;
            tomb.lastWords = lastWords ?? "";
            foreach (var n in Object.FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude))
            {
                if (!n || n == guest) continue;
                if (Vector3.Distance(n.transform.position, stone.transform.position) > 12f) continue;
                var life = n.GetComponent<NpcLife>();
                if (life) life.Notice(stone.transform, 5f);
            }
            return tomb;
        }
    }

    /// <summary>
    /// Real gossip summary on a matching GuestNpc. One-shot when the player
    /// walks within 7m. Does not spawn a fake speaker.
    /// </summary>
    public class GossipEar : MonoBehaviour
    {
        public string summary;
        bool _heard;
        const float Reach = 7f;

        public static void Attach(GuestNpc npc, string line)
        {
            if (!npc || string.IsNullOrEmpty(line)) return;
            var ear = npc.GetComponent<GossipEar>();
            if (!ear) ear = npc.gameObject.AddComponent<GossipEar>();
            ear.summary = line;
            ear._heard = false;
        }

        void Update()
        {
            if (_heard || string.IsNullOrEmpty(summary)) return;
            var p = ConcordiaPlayer.Live;
            if (!p) return;
            if (Vector3.Distance(p.transform.position, transform.position) > Reach) return;
            _heard = true;
            WorldClock.LastEvent = summary;
            WorldClock.PushFeed("gossip", summary);
            var life = GetComponent<NpcLife>();
            if (life) life.NoticePlayer(4f);
        }
    }

    /// <summary>
    /// Player co-location centroid from world:gathering-detected. Marker only;
    /// never a fabricated crowd.
    /// </summary>
    public class GatheringTell : MonoBehaviour
    {
        float _life = 18f;

        public static void Place(float x, float y, float z)
        {
            if (!WorldPresence.InPresenter(x, z)) return;
            PlaceAt(new Vector3(x, y > 0.01f && y < 4.5f ? y : 0.08f, z));
        }

        public static void PlaceAt(Vector3 p)
        {
            var root = Object.FindFirstObjectByType<WorldBuilder>();
            var parent = root ? root.transform : null;
            var go = HubLook.Prim(parent, PrimitiveType.Cylinder,
                new Vector3(p.x, p.y + 0.04f, p.z),
                new Vector3(2.4f, 0.04f, 2.4f),
                HubLook.Emit(new Color(0.95f, 0.82f, 0.45f), 1.6f),
                "GatheringTell", false);
            go.AddComponent<GatheringTell>();
        }

        void Update()
        {
            _life -= Time.deltaTime;
            if (_life <= 0f) Destroy(gameObject);
        }
    }

    /// <summary>
    /// World boss body only at an existing DungeonGate mouth. No invented xz.
    /// Template slug may differ from hollow_warden — the hold is the site.
    /// Hostile + TrainingDummy are the body: HP / phase from kernel BindState,
    /// attacks from Hostile, death → Fall → chronicle plaque at the mouth.
    /// </summary>
    public class WorldBoss : MonoBehaviour
    {
        public static WorldBoss Live;
        public string template;
        public string activeId;
        public string encounterId;
        public float hp = -1f, maxHp = 1f;
        public string phase;
        public string mechanic;
        public bool fallen;
        public float HpPct => maxHp > 0f && hp >= 0f ? Mathf.Clamp01(hp / maxHp) : -1f;
        TrainingDummy _dummy;
        Hostile _hostile;
        Vector3 _scale0;
        Renderer _rend;

        public static WorldBoss Present(string template, string activeId)
        {
            DungeonGate hold = null;
            foreach (var g in FindObjectsByType<DungeonGate>(FindObjectsInactive.Exclude))
            {
                if (g && g.gameObject.activeInHierarchy) { hold = g; break; }
            }
            if (!hold) return null;
            var key = "WorldBoss_" + (string.IsNullOrEmpty(activeId) ? (template ?? "open") : activeId);
            var existing = GameObject.Find(key);
            if (existing)
            {
                var boss = existing.GetComponent<WorldBoss>();
                if (boss)
                {
                    Live = boss;
                    if (!string.IsNullOrEmpty(template)) boss.template = template;
                    if (!string.IsNullOrEmpty(hold.encounterId)) boss.encounterId = hold.encounterId;
                }
                return boss;
            }
            var root = FindFirstObjectByType<WorldBuilder>();
            var parent = root ? root.transform : null;
            var p = hold.mouth + Vector3.up * 1.6f + hold.transform.forward * 1.4f;
            var go = HubLook.Prim(parent, PrimitiveType.Capsule, p,
                new Vector3(1.6f, 2.4f, 1.6f),
                HubLook.Lit(new Color(0.52f, 0.12f, 0.1f), 0.1f, 0.32f),
                key);
            var presented = go.AddComponent<WorldBoss>();
            presented.template = template ?? "";
            presented.activeId = activeId ?? "";
            presented.encounterId = hold.encounterId ?? "";
            presented._rend = go.GetComponent<Renderer>();
            presented._scale0 = go.transform.localScale;
            var cc = go.GetComponent<CharacterController>() ?? go.AddComponent<CharacterController>();
            cc.height = 3.2f;
            cc.radius = 0.7f;
            cc.center = Vector3.up * 0.2f;
            presented._dummy = go.GetComponent<TrainingDummy>() ?? go.AddComponent<TrainingDummy>();
            presented._dummy.living = true;
            presented._dummy.hp = 80f;
            presented._hostile = go.GetComponent<Hostile>() ?? go.AddComponent<Hostile>();
            presented._hostile.damage = 16f;
            presented._hostile.range = 2.6f;
            presented._hostile.aggro = 22f;
            presented._hostile.speed = 2.2f;
            Live = presented;
            var label = string.IsNullOrEmpty(template) ? hold.holdName : template;
            PersonLabel.Attach(go.transform, label, "boss");
            return presented;
        }

        public static void BindState(string name, float hp, float maxHp, string phase, string mechanic)
        {
            var boss = Live;
            if (!boss) boss = Present(name, null);
            if (!boss) return;
            if (!string.IsNullOrEmpty(name)) boss.template = name;
            boss.hp = hp;
            boss.maxHp = maxHp > 0f ? maxHp : 1f;
            var prev = boss.phase;
            boss.phase = phase ?? "";
            boss.mechanic = mechanic ?? "";
            var title = string.IsNullOrEmpty(boss.template) ? "world boss" : boss.template;
            if (!string.IsNullOrEmpty(phase)) title += " · " + phase;
            PersonLabel.Attach(boss.transform, title, mechanic);
            boss.PaintPhase(prev != boss.phase);
            if (boss._dummy)
            {
                if (hp >= 0f) boss._dummy.SyncHp(hp);
            }
            if (hp >= 0f && hp <= 0.01f) boss.Fall();
        }

        void PaintPhase(bool entered)
        {
            var pct = HpPct < 0f ? 1f : HpPct;
            if (_scale0.sqrMagnitude < 0.01f) _scale0 = transform.localScale;
            transform.localScale = _scale0 * (1f + (1f - pct) * 0.18f);
            if (!_rend) _rend = GetComponent<Renderer>();
            if (_rend)
            {
                var c = phase == "desperate" || phase == "undertow"
                    ? new Color(0.95f, 0.18f, 0.08f)
                    : phase == "sundered" || phase == "surge"
                        ? new Color(0.85f, 0.38f, 0.1f)
                        : new Color(0.52f, 0.12f, 0.1f);
                _rend.material = HubLook.Lit(c, entered ? 0.35f : 0.12f, 0.32f);
            }
            if (entered && _hostile) _hostile.TelegraphNow();
        }

        public void Fall()
        {
            if (fallen) return;
            fallen = true;
            hp = 0f;
            if (_dummy) _dummy.hp = 0f;
            if (_hostile) _hostile.enabled = false;
            transform.rotation = Quaternion.Euler(78f, transform.eulerAngles.y, 12f);
            PersonLabel.Attach(transform, string.IsNullOrEmpty(template) ? "fallen" : template, "fallen");
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
        }
    }

    /// <summary>
    /// Match chronicle plaque at the Arena. Only when a real chronicleId exists.
    /// </summary>
    public class ChroniclePlaque : MonoBehaviour
    {
        public string chronicleId;
        public string title;
        public string summary;
        public string Prompt => string.IsNullOrEmpty(title) ? "E  ·  chronicle" : "E  ·  " + title;

        public static ChroniclePlaque Place(string chronicleId, string title, string summary)
        {
            if (string.IsNullOrEmpty(chronicleId)) return null;
            var existing = GameObject.Find("ChroniclePlaque_" + chronicleId);
            if (existing) return existing.GetComponent<ChroniclePlaque>();
            var root = FindFirstObjectByType<WorldBuilder>();
            var parent = root ? root.transform : null;
            var p = Canon.Arena + Vector3.right * 3.4f + Vector3.up * 0.9f;
            if (WorldBoss.Live && WorldBoss.Live.fallen)
                p = WorldBoss.Live.transform.position + Vector3.right * 2.2f + Vector3.up * 0.9f;
            var go = HubLook.Prim(parent, PrimitiveType.Cube, p,
                new Vector3(0.9f, 1.4f, 0.14f),
                HubLook.Lit(new Color(0.42f, 0.36f, 0.22f), 0.12f, 0.28f),
                "ChroniclePlaque_" + chronicleId);
            var plaque = go.AddComponent<ChroniclePlaque>();
            plaque.chronicleId = chronicleId;
            plaque.title = title ?? "";
            plaque.summary = summary ?? "";
            var stone = go.AddComponent<LoreStone>();
            stone.title = string.IsNullOrEmpty(title) ? "chronicle" : title;
            stone.text = string.IsNullOrEmpty(summary) ? "a bout was recorded." : summary;
            return plaque;
        }
    }

    /// <summary>
    /// Crafted work at an existing cook/market station. Never a fabricated map pin.
    /// </summary>
    public class CraftedTell : MonoBehaviour
    {
        float _life = 22f;

        public static void PlaceAtStation(string label)
        {
            CookStation cook = null;
            foreach (var c in FindObjectsByType<CookStation>(FindObjectsInactive.Exclude))
            {
                if (c) { cook = c; break; }
            }
            if (!cook) return;
            var root = FindFirstObjectByType<WorldBuilder>();
            var parent = root ? root.transform : null;
            var p = cook.transform.position + Vector3.up * 0.08f;
            var go = HubLook.Prim(parent, PrimitiveType.Cylinder, p,
                new Vector3(1.1f, 0.05f, 1.1f),
                HubLook.Emit(new Color(0.72f, 0.55f, 0.28f), 1.4f),
                "CraftedTell", false);
            go.AddComponent<CraftedTell>();
            if (!string.IsNullOrEmpty(label)) WorldClock.PushFeed("economy", label);
        }

        void Update()
        {
            _life -= Time.deltaTime;
            if (_life <= 0f) Destroy(gameObject);
        }
    }
}
