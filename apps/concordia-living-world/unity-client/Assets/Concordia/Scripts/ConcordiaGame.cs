using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Convai.Runtime.Components;
using Convai.Runtime.Core.Async;
using Convai.Runtime.Core.Coordinators;
using Convai.Runtime.Core.Providers;
using UnityEngine;
using UnityEngine.Scripting;

namespace Concordia
{
    public class ConcordiaGame : MonoBehaviour
    {
        public GameObject soldierPrefab;
        public WorldId world = WorldId.Hub;
        ConcordiaPlayer _player;
        WorldBuilder _world;
        WorldGate[] _gates;
        CityGate[] _cities;
        LoreStone[] _stones;
        GuestNpc[] _npcs;
        QuestBoard[] _boards;
        DungeonGate[] _holds;
        Gatherable[] _loot;
        CookStation[] _cooks;
        float _probeAt;

        async void Start()
        {
            HubObjectives.Reset();
            try { File.WriteAllText("/tmp/concordia-play-started.txt", System.DateTime.Now.ToString("o") + " world=" + world); } catch {}
            if (Camera.main) Camera.main.gameObject.SetActive(false);

            var camGo = new GameObject("ChaseCam");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.18f;
            cam.farClipPlane = 220f;
            camGo.AddComponent<AudioListener>();
            var chase = camGo.AddComponent<ChaseCamera>();

            var pgo = new GameObject("Player");
            pgo.transform.position = new Vector3(Canon.Spawn.x, 0.12f, Canon.Spawn.z);
            var cc = pgo.AddComponent<CharacterController>();
            cc.height = 1.8f;
            cc.center = new Vector3(0, 0.9f, 0);
            cc.radius = 0.28f;
            _player = pgo.AddComponent<ConcordiaPlayer>();
            _player.cc = cc;
            _player.cam = chase;
            _player.world = world;
            chase.target = pgo.transform;
            chase.yaw = Mathf.PI;
            chase.pov = 0;
            chase.distance = 3.4f;
            chase.shoulder = 0.62f;
            chase.height = 1.55f;
            chase.Bind();
            chase.AimAt(pgo.transform);
            cam.clearFlags = CameraClearFlags.Skybox;
            camGo.transform.position = new Vector3(Canon.Spawn.x + 1.7f, 2.7f, Canon.Spawn.z - 5.2f);
            camGo.transform.LookAt(new Vector3(Canon.Spawn.x, 1.4f, Canon.Spawn.z));

            var look = AppearanceStore.HasSaved ? AppearanceStore.Load() : new Appearance();
            _player.person = ModularPerson.AttachHero(pgo.transform, look);
            _player.EquipWorldKit();
            _player.onInteract = TryInteract;
            _player.onTalkSend = SubmitTalk;
            pgo.AddComponent<ConcordiaHUD>().player = _player;
            pgo.AddComponent<Footsteps>();
            var feel = pgo.AddComponent<CombatFeel>();
            feel.body = cc;
            feel.cam = cam;
            pgo.AddComponent<EvoResolver>();
            var kernelGo = new GameObject("ConcordClient");
            var kernel = kernelGo.AddComponent<ConcordClient>();
            kernel.OnEvent += HandleKernelEvent;
            var convaiGo = new GameObject("ConcordConvai");
            convaiGo.AddComponent<ConcordConvaiManager>();

            var wgo = new GameObject("WorldBuilder");
            _world = wgo.AddComponent<WorldBuilder>();
            _world.player = _player;
            await HubKit.EnsureLoaded();
            _world.Build(world);
            WorldClock.Enter(world);
            Grounding.Snap(cc);
            var py = pgo.transform.position.y;
            if (py < 0f || py > 3.5f)
                pgo.transform.position = new Vector3(Canon.Spawn.x, 0.12f, Canon.Spawn.z);
            camGo.transform.position = pgo.transform.position + new Vector3(1.7f, 2.55f, -5.2f);
            camGo.transform.LookAt(pgo.transform.position + Vector3.up * 1.3f);
            try { HubLook.Apply(cam, world); } catch (Exception e) { Debug.LogException(e); }
            try { HubLook.UpgradeStandardMaterials(); } catch (Exception e) { Debug.LogException(e); }

            if (!AppearanceStore.HasSaved)
            {
                pgo.transform.rotation = Quaternion.identity;
                chase.creatorFraming = true;
                CharacterCreator.Open(_player.person, _player, chase, () =>
                {
                    ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
                    Debug.Log("Concordia: " + _player.person.look.displayName + " entered the Unburned Court.");
                });
            }
            else
            {
                pgo.transform.rotation = Quaternion.identity;
                chase.yaw = Mathf.PI;
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
                ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
            }
            Debug.Log("Concordia hub: Unburned Court under the bronze dome. Eight named gates. No soldier.");
            StartCoroutine(ConcordiaShot.Grab());
            if (File.Exists("/tmp/concordia-request-tour"))
                StartCoroutine(ConcordiaShot.Tour(this));
        }

        void RefreshProbe()
        {
            _gates = FindObjectsByType<WorldGate>(FindObjectsInactive.Exclude);
            _cities = FindObjectsByType<CityGate>(FindObjectsInactive.Exclude);
            _stones = FindObjectsByType<LoreStone>(FindObjectsInactive.Exclude);
            _npcs = FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude);
            _boards = FindObjectsByType<QuestBoard>(FindObjectsInactive.Exclude);
            _holds = FindObjectsByType<DungeonGate>(FindObjectsInactive.Exclude);
            _loot = FindObjectsByType<Gatherable>(FindObjectsInactive.Exclude);
            _cooks = FindObjectsByType<CookStation>(FindObjectsInactive.Exclude);
            _probeAt = Time.unscaledTime;
        }

        void Update()
        {
            if (!_player || CharacterCreator.IsOpen) return;
            if (_gates == null || Time.unscaledTime - _probeAt > 0.25f) RefreshProbe();
            var pos = _player.transform.position;
            string prompt = null;
            float best = 3.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < best) { best = d; prompt = g.Prompt; }
                    if (d < 9f && g.def.world != WorldId.Hub) HubObjectives.NoteGateWalked(g.def.world);
                }
            if (_cities != null)
                foreach (var c in _cities)
                {
                    if (!c) continue;
                    var d = Vector3.Distance(pos, c.transform.position);
                    if (d < best) { best = d; prompt = c.Prompt; }
                }
            if (_stones != null)
                foreach (var s in _stones)
                {
                    if (!s) continue;
                    var d = Vector3.Distance(pos, s.transform.position);
                    if (d < best) { best = d; prompt = s.Prompt; }
                }
            if (_npcs != null)
                foreach (var n in _npcs)
                {
                    if (!n) continue;
                    var d = Vector3.Distance(pos, n.transform.position);
                    if (d < best) { best = d; prompt = n.Prompt; }
                }
            if (_boards != null)
                foreach (var b in _boards)
                {
                    if (!b) continue;
                    var d = Vector3.Distance(pos, b.transform.position);
                    if (d < best) { best = d; prompt = b.Prompt; }
                }
            if (_holds != null)
                foreach (var h in _holds)
                {
                    if (!h) continue;
                    var d = Vector3.Distance(pos, h.transform.position);
                    if (d < best) { best = d; prompt = h.Prompt; }
                }
            if (_loot != null)
                foreach (var l in _loot)
                {
                    if (!l || l.taken) continue;
                    var d = Vector3.Distance(pos, l.transform.position);
                    if (d < best) { best = d; prompt = l.Prompt; }
                }
            if (_cooks != null)
                foreach (var k in _cooks)
                {
                    if (!k) continue;
                    var d = Vector3.Distance(pos, k.transform.position);
                    if (d < best) { best = d; prompt = k.Prompt; }
                }
            var use = UsePlace.Nearest(pos, 2.4f);
            if (use)
            {
                var d = Vector3.Distance(pos, use.transform.position);
                if (d < best) { best = d; prompt = use.Prompt; }
            }
            var door = BuildingPlace.NearestDoor(pos, 3.4f);
            if (door)
            {
                var d = Vector3.Distance(pos, door.door);
                if (d < best)
                {
                    best = d;
                    var bi = door.GetComponent<BuildingInterior>();
                    prompt = bi != null && bi.entered ? "E  ·  Leave" : door.Prompt;
                }
            }
            _player.SetNearPrompt(prompt);
            QuestLog.TickBeacons(pos);
            WorldClock.Tick(Time.deltaTime);
        }

        string TryInteract(Vector3 pos)
        {
            RefreshProbe();
            WorldGate gate = null;
            CityGate city = null;
            LoreStone stone = null;
            GuestNpc npc = null;
            QuestBoard board = null;
            DungeonGate hold = null;
            Gatherable loot = null;
            CookStation cook = null;
            float best = 3.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < best) { best = d; gate = g; city = null; stone = null; npc = null; board = null; hold = null; loot = null; cook = null; }
                }
            if (_cities != null)
                foreach (var c in _cities)
                {
                    if (!c) continue;
                    var d = Vector3.Distance(pos, c.transform.position);
                    if (d < best) { best = d; city = c; gate = null; stone = null; npc = null; board = null; hold = null; loot = null; cook = null; }
                }
            if (_holds != null)
                foreach (var h in _holds)
                {
                    if (!h) continue;
                    var d = Vector3.Distance(pos, h.transform.position);
                    if (d < best) { best = d; hold = h; gate = null; city = null; stone = null; npc = null; board = null; loot = null; cook = null; }
                }
            if (_boards != null)
                foreach (var b in _boards)
                {
                    if (!b) continue;
                    var d = Vector3.Distance(pos, b.transform.position);
                    if (d < best) { best = d; board = b; gate = null; city = null; stone = null; npc = null; hold = null; loot = null; cook = null; }
                }
            if (_loot != null)
                foreach (var l in _loot)
                {
                    if (!l || l.taken) continue;
                    var d = Vector3.Distance(pos, l.transform.position);
                    if (d < best) { best = d; loot = l; gate = null; city = null; stone = null; npc = null; board = null; hold = null; cook = null; }
                }
            if (_cooks != null)
                foreach (var k in _cooks)
                {
                    if (!k) continue;
                    var d = Vector3.Distance(pos, k.transform.position);
                    if (d < best) { best = d; cook = k; gate = null; city = null; stone = null; npc = null; board = null; hold = null; loot = null; }
                }
            if (_stones != null)
                foreach (var s in _stones)
                {
                    if (!s) continue;
                    var d = Vector3.Distance(pos, s.transform.position);
                    if (d < best) { best = d; stone = s; gate = null; city = null; npc = null; board = null; hold = null; loot = null; cook = null; }
                }
            if (_npcs != null)
                foreach (var n in _npcs)
                {
                    if (!n) continue;
                    var d = Vector3.Distance(pos, n.transform.position);
                    if (d < best) { best = d; npc = n; gate = null; city = null; stone = null; board = null; hold = null; loot = null; cook = null; }
                }
            if (gate != null)
            {
                Travel(gate.def.world);
                return "The Ring opens — " + gate.def.name + ". " + gate.def.theNo;
            }
            if (hold != null)
                return EnterHold(hold);
            if (city != null)
                return EnterCity(city.city);
            if (board != null)
                return QuestLog.Offer(board.quest, board.world);
            if (loot != null)
                return TakeLoot(loot);
            if (cook != null)
                return cook.Use();
            if (stone != null)
            {
                QuestLog.NoteLocation(stone.title);
                return stone.title + "\n" + stone.text;
            }
            var use = UsePlace.Nearest(pos, 2.4f);
            var door = BuildingPlace.NearestDoor(pos, 3.4f);
            float useD = use ? Vector3.Distance(pos, use.transform.position) : 99f;
            float doorD = door ? Vector3.Distance(pos, door.door) : 99f;
            if (use && useD <= best && useD <= doorD)
                return UseSpot(use);
            if (door && doorD <= best)
                return EnterBuilding(door);
            if (npc != null)
            {
                var life = npc.GetComponent<NpcLife>();
                if (life) life.NoticePlayer(8f);
                if (npc.def.id == "lamplighter") HubObjectives.NoteLamp();
                QuestLog.NoteTalk(npc.personId ?? npc.def.id, npc.def.name);
                var offered = WorldBook.OfferedBy(world, npc.personId ?? npc.def.id);
                if (offered.Length > 0)
                    return npc.def.name + ": " + npc.def.line + "\n" + QuestLog.Offer(offered[0], world);
                if (npc.questHooks != null)
                    foreach (var hook in npc.questHooks)
                    {
                        var q = WorldBook.QuestById(world, hook);
                        if (q != null) return npc.def.name + ": " + npc.def.line + "\n" + QuestLog.Offer(q, world);
                    }
                var line = npc.def.name + ": " + npc.def.line;
                foreach (var extra in CrossRing.LivingLines(npc.def.id ?? npc.personId))
                    line += "\n" + extra;
                if (!string.IsNullOrEmpty(WorldClock.LastEvent))
                    line += "\nThey heard: " + WorldClock.LastEvent;
                _player.OpenTalk(npc, line);
                return "Talking with " + npc.def.name + ".";
            }
            return null;
        }

        string UseSpot(UsePlace use)
        {
            if (use.sit) _player?.person?.Sit(true);
            QuestLog.NoteLocation(use.verb);
            return string.IsNullOrEmpty(use.line) ? use.verb : use.line;
        }

        string EnterBuilding(BuildingPlace door)
        {
            var bi = door.GetComponent<BuildingInterior>();
            var dest = door.door;
            if (bi)
            {
                if (bi.entered)
                {
                    bi.entered = false;
                    dest = door.door + Vector3.up * 0.12f;
                }
                else
                {
                    bi.entered = true;
                    dest = bi.Inside();
                }
            }
            else
                dest = door.door + Vector3.up * 0.12f;
            _player.cc.enabled = false;
            _player.transform.position = dest;
            _player.cc.enabled = true;
            Grounding.Snap(_player.cc);
            QuestLog.NoteLocation(door.plan, "building");
            return bi != null && bi.entered
                ? "You step inside" + (string.IsNullOrEmpty(door.plan) ? "." : " the " + door.plan + ".")
                : "You leave.";
        }

        string EnterHold(DungeonGate hold)
        {
            var dest = hold.inHold ? hold.mouth : hold.inside;
            hold.inHold = !hold.inHold;
            _player.cc.enabled = false;
            _player.transform.position = dest;
            _player.cc.enabled = true;
            Grounding.Snap(_player.cc);
            QuestLog.NoteLocation("dungeon", "hold");
            if (hold.inHold)
            {
                ConcordiaHUD.Announce("A hold", "Kenney tiles. No authored name.");
                return "You enter the hold. Live steel if the world allows it.";
            }
            return "You leave the hold.";
        }

        static string TakeLoot(Gatherable loot)
        {
            if (loot.taken) return null;
            loot.taken = true;
            loot.gameObject.SetActive(false);
            QuestLog.NoteGather(loot.itemId);
            QuestLog.NoteGather(loot.label);
            KitBag.AddLoot(loot.itemId, loot.label);
            return "Took " + loot.label + ".";
        }

        public void Travel(WorldId next)
        {
            var carried = _player != null ? _player.kitWeapon : null;
            var from = world;
            WorldClock.Leave();
            var crossed = CrossRing.Walk(from, next, carried);
            HubObjectives.NoteTravel(world, next);
            world = next;
            _player.world = next;
            var spawn = next == WorldId.Hub ? Canon.Spawn : new Vector3(0f, 0.12f, 2f);
            _player.cc.enabled = false;
            _player.transform.position = spawn;
            _player.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
            _player.cc.enabled = true;
            if (_player.cam) _player.cam.yaw = Mathf.PI;
            _world.Build(next);
            WorldClock.Enter(next);
            _gates = null;
            _cities = null;
            _holds = null;
            _boards = null;
            _loot = null;
            _cooks = null;
            _player.EquipWorldKit();
            Grounding.Snap(_player.cc);
            try { if (Camera.main) HubLook.Apply(Camera.main, next); } catch (Exception e) { Debug.LogException(e); }
            var w = Canon.Get(next);
            var steel = Canon.SteelLive(next, spawn)
                ? "Live steel. Combat is allowed here."
                : "Flower-law. Blades die as flowers except in the Arena.";
            ConcordiaHUD.Announce(w.title, string.IsNullOrEmpty(crossed) ? w.refusal : crossed);
            _player.Notice(w.law + " " + steel);
            if (!string.IsNullOrEmpty(crossed))
                _player.Notice(crossed);
            else if (!string.IsNullOrEmpty(WorldClock.LastEvent) && WorldClock.LastEvent.Contains("away"))
                _player.Notice(WorldClock.LastEvent);
            var client = ConcordClient.Live;
            if (client && client.Connected)
                _ = client.RequestScene(WorldBook.Folder(next));
        }

        public string EnterCity(WorldBook.CityDef city)
        {
            if (city == null) return null;
            var dest = new Vector3(city.x, 0.12f, city.z);
            if (Vector3.Distance(_player.transform.position, dest) > 6f)
            {
                _player.cc.enabled = false;
                _player.transform.position = dest;
                _player.cc.enabled = true;
                Grounding.Snap(_player.cc);
            }
            var line = city.description ?? "";
            var cut = line.IndexOf('\n');
            if (cut > 0) line = line.Substring(0, cut);
            if (line.Length > 160) line = line.Substring(0, 157) + "…";
            ConcordiaHUD.Announce(city.name, string.IsNullOrEmpty(line) ? Canon.Get(world).title : line);
            QuestLog.NoteLocation(city.id, city.name, RealmFill.Slug(city.name));
            if (city.districts != null) QuestLog.NoteLocation(city.districts);
            _player.Notice("You are in " + city.name + ".");
            return "Entered " + city.name + ".";
        }

        void HandleKernelEvent(string evt, string json)
        {
            if (evt != "combat:attack:ack") return;
            KernelAckEnvelope env = null;
            try { env = JsonUtility.FromJson<KernelAckEnvelope>(json); }
            catch { return; }
            if (env?.data == null) return;
            _player?.ApplyKernelAttackAck(env.data.ok, env.data.refused, env.data.damage, env.data.error, env.data.reason);
        }

        async void SubmitTalk(string typed)
        {
            var npc = _player != null ? _player.talkNpc : null;
            if (npc == null) return;
            await AskTwoB(npc, typed);
        }

        async System.Threading.Tasks.Task AskTwoB(GuestNpc npc, string typed)
        {
            var client = ConcordClient.Live;
            if (client == null)
            {
                _player?.AppendTalk("2B is not on this box (no_gateway)");
                return;
            }
            if (!client.Connected) await client.EnsureConnected();
            if (!client.Connected)
            {
                var why = string.IsNullOrEmpty(ConcordClient.LastReason) ? "no_gateway" : ConcordClient.LastReason;
                _player?.AppendTalk("2B is not on this box (" + why + ")");
                return;
            }
            var reply = await client.AskTwoB(
                npc.personId ?? npc.def.id,
                npc.def.name,
                npc.def.line,
                typed);
            if (string.IsNullOrEmpty(reply))
            {
                var why = string.IsNullOrEmpty(ConcordClient.LastReason) ? "no_gateway" : ConcordClient.LastReason;
                _player?.AppendTalk("2B is not on this box (" + why + ")");
                return;
            }
            _player?.AppendTalk(npc.def.name + ": " + reply);
        }

        void OnDestroy()
        {
            WorldClock.Leave();
            var kernel = ConcordClient.Live;
            if (kernel != null) kernel.OnEvent -= HandleKernelEvent;
        }

        [Serializable]
        class KernelAckEnvelope
        {
            public string evt;
            public KernelAckData data;
        }

        [Serializable]
        class KernelAckData
        {
            public bool ok;
            public bool refused;
            public float damage;
            public string error;
            public string reason;
        }
    }

    /// <summary>
    /// Convai talks to Concord 2B, not the Convai cloud LLM.
    /// </summary>
    public class ConcordConvaiManager : ConvaiManager
    {
        protected override IConversationProvider GetConversationProvider() =>
            ConcordTwoBConversationProvider.Instance;
    }

    [Preserve]
    public sealed class ConcordTwoBConversationProvider : IConversationProvider
    {
        static readonly ConcordTwoBConversationProvider Live = new ConcordTwoBConversationProvider();
        ConcordTwoBConversationProvider() { }
        public static ConcordTwoBConversationProvider Instance => Live;
        public string ProviderId => "concord-2b";
        public ConversationCapabilities Capabilities =>
            ConversationCapabilities.TextInput | ConversationCapabilities.StreamingResponse | ConversationCapabilities.History;

        public IConvaiOperation<IConversationSession> CreateSessionAsync(
            ConversationSessionRequest request,
            CancellationToken ct = default)
        {
            var session = new ConcordTwoBSession(
                Guid.NewGuid().ToString("N"),
                request.CharacterId,
                Capabilities);
            return ConvaiOperation<IConversationSession>.Succeeded(session);
        }
    }

    [Preserve]
    sealed class ConcordTwoBSession : IConversationSession
    {
        readonly object _lock = new object();
        readonly Queue<ConversationResponsePart> _parts = new Queue<ConversationResponsePart>();
        readonly SemaphoreSlim _signal = new SemaphoreSlim(0);
        readonly CancellationTokenSource _life = new CancellationTokenSource();
        bool _done;

        public ConcordTwoBSession(string sessionId, string characterId, ConversationCapabilities capabilities)
        {
            SessionId = sessionId;
            CharacterId = characterId;
            Capabilities = capabilities;
        }

        public string SessionId { get; }
        public string CharacterId { get; }
        public ConversationCapabilities Capabilities { get; }
        public event Action<ConversationEvent> EventReceived;

        public IConvaiOperation<Unit> SendAsync(ConversationRequest request, CancellationToken ct = default)
        {
            if (_done)
                return ConvaiOperation<Unit>.Failed(new ObjectDisposedException(nameof(ConcordTwoBSession)));
            _ = Reply(request);
            return ConvaiOperation<Unit>.Succeeded(Unit.Value);
        }

        async Task Reply(ConversationRequest request)
        {
            var client = ConcordClient.Live;
            var text = "";
            if (client != null && client.Connected)
                text = await client.AskTwoB(CharacterId, CharacterId, "", request.Text ?? "");
            if (string.IsNullOrEmpty(text))
                text = "{ok:false, reason:'no_gateway'}";
            Push(new ConversationResponsePart(text, null, true));
        }

        public IConvaiStream<ConversationResponsePart> OpenResponseStream(CancellationToken ct = default) =>
            new ConvaiStream<ConversationResponsePart>(readCt => Read(readCt), disposeAsync: KillStream);

        public ValueTask DisposeAsync()
        {
            if (!_done)
            {
                _done = true;
                _life.Cancel();
                _signal.Release();
                EventReceived?.Invoke(new ConversationEvent("session_ended"));
            }
            return default;
        }

        void Push(ConversationResponsePart part)
        {
            lock (_lock) _parts.Enqueue(part);
            _signal.Release();
        }

        async IAsyncEnumerable<ConversationResponsePart> Read([EnumeratorCancellation] CancellationToken ct)
        {
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct, _life.Token);
            while (!linked.IsCancellationRequested)
            {
                try { await _signal.WaitAsync(linked.Token); }
                catch (OperationCanceledException) { yield break; }
                while (true)
                {
                    ConversationResponsePart next;
                    lock (_lock)
                    {
                        if (_parts.Count == 0) break;
                        next = _parts.Dequeue();
                    }
                    yield return next;
                }
            }
        }

        ValueTask KillStream()
        {
            if (!_life.IsCancellationRequested) _life.Cancel();
            return default;
        }
    }
}
