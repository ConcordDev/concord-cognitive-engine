using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// W3 continent streaming. Civilizations stay in one scene. Walking does
    /// not call WorldBuilder.Build. Link gates remain the only teleport.
    /// Far chunks unload. Empty stays empty — a missing pack is not a town.
    /// Impostors stay visible from the Hub so leave-Hub is not a barren void.
    /// </summary>
    public class ContinentStream : MonoBehaviour
    {
        public const string TravelMode = "continent_stream";
        /// <summary>Full chunk when this close to a civilization present point.</summary>
        public const float StreamInM = 175f;
        /// <summary>Wider than MegaworldMap.RingMeters so Hub sees every impostor, including Sere.</summary>
        public const float StreamOutM = 360f;
        public const float L3NearM = 55f;
        public const float ChunkRadiusM = 52f;
        /// <summary>Hub chunk stays until the player is well onto a road.</summary>
        public const float HubKeepM = 125f;

        public static ContinentStream Live { get; private set; }
        public static string LastTravelKind = "boot";

        public Transform continent { get; private set; }
        WorldBuilder _builder;
        readonly Dictionary<WorldId, Transform> _chunks = new Dictionary<WorldId, Transform>();
        readonly Dictionary<WorldId, int> _lod = new Dictionary<WorldId, int>();
        Light _sun;
        int _lastTickFrame = -1;
        Coroutine _fullBuild;
        Coroutine _wildernessBuild;
        Coroutine _continentBootstrap;

        WorldId _fullBuildWorld;
        int _fullBuildGeneration;
        int _continentGeneration;
        int _continentBootstrapGeneration;

        readonly Dictionary<WorldId, ChunkReadiness> _readiness = new Dictionary<WorldId, ChunkReadiness>();
        readonly Dictionary<WorldId, int> _chunkGenerations = new Dictionary<WorldId, int>();

        bool _continentReady;
        bool _roadLife;

        public static int LodOf(float dist)
        {
            if (dist >= StreamOutM) return 0;
            if (dist > StreamInM) return 1;
            if (dist > L3NearM) return 2;
            return 3;
        }

        public static ContinentStream Bind(WorldBuilder builder)
        {
            if (!builder) return null;
            var stream = builder.GetComponent<ContinentStream>() ?? builder.gameObject.AddComponent<ContinentStream>();
            stream._builder = builder;
            if (!stream.enabled) stream.enabled = true;
            Live = stream;
            return stream;
        }

        void OnEnable()
        {
            Live = this;
        }

public void Boot(WorldId start)
        {
            Live = this;
            LastTravelKind = "boot";
            EnsureContinent();
            // ROOT CAUSE FIX: Force Full used sync BuildChunk/BuildHub and starved Play.
            RequestFull(WorldId.Hub);
            if (start != WorldId.Hub)
                EnsureImpostor(start);
            Debug.Log("[Concordia] Boot: staged Hub RequestFull + SeedImpostorsStaged (Full and Lean)");
            StartCoroutine(SeedImpostorsStaged(start));
            ApplySky(start);
        }

        System.Collections.IEnumerator SeedImpostorsStaged(WorldId start)
        {
            // Let Hub plaza/cast get a few frames first — keep short so LeanPlay doesn't starve seed.
            for (int i = 0; i < 3; i++) yield return null;
            int n = 0;
            int failed = 0;
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub || id == start) continue;
                try
                {
                    var chunk = EnsureImpostor(id);
                    if (chunk) n++;
                    else { failed++; Debug.LogWarning("[Concordia] FarGeographySeed EnsureImpostor null for " + id); }
                }
                catch (System.Exception ex)
                {
                    failed++;
                    Debug.LogWarning("[Concordia] LeanPlay: impostor " + id + " failed: " + ex.Message);
                }
                yield return null;
            }
            Debug.Log("[Concordia] FarGeographySeed impostors=" + n + " failed=" + failed + " (continent Present masses)");
            Debug.Log("[Concordia] LeanPlay: continent impostors seeded count=" + n);
        }

        /// <summary>
        /// Sync seed for stills / recovery — LeanPlay-safe (impostors only, no RequestFull).
        /// </summary>
        public int EnsureFarGeographyNow()
        {
            int n = 0;
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub) continue;
                try
                {
                    if (EnsureImpostor(id)) n++;
                }
                catch (System.Exception ex)
                {
                    Debug.LogWarning("[Concordia] EnsureFarGeographyNow " + id + ": " + ex.Message);
                }
            }
            Debug.Log("[Concordia] FarGeographySeed impostors=" + n + " failed=0 (EnsureFarGeographyNow sync)");
            return n;
        }

        public bool IsLoaded(WorldId id) => _chunks.TryGetValue(id, out var t) && t;

        public Transform ChunkOf(WorldId id) =>
            _chunks.TryGetValue(id, out var t) && t ? t : null;

        public enum ChunkReadiness
        {
            Impostor,
            Building,
            Ready,
            Retiring
        }

        public bool IsContinentReady => _continentReady;

        public bool IsReady(WorldId id)
        {
            return _readiness.TryGetValue(id, out var state)
                && state == ChunkReadiness.Ready
                && _lod.TryGetValue(id, out var lod)
                && lod >= 2
                && _chunks.TryGetValue(id, out var chunk)
                && chunk;
        }

        public bool TryGetReadiness(WorldId id, out ChunkReadiness state)
        {
            return _readiness.TryGetValue(id, out state);
        }

        public bool InPresenter(Vector3 present)
        {
            foreach (var kv in _chunks)
            {
                if (!kv.Value) continue;
                if ((present - MegaworldMap.Present(kv.Key)).sqrMagnitude <= ChunkRadiusM * ChunkRadiusM)
                    return true;
            }
            return false;
        }

public void Tick(Vector3 player)
        {
            // ConcordiaGame.Update and this component's LateUpdate can both reach
            // streaming in the same frame. Serialize that path before any build work.
            if (_lastTickFrame == Time.frameCount) return;
            _lastTickFrame = Time.frameCount;

            // LeanPlay: same LOD loop as desktop, but budget=1 so at most one RequestFull
            // / EnsureImpostor per frame. Impostors already seeded at Boot.
            ReceiveHere(player);
            var toward = MegaworldMap.Toward(player);
            int built = 0;
            int budget = ConcordiaHost.LeanPlay ? 1 : 8;
            foreach (var id in MegaworldMap.All)
            {
                if (id == WorldId.Hub) continue;
                try
                {
                    var d = Vector3.Distance(player, MegaworldMap.Present(id));
                    var lod = LodOf(d);
                    var have = _chunks.TryGetValue(id, out var live) && live;
                    int currentLod = _lod.TryGetValue(id, out var recordedLod) ? recordedLod : 0;
                    if (lod >= 3)
                    {
                        if (!have || currentLod < 2)
                        {
                            if (built < budget)
                            {
                                // LeanPlay: never RequestFull foreign continents — FarGeography impostors only.
                                // Hub full path is RequestFull(Hub) from Boot; untouched here (loop skips Hub).
                                if (ConcordiaHost.LeanPlay)
                                {
                                    EnsureImpostor(id);
                                    built++;
                                }
                                else
                                {
                                    RequestFull(id);
                                    built++;
                                }
                            }
                        }
                    }
                    else if (lod >= 1)
                    {
                        if (have) EnsureImpostor(id);
                        else if (built < budget)
                        {
                            // LeanPlay: SeedImpostorsStaged can starve under Hub RequestFull.
                            // Finish missing Present geography near Hub (1/frame) — never RequestFull here.
                            bool nearHub = player.sqrMagnitude <= HubKeepM * HubKeepM;
                            if (id == toward || !ConcordiaHost.LeanPlay || nearHub)
                            {
                                EnsureImpostor(id);
                                built++;
                            }
                        }
                    }
                    else Release(id);
                }
                catch (System.Exception e)
                {
                    Debug.LogException(e);
                }
            }
            if (_fullBuild == null)
            {
                try { Ensure(WorldId.Hub); }
                catch (System.Exception e) { Debug.LogException(e); }
            }
            if (_continentReady && !_roadLife && continent && _wildernessBuild == null)
                _wildernessBuild = StartCoroutine(BuildWildernessStaged(_continentGeneration));
        }

        /// <summary>
        /// The land underfoot is this stream's job — not ConcordiaGame.Update,
        /// which used to skip Tick while the creator overlay was open so you
        /// could stand in Fantasy Present with world still Hub.
        /// </summary>
        void LateUpdate()
        {
            var p = ConcordiaPlayer.Live;
            if (!p || p.creatorLocked) return;
            // Budget Tick — every-frame stream after CompileOne melted Editor update.
            if ((Time.frameCount % 8) != 0) return;
            Tick(p.transform.position);
        }

        public void Teleport(ConcordiaPlayer player, WorldId next)
        {
            if (!player) return;
            LastTravelKind = "link_gate";
            Ensure(WorldId.Hub);
            Ensure(next);
            if (!IsReady(WorldId.Hub) || !IsReady(next))
            {
                StartCoroutine(CompleteTeleportWhenReady(player, next));
                return;
            }
            CompleteTeleport(player, next);
        }

        public Transform Ensure(WorldId id, int lod = 2)
        {
            if (_lod.TryGetValue(id, out var have) && have >= 2 && _chunks.TryGetValue(id, out var live) && live)
            {
                _lod[id] = lod < 2 ? 2 : lod;
                return live;
            }
            if (_chunks.TryGetValue(id, out var existing) && existing)
            {
                if (have >= 2) return existing;
                Release(id);
            }
            EnsureContinent();
            // Never sync BuildChunk — Full Play hit the same CX/visual storm LeanPlay avoided.
            Debug.Log("[Concordia] Ensure routes to RequestFull for " + id);
            RequestFull(id);
            return _chunks.TryGetValue(id, out var pending) ? pending : EnsureImpostor(id);
        }

void RequestFull(WorldId id)
        {
            // Slice 6 hard cap: LeanPlay keeps non-Hub at FarGeography impostor — no sync/staged BuildChunk.
            if (ConcordiaHost.LeanPlay && id != WorldId.Hub)
            {
                EnsureImpostor(id);
                return;
            }
            if (_fullBuild != null) return;
            if (_lod.TryGetValue(id, out var lod) && lod >= 2 && _chunks.TryGetValue(id, out var existing) && existing)
            {
                SetReadiness(id, ChunkReadiness.Ready);
                return;
            }

            var generation = NextChunkGeneration(id);
            _fullBuildWorld = id;
            _fullBuildGeneration = generation;
            SetReadiness(id, ChunkReadiness.Building, generation);
            _fullBuild = StartCoroutine(BuildFull(id, generation));
        }

System.Collections.IEnumerator BuildFull(WorldId id, int generation)
        {
            Transform built = null;
            try
            {
                yield return StartCoroutine(WaitForContinentReady());
                if (!_continentReady)
                {
                    Debug.LogError("[Concordia] BuildFull aborted: continent never reached ready for " + id);
                    yield break;
                }
                if (!IsCurrentGeneration(id, generation) || !OwnsFullBuild(id, generation)) yield break;
                if (!_builder || !continent) yield break;

                yield return StartCoroutine(_builder.BuildChunkStaged(id, continent, chunk => built = chunk));
                if (!IsCurrentGeneration(id, generation) || !OwnsFullBuild(id, generation))
                {
                    if (built) Object.Destroy(built.gameObject);
                    yield break;
                }

                var current = _chunks.TryGetValue(id, out var currentChunk) && currentChunk ? currentChunk : null;
                if (built)
                {
                    built.position = MegaworldMap.Present(id);
                    if (current && current != built) Object.Destroy(current.gameObject);
                    _chunks[id] = built;
                    _lod[id] = 2;
                    SetReadiness(id, ChunkReadiness.Ready, generation);
                }
                else if (current)
                {
                    _chunks[id] = current;
                    _lod[id] = 1;
                    SetReadiness(id, ChunkReadiness.Impostor, generation);
                }
                else
                {
                    _chunks.Remove(id);
                    _lod.Remove(id);
                    SetReadiness(id, ChunkReadiness.Retiring, generation);
                }
            }
            finally
            {
                if (OwnsFullBuild(id, generation))
                    _fullBuild = null;
            }
        }


        Transform EnsureImpostor(WorldId id)
        {
            if (_lod.TryGetValue(id, out var have) && have >= 2 && _chunks.TryGetValue(id, out var full) && full)
                return full;
            if (_lod.TryGetValue(id, out var lod) && lod == 1 && _chunks.TryGetValue(id, out var existing) && existing)
                return existing;
            if (_chunks.TryGetValue(id, out var stale) && stale) Release(id);
            EnsureContinent();
            if (!_builder || !continent) return null;
            var chunk = _builder.BuildImpostor(id, continent);
            if (!chunk) return null;
            chunk.position = MegaworldMap.Present(id);
            _chunks[id] = chunk;
            _lod[id] = 1;
            if (!IsBuildRequested(id)) SetReadiness(id, ChunkReadiness.Impostor);
            return chunk;
        }

        void Release(WorldId id)
        {
            bool hasChunk = _chunks.TryGetValue(id, out var chunk) && chunk;
            bool hasState = _readiness.ContainsKey(id);
            if (!hasChunk && !hasState) return;

            var generation = NextChunkGeneration(id);
            SetReadiness(id, ChunkReadiness.Retiring, generation);
            if (hasChunk) Object.Destroy(chunk.gameObject);
            _chunks.Remove(id);
            _lod.Remove(id);
        }

        /// <summary>
        /// Sky, kit, clock, journey stamp. Cheap. The body calls this after
        /// Move so receive does not wait on chunk Ensure. Stand() calls it
        /// so a warp without a frame still takes you.
        /// </summary>
        public void ReceiveHere(Vector3 player)
        {
            var next = Canon.InHubCourt(player)
                ? WorldId.Hub
                : WorldGeography.CountryAt(player);
            SoftEnter(next);
            RoadWorld.TickNear(player);
        }

        /// <summary>
        /// Walk-in and debug teleports. Always writes ConcordiaPlayer.world
        /// and kit first — WorldClock matching is not enough (Editor proof:
        /// clock Fantasy, player.world still Hub, steel false).
        /// </summary>
        public void SoftEnter(WorldId id, string kind = "walk")
        {
            string journey = null;
            var from = WorldClock.World;
            var preservedKill = WorldClock.KillLine(WorldClock.LastEvent) ? WorldClock.LastEvent : null;
            if (WorldClock.World != id)
            {
                if (id == WorldId.Hub)
                    journey = "You came home from " + Canon.Get(WorldClock.World).title + ".";
                else if (WorldClock.World == WorldId.Hub)
                    journey = "You left Hub for " + Canon.Get(id).title + ".";
                else
                    journey = "You crossed into " + Canon.Get(id).title + ".";
            }
            SyncActor(id);
            if (WorldClock.World == id) return;
            LastTravelKind = kind;
            WorldClock.Leave();
            WorldClock.Enter(id);
            if (!string.IsNullOrEmpty(preservedKill))
                WorldClock.LastEvent = preservedKill;
            if (kind == "walk" && from != id)
            {
                var route = WorldGeography.RouteBetween(from, id);
                if (route != null)
                    WorldGeography.RecordBorderCrossing(route.border, from, id, "physical");
            }
            // Do not clobber a kill summary with the journey home stamp.
            if (string.IsNullOrEmpty(preservedKill) && !string.IsNullOrEmpty(journey) && !WorldClock.KillLine(WorldClock.LastEvent))
                WorldClock.LastEvent = journey;
            try { ApplySky(id); }
            catch (System.Exception e) { Debug.LogException(e); }
            ModularPerson.CastingWorld = id;
            var player = ConcordiaPlayer.Live;
            if (player) player.world = id;
            var game = Object.FindAnyObjectByType<ConcordiaGame>();
            if (game) game.world = id;
            if (LastTravelKind != "link_gate")
            {
                var w = Canon.Get(id);
                ConcordiaHUD.Announce(w.title, w.refusal);
            }
            try { ReceiveTraveler(id); }
            catch (System.Exception e) { Debug.LogException(e); }
        }

        /// <summary>
        /// Arrival is being noticed — not a title card. Empty land stays empty.
        /// </summary>
        static void ReceiveTraveler(WorldId id)
        {
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            int n = 0;
            foreach (var life in Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Exclude))
            {
                if (!life) continue;
                if (Vector3.Distance(life.transform.position, player.transform.position) > 14f) continue;
                life.NoticePlayer(5f);
                n++;
            }
            if (id == WorldId.Hub && !string.IsNullOrEmpty(WorldClock.LastEvent))
                player.Notice("They still talk about: " + WorldClock.LastEvent);
            else if (n > 0)
                player.Notice(Canon.Get(id).title + " received you.");
            else if (id != WorldId.Hub)
                player.Notice(Canon.Get(id).title + " is quiet. No one here yet.");
        }

        static void SyncActor(WorldId id)
        {
            var player = ConcordiaPlayer.Live;
            if (!player)
            {
                var all = Object.FindObjectsByType<ConcordiaPlayer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
                if (all != null && all.Length > 0) player = all[0];
            }
            var changed = false;
            if (player)
            {
                changed = player.world != id;
                player.world = id;
                if (changed) player.EquipWorldKit();
            }
            var game = ConcordiaGame.Live ?? Object.FindFirstObjectByType<ConcordiaGame>();
            if (game)
            {
                if (changed || game.world != id) game.NoteWorld(id);
                else game.world = id;
            }
        }

void EnsureContinent()
        {
            if (!continent)
            {
                var go = GameObject.Find("Megaworld");
                continent = go ? go.transform : new GameObject("Megaworld").transform;
                continent.position = Vector3.zero;
            }

            if (_continentReady || _continentBootstrap != null) return;
            _continentBootstrapGeneration = ++_continentGeneration;
            _continentBootstrap = StartCoroutine(BuildContinentStaged(_continentBootstrapGeneration));
        }

System.Collections.IEnumerator BuildContinentStaged(int generation)
        {
            try
            {
                if (!continent) yield break;
                // Readiness is the minimum physical bootstrap needed to begin the
                // Hub full chunk. Route geometry, weather, sun, and wilderness are
                // presentation work and continue independently after this gate.
                Debug.Log("[Concordia] continent stage=ground");
                try { MakeGround(); }
                catch (System.Exception ex) { Debug.LogException(ex); }
                yield return null;
                if (generation != _continentGeneration) yield break;

                Debug.Log("[Concordia] continent stage=court_horizon");
                try { CourtWalkableHorizon.Ensure(continent); }
                catch (System.Exception ex) { Debug.LogException(ex); }
                yield return null;
                if (generation != _continentGeneration) yield break;

                StartCoroutine(FinishContinentPresentationStaged(generation));
            }
            finally
            {
                if (generation == _continentBootstrapGeneration)
                {
                    _continentReady = generation == _continentGeneration && continent != null;
                    _continentBootstrap = null;
                    Debug.Log("[Concordia] continent stage=ready ready=" + _continentReady);
                }
            }
        }

System.Collections.IEnumerator FinishContinentPresentationStaged(int generation)
        {
            if (generation != _continentGeneration || !continent) yield break;

            Debug.Log("[Concordia] continent stage=hub_wilderness");
            try { HubWilderness.Ensure(continent); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            if (generation != _continentGeneration) yield break;

            Debug.Log("[Concordia] continent stage=roads");
            try { MakeRoads(); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            if (generation != _continentGeneration) yield break;

            Debug.Log("[Concordia] continent stage=routes");
            System.Collections.IEnumerator routes = null;
            try { routes = GeographyRuntime.BuildRoutesStaged(continent); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            if (routes != null) yield return routes;
            if (generation != _continentGeneration) yield break;

            Debug.Log("[Concordia] continent stage=visuals");
            System.Collections.IEnumerator visuals = null;
            try { visuals = WorldVisualDirector.EnsureContinentStaged(continent); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            if (visuals != null) yield return visuals;
            if (generation != _continentGeneration) yield break;

            Debug.Log("[Concordia] continent stage=sun");
            try { MakeSun(); }
            catch (System.Exception ex) { Debug.LogException(ex); }
            yield return null;
            if (generation != _continentGeneration) yield break;

            Debug.Log("[Concordia] continent stage=wilderness");
            if (_wildernessBuild == null)
                _wildernessBuild = StartCoroutine(BuildWildernessStaged(generation));
            if (_wildernessBuild != null)
                yield return _wildernessBuild;
        }


        System.Collections.IEnumerator WaitForContinentReady()
        {
            const int maxFrames = 1800;
            int frames = 0;
            while (!_continentReady && frames++ < maxFrames)
            {
                if (_continentBootstrap == null)
                    EnsureContinent();
                yield return null;
            }
            if (!_continentReady)
                Debug.LogError("[Concordia] WaitForContinentReady timed out after " + maxFrames + " frames");
        }

        int NextChunkGeneration(WorldId id)
        {
            int next = 1;
            if (_chunkGenerations.TryGetValue(id, out var current)) next = current + 1;
            _chunkGenerations[id] = next;
            return next;
        }

        void SetReadiness(WorldId id, ChunkReadiness state, int generation = -1)
        {
            _readiness[id] = state;
            if (generation >= 0) _chunkGenerations[id] = generation;
        }

        bool IsCurrentGeneration(WorldId id, int generation)
        {
            return _chunkGenerations.TryGetValue(id, out var current) && current == generation;
        }

        bool OwnsFullBuild(WorldId id, int generation)
        {
            return _fullBuild != null && _fullBuildWorld == id && _fullBuildGeneration == generation;
        }

        bool IsBuildRequested(WorldId id)
        {
            return _fullBuild != null && _fullBuildWorld == id;
        }

        void CompleteTeleport(ConcordiaPlayer player, WorldId next)
        {
            if (!player) return;
            var spawn = MegaworldMap.Present(next);
            if (next == WorldId.Hub) spawn = Canon.Spawn;
            else spawn += new Vector3(0f, 0.12f, 2f);
            player.cc.enabled = false;
            player.transform.position = spawn;
            player.transform.rotation = Quaternion.Euler(0f, 180f, 0f);
            player.cc.enabled = true;
            if (player.cam) player.cam.yaw = Mathf.PI;
            Grounding.Snap(player.cc);
            player.world = next;
            SoftEnter(next, "link_gate");
            player.EquipWorldKit();
        }

        System.Collections.IEnumerator CompleteTeleportWhenReady(ConcordiaPlayer player, WorldId next)
        {
            const int timeoutFrames = 1800;
            const int readinessDiagnosticAfterFrames = 60;
            int frames = 0;
            bool readinessDiagnosticLogged = false;
            while (player && frames++ < timeoutFrames && (!IsReady(WorldId.Hub) || !IsReady(next)))
            {
                if (!readinessDiagnosticLogged && frames > readinessDiagnosticAfterFrames)
                {
                    var hubState = _readiness.TryGetValue(WorldId.Hub, out var hubReadiness)
                        ? hubReadiness.ToString()
                        : "Missing";
                    var destinationState = _readiness.TryGetValue(next, out var destinationReadiness)
                        ? destinationReadiness.ToString()
                        : "Missing";
                    Debug.LogWarning("[Concordia] Link-gate readiness wait exceeded "
                        + readinessDiagnosticAfterFrames + " frames: next=" + next
                        + " Hub=" + hubState + " ready=" + IsReady(WorldId.Hub)
                        + " destination=" + destinationState + " ready=" + IsReady(next));
                    readinessDiagnosticLogged = true;
                }
                yield return null;
            }
            if (player && IsReady(next)) CompleteTeleport(player, next);
        }

        void MakeGround()
        {
            if (!continent.Find("ContinentGround"))
            {
                var g = GameObject.CreatePrimitive(PrimitiveType.Plane);
                g.name = "ContinentGround";
                g.transform.SetParent(continent, false);
                // Cover Court mid-hills + horizon mask (~210m) with margin — void-drop guard.
                g.transform.localScale = Vector3.one * 88f;
                var mat = HubLook.Pbr("packed_earth", new Color(0.42f, 0.38f, 0.32f), 0.05f, 0.22f, 28f);
                var r = g.GetComponent<Renderer>();
                if (r && mat) r.sharedMaterial = mat;
            }
            else
            {
                // Existing scenes may still carry the pre-SLICE-1 72× plane.
                var existing = continent.Find("ContinentGround");
                if (existing && existing.localScale.x < 85f)
                    existing.localScale = Vector3.one * 88f;
            }
            if (continent.Find("CourtGround")) return;
            var court = GameObject.CreatePrimitive(PrimitiveType.Plane);
            court.name = "CourtGround";
            court.transform.SetParent(continent, false);
            court.transform.localPosition = new Vector3(0f, 0.04f, 0f);
            court.transform.localScale = Vector3.one * (Canon.RingRadius * 2.2f / 10f);
            var courtMat = HubLook.WetStone("cobblestone_square", 5.5f);
            var cr = court.GetComponent<Renderer>();
            if (cr && courtMat) cr.sharedMaterial = courtMat;
        }

        void MakeRoads()
        {
            if (continent.Find("ContinentRoads")) return;
            var hold = new GameObject("ContinentRoads").transform;
            hold.SetParent(continent, false);
            foreach (var g in Canon.Gates)
            {
                var dest = MegaworldMap.Present(g.world);
                var from = dest.normalized * (Canon.RingRadius + 2f);
                var mid = (from + dest) * 0.5f;
                var len = Vector3.Distance(from, dest);
                if (len < 4f) continue;
                var road = GameObject.CreatePrimitive(PrimitiveType.Cube);
                road.name = "Road_" + g.shortName;
                road.transform.SetParent(hold, false);
                road.transform.position = mid + Vector3.up * 0.03f;
                road.transform.rotation = Quaternion.LookRotation(dest - from, Vector3.up);
                road.transform.localScale = new Vector3(3.2f, 0.06f, len);
                var mat = HubLook.Pbr("packed_earth", g.color * 0.35f, 0.08f, 0.18f, 8f);
                var rr = road.GetComponent<Renderer>();
                if (rr && mat) rr.sharedMaterial = mat;
            }
        }

        /// <summary>
        /// Rocks, hills, and road marks between the Hub ring and each
        /// civilization. Not towns. A missing pack stays a primitive.
        /// </summary>
void MakeWilderness()
        {
            var hold = continent.Find("ContinentWilderness");
            if (!hold)
            {
                hold = new GameObject("ContinentWilderness").transform;
                hold.SetParent(continent, false);
                var earth = HubLook.Pbr("packed_earth", new Color(0.38f, 0.33f, 0.26f), 0.06f, 0.28f, 16f);
                var stone = HubLook.Pbr("stone_tiles", new Color(0.46f, 0.42f, 0.36f), 0.04f, 0.22f, 12f);
                foreach (var g in Canon.Gates)
                    BuildWildernessGate(hold, g, earth, stone);
            }
            ClearSunderingWalk(hold);
            // Never sync RoadWorld.Seed — WorldStreamManager / SeedStaged only.
            if (_wildernessBuild == null)
                _wildernessBuild = StartCoroutine(BuildWildernessStaged(_continentGeneration));
        }

System.Collections.IEnumerator BuildWildernessStaged(int generation)
        {
            try
            {
                var hold = continent.Find("ContinentWilderness");
                if (!hold)
                {
                    hold = new GameObject("ContinentWilderness").transform;
                    hold.SetParent(continent, false);
                    var earth = HubLook.Pbr("packed_earth", new Color(0.38f, 0.33f, 0.26f), 0.06f, 0.28f, 16f);
                    var stone = HubLook.Pbr("stone_tiles", new Color(0.46f, 0.42f, 0.36f), 0.04f, 0.22f, 12f);
                    foreach (var g in Canon.Gates)
                    {
                        if (generation != _continentGeneration) yield break;
                        BuildWildernessGate(hold, g, earth, stone);
                        yield return null;
                    }
                }
                if (generation != _continentGeneration) yield break;
                ClearSunderingWalk(hold);
                yield return null;
                if (generation != _continentGeneration) yield break;
                yield return RoadWorld.SeedStaged(hold);
                if (generation != _continentGeneration) yield break;
                _roadLife = true;
            }
            finally
            {
                if (generation == _continentGeneration)
                    _wildernessBuild = null;
            }
        }

        static void BuildWildernessGate(Transform hold, GateDef g, Material earth, Material stone)
        {
            var dest = MegaworldMap.Present(g.world);
            if (dest.sqrMagnitude < 4f) return;
            var dir = dest.normalized;
            var side = Vector3.Cross(Vector3.up, dir);
            var span = dest.magnitude - Canon.RingRadius - ChunkRadiusM;
            if (span < 12f) return;
            int n = Mathf.Max(4, Mathf.FloorToInt(span / 16f));
            for (int i = 0; i < n; i++)
            {
                float t = (i + 1f) / (n + 1f);
                float along = Canon.RingRadius + 10f + t * span;
                var p = dir * along;
                int h = StemHash(g.shortName, i);
                float off = ((h % 1000) / 1000f - 0.5f) * 14f;
                var hill = p + side * (5.5f + off);
                float ht = 1.6f + (h % 7) * 0.85f;
                float w = 3.2f + (h % 5) * 0.7f;
                if (Canon.BlocksSunderingWalk(hill, w * 0.5f)) continue;
                var prim = (h % 3 == 0) ? PrimitiveType.Sphere : PrimitiveType.Cube;
                HubLook.Prim(hold, prim, hill + Vector3.up * (ht * 0.45f),
                    new Vector3(w, ht, w * 0.85f), earth, "Hill_" + g.shortName + "_" + i);

                var rockAt = p - side * (3.4f + (h % 5) * 0.6f);
                var rock = FreePacks.Spawn(DressVocab.Rock(), hold, rockAt, h % 360,
                    1.1f + (h % 4) * 0.25f, required: false);
                if (!rock)
                    HubLook.Prim(hold, PrimitiveType.Cube, rockAt + Vector3.up * 0.35f,
                        new Vector3(1.1f, 0.7f, 0.9f), stone, "Rock_" + g.shortName + "_" + i);

                if (i % 2 == 0)
                {
                    var left = Mathf.Max(0f, dest.magnitude - along);
                    RoadWorld.PlaceSign(hold, g, p, dir, i, left);
                }
            }
        }


        /// <summary>
        /// Scene leftovers or a skip that didn't fire still cannot sit in the
        /// +Z stride. Do not disable ContinentGround to walk past them.
        /// </summary>
        static void ClearSunderingWalk(Transform hold)
        {
            if (!hold) return;
            for (int i = hold.childCount - 1; i >= 0; i--)
            {
                var c = hold.GetChild(i);
                if (!c) continue;
                if (!c.name.StartsWith("Hill_") && !c.name.StartsWith("Rock_")) continue;
                float half = Mathf.Max(c.lossyScale.x, c.lossyScale.z) * 0.5f;
                if (Canon.BlocksSunderingWalk(c.position, half))
                    Object.DestroyImmediate(c.gameObject);
            }
        }

        static int StemHash(string s, int i)
        {
            int h = 17;
            if (!string.IsNullOrEmpty(s))
                for (int n = 0; n < s.Length; n++) h = h * 31 + s[n];
            return (h ^ (i * 7919)) & 0x7fffffff;
        }

        void MakeSun()
        {
            if (_sun) return;
            var go = new GameObject("ContinentSun");
            go.transform.SetParent(continent, false);
            go.transform.rotation = Quaternion.Euler(42f, -38f, 0f);
            _sun = go.AddComponent<Light>();
            _sun.type = LightType.Directional;
            _sun.color = new Color(1f, 0.86f, 0.68f); // warm key ~4000K
            _sun.intensity = 0.62f;
            _sun.shadows = LightShadows.Soft;
            RenderSettings.sun = _sun;
            HubLook.EnsureCourtRig(WorldId.Hub);
        }

        void ApplySky(WorldId id)
        {
            _builder.DressChunkSky(id);
            if (_sun)
            {
                var w = Canon.Get(id);
                _sun.color = Color.Lerp(new Color(1f, 0.94f, 0.82f), w.sun, 0.45f);
            }
            if (Camera.main) Camera.main.farClipPlane = 420f;
        }

        void OnDestroy()
        {
            if (Live == this) Live = null;
        }
    }
}
