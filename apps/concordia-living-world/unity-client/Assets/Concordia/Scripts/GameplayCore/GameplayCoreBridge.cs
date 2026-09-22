using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.ConKay;
using Concordia.GameplayCore.Combat;
using Concordia.GameplayCore.Containers;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.Gunsmithing;
using Concordia.GameplayCore.Movement;
using Concordia.GameplayCore.Spellcrafting;
using Concordia.GameplayCore.WorldField;
using Concordia.GameplayCore.Persistence;
using Concordia.GameplayCore.Presentation;
using Concordia.GameplayCore.WorldFabric;
using Concordia.GameplayCore.GoldenSlice;
using Concordia.Vehicles;
using Concordia.WorldSimulation;
using Concordia.WorldSystems;

namespace Concordia.GameplayCore
{
    /// <summary>
    /// Single additive composition bridge for the completed gameplay-core packages.
    /// Existing Concordia systems remain authoritative; this bridge exposes their
    /// state to the new contracts and routes only presentation/defense hooks.
    /// </summary>
    [DefaultExecutionOrder(-20)]
    public sealed class GameplayCoreBridge : MonoBehaviour
    {
        public static GameplayCoreBridge Live { get; private set; }

        public ConcordiaGame Game { get; private set; }
        public ConcordiaPlayer Player { get; private set; }
        public ChaseCamera ChaseCamera { get; private set; }
        public ConcordClient Client { get; private set; }
        public ConcordiaLocomotionBindings LocomotionBindings { get; private set; }
        public LocomotionStateMachine LocomotionState { get; private set; }
        public LocomotionSnapshot Snapshot { get; private set; }
        public WorldSystemsHost WorldHost { get; private set; }
        public WorldSystemsBuildingAdapter StoreAdapter { get; private set; }
        public WorldSystemsEconomyService Economy { get; private set; }
        public WorldSystemsInventoryContract PlayerInventory { get; private set; }
        public CanonicalContainerService Containers { get; private set; }
        public WorldSimulationHost SimulationHost { get; private set; }
        public WorldSimulationService Simulation { get; private set; }
        public WorldFabricRuntime FabricRuntime { get; private set; }
        public WorldFabricService Fabric { get; private set; }
        public global::Concordia.WorldField.Sample CurrentWorldField { get; private set; }
        public string FieldBecause => CurrentWorldField.because;
        public ConKayGameplayCoreAdapter ConKayAdapter { get; private set; }
        public ConcordLinkRuntime ConcordLink { get; private set; }
        public IReadOnlyList<FabricatedObjectRecord> FabricatedObjects => _fabricatedObjects;
        public IReadOnlyList<ComposedWeaponRecord> ComposedWeapons => _weapons;
        public IReadOnlyList<ComposedSpellRecord> ComposedSpells => _spells;
        public IEnumerable<CanonicalContainerRecord> CanonicalContainers => Containers == null ? new List<CanonicalContainerRecord>() : Containers.All;
        public WorldFieldAuthority FieldAuthority { get; private set; }
        public GameplayCombatRegistry CombatRegistry { get; private set; }
        public CombatEventRecorder CombatEvents { get; private set; }
        public ConcordiaPresentationDirector Presentation { get; private set; }
        public string RuntimeDiagnostics { get; private set; }
        public bool LastSaveSucceeded { get; private set; }
        public LocomotionInput LastInput { get; private set; }
        public VehicleVerticalSlice ActiveVehicle { get; private set; }
        public GoldenSliceRuntime GoldenSlice { get; private set; }

        Vector3 _lastPosition;
        float _saveAt;
        float _refreshAt;
        bool _guardHeld;
        float _guardStarted;
        CombatDefenseState _defense;
        public CombatDefenseState DefenseState => _defense;
        WorldId _boundWorld;
        float _actorRefreshAt;
        bool _leanExpanded;
        bool _leanFabricBound;
        bool _leanUpdateFull;
        float _fabricRefreshAt;
        float _fieldRefreshAt;
        bool _simulationSubscribed;
        bool _fabricSubscribed;
        bool _fabricRestored;
        bool _economySeeded;
        bool _economyRestored;
        readonly List<FabricatedObjectRecord> _fabricatedObjects = new List<FabricatedObjectRecord>();
        readonly List<ComposedWeaponRecord> _weapons = new List<ComposedWeaponRecord>();
        readonly List<ComposedSpellRecord> _spells = new List<ComposedSpellRecord>();
        bool _capabilitiesRestored;


        public static GameplayCoreBridge Install(ConcordiaGame game, ConcordiaPlayer player, ChaseCamera chase, ConcordClient client)
        {
            if (!player) return null;
            var bridge = player.GetComponent<GameplayCoreBridge>() ?? player.gameObject.AddComponent<GameplayCoreBridge>();
            bridge.Bind(game, player, chase, client);
            return bridge;
        }

public void Bind(ConcordiaGame game, ConcordiaPlayer player, ChaseCamera chase, ConcordClient client)
        {
            Game = game;
            Player = player;
            ChaseCamera = chase;
            Client = client;
            Live = this;
            _boundWorld = player ? player.world : WorldId.Hub;
            _lastPosition = player ? player.transform.position : Vector3.zero;
            LocomotionBindings = LocomotionBindings ?? new ConcordiaLocomotionBindings();
            if (player) LocomotionBindings.Resolve(player.transform);
            LocomotionState = LocomotionState ?? new LocomotionStateMachine();
            LocomotionState.Reset(LocomotionBindings.Controller && LocomotionBindings.Controller.isGrounded);
            CombatEvents = CombatEvents ?? new CombatEventRecorder();
            CombatRegistry = CombatRegistry ?? new GameplayCombatRegistry();
            // Always light Install — synchronous fabric/actor expansion starved the editor.
            // ExpandSystemsStaged (capped) fills the rest after Hub settle.
            EnsureWorldSystems();
            EnsureEconomy();
            FieldAuthority = FieldAuthority ?? new WorldFieldAuthority();
            Containers = Containers ?? new CanonicalContainerService();
            Presentation = Presentation ?? (gameObject.GetComponent<ConcordiaPresentationDirector>() ?? gameObject.AddComponent<ConcordiaPresentationDirector>());
            if (player) Presentation.Bind(this, player, chase);
            try { UpdateDiagnostics(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            UnityEngine.Debug.Log("[Concordia] Bridge.Install light (ExpandSystemsStaged follows)");
        }

        public System.Collections.IEnumerator ExpandSystemsStaged()
        {
            UnityEngine.Debug.Log("[Concordia] LeanPlay: ExpandSystemsStaged begin (fabric+findobjects staged)");
            try { EnsureWorldSimulation(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            try { EnsureGoldenSlice(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            try { EnsurePresentationAdapters(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            try { EnsureConKay(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            try { EnsureConcordLink(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;

            // Fabric core (no BuildingPlace scan yet).
            UnityEngine.Debug.Log("[Concordia] LeanPlay: expand fabric core");
            try { EnsureWorldFabricCore(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning("[Concordia] fabric core: " + ex.Message); }
            yield return null;

            // Cap fabric place binds — 36 CompileOne buildings made one-per-frame bind starve Play.
            var places = FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            var placeCap = Mathf.Min(16, places != null ? places.Length : 0);
            UnityEngine.Debug.Log("[Concordia] expand fabric places=" + (places != null ? places.Length : 0) + " bindCap=" + placeCap);
            for (var i = 0; i < placeCap; i++)
            {
                try { BindOneFabricPlace(places[i]); }
                catch (System.Exception ex) { UnityEngine.Debug.LogWarning("[Concordia] fabric place: " + ex.Message); }
                if ((i & 3) == 3) yield return null; // 4 binds/frame
            }
            yield return null;

            // Soft bind — each step yields; FindObjects guest/container capped.
            UnityEngine.Debug.Log("[Concordia] LeanPlay: expand EnsureStoreAdapter");
            try { EnsureStoreAdapter(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            UnityEngine.Debug.Log("[Concordia] LeanPlay: expand GoldenSlice.Configure");
            try { GoldenSlice?.Configure(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;
            UnityEngine.Debug.Log("[Concordia] LeanPlay: expand RefreshCombatants");
            try { RefreshCombatants(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            yield return null;

            UnityEngine.Debug.Log("[Concordia] LeanPlay: expand EnsureContainersPlayerAndVehicles");
            try { EnsureContainersPlayerAndVehicles(); } catch (System.Exception ex) { UnityEngine.Debug.LogWarning(ex.Message); }
            // Same-frame capped unlocks — yields after this point used to never resume under dense Court.
            try
            {
                if (Containers == null) Containers = new CanonicalContainerService();
                var worldContainers = FindObjectsByType<WorldFabricContainer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
                var cCap = Mathf.Min(8, worldContainers.Length);
                for (var i = 0; i < cCap; i++)
                {
                    var worldContainer = worldContainers[i];
                    if (!worldContainer || string.IsNullOrEmpty(worldContainer.containerId)) continue;
                    var id = CanonicalContainerIds.WorldFabric(worldContainer.containerId);
                    if (!Containers.TryGet(id, out var canonical))
                    {
                        canonical = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.Chest, displayName = worldContainer.name, ownerId = worldContainer.ownerId ?? "", accessRule = string.IsNullOrEmpty(worldContainer.ownerId) ? ContainerAccessRule.Public : ContainerAccessRule.OwnerOnly, capacity = worldContainer.capacity, inventoryAuthority = ContainerInventoryAuthority.Canonical, authorityId = worldContainer.containerId, provenance = new ContainerProvenance { sourceId = worldContainer.containerId, sourceKind = "WorldFabricContainer", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "scene-adapter" } };
                        Containers.Register(canonical, new WorldFabricContainerAdapter(worldContainer));
                    }
                    else Containers.BindAdapter(id, new WorldFabricContainerAdapter(worldContainer));
                }
                UnityEngine.Debug.Log("[Concordia] LeanPlay: expand containers bound=" + cCap + " (skip SyncAll)");
            }
            catch (System.Exception ex) { UnityEngine.Debug.LogWarning("[Concordia] LeanPlay: expand containers: " + ex.Message); }

            // Hub staging has completed before this coroutine is entered. Bind only existing
            // authored actors through their adapters, one actor per frame; never construct NPCs here.
            yield return BindWorldSimulationActorsStaged();

            _leanExpanded = true;
            _leanFabricBound = true;
            UnityEngine.Debug.Log("[Concordia] LeanPlay: ExpandSystemsStaged done (fabric+containers+simulation actors)");
            yield break;
        }

        public void EnableLeanFullUpdate()
        {
            _leanUpdateFull = true;
            UnityEngine.Debug.Log("[Concordia] LeanPlay: Bridge full Update enabled");
        }

        void EnsureWorldFabricCore()
        {
            FabricRuntime = WorldFabricRuntime.Active;
            if (!FabricRuntime)
            {
                var hostGo = new GameObject("GameplayCoreWorldFabric");
                FabricRuntime = hostGo.AddComponent<WorldFabricRuntime>();
            }
            Fabric = FabricRuntime != null ? FabricRuntime.Service : null;
            if (FabricRuntime != null && !_fabricSubscribed)
            {
                FabricRuntime.ConsequenceRaised += OnFabricConsequence;
                _fabricSubscribed = true;
            }
            if (FabricRuntime != null && !_fabricRestored)
            {
                ConcordiaPersistenceService.RestoreWorldFabric(FabricRuntime);
                _fabricRestored = true;
            }
            if (Fabric == null || Player == null) return;
            var world = Player.world.ToString();
            var canon = Canon.Get(Player.world);
            var settlementId = "settlement/" + world.ToLowerInvariant() + "/runtime";
            Fabric.EnsureSettlement(
                settlementId,
                world,
                "runtime",
                canon != null ? canon.title : world,
                Player.world == WorldId.Hub ? "hub" : "settlement",
                world,
                "concordia",
                1,
                new[] { "canonical-world-profile" },
                new[] { "WorldGeography", "Canon" });
        }

        void BindOneFabricPlace(BuildingPlace place)
        {
            if (!place || Fabric == null || Player == null) return;
            var world = Player.world.ToString();
            var settlementId = "settlement/" + world.ToLowerInvariant() + "/runtime";
            var goldenMarker = place.GetComponent<GoldenSliceMarker>();
            var buildingId = goldenMarker != null ? GoldenSliceRuntime.ForgeBuildingId : "building/fabric/" + world.ToLowerInvariant() + "/" + place.name.ToLowerInvariant().Replace(' ', '-');
            var boundSettlementId = goldenMarker != null ? GoldenSliceRuntime.SettlementId : settlementId;
            var boundRegionId = goldenMarker != null ? GoldenSliceRuntime.RegionId : "runtime";
            Fabric.EnsureBuilding(
                buildingId,
                world,
                boundRegionId,
                boundSettlementId,
                string.IsNullOrEmpty(place.plan) ? "building" : place.plan,
                string.IsNullOrEmpty(place.plan) ? "house" : place.plan,
                world,
                "concordia",
                "runtime-owner",
                StableSeed(buildingId),
                new[] { "BuildingPlace", "WorldGeography" });
            BindFabricIdentity(place, buildingId);
        }

        void EnsureContainersPlayerAndVehicles()
        {
            if (Containers == null) Containers = new CanonicalContainerService();
            if (PlayerInventory != null)
            {
                var id = CanonicalContainerIds.PlayerInventory(PlayerInventory.inventoryId);
                if (!Containers.TryGet(id, out var playerContainer))
                {
                    playerContainer = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.Backpack, displayName = "Player inventory", ownerId = "player", accessRule = ContainerAccessRule.OwnerOnly, capacity = PlayerInventory.capacity, inventoryAuthority = ContainerInventoryAuthority.WorldSystemsInventory, authorityId = PlayerInventory.inventoryId, provenance = new ContainerProvenance { sourceId = PlayerInventory.inventoryId, sourceKind = "WorldSystemsInventoryContract", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "runtime-adapter" } };
                    Containers.Register(playerContainer, new WorldSystemsInventoryContainerAdapter(PlayerInventory));
                }
                else Containers.BindAdapter(id, new WorldSystemsInventoryContainerAdapter(PlayerInventory));
            }
            foreach (var vehicle in VehiclePersistenceService.Vehicles)
            {
                if (!vehicle) continue;
                var id = CanonicalContainerIds.VehicleStorage(vehicle.EntityId);
                if (!Containers.TryGet(id, out var vehicleContainer))
                {
                    vehicleContainer = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.VehicleTrunk, displayName = vehicle.name + " storage", ownerId = vehicle.OwnerId ?? "", accessRule = string.IsNullOrEmpty(vehicle.OwnerId) ? ContainerAccessRule.Public : ContainerAccessRule.OwnerOrAllowed, capacity = vehicle.StorageCapacity, inventoryAuthority = ContainerInventoryAuthority.VehicleStorage, authorityId = vehicle.EntityId + ":storage", provenance = new ContainerProvenance { sourceId = vehicle.EntityId, sourceKind = "VehicleEntity", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "runtime-adapter" } };
                    Containers.Register(vehicleContainer, new VehicleStorageContainerAdapter(vehicle, true));
                }
                else Containers.BindAdapter(id, new VehicleStorageContainerAdapter(vehicle, true));
            }
        }

        void BindOneWorldContainer(WorldFabricContainer worldContainer)
        {
            if (Containers == null) Containers = new CanonicalContainerService();
            if (!worldContainer || string.IsNullOrEmpty(worldContainer.containerId)) return;
            var id = CanonicalContainerIds.WorldFabric(worldContainer.containerId);
            if (!Containers.TryGet(id, out var canonical))
            {
                canonical = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.Chest, displayName = worldContainer.name, ownerId = worldContainer.ownerId ?? "", accessRule = string.IsNullOrEmpty(worldContainer.ownerId) ? ContainerAccessRule.Public : ContainerAccessRule.OwnerOnly, capacity = worldContainer.capacity, inventoryAuthority = ContainerInventoryAuthority.Canonical, authorityId = worldContainer.containerId, provenance = new ContainerProvenance { sourceId = worldContainer.containerId, sourceKind = "WorldFabricContainer", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "scene-adapter" } };
                Containers.Register(canonical, new WorldFabricContainerAdapter(worldContainer));
            }
            else Containers.BindAdapter(id, new WorldFabricContainerAdapter(worldContainer));
        }

        void Awake()
        {
            if (Live != null && Live != this) { Destroy(this); return; }
            Live = this;
        }

void Start()
        {
            if (ConcordiaHost.LeanPlay)
            {
                UpdateDiagnostics();
                return;
            }
            EnsureWorldSystems();
            EnsureWorldSimulation();
            EnsureWorldFabric();
            EnsureEconomy();
            GoldenSlice?.Configure();
            EnsureStoreAdapter();
            FieldAuthority = FieldAuthority ?? new WorldFieldAuthority();
            Containers = Containers ?? new CanonicalContainerService();
            EnsureContainers();
            EnsureConKay();
            EnsureConcordLink();
            UpdateDiagnostics();
        }

void Update()
        {
            if (!Player) return;
            // LeanPlay: locomotion-only until DressHero flips _leanUpdateFull (after Restore settle).
            if (ConcordiaHost.LeanPlay && !_leanUpdateFull)
            {
                SampleLocomotion();
                return;
            }
            // Force Full used to re-sweep fabric/actors/containers every 0.25–2s and melt
            // BehaviourUpdate after staged Expand. Keep Lean-safe cadences for both modes;
            // ExpandSystemsStaged already bound fabric once at boot.
            float fieldEvery = 1.0f;
            float refreshEvery = 8f;
            float actorEvery = 12f;
            float fabricEvery = 15f;
            if (Time.unscaledTime >= _fieldRefreshAt)
            {
                _fieldRefreshAt = Time.unscaledTime + fieldEvery;
                SampleWorldField(Player.transform.position, "athletics");
            }
            if (Time.unscaledTime >= _refreshAt)
            {
                _refreshAt = Time.unscaledTime + refreshEvery;
                EnsureEconomy();
                if (_leanFabricBound || !ConcordiaHost.LeanPlay)
                    RefreshCombatants();
            }
            if (Time.unscaledTime >= _actorRefreshAt)
            {
                _actorRefreshAt = Time.unscaledTime + actorEvery;
                // Skip dense actor resweep — Expand already bound; Tick binds on demand.
            }
            if (Time.unscaledTime >= _fabricRefreshAt)
            {
                _fabricRefreshAt = Time.unscaledTime + fabricEvery;
                if (_leanFabricBound || !ConcordiaHost.LeanPlay)
                {
                    EnsureWorldFabricCore();
                    GoldenSlice?.Configure();
                }
            }
            Economy?.Tick(Time.unscaledDeltaTime);
            SampleLocomotion();
            UpdateDefense();
            if (_boundWorld != Player.world)
            {
                Save();
                HandleWorldChanged(_boundWorld, Player.world);
                _boundWorld = Player.world;
                EnsureStoreAdapter();
                EnsureEconomy();
                EnsureContainers();
            }
            if (Time.unscaledTime >= _saveAt)
            {
                _saveAt = Time.unscaledTime + 60f;
                // Autosave stays rare — Force Full used to Save() every 8s.
            }
            UpdateDiagnostics();
        }

        void SampleLocomotion()
        {
            if (Player == null) return;
            if (LocomotionBindings == null)
            {
                LocomotionBindings = new ConcordiaLocomotionBindings();
                LocomotionBindings.Resolve(Player.transform);
            }
            if (LocomotionState == null)
            {
                LocomotionState = new LocomotionStateMachine();
                LocomotionState.Reset(LocomotionBindings.Controller && LocomotionBindings.Controller.isGrounded);
            }
            var dt = Mathf.Max(0.0001f, Time.unscaledDeltaTime);
            var position = Player.transform.position;
            var velocity = (position - _lastPosition) / dt;
            _lastPosition = position;
            var controller = LocomotionBindings != null ? LocomotionBindings.Controller : null;
            var environment = new LocomotionEnvironment
            {
                Grounded = controller != null && controller.enabled && controller.isGrounded,
                WallContact = controller != null && controller.enabled && (controller.collisionFlags & CollisionFlags.Sides) != 0,
                InSwimVolume = false,
                InFlightVolume = false,
                SuperspeedAllowed = Player.world != WorldId.Hub,
                SlopeAngle = 0f,
                GroundNormal = Vector3.up,
                WallNormal = Vector3.zero,
                Surface = LocomotionSurfaceData.Default
            };
            var input = new ConcordiaInputSource().Read(Player.transform, new ChaseCameraAdapter());
            var tuning = LocomotionTuning.Default;
            var transition = LocomotionState.Evaluate(input, environment, tuning, Player.stamina, LocomotionBindings.CanClimb);
            Snapshot = new LocomotionSnapshot
            {
                Context = LocomotionState.Current,
                Animation = LocomotionAnimationSelector.Select(LocomotionState.Current, velocity, environment.Grounded),
                Position = position,
                Velocity = velocity,
                GroundNormal = environment.GroundNormal,
                SlopeAngle = environment.SlopeAngle,
                Stamina = Player.stamina,
                Grounded = environment.Grounded,
                WallContact = environment.WallContact,
                SurfaceId = environment.Surface.Id
            };
            LocomotionBindings.ApplyAnimation(Snapshot);
            Player.GetComponent<PresentationAnimationBridge>()?.ApplyLocomotion(Snapshot);
            Presentation?.ApplySnapshot(Snapshot, transition);
        }

        void UpdateDefense()
        {
            var held = KeyHeld(KeyCode.C);
            if (held && !_guardHeld)
            {
                _guardStarted = Time.time;
                _defense = new CombatDefenseState
                {
                    Mode = CombatDefenseMode.PerfectGuard,
                    Facing = Player.transform.forward,
                    StartedAt = Time.time,
                    EndsAt = Time.time + 0.5f,
                    PerfectGuardUntil = Time.time + 0.12f,
                    ParryUntil = Time.time + 0.1f,
                    CounterActionId = "court-counter"
                };
            }
            else if (held)
            {
                _defense.Facing = Player.transform.forward;
                _defense.EndsAt = Time.time + 0.12f;
                if (Time.time > _defense.PerfectGuardUntil) _defense.Mode = CombatDefenseMode.Block;
            }
            else if (_guardHeld)
            {
                _defense = default(CombatDefenseState);
            }
            _guardHeld = held;
        }

        /// <summary>
        /// Presentation bookkeeping only. Live defense is ConcordiaPlayer.TakeHit →
        /// Core.HitResolver. Must not absorb or scale the hit — a second evaluator here
        /// was a parallel combat stack.
        /// </summary>
        public bool TryResolveIncomingDamage(ref float damage, string source, ref float knockback)
        {
            if (CombatEvents != null)
            {
                CombatEvents.Record(new CombatEvent(
                    CombatEventType.CollisionTested, CombatPhase.Collision, Time.time,
                    source, "player", "incoming:" + (source ?? "unknown"), "HitResolver", damage));
            }
            return true;
        }

        void EnsureGoldenSlice()
        {
            if (GoldenSlice == null)
            {
                GoldenSlice = gameObject.GetComponent<GoldenSliceRuntime>() ?? gameObject.AddComponent<GoldenSliceRuntime>();
                GoldenSlice.Bind(this);
            }
        }

void EnsureWorldSystems()
        {
            WorldHost = WorldSystemsHost.Active;
            if (!WorldHost)
            {
                var hostGo = new GameObject("GameplayCoreWorldSystems");
                WorldHost = hostGo.AddComponent<WorldSystemsHost>();
            }
            if (WorldHost != null && WorldHost.Simulation != null)
                ConcordiaPersistenceService.RestoreWorldSystems(WorldHost);
        }

        void EnsureStoreAdapter()
        {
            if (!WorldHost || WorldHost.Simulation == null) return;
            var places = FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            BuildingPlace target = null;
            for (var i = 0; i < places.Length; i++)
            {
                if (!places[i]) continue;
                if (string.Equals(places[i].plan, "market", StringComparison.OrdinalIgnoreCase)) { target = places[i]; break; }
                if (target == null) target = places[i];
            }
            if (!target) return;
            StoreAdapter = target.GetComponent<WorldSystemsBuildingAdapter>() ?? target.gameObject.AddComponent<WorldSystemsBuildingAdapter>();
            StoreAdapter.buildingId = "concordia-hub-market";
            StoreAdapter.settlementId = "unburned-court";
            StoreAdapter.ownerId = "concordia-market-keeper";
            StoreAdapter.factionId = "merchant_collective";
            StoreAdapter.kind = BuildingKind.Store;
            StoreAdapter.plan = string.IsNullOrEmpty(target.plan) ? "market" : target.plan;
            StoreAdapter.Bind(WorldHost.Simulation);
            var state = WorldHost.Simulation.FindBuildingState(StoreAdapter.buildingId);
            if (state != null)
            {
                state.construction = ConstructionStatus.Complete;
                state.operational = true;
                state.condition = Mathf.Max(0.85f, state.condition);
            }
            var offers = WorldHost.Simulation.GetOffers(StoreAdapter.buildingId);
            if (offers.Length == 0)
            {
                WorldHost.Simulation.State.storefront.Add(new StorefrontItem { itemId = "market-lantern-oil", storefrontId = StoreAdapter.buildingId, resource = "lantern oil", quantity = 8f, targetStock = 8f, unitPrice = 1.5f });
                WorldHost.Simulation.State.storefront.Add(new StorefrontItem { itemId = "market-travel-ration", storefrontId = StoreAdapter.buildingId, resource = "travel ration", quantity = 6f, targetStock = 6f, unitPrice = 2f });
                WorldHost.Simulation.Reindex();
            }
        }

public string TryInteract(Vector3 position)
        {
            if (Player == null) return null;
            var vehicleMessage = TryInteractVehicle(position);
            if (!string.IsNullOrEmpty(vehicleMessage)) return vehicleMessage;
            var containerMessage = TryInteractContainer(position);
            if (!string.IsNullOrEmpty(containerMessage)) return containerMessage;
            var fabricMessage = TryInteractFabric(position);
            if (!string.IsNullOrEmpty(fabricMessage)) return fabricMessage;
            var constructionMessage = TryInteractConstruction(position);
            if (!string.IsNullOrEmpty(constructionMessage)) return constructionMessage;
            if (!StoreAdapter || Economy == null) return null;

            var distance = Vector3.Distance(position, StoreAdapter.transform.position);
            if (distance > 3.6f) return null;
            var marketFactionId = FactionStandingIntegration.StableFactionId(StoreAdapter.factionId);
            if (!FactionStandingIntegration.CanTrade(Player.world, marketFactionId, out var marketRefusal))
            {
                FactionStandingIntegration.RecordDecision("market-refusal", StoreAdapter.buildingId + " refused service: " + marketRefusal, marketFactionId);
                return marketRefusal;
            }
            var standingPriceMultiplier = FactionStandingIntegration.MarketPriceMultiplier(Player.world, marketFactionId);
            var offers = StoreAdapter.GetOffers();
            if (offers == null || offers.Length == 0) return "The market is closed.";
            var offer = offers[0];
            var result = Economy.BuyFromShop("player", StoreAdapter.buildingId, offer.itemId, 1f, PlayerInventory != null ? PlayerInventory.inventoryId : "player-inventory", standingPriceMultiplier);
            if (!result.success) return result.message;
            if (!Mathf.Approximately(standingPriceMultiplier, 1f))
                FactionStandingIntegration.RecordDecision("market-price", StoreAdapter.buildingId + " price multiplier=" + standingPriceMultiplier.ToString("0.00"), marketFactionId);
            KitBag.AddLoot(result.resourceId ?? offer.resource, offer.resource);
            QuestLog.NoteGather(offer.resource);
            QuestLog.NoteLocation("market", "store", StoreAdapter.buildingId);
            Player.Notice("Bought " + offer.resource + " for " + result.totalValue.ToString("0.0") + ".");
            RecordConsequence("economy", "purchase", "Bought " + offer.resource + ".", "market purchase", "player", StoreAdapter.buildingId, offer.itemId, result.totalValue);
            Save();
            return "Bought " + offer.resource + ".";
        }

        void RefreshCombatants()
        {
            if (CombatRegistry == null) CombatRegistry = new GameplayCombatRegistry();
            CombatRegistry.Clear();
            CombatRegistry.Register(new PlayerCombatant(Player));
            var dummies = FindObjectsByType<TrainingDummy>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < dummies.Length; i++)
                if (dummies[i]) CombatRegistry.Register(new DummyCombatant(dummies[i], Player ? Player.world : WorldId.Hub));
        }

public void Save()
        {
            var unified = ConcordiaPersistenceService.TrySave(out var error);
            LastSaveSucceeded = unified;
            if (!unified && !string.IsNullOrEmpty(error)) Debug.LogWarning("[Concordia] unified save: " + error);
        }

void OnDisable()
        {
#if UNITY_EDITOR
            // During Play-mode stop Unity is already tearing down scene objects;
            // avoid a second full object-graph capture from the bridge teardown.
            if (!UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode)
                Save();
#else
            Save();
#endif
            if (_simulationSubscribed && SimulationHost != null) SimulationHost.EventRaised -= OnSimulationEvent;
            if (_fabricSubscribed && FabricRuntime != null) FabricRuntime.ConsequenceRaised -= OnFabricConsequence;
            _simulationSubscribed = false;
            _fabricSubscribed = false;
            if (Live == this) Live = null;
        }

        static bool KeyHeld(KeyCode key)
        {
#if ENABLE_INPUT_SYSTEM
            if (UnityEngine.InputSystem.Keyboard.current != null)
            {
                if (key == KeyCode.C) return UnityEngine.InputSystem.Keyboard.current.cKey.isPressed;
            }
            return false;
#else
            return Input.GetKey(key);
#endif
        }
    

void EnsureWorldSimulation()
        {
            SimulationHost = WorldSimulationHost.Active;
            if (!SimulationHost)
            {
                var hostGo = new GameObject("GameplayCoreWorldSimulation");
                SimulationHost = hostGo.AddComponent<WorldSimulationHost>();
            }
            Simulation = SimulationHost != null ? SimulationHost.Service : null;
            if (SimulationHost != null && !_simulationSubscribed)
            {
                SimulationHost.EventRaised += OnSimulationEvent;
                _simulationSubscribed = true;
            }
            if (Simulation != null && Player != null && Player.world != WorldId.Hub)
            {
                var geography = SimulationHost.GetComponent<WorldSimulationGeographyAdapter>() ?? SimulationHost.gameObject.AddComponent<WorldSimulationGeographyAdapter>();
                geography.world = Player.world;
                geography.Sync(Simulation);
            }
        }

        void EnsureWorldFabric()
        {
            EnsureWorldFabricCore();
            if (Fabric == null || Player == null) return;
            var places = FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < places.Length; i++)
                BindOneFabricPlace(places[i]);
        }

        void EnsureEconomy()
        {
            if (!WorldHost || WorldHost.Simulation == null) return;
            if (Economy == null || Economy.Host != WorldHost) Economy = new WorldSystemsEconomyService(WorldHost);
            if (!_economyRestored)
            {
                ConcordiaPersistenceService.RestoreEconomy(Economy);
                _economyRestored = true;
                for (var i = 0; i < Economy.State.inventories.Count; i++)
                    if (Economy.State.inventories[i] != null && Economy.State.inventories[i].inventoryId == "player-inventory") { PlayerInventory = Economy.State.inventories[i]; break; }
            }
            if (PlayerInventory == null)
            {
                PlayerInventory = new WorldSystemsInventoryContract { inventoryId = "player-inventory", ownerId = "player", settlementId = Player != null && Player.world == WorldId.Tunya ? GoldenSliceRuntime.SettlementId : "unburned-court", capacity = 999f };
                Economy.RegisterInventory(PlayerInventory);
            }
            if (_economySeeded) return;
            Economy.RegisterMarket(new WorldSystemsMarketContract { storefrontId = "concordia-hub-market", resourceId = "lantern oil", basePrice = 1.5f, targetStock = 8f });
            Economy.RegisterMarket(new WorldSystemsMarketContract { storefrontId = "concordia-hub-market", resourceId = "travel ration", basePrice = 2f, targetStock = 6f });
            Economy.RegisterMarket(new WorldSystemsMarketContract { storefrontId = "concordia-hub-market", resourceId = LoreNpcBinder.SparksResource, basePrice = 1f, targetStock = 80f, minimumPrice = 0.2f, maximumPrice = 20f });
            // Walker starts with a lore-light purse — enough to trade, not a warlord.
            if (PlayerInventory != null)
            {
                var hasSparks = false;
                for (var i = 0; i < PlayerInventory.resources.Count; i++)
                    if (PlayerInventory.resources[i] != null && PlayerInventory.resources[i].resourceId == LoreNpcBinder.SparksResource)
                    { hasSparks = true; break; }
                if (!hasSparks)
                    PlayerInventory.resources.Add(new WorldSystemsResourceStack(LoreNpcBinder.SparksResource, 40f));
            }
            TradeRouteTraffic.ActivateOpeningEconomy(Economy);
            _economySeeded = true;
        }

        void EnsureContainers()
        {
            if (Containers == null) Containers = new CanonicalContainerService();
            if (PlayerInventory != null)
            {
                var id = CanonicalContainerIds.PlayerInventory(PlayerInventory.inventoryId);
                if (!Containers.TryGet(id, out var playerContainer))
                {
                    playerContainer = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.Backpack, displayName = "Player inventory", ownerId = "player", accessRule = ContainerAccessRule.OwnerOnly, capacity = PlayerInventory.capacity, inventoryAuthority = ContainerInventoryAuthority.WorldSystemsInventory, authorityId = PlayerInventory.inventoryId, provenance = new ContainerProvenance { sourceId = PlayerInventory.inventoryId, sourceKind = "WorldSystemsInventoryContract", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "runtime-adapter" } };
                    Containers.Register(playerContainer, new WorldSystemsInventoryContainerAdapter(PlayerInventory));
                }
                else Containers.BindAdapter(id, new WorldSystemsInventoryContainerAdapter(PlayerInventory));
            }
            foreach (var vehicle in VehiclePersistenceService.Vehicles)
            {
                if (!vehicle) continue;
                var id = CanonicalContainerIds.VehicleStorage(vehicle.EntityId);
                if (!Containers.TryGet(id, out var vehicleContainer))
                {
                    vehicleContainer = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.VehicleTrunk, displayName = vehicle.name + " storage", ownerId = vehicle.OwnerId ?? "", accessRule = string.IsNullOrEmpty(vehicle.OwnerId) ? ContainerAccessRule.Public : ContainerAccessRule.OwnerOrAllowed, capacity = vehicle.StorageCapacity, inventoryAuthority = ContainerInventoryAuthority.VehicleStorage, authorityId = vehicle.EntityId + ":storage", provenance = new ContainerProvenance { sourceId = vehicle.EntityId, sourceKind = "VehicleEntity", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "runtime-adapter" } };
                    Containers.Register(vehicleContainer, new VehicleStorageContainerAdapter(vehicle, true));
                }
                else Containers.BindAdapter(id, new VehicleStorageContainerAdapter(vehicle, true));
            }
            var worldContainers = FindObjectsByType<WorldFabricContainer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < worldContainers.Length; i++)
            {
                var worldContainer = worldContainers[i];
                if (!worldContainer || string.IsNullOrEmpty(worldContainer.containerId)) continue;
                var id = CanonicalContainerIds.WorldFabric(worldContainer.containerId);
                if (!Containers.TryGet(id, out var canonical))
                {
                    canonical = new CanonicalContainerRecord { containerId = id, kind = ContainerKind.Chest, displayName = worldContainer.name, ownerId = worldContainer.ownerId ?? "", accessRule = string.IsNullOrEmpty(worldContainer.ownerId) ? ContainerAccessRule.Public : ContainerAccessRule.OwnerOnly, capacity = worldContainer.capacity, inventoryAuthority = ContainerInventoryAuthority.Canonical, authorityId = worldContainer.containerId, provenance = new ContainerProvenance { sourceId = worldContainer.containerId, sourceKind = "WorldFabricContainer", worldId = Player != null ? Player.world.ToString() : WorldId.Hub.ToString(), generationRule = "scene-adapter" } };
                    Containers.Register(canonical, new WorldFabricContainerAdapter(worldContainer));
                }
                else Containers.BindAdapter(id, new WorldFabricContainerAdapter(worldContainer));
            }
            if (!_capabilitiesRestored) Containers.SyncAll();
        }

        void EnsureConKay()
        {
            if (ConKayAdapter == null) ConKayAdapter = new ConKayGameplayCoreAdapter();
            ConKayAdapter.Bind(this);
            var workbench = FindFirstObjectByType<ConKayDiagnosticWorkbench>();
            if (workbench != null) workbench.SetSource(ConKayAdapter.Source);
        }

        void EnsureConcordLink()
        {
            if (ConcordLink == null) ConcordLink = new ConcordLinkRuntime();
            ConcordLink.Bind(this);
        }

        public global::Concordia.WorldField.Sample SampleWorldField(Vector3 position, string domain = "athletics")
        {
            var world = Player != null ? Player.world : WorldId.Hub;
            CurrentWorldField = global::Concordia.WorldField.At(world, position, domain, world);
            return CurrentWorldField;
        }

        public WorldFabricInteractionResolution ResolveInteraction(Vector3 position)
        {
            return WorldFabricInteractionResolver.Resolve(Fabric, position, Player != null ? Player.world : WorldId.Hub,
                "player", PlayerInventory);
        }

        public string TryInteractContainer(Vector3 position)
        {
            if (Containers == null) return null;
            var nearest = FindObjectsByType<WorldFabricContainer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            WorldFabricContainer target = null;
            var best = 2.8f;
            for (var i = 0; i < nearest.Length; i++)
            {
                if (!nearest[i] || string.IsNullOrEmpty(nearest[i].containerId)) continue;
                var distance = Vector3.Distance(position, nearest[i].transform.position);
                if (distance < best) { best = distance; target = nearest[i]; }
            }
            if (!target) return null;
            var id = CanonicalContainerIds.WorldFabric(target.containerId);
            var result = Containers.Open(id, "player");
            if (!result.success) return result.message;

            RecordConsequence("container", "open", target.name, "Canonical container access resolved through the scene adapter.", "player", id, "open");
            Save();
            return result.message;
        }

        public string TryInteractFabric(Vector3 position)
        {
            var resolution = ResolveInteraction(position);
            if (resolution == null || !resolution.found) return null;
            if (!resolution.available) return resolution.why;
            if (FabricRuntime == null || !FabricRuntime.TryInteract(resolution.identity, "player", out var message))
                return resolution.why;
            if (resolution.primaryVerb == WorldFabricInteractionKind.Take && !string.IsNullOrEmpty(resolution.semanticId))
            {
                KitBag.AddLoot(resolution.semanticId, resolution.displayName);
                QuestLog.NoteGather(resolution.semanticId);
            }
            if (resolution.primaryVerb != WorldFabricInteractionKind.Take
                && resolution.primaryVerb != WorldFabricInteractionKind.Consume
                && resolution.primaryVerb != WorldFabricInteractionKind.Break
                && resolution.primaryVerb != WorldFabricInteractionKind.Repair)
                RecordConsequence("fabric", resolution.primaryVerb.ToString().ToLowerInvariant(), resolution.displayName,
                    resolution.why, "player", resolution.targetId, resolution.primaryVerb.ToString(), 1f);
            Save();
            return message;
        }

        public FabricationCompositionResult TryFabricate(FabricationRecipeContract recipe, FabricationCompositionContext context)
        {
            if (context == null) context = new FabricationCompositionContext();
            if (string.IsNullOrEmpty(context.actorId)) context.actorId = "player";
            if (string.IsNullOrEmpty(context.ownerId)) context.ownerId = context.actorId;
            if (string.IsNullOrEmpty(context.sourceLocationId) && Player != null) context.sourceLocationId = Player.world.ToString();
            var result = FabricationComposer.Compose(recipe, context);
            if (!result.success || result.fabricatedObject == null) return result;
            _fabricatedObjects.Add(result.fabricatedObject);
            RecordConsequence("fabrication", "compose", result.fabricatedObject.displayName,
                "Fabrication composed with deterministic material, method, quality, durability, and provenance.",
                context.actorId, result.fabricatedObject.objectId, result.fabricatedObject.recipeId, result.fabricatedObject.quality.score);
            Save();
            return result;
        }

        public WeaponCompositionResult TryGunsmith(WeaponConfigurationDto configuration, WeaponCompositionContext context)
        {
            if (context == null) context = new WeaponCompositionContext();
            if (string.IsNullOrEmpty(context.actorId)) context.actorId = "player";
            if (string.IsNullOrEmpty(context.sourceWorldId) && Player != null) context.sourceWorldId = Player.world.ToString();
            var result = GunsmithingComposer.Compose(configuration, context);
            if (!result.success || result.weapon == null) return result;
            _weapons.Add(result.weapon);
            RecordConsequence("gunsmithing", "compose", result.weapon.configuration.displayName, "Weapon composed with canonical fabrication, field-ready provenance, and explainable stats.", context.actorId, result.weapon.persistentWeaponId, result.weapon.configuration.recipeId, result.weapon.lastResolvedStats.damage);
            Save();
            return result;
        }

        public SpellCompositionResult TrySpellcraft(SpellConfigurationDto configuration, SpellCompositionContext context)
        {
            if (context == null) context = new SpellCompositionContext();
            if (string.IsNullOrEmpty(context.actorId)) context.actorId = "player";
            if (string.IsNullOrEmpty(context.sourceWorldId) && Player != null) context.sourceWorldId = Player.world.ToString();
            var result = SpellcraftingComposer.Compose(configuration, context);
            if (!result.success || result.spell == null) return result;
            _spells.Add(result.spell);
            RecordConsequence("spellcrafting", "compose", result.spell.configuration.displayName, "Spell composed with canonical fabrication, field resolution, and explainable provenance.", context.actorId, result.spell.persistentSpellId, result.spell.configuration.recipeId, result.spell.lastResolvedEffect.potency);
            Save();
            return result;
        }

        public WeaponFireEligibilityDto EvaluateWeaponFire(string persistentWeaponId, WeaponFireRequest request)
        {
            if (request == null) request = new WeaponFireRequest();
            for (var i = 0; i < _weapons.Count; i++) if (_weapons[i] != null && string.Equals(_weapons[i].persistentWeaponId, persistentWeaponId, StringComparison.OrdinalIgnoreCase))
            {
                PrepareWeaponRequest(_weapons[i], request);
                return GunsmithingComposer.EvaluateFireEligibility(_weapons[i], request, FieldAuthority);
            }
            return GunsmithingComposer.EvaluateFireEligibility(null, request, FieldAuthority);
        }

        public SpellCastEligibilityDto EvaluateSpellCast(string persistentSpellId, SpellCastRequest request)
        {
            if (request == null) request = new SpellCastRequest();
            for (var i = 0; i < _spells.Count; i++) if (_spells[i] != null && string.Equals(_spells[i].persistentSpellId, persistentSpellId, StringComparison.OrdinalIgnoreCase))
            {
                PrepareSpellRequest(_spells[i], request);
                return SpellcraftingComposer.EvaluateCastEligibility(_spells[i], request, FieldAuthority);
            }
            return SpellcraftingComposer.EvaluateCastEligibility(null, request, FieldAuthority);
        }

        public bool TryFireWeapon(string persistentWeaponId, string targetId, WeaponFireRequest request, out WeaponFireEligibilityDto eligibility, out string error)
        {
            error = null;
            eligibility = EvaluateWeaponFire(persistentWeaponId, request);
            if (eligibility == null || !eligibility.canFire) { error = eligibility == null ? "Weapon eligibility was not resolved." : eligibility.reasonCode; return false; }
            ComposedWeaponRecord weapon = null;
            for (var i = 0; i < _weapons.Count; i++) if (_weapons[i] != null && _weapons[i].persistentWeaponId == persistentWeaponId) { weapon = _weapons[i]; break; }
            if (weapon == null) { error = "Weapon was not found."; return false; }
            var packet = new CombatDamagePacket { SourceId = request == null ? "player" : request.actorId, TargetId = targetId, Amount = eligibility.resolvedStats.damage, PoiseDamage = eligibility.resolvedStats.damage * 0.25f, Impulse = eligibility.resolvedStats.recoil, Direction = Player ? Player.transform.forward : Vector3.forward, DamageType = "physical", Kind = CombatActionKind.Ranged };
            if (!TryApplyCombatPacket(packet, out error)) return false;
            if (!GunsmithingComposer.TryApplyWear(weapon, 0.5f, 0.01f, "firing", packet.SourceId, DateTime.UtcNow.ToString("o"), out error)) return false;
            RecordConsequence("combat", "weapon-fire", "Weapon fired", eligibility.environment.foreignWorld ? "Foreign-world weapon retained; local WorldField modifiers resolved the shot." : "Weapon resolved through gunsmithing and the canonical combat registry.", packet.SourceId, targetId, persistentWeaponId, packet.Amount);
            Save();
            return true;
        }

        public bool TryCastSpell(string persistentSpellId, string targetId, SpellCastRequest request, out SpellCastEligibilityDto eligibility, out string error)
        {
            error = null;
            eligibility = EvaluateSpellCast(persistentSpellId, request);
            if (eligibility == null || !eligibility.canCast) { error = eligibility == null ? "Spell eligibility was not resolved." : eligibility.reasonCode; return false; }
            ComposedSpellRecord spell = null;
            for (var i = 0; i < _spells.Count; i++) if (_spells[i] != null && _spells[i].persistentSpellId == persistentSpellId) { spell = _spells[i]; break; }
            if (spell == null) { error = "Spell was not found."; return false; }
            var packet = new CombatDamagePacket { SourceId = request == null ? "player" : request.actorId, TargetId = targetId, Amount = eligibility.resolvedEffect.potency, PoiseDamage = eligibility.resolvedEffect.control * 10f, Impulse = eligibility.resolvedEffect.control, Direction = Player ? Player.transform.forward : Vector3.forward, DamageType = eligibility.resolvedEffect.damageType, Kind = CombatActionKind.Magic };
            if (!TryApplyCombatPacket(packet, out error)) return false;
            if (spell.configuration.stability != null) { spell.configuration.stability.currentFatigue += eligibility.resolvedEffect.recovery; spell.configuration.stability.casts++; }
            RecordConsequence("combat", "spell-cast", "Spell cast", eligibility.environment.foreignWorld ? "Foreign-world spell retained; local WorldField modifiers resolved the cast." : "Spell resolved through spellcrafting and the canonical combat registry.", packet.SourceId, targetId, persistentSpellId, packet.Amount);
            Save();
            return true;
        }

        public bool TryApplyCombatPacket(CombatDamagePacket packet, out string error)
        {
            error = null;
            if (CombatRegistry == null || string.IsNullOrEmpty(packet.TargetId)) { error = "Combat target registry is unavailable."; return false; }
            if (!CombatRegistry.TryGet(packet.TargetId, out var target) || target == null) { error = "Combat target was not found."; return false; }
            if (!target.IsAlive) { error = "Combat target is not alive."; return false; }
            target.ApplyDamage(packet);
            target.ApplyImpulse(packet.Direction.normalized * packet.Impulse);
            target.React(packet);
            if (CombatEvents != null) CombatEvents.Record(new CombatEvent(CombatEventType.Hit, CombatPhase.Collision, Time.time, packet.SourceId, packet.TargetId, packet.DamageType, "canonical combat packet", packet.Amount));
            return true;
        }

        public void RebindEconomyInventory()
        {
            if (Economy == null || Economy.State == null) return;
            for (var i = 0; i < Economy.State.inventories.Count; i++)
                if (Economy.State.inventories[i] != null && Economy.State.inventories[i].inventoryId == "player-inventory") { PlayerInventory = Economy.State.inventories[i]; return; }
        }

        public void RestoreGunsmithing(GunsmithingPersistenceEnvelopeDto envelope)
        {
            _weapons.Clear();
            if (envelope == null || envelope.weapons == null) return;
            for (var i = 0; i < envelope.weapons.Count; i++) { var item = GunsmithingPersistence.FromDto(envelope.weapons[i]); if (item != null) _weapons.Add(item); }
            GoldenSlice?.Configure();
        }

        public void RestoreSpellcrafting(SpellcraftingPersistenceEnvelopeDto envelope)
        {
            _spells.Clear();
            if (envelope == null || envelope.spells == null) return;
            for (var i = 0; i < envelope.spells.Count; i++) { var item = SpellcraftingPersistence.FromDto(envelope.spells[i]); if (item != null) _spells.Add(item); }
        }

        public void RestoreContainers(CanonicalContainerPersistenceEnvelopeDto envelope)
        {
            Containers = Containers ?? new CanonicalContainerService();
            Containers.Restore(envelope);
            _capabilitiesRestored = true;
        }

        void PrepareWeaponRequest(ComposedWeaponRecord weapon, WeaponFireRequest request)
        {
            if (request == null) return;
            request.actorId = string.IsNullOrEmpty(request.actorId) ? "player" : request.actorId;
            request.world = request.world ?? new WeaponWorldContext();
            request.world.query = request.world.query ?? WorldFieldQuery.At(Player ? Player.world : WorldId.Hub, Player ? Player.transform.position : Vector3.zero);
        }
        void PrepareSpellRequest(ComposedSpellRecord spell, SpellCastRequest request)
        {
            if (request == null) return;
            request.actorId = string.IsNullOrEmpty(request.actorId) ? "player" : request.actorId;
            request.world = request.world ?? new SpellWorldContext();
            request.world.query = request.world.query ?? WorldFieldQuery.At(Player ? Player.world : WorldId.Hub, Player ? Player.transform.position : Vector3.zero);
        }

        public void RestoreFabrication(FabricationPersistenceEnvelopeDto envelope)
        {
            _fabricatedObjects.Clear();
            if (envelope == null || envelope.objects == null) return;
            for (var i = 0; i < envelope.objects.Count; i++)
            {
                var item = FabricationPersistence.FromDto(envelope.objects[i]);
                if (item != null) _fabricatedObjects.Add(item);
            }
        }

        void BindFabricIdentity(BuildingPlace place, string buildingId)
        {
            if (!place || Fabric == null) return;
            var building = Fabric.TryGetBuilding(buildingId);
            if (building == null) return;
            var identity = place.GetComponent<WorldFabricIdentity>() ?? place.gameObject.AddComponent<WorldFabricIdentity>();
            WorldFabricObjectRecord target = null;
            for (var i = 0; i < building.objects.Count; i++)
                if (building.objects[i] != null && building.objects[i].interactive) { target = building.objects[i]; break; }
            if (target != null) identity.Bind(target);
            identity.buildingId = buildingId;
        }

        void OnFabricConsequence(WorldFabricConsequenceRecord record)
        {
            if (record == null) return;
            RecordConsequence("fabric", record.kind, record.kind, record.detail, record.actorId, record.objectId, record.eventId, record.value);
        }

        static int StableSeed(string value)
        {
            unchecked
            {
                var hash = 23;
                if (!string.IsNullOrEmpty(value)) for (var i = 0; i < value.Length; i++) hash = hash * 31 + value[i];
                return hash & 0x7fffffff;
            }
        }

        void EnsurePresentationAdapters()
        {
            if (!Player) return;
            if (!Player.GetComponent<PresentationAnimationBridge>()) Player.gameObject.AddComponent<PresentationAnimationBridge>();
            if (!Player.GetComponent<PresentationReactionReceiver>()) Player.gameObject.AddComponent<PresentationReactionReceiver>();
            if (!Player.GetComponent<PresentationHumanActivityEvidence>())
            {
                var evidence = Player.gameObject.AddComponent<PresentationHumanActivityEvidence>();
                evidence.Bind("player");
            }
        }

        System.Collections.IEnumerator BindWorldSimulationActorsStaged()
        {
            EnsureWorldSimulation();
            if (Simulation == null) yield break;

            // This scan happens once, after Hub staging. The binding itself is deliberately
            // one existing actor per frame so adapter work cannot recreate the old bind storm.
            var guests = FindObjectsByType<GuestNpc>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            var boundGuests = 0;
            for (var i = 0; i < guests.Length; i++)
            {
                var guest = guests[i];
                if (guest)
                {
                    try
                    {
                        var adapter = guest.GetComponent<WorldSimulationNpcAdapter>() ?? guest.gameObject.AddComponent<WorldSimulationNpcAdapter>();
                        if (adapter.BindExistingGuest(Simulation, guest))
                        {
                            var life = guest.GetComponent<NpcLife>();
                            adapter.SetActivity(life != null ? life.act : "idle");
                            boundGuests++;
                        }
                    }
                    catch (System.Exception ex)
                    {
                        UnityEngine.Debug.LogWarning("[Concordia] staged guest bind: " + ex.Message);
                    }
                }
                yield return null;
            }

            // Preserve the existing creature adapter path without making it part of NPC
            // construction or a second simulation authority.
            var genomes = FindObjectsByType<CreatureGenome>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            var boundCreatures = 0;
            for (var i = 0; i < genomes.Length; i++)
            {
                var genome = genomes[i];
                if (genome && !string.IsNullOrEmpty(genome.id))
                {
                    try
                    {
                        var adapter = genome.GetComponent<WorldSimulationCreatureAdapter>() ?? genome.gameObject.AddComponent<WorldSimulationCreatureAdapter>();
                        adapter.speciesId = genome.speciesId;
                        if (adapter.BindExistingGenome(Simulation, genome)) boundCreatures++;
                    }
                    catch (System.Exception ex)
                    {
                        UnityEngine.Debug.LogWarning("[Concordia] staged creature bind: " + ex.Message);
                    }
                }
                yield return null;
            }

            UnityEngine.Debug.Log("[Concordia] staged WorldSimulation actors bound guests=" + boundGuests + " creatures=" + boundCreatures);
        }

        bool TryToggleVehicle(Vector3 position)
        {
            ActiveVehicle = null;
            var vehicles = FindObjectsByType<VehicleVerticalSlice>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            var best = 3.5f;
            for (var i = 0; i < vehicles.Length; i++)
            {
                var vehicle = vehicles[i];
                if (!vehicle) continue;
                var distance = Vector3.Distance(position, vehicle.transform.position);
                if (distance < best) { best = distance; ActiveVehicle = vehicle; }
            }
            if (!ActiveVehicle || !Player) return false;
            if (ActiveVehicle.IsPossessed)
            {
                if (!ActiveVehicle.TryExit(Player.gameObject)) return false;
                RecordConsequence("vehicle", "exit", "Player exited vehicle.", "vehicle exit", "player");
                return true;
            }
            if (!ActiveVehicle.TryEnterDriver(Player.gameObject, "player")) return false;
            RecordConsequence("vehicle", "enter", "Player entered vehicle.", "vehicle enter", "player", ActiveVehicle.Entity != null ? ActiveVehicle.Entity.EntityId : null);
            return true;
        }

        public string TryInteractVehicle(Vector3 position)
        {
            var wasPossessed = ActiveVehicle != null && ActiveVehicle.IsPossessed;
            if (!TryToggleVehicle(position)) return null;
            return wasPossessed ? "You leave the vehicle." : "You take the driver seat.";
        }

        public void NotifyLocomotionInput(LocomotionInput input)
        {
            LastInput = input;
            PresentationHumanActivityEvidence.Publish(input.HasMove ? "player moved" : "player idle", Player ? Player.transform.position : Vector3.zero, input.HasMove ? 0.35f : 0.05f, Player ? Player.gameObject : null, "player");
        }

        public void HandleWorldChanged(WorldId from, WorldId to)
        {
            if (from == to) return;
            EnsureWorldSimulation();
            if (Simulation != null) Simulation.SetReputation("player", "world", to.ToString(), 0f);
            WorldClock.PushFeed("travel", "Entered " + Canon.Get(to).title + ".");
            PresentationEventBus.Publish(PresentationEvent.Make(PresentationEventType.Weather, "world:" + to, Player ? Player.transform.position : Vector3.zero, Vector3.up, 1f, 0.2f, Player ? Player.gameObject : null));
            RecordConsequence("travel", "world-change", "Entered " + Canon.Get(to).title + ".", "world transition", "player", to.ToString(), "travel");
            Save();
        }

        public void RecordConsequence(string channel, string kind, string title, string detail, string sourceId = null, string targetId = null, string actionId = null, float value = 0f)
        {
            ConcordiaPersistenceService.RecordConsequence(channel, kind, title, detail, sourceId, targetId, actionId, value, Player != null ? (WorldId?)Player.world : null);
            if (Simulation != null)
                Simulation.AddConsequence(new ConsequenceRecord { kind = ConsequenceKind.Social, sourceId = sourceId, subjectId = targetId, description = detail, magnitude = value });
            ConcordLink?.Emit(channel, kind, title, detail, sourceId, targetId, actionId, value);
        }

                void ApplyFactionCrimeIntegration(WorldSimulationEvent record)
        {
            if (Simulation == null || Player == null || record == null || Simulation.State == null) return;
            if (record.type != "crime.recorded" && record.type != "crime.witnessed") return;
            CrimeRecord crime = null;
            for (var i = 0; i < Simulation.State.crimes.Count; i++)
            {
                var candidate = Simulation.State.crimes[i];
                if (candidate != null && string.Equals(candidate.crimeId, record.relatedId, System.StringComparison.OrdinalIgnoreCase)) { crime = candidate; break; }
            }
            if (crime == null || !string.Equals(crime.perpetratorId, "player", System.StringComparison.OrdinalIgnoreCase)) return;
            var factionId = FactionStandingIntegration.StableFactionId(crime.factionId);
            if (string.IsNullOrEmpty(factionId)) return;
            if (record.type == "crime.recorded")
            {
                FactionStandingBook.Adjust(Player.world, factionId, -Mathf.Clamp01(crime.severity) * 0.15f, false, "crime-recorded");
                WorldEventLog.Record("crime-standing", factionId + " standing changed after " + crime.kind, "player", factionId);
                return;
            }
            WitnessRecord witness = null;
            for (var i = Simulation.State.witnesses.Count - 1; i >= 0; i--)
            {
                var candidate = Simulation.State.witnesses[i];
                if (candidate != null && string.Equals(candidate.crimeId, crime.crimeId, System.StringComparison.OrdinalIgnoreCase)
                    && string.Equals(candidate.observerNpcId, record.subjectId, System.StringComparison.OrdinalIgnoreCase)) { witness = candidate; break; }
            }
            if (witness == null) return;
            var heat = FactionStandingIntegration.WitnessHeatFor(witness.confidence, witness.reliability);
            FactionStandingBook.AddWitnessHeat(Player.world, factionId, heat * 0.25f, "crime-witnessed");
            var reaction = FactionStandingIntegration.EvaluateGuardReaction(Player.world, factionId, crime.severity, witness.confidence == WitnessConfidence.Confirmed);
            FactionStandingIntegration.RecordDecision("guard-reaction", factionId + " guard response: " + reaction.reason + " suspicion=" + reaction.suspicion.ToString("0.00"), factionId);
            if (witness.reported && reaction.investigate)
                Simulation.OpenInvestigation(new InvestigationCase { subjectId = crime.perpetratorId, investigatorId = factionId + ":guard", crimeId = crime.crimeId, locationId = crime.locationId, certainty = reaction.suspicion });
        }

void OnSimulationEvent(WorldSimulationEvent record)
        {
            if (record == null) return;
            ApplyFactionCrimeIntegration(record);
            // Was LeanPlay no-op; ring-capped RecordConsequence is enough — run on Full.
            WorldClock.PushFeed("simulation", record.message);
            PresentationHumanActivityEvidence.Publish(record.message, Player ? Player.transform.position : Vector3.zero, Mathf.Clamp01(Mathf.Abs(record.magnitude)), Player ? Player.gameObject : null, "simulation");
            RecordConsequence("simulation", record.type, record.message, record.message, record.subjectId, record.relatedId, record.eventId, record.magnitude);
        }

        float _diagAt;
        void UpdateDiagnostics()
        {
            if (Time.unscaledTime < _diagAt) return;
            _diagAt = Time.unscaledTime + 2f;
            RuntimeDiagnostics = "bridge=" + (Player ? "live" : "missing")
                + " world=" + (Player ? Player.world.ToString() : "none")
                + " sim=" + (Simulation != null ? "live" : "missing")
                + " fabric=" + (Fabric != null ? "live" : "missing")
                + " economy=" + (Economy != null ? "live" : "missing")
                + " vehicles=" + VehiclePersistenceService.Vehicles.Count
                + " save=" + (LastSaveSucceeded ? "ok" : "pending");
        }


string TryInteractConstruction(Vector3 position)
        {
            if (Economy == null || PlayerInventory == null) return null;
            var places = FindObjectsByType<BuildingPlace>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            BuildingPlace forge = null;
            var best = 3.6f;
            for (var i = 0; i < places.Length; i++)
            {
                var place = places[i];
                if (!place || !string.Equals(place.plan, "forge", StringComparison.OrdinalIgnoreCase)) continue;
                var distance = Vector3.Distance(position, place.door);
                if (distance < best) { best = distance; forge = place; }
            }
            if (!forge) return null;
            var forgeKey = string.IsNullOrEmpty(forge.name) ? "forge" : forge.name;
            var projectId = "construction:" + forgeKey;
            var buildingId = "building:" + forgeKey;
            var project = Economy.State.construction.Find(x => x != null && x.projectId == projectId);
            if (project == null)
            {
                project = new WorldSystemsConstructionContract
                {
                    projectId = projectId,
                    buildingId = buildingId,
                    settlementId = "unburned-court",
                    ownerId = "player",
                    factionId = "concordant-watch",
                    kind = BuildingKind.Workshop,
                    plan = forge.plan,
                    requiredWork = 1f
                };
                Economy.RegisterConstruction(project);
            }
            if (project.status == ConstructionStatus.Complete) return null;
            if (!project.materialsConsumed && !Economy.BeginConstruction("player", projectId, PlayerInventory.inventoryId))
                return "The forge needs a workable site before construction can begin.";
            var advanced = Economy.AdvanceConstruction("player", projectId, 1f);
            if (!advanced.success) return advanced.message;
            RecordConsequence("economy", "construction", advanced.message, "forge construction", "player", buildingId, projectId, advanced.quantity);
            Save();
            return advanced.message;
        }
}

    public sealed class GameplayCombatRegistry : ICombatantRegistry
    {
        readonly Dictionary<string, ICombatant> _items = new Dictionary<string, ICombatant>(StringComparer.OrdinalIgnoreCase);
        public IEnumerable<ICombatant> All => _items.Values;
        public void Clear() => _items.Clear();
        public void Register(ICombatant combatant) { if (combatant != null && !string.IsNullOrEmpty(combatant.CombatId)) _items[combatant.CombatId] = combatant; }
        public bool TryGet(string combatId, out ICombatant combatant) => _items.TryGetValue(combatId ?? string.Empty, out combatant);
    }

    sealed class PlayerCombatant : ICombatant
    {
        readonly ConcordiaPlayer _player;
        public PlayerCombatant(ConcordiaPlayer player) { _player = player; }
        public string CombatId => "player";
        public bool IsAlive => _player && _player.hp > 0f;
        public Vector3 Position => _player ? _player.transform.position : Vector3.zero;
        public Vector3 Forward => _player ? _player.transform.forward : Vector3.forward;
        public float Vitality => _player ? _player.hp : 0f;
        public float Poise => _player ? _player.poise : 0f;
        public float MaxPoise => 12f;
        public CombatDefenseState Defense => GameplayCoreBridge.Live != null ? GameplayCoreBridge.Live.GetDefense() : default(CombatDefenseState);
        public void ApplyDamage(CombatDamagePacket packet) { if (_player) _player.TakeHit(packet.Amount, packet.SourceId, packet.Impulse); }
        public void ApplyPoiseDamage(float amount, string sourceId) { if (_player) _player.poise = Mathf.Max(0f, _player.poise - amount); }
        public void ApplyImpulse(Vector3 impulse) { _player?.ApplyCombatImpulse(impulse); }
        public void React(CombatDamagePacket packet) { _player?.ReactCombat(packet); }
        public void Stagger(float duration, string sourceId)
        {
            if (!_player) return;
            _player.Notice("Staggered.");
            _player.ReactCombat(new CombatDamagePacket
            {
                SourceId = sourceId,
                TargetId = CombatId,
                Amount = 0f,
                PoiseDamage = 7f,
                Impulse = 2f
            });
        }
        public void EnqueueCounter(CombatIntent intent) { _player?.QueueCounter(intent.ActionId); }
    }

    sealed class DummyCombatant : ICombatant
    {
        readonly TrainingDummy _dummy;
        readonly WorldId _world;
        public DummyCombatant(TrainingDummy dummy, WorldId world) { _dummy = dummy; _world = world; }
        public string CombatId => _dummy ? _dummy.KernelId : string.Empty;
        public bool IsAlive => _dummy && _dummy.hp > 0f;
        public Vector3 Position => _dummy ? _dummy.transform.position : Vector3.zero;
        public Vector3 Forward => _dummy ? _dummy.transform.forward : Vector3.forward;
        public float Vitality => _dummy ? _dummy.hp : 0f;
        public float Poise => _dummy ? Mathf.Min(_dummy.hp, 12f) : 0f;
        public float MaxPoise => 12f;
        public CombatDefenseState Defense => default(CombatDefenseState);
        public void ApplyDamage(CombatDamagePacket packet) { if (_dummy) _dummy.Hit(packet.Amount, _world); }
        public void ApplyPoiseDamage(float amount, string sourceId) { }
        public void ApplyImpulse(Vector3 impulse) { if (_dummy) _dummy.transform.position += impulse * 0.05f; }
        public void React(CombatDamagePacket packet) { }
        public void Stagger(float duration, string sourceId) { _dummy?.GetComponentInChildren<ModularPerson>()?.Stagger(); }
        public void EnqueueCounter(CombatIntent intent) { }
    }

    public static class GameplayCoreBridgeExtensions
    {
        public static CombatDefenseState GetDefense(this GameplayCoreBridge bridge)
        {
            return bridge == null ? default(CombatDefenseState) : bridge.DefenseState;
        }
    }
}
