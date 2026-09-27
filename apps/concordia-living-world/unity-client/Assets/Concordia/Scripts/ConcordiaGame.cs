using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Scripting;
using Concordia.GameplayCore;
using Concordia.GameplayCore.Persistence;


namespace Concordia
{
    public class ConcordiaGame : MonoBehaviour
    {
        public static ConcordiaGame Live { get; private set; }
        public GameObject soldierPrefab;
        public WorldId world = WorldId.Hub;
        ConcordiaPlayer _player;
        bool _leanDressDone;
        float _leanStreamAt;
        WorldBuilder _world;
        WorldGate[] _gates;
        CityGate[] _cities;
        LoreStone[] _stones;
        GuestNpc[] _npcs;
        QuestBoard[] _boards;
        DungeonGate[] _holds;
        Gatherable[] _loot;
        CookStation[] _cooks;
        KernelTomb[] _tombs;
        float _probeAt;
        PersistenceEnvelope _loadedPersistence;
        GameplayCoreBridge _coreBridge;

        void OnEnable()
        {
            Live = this;
            if (!_player) _player = ConcordiaPlayer.Live;
        }

        void OnDisable()
        {
            if (Live == this) Live = null;
        }

        async void Start()
        {
            Live = this;
            _loadedPersistence = ConcordiaPersistenceService.Load();
            if (_loadedPersistence != null && _loadedPersistence.payload != null && _loadedPersistence.payload.world != null)
            {
                if (Enum.TryParse(_loadedPersistence.payload.world.activeWorld, true, out WorldId savedWorld))
                    world = savedWorld;
            }
            // LeanPlay: saved Tunya (or other realm) pulls GoldenSlice/Fabric into first frames and
            // starves the editor while Hub is still staging. Force Hub boot; restore can re-enter later.
            if (ConcordiaHost.LeanPlay && world != WorldId.Hub)
            {
                Debug.Log("[Concordia] LeanPlay: force Hub boot (saved world was " + world + ")");
                world = WorldId.Hub;
            }
            HubObjectives.Reset();
            ContentBindCatalog.Preload();
            try { File.WriteAllText("/tmp/concordia-play-started.txt", System.DateTime.Now.ToString("o") + " world=" + world); } catch {}
            if (Camera.main) Camera.main.gameObject.SetActive(false);

            var camGo = new GameObject("ChaseCam");
            camGo.tag = "MainCamera";
            var cam = camGo.AddComponent<Camera>();
            cam.nearClipPlane = 0.18f;
            cam.farClipPlane = 420f;
            camGo.AddComponent<AudioListener>();
            var chase = camGo.AddComponent<ChaseCamera>();

            var pgo = new GameObject("Player");
            pgo.transform.position = new Vector3(Canon.Spawn.x, 0.12f, Canon.Spawn.z);
            var cc = Grounding.EnsureController(pgo, 1.8f);
            _player = pgo.AddComponent<ConcordiaPlayer>();
            _player.cc = cc;
            _player.cam = chase;
            _player.world = world;
            chase.target = pgo.transform;
            chase.yaw = Mathf.PI;
            chase.pitch = 0.08f;
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
            // Defer AttachHero until Hub staged for Full and Lean — sync Rocketbox at Start + sync Hub was the cliff.
            Debug.Log("[Concordia] defer ModularPerson.AttachHero until Hub staged (no sync hero at Start)");
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

            var wgo = new GameObject("WorldBuilder");
            _world = wgo.AddComponent<WorldBuilder>();
            _world.player = _player;
            await HubKit.EnsureLoaded();
            _world.Build(world);
            WorldClock.Enter(world);
            // Full and Lean: Bridge + hero after staged Hub (BuildChunkStaged / realmfill_done).
            Debug.Log("[Concordia] defer GameplayCoreBridge.Install until Hub staged");
            StartCoroutine(DressHeroAfterHub(look, chase, kernel));
            if (!ConcordiaHost.LeanPlay && _loadedPersistence != null)
            {
                // Persistence restore after Expand in DressHero — stash for then.
            }
            Grounding.Snap(cc);
            camGo.transform.position = pgo.transform.position + new Vector3(1.7f, 2.55f, -5.2f);
            camGo.transform.LookAt(pgo.transform.position + Vector3.up * 1.3f);
            try { HubLook.Apply(cam, world); } catch (Exception e) { Debug.LogException(e); }
            try { HubLook.UpgradeStandardMaterials(); } catch (Exception e) { Debug.LogException(e); }

            // Character creator needs a live ModularPerson — open after DressHero AttachHero if wanted.
            if (_loadedPersistence == null) pgo.transform.rotation = Quaternion.identity;
            chase.yaw = Mathf.PI;
            chase.pitch = 0.08f;
            Cursor.lockState = CursorLockMode.Locked;
            Cursor.visible = false;
            ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
            Debug.Log("Concordia hub: Unburned Court under the bronze dome. Eight named gates. No soldier.");
            Application.runInBackground = true;
#if UNITY_EDITOR
            // Grab used to unpause and ForceGameView. LeanPlay skips Grab, so
            // Play froze on frame 1 unless the Game view had focus.
            UnityEditor.EditorApplication.isPaused = false;
#endif
            Time.timeScale = 1f;
            StartCoroutine(ConcordiaShot.Grab());
            if (File.Exists("/tmp/concordia-request-tour"))
                StartCoroutine(ConcordiaShot.Tour(this));
            StartCoroutine(PlayHeartbeat());
        }

        System.Collections.IEnumerator PlayHeartbeat()
        {
            var path = System.IO.Path.Combine(Application.dataPath, "Concordia/Generated/play-heartbeat.txt");
            var start = Time.realtimeSinceStartup;
            try { File.WriteAllText(path, "STARTED " + System.DateTime.Now.ToString("o") + "\\n"); } catch { }
            while (Time.realtimeSinceStartup - start < 60f)
            {
                yield return new WaitForSecondsRealtime(1f);
                try
                {
                    File.WriteAllText(path, "RUNNING " + (Time.realtimeSinceStartup - start).ToString("F1") + "s\\n");
                }
                catch { }
            }
            try
            {
                File.WriteAllText(path, "SUCCESS 60s " + System.DateTime.Now.ToString("o") + "\\n");
                Debug.Log("[Concordia] SUCCESS 60s");
            }
            catch { }
        }

        void OfferFoundingDay()
        {
            TryOfferHubQuest("founding_day_01_gather");
        }

        static void TryOfferHubQuest(string id)
        {
            var q = WorldBook.QuestById(WorldId.Hub, id);
            if (q != null) QuestLog.Offer(q, WorldId.Hub);
        }

bool _needsCharacterCreator;

System.Collections.IEnumerator DressHeroAfterHub(Appearance look, ChaseCamera chase, ConcordClient kernel)
        {
            var stagePath = System.IO.Path.Combine(Application.dataPath, "Concordia/Generated/runtime-stage.txt");
            float giveUp = Time.realtimeSinceStartup + 120f;
            while (Time.realtimeSinceStartup < giveUp)
            {
                if (_world && _world.HubStageComplete)
                    break;
                var mega = GameObject.Find("Megaworld");
                if (mega && mega.transform.Find("ContinentGround") && mega.transform.Find("CourtGround"))
                {
                    Debug.Log("[Concordia] initial Court ground ready; binding hero while Hub dressing continues");
                    break;
                }
                try
                {
                    if (System.IO.File.Exists(stagePath))
                    {
                        var text = System.IO.File.ReadAllText(stagePath);
                        if (text.Contains("realmfill_done"))
                            break;
                    }
                }
                catch { }
                yield return null;
            }
            // Let guest/gate CX settle — AttachHero same frame as last guest was the cliff.
            for (int i = 0; i < 20; i++) yield return null;

            // Your character lives on your Concord account: load it before the hero
            // is built so you appear as yourself on any device. Bounded wait — a
            // slow or offline server falls back to the local cache, never blocks entry.
            bool accountHasCharacter = false;
            if (kernel != null)
            {
                var connectTask = kernel.Connected ? null : kernel.EnsureConnected();
                float connectBy = Time.realtimeSinceStartup + 4f;
                while (connectTask != null && !connectTask.IsCompleted && Time.realtimeSinceStartup < connectBy) yield return null;
                if (kernel.Connected)
                {
                    var loadTask = kernel.LoadAccountCharacter(5000);
                    float loadBy = Time.realtimeSinceStartup + 6f;
                    while (!loadTask.IsCompleted && Time.realtimeSinceStartup < loadBy) yield return null;
                    if (loadTask.IsCompleted && !loadTask.IsFaulted && loadTask.Result != null)
                    {
                        look = loadTask.Result;
                        accountHasCharacter = true;
                        AppearanceStore.Save(look); // refresh the local cache from the account
                        Debug.Log("[Concordia] loaded account character: " + look.displayName);
                    }
                }
            }
            _needsCharacterCreator = !accountHasCharacter && !AppearanceStore.HasSaved;
            // A character made on this device before accounts held them: adopt it
            // onto the account instead of making the player create it again.
            if (!accountHasCharacter && AppearanceStore.HasSaved && kernel != null && kernel.Connected)
            {
                var local = AppearanceStore.Load();
                _ = kernel.SaveAccountCharacter(local);
                look = local;
            }

            var lean = _player ? _player.transform.Find("LeanHero") : null;
            if (lean) Destroy(lean.gameObject);
            if (_player && _player.person == null)
            {
                if (!AppearanceStore.HasSaved)
                {
                    look = look ?? new Appearance();
                    look.displayName = string.IsNullOrEmpty(look.displayName) || look.displayName == "Walker"
                        ? "Court Walker" : look.displayName;
                    look.outfit = 0; // Court linen
                    look.hairVal = 0.16f;
                    look.hairSat = 0.42f;
                }

                ModularPerson.CastingWorld = WorldId.Hub;
                for (int attempt = 1; attempt <= 3 && _player.person == null; attempt++)
                {
                    Debug.Log("[Concordia] LeanPlay: AttachHero after Hub settle attempt=" + attempt + " (Court traveler, no capsule)");
                    try
                    {
                        _player.person = ModularPerson.AttachHero(_player.transform, look);
                    }
                    catch (System.Exception ex)
                    {
                        Debug.LogWarning("[Concordia] AttachHero attempt " + attempt + " failed: " + ex.Message);
                    }
                    if (_player.person == null) yield return null;
                }

                if (_player.person == null)
                {
                    Debug.LogError("[Concordia] AttachHero failed after 3 attempts; hero binding remains incomplete");
                    yield break;
                }
                _player.EquipWorldKit();
            }
            // Spread kit/gear work off the bind frame.
            for (int i = 0; i < 12; i++) yield return null;

            // First visit on this account: make your own character before you play.
            if (_needsCharacterCreator && _player && _player.person != null && !CharacterCreator.IsOpen)
            {
                Debug.Log("[Concordia] no character on this account yet — opening the character creator");
                CharacterCreator.Open(_player.person, _player, chase, () =>
                {
                    ConcordiaHUD.Announce(Canon.Hub.title, Canon.Hub.refusal);
                    OfferFoundingDay();
                });
                _needsCharacterCreator = false;
            }

            Debug.Log("[Concordia] LeanPlay: GameplayCoreBridge.Install (locomotion-light)");
            try
            {
                _coreBridge = GameplayCoreBridge.Install(this, _player, chase, kernel);
            }
            catch (System.Exception ex)
            {
                Debug.LogWarning("[Concordia] LeanPlay: Bridge.Install failed: " + ex.Message);
            }
            for (int i = 0; i < 8; i++) yield return null;

            if (_coreBridge != null)
                yield return _coreBridge.ExpandSystemsStaged();

            // Skip persistence Restore/ReceiveHere during Full Play stabilize — was part of post-Expand melt.
            if (_loadedPersistence != null)
                Debug.Log("[Concordia] LeanPlay: skip persistence Restore/ReceiveHere (post-Expand stability)");

            // After any persistence restore (it replaces QuestLog wholesale). Offer is
            // idempotent: already-active or done quests are left alone.
            OfferFoundingDay();

            if (kernel != null)
            {
                // Defer WS + RestoreAgentSoul — both sat on the ~28–29s post-Expand melt.
                // Probe SUCCESS first; re-enable once Play holds 60s with buildings.
                Debug.Log("[Concordia] LeanPlay: skip EnsureConnected/RestoreAgentSoul (post-Expand stability)");
                _leanDressDone = true;
                Debug.Log("[Concordia] LeanPlay: DressHeroAfterHub complete (Bridge locomotion; Expand guests live)");
            }
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
            _tombs = FindObjectsByType<KernelTomb>(FindObjectsInactive.Exclude);
            _probeAt = Time.unscaledTime;
        }

        void Update()
        {
            if (!_player) _player = ConcordiaPlayer.Live;
            if (ContinentStream.Live == null && _world)
                ContinentStream.Bind(_world);
            // Stream before the Boot/creator gates so chunks load while the
            // character creator is open and the traveler is received before the
            // chunk hitch. Throttled LeanPlay ticks inside its own branch below.
            bool leanThrottled = ConcordiaHost.LeanPlay && _leanDressDone;
            if (_player && !leanThrottled)
                ContinentStream.Live?.Tick(_player.transform.position);
            WorldClock.Tick(Time.deltaTime);
            // Frame 1 is Boot. Probe FindObjects across chunks here used to
            // keep Time.time at 0 so WalkBearing never took a step.
            if (Time.frameCount < 2) return;
            if (!_player || CharacterCreator.IsOpen) return;
            // LeanPlay after Dress: stream/proximity live but throttled; RefreshProbe rare.
            if (leanThrottled)
            {
                if (Time.unscaledTime - _leanStreamAt > 2f)
                {
                    _leanStreamAt = Time.unscaledTime;
                    if (_player)
                        ContinentStream.Live?.Tick(_player.transform.position);
                    ProximityVoice.Tick(_player.transform.position, WorldBook.Folder(_player.world));
                }
                if (_gates == null || Time.unscaledTime - _probeAt > 60f) RefreshProbe();
                return;
            }
            // LeanPlay: keep prompts, but RefreshProbe rare (FindObjects storm starved Play).
            ProximityVoice.Tick(_player.transform.position, WorldBook.Folder(_player.world));
            float probeEvery = ConcordiaHost.LeanPlay ? 60f : 0.25f;
            if (_gates == null || Time.unscaledTime - _probeAt > probeEvery) RefreshProbe();
            var pos = _player.transform.position;
            string prompt = null;
            float best = 3.2f;
            WorldGate nearGate = null;
            float gateBest = 5.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < gateBest) { gateBest = d; nearGate = g; }
                    if (d < 9f && g.def.world != WorldId.Hub) HubObjectives.NoteGateWalked(g.def.world);
                }
            if (nearGate)
                prompt = nearGate.Prompt;
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
            if (_tombs != null)
                foreach (var t in _tombs)
                {
                    if (!t) continue;
                    var d = Vector3.Distance(pos, t.transform.position);
                    if (d < best) { best = d; prompt = t.Prompt; }
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
            var fabricResolution = _coreBridge != null ? _coreBridge.ResolveInteraction(pos) : null;
            if (fabricResolution != null && fabricResolution.found && fabricResolution.distance <= best)
            {
                best = fabricResolution.distance;
                prompt = fabricResolution.prompt;
            }
            if (nearGate) prompt = nearGate.Prompt;
            if (string.IsNullOrEmpty(prompt) && !string.IsNullOrEmpty(RoadWorld.NearLine))
                prompt = RoadWorld.NearLine;
            _player.SetNearPrompt(prompt);
            QuestLog.TickBeacons(pos);
        }

        string TryInteract(Vector3 pos)
        {
            RefreshProbe();
            var coreMessage = GameplayCoreBridge.Live?.TryInteractVehicle(pos);
            if (!string.IsNullOrEmpty(coreMessage)) return coreMessage;
            var coreEconomy = GameplayCoreBridge.Live?.TryInteract(pos);
            if (!string.IsNullOrEmpty(coreEconomy)) return coreEconomy;
            WorldGate gate = null;
            CityGate city = null;
            LoreStone stone = null;
            GuestNpc npc = null;
            QuestBoard board = null;
            DungeonGate hold = null;
            Gatherable loot = null;
            CookStation cook = null;
            KernelTomb tomb = null;
            float gateBest = 5.2f;
            if (_gates != null)
                foreach (var g in _gates)
                {
                    if (!g) continue;
                    var d = Vector3.Distance(pos, g.transform.position);
                    if (d < gateBest) { gateBest = d; gate = g; }
                }
            if (gate != null)
            {
                Travel(gate.def.world);
                return "The Ring opens — " + gate.def.name + ". " + gate.def.theNo;
            }
            float best = 3.2f;
            if (_cities != null)
                foreach (var c in _cities)
                {
                    if (!c) continue;
                    var d = Vector3.Distance(pos, c.transform.position);
                    if (d < best) { best = d; city = c; gate = null; stone = null; npc = null; board = null; hold = null; loot = null; cook = null; tomb = null; }
                }
            if (_holds != null)
                foreach (var h in _holds)
                {
                    if (!h) continue;
                    var d = Vector3.Distance(pos, h.transform.position);
                    if (d < best) { best = d; hold = h; gate = null; city = null; stone = null; npc = null; board = null; loot = null; cook = null; tomb = null; }
                }
            if (_boards != null)
                foreach (var b in _boards)
                {
                    if (!b) continue;
                    var d = Vector3.Distance(pos, b.transform.position);
                    if (d < best) { best = d; board = b; gate = null; city = null; stone = null; npc = null; hold = null; loot = null; cook = null; tomb = null; }
                }
            if (_loot != null)
                foreach (var l in _loot)
                {
                    if (!l || l.taken) continue;
                    var d = Vector3.Distance(pos, l.transform.position);
                    if (d < best) { best = d; loot = l; gate = null; city = null; stone = null; npc = null; board = null; hold = null; cook = null; tomb = null; }
                }
            if (_cooks != null)
                foreach (var k in _cooks)
                {
                    if (!k) continue;
                    var d = Vector3.Distance(pos, k.transform.position);
                    if (d < best) { best = d; cook = k; gate = null; city = null; stone = null; npc = null; board = null; hold = null; loot = null; tomb = null; }
                }
            if (_stones != null)
                foreach (var s in _stones)
                {
                    if (!s) continue;
                    var d = Vector3.Distance(pos, s.transform.position);
                    if (d < best) { best = d; stone = s; gate = null; city = null; npc = null; board = null; hold = null; loot = null; cook = null; tomb = null; }
                }
            if (_npcs != null)
                foreach (var n in _npcs)
                {
                    if (!n) continue;
                    var d = Vector3.Distance(pos, n.transform.position);
                    if (d < best) { best = d; npc = n; gate = null; city = null; stone = null; board = null; hold = null; loot = null; cook = null; tomb = null; }
                }
            if (_tombs != null)
                foreach (var t in _tombs)
                {
                    if (!t) continue;
                    var d = Vector3.Distance(pos, t.transform.position);
                    if (d < best) { best = d; tomb = t; gate = null; city = null; stone = null; npc = null; board = null; hold = null; loot = null; cook = null; }
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
            if (tomb != null)
            {
                var said = string.IsNullOrEmpty(tomb.lastWords) ? "a grave with no words" : tomb.lastWords;
                WorldClock.LastEvent = said;
                return said;
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
                npc.hailed = false;
                Bonds.TalkBump(Bonds.Key(npc));
                if (npc.def.id == "lamplighter") HubObjectives.NoteLamp();
                QuestLog.NoteTalk(npc.personId ?? npc.def.id, npc.def.name);
                var firstTalkOffer = ConcordiaDialogueService.FirstTalkQuestOffer(npc, world);
                if (!string.IsNullOrEmpty(firstTalkOffer))
                    return firstTalkOffer;
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
                var person = WorldBook.FindPerson(world, npc.personId ?? npc.def.id);
                var lev = WorldBook.LeverageLine(person);
                if (!string.IsNullOrEmpty(lev) && Bonds.Get(Bonds.Key(npc)) >= 0.22f)
                    line += "\nLeverage: " + lev;
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
                var client = ConcordClient.Live;
                if (client != null) client.SendDungeonOpen(hold.encounterId);
                if (ConcordClient.HoldLocked)
                {
                    hold.inHold = false;
                    _player.cc.enabled = false;
                    _player.transform.position = hold.mouth;
                    _player.cc.enabled = true;
                    Grounding.Snap(_player.cc);
                    return "the hold is sealed — " + ConcordClient.HoldLockReason;
                }
                var title = string.IsNullOrEmpty(hold.holdName) ? "The Hollow Warden" : hold.holdName;
                ConcordiaHUD.Announce(title, string.IsNullOrEmpty(ConcordClient.DungeonLine) ? "the hold opened" : ConcordClient.DungeonLine);
                return "You enter " + title + ".";
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

        /// <summary>
        /// MEGAWORLD: live path is ContinentStream (one plane). Link gates
        /// teleport; walking SoftEnters. Travel never calls _world.Build —
        /// that PurgeNamed("Megaworld") + Canon.SteelSpawn wipe emptied the
        /// Hub Ring after repeated Travel. Boot is the only Build caller.
        /// Flower Law is the Unburned Court only.
        /// See docs/CONCORDIA_PERSISTENT_MEGAWORLD.md.
        /// </summary>
        public void Travel(WorldId next)
        {
            var carried = _player != null ? _player.kitWeapon : null;
            var from = world;
            var crossed = CrossRing.Walk(from, next, carried);
            HubObjectives.NoteTravel(world, next);
            world = next;
            _player.world = next;
            var stream = ContinentStream.Bind(_world);
            if (stream)
                stream.Teleport(_player, next);
            else
                Debug.LogError("Concordia Travel: ContinentStream missing; refusing single-world Build (SteelSpawn wipe).");
            ModularPerson.RecastBody(_player.person);
            try { if (Camera.main) HubLook.Apply(Camera.main, next); } catch (Exception e) { Debug.LogException(e); }
            var w = Canon.Get(next);
            var steel = Canon.SteelLive(next, _player.transform.position)
                ? "Live steel. Combat is allowed here."
                : "Flower-law. Blades die as flowers except in the Arena.";
            ConcordiaHUD.Announce(w.title, string.IsNullOrEmpty(crossed) ? w.refusal : crossed);
            _player.Notice(w.law + " " + steel);
            if (!string.IsNullOrEmpty(crossed))
                _player.Notice(crossed);
            else if (!string.IsNullOrEmpty(WorldClock.LastEvent) && WorldClock.LastEvent.Contains("away"))
                _player.Notice(WorldClock.LastEvent);
            _ = ConcordClient.JoinWorld(WorldBook.Folder(next));
        }

        /// <summary>
        /// SoftEnter / walk-in world change. Same kernel join Travel uses.
        /// Overland players must not keep sending the previous region id.
        /// JoinWorld connects kitchen if Start() missed it.
        /// </summary>
        public void NoteWorld(WorldId id)
        {
            world = id;
            _ = ConcordClient.JoinWorld(WorldBook.Folder(id));
        }

        public string EnterCity(WorldBook.CityDef city)
        {
            if (city == null) return null;
            var dest = MegaworldMap.Present(world) + new Vector3(city.x, 0.12f, city.z);
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

        void OnApplicationQuit()
        {
#if UNITY_EDITOR
            // Unity's Play-mode stop destroys the scene while OnApplicationQuit is
            // raised; a full object graph capture at that point can stall teardown.
            // GameplayCoreBridge.OnDisable owns the editor-stop save path.
            if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return;
#endif
            string error;
            if (!ConcordiaPersistenceService.TrySave(out error) && !string.IsNullOrEmpty(error))
                Debug.LogWarning("[Concordia] unified lifecycle save: " + error);
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
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
#if false
    /// Convai talks to Concord 2B, not the Convai cloud LLM.
    /// Parked: the Convai package is not in this project, and these types
    /// block HubLook compile. Restore when the SDK is present.
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
#endif
}
