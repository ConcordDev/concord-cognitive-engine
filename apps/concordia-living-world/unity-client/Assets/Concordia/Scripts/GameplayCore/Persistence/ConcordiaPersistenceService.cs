using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;
using Concordia.GameplayCore.Combat;
using Concordia.GameplayCore.Containers;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.Gunsmithing;
using Concordia.GameplayCore.Spellcrafting;
using Concordia.GameplayCore.WorldFabric;
using Concordia.Vehicles;
using Concordia.WorldSimulation;
using Concordia.WorldSystems;

namespace Concordia.GameplayCore.Persistence
{
    /// <summary>
    /// Unified, additive persistence boundary for the Concordia runtime.
    /// It owns one versioned JSON file and converts canonical runtime objects to
    /// stable DTOs; it does not create or replace WorldSystemsHost.
    /// </summary>
    public static class ConcordiaPersistenceService
    {
        public const int CurrentSchemaVersion = 1;
        public const int CurrentWorldSimulationSchemaVersion = 1;
        public const string SaveFileName = "concordia-unified-v1.json";
        public const string LegacyWorldMemoryFileName = "concordia-living-v1.json";
        public static string SavePath => Path.Combine(Application.persistentDataPath, SaveFileName);
        public static string LegacyWorldMemoryPath => Path.Combine(Application.persistentDataPath, LegacyWorldMemoryFileName);

        static readonly List<ConsequenceEventRecord> RecordedConsequences = new List<ConsequenceEventRecord>();
        static PersistenceEnvelope LastLoadedEnvelope;
        static int LastSuccessfulSaveFrame = -1;
        static int WorldMemoryRevision;
        static int LastSavedWorldMemoryRevision = -1;

        public static IReadOnlyList<ConsequenceEventRecord> RecordedEvents => RecordedConsequences;

        public static void NotifyWorldMemoryChanged()
        {
            WorldMemoryRevision++;
        }

        public static bool TryImportLegacyWorldMemory(string json, out string error)
        {
            return WorldMemory.TryImportLegacy(json, out error);
        }

        public static bool TryImportLegacyWorldMemoryFromDisk(out string error)
        {
            error = null;
            try
            {
                if (!File.Exists(LegacyWorldMemoryPath)) return false;
                return TryImportLegacyWorldMemory(File.ReadAllText(LegacyWorldMemoryPath), out error);
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
        }

        static bool HasCanonicalWorldMemory(WorldPersistenceRecord record)
        {
            if (record == null) return false;
            return (record.slices != null && record.slices.Count > 0)
                || (record.eventLog != null && record.eventLog.Count > 0)
                || (record.factionStandings != null && record.factionStandings.Count > 0)
                || !string.IsNullOrEmpty(record.plotsCsv)
                || !string.IsNullOrEmpty(record.travelersCsv)
                || !string.IsNullOrEmpty(record.crossCsv)
                || !string.IsNullOrEmpty(record.caravansCsv)
                || !string.IsNullOrEmpty(record.tariffsCsv)
                || !string.IsNullOrEmpty(record.borderCrossingsCsv);
        }

        public static PersistenceEnvelope Capture()
        {
            var envelope = new PersistenceEnvelope
            {
                schemaVersion = CurrentSchemaVersion,
                saveId = Guid.NewGuid().ToString("N"),
                savedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                payload = new PersistencePayload()
            };

            CapturePlayer(envelope.payload);
            CaptureNpcState(envelope.payload);
            CaptureWorldState(envelope.payload);
            CaptureVehicleState(envelope.payload);
            CaptureWorldSystems(envelope.payload);
            CaptureWorldSimulation(envelope.payload);
            CaptureEconomy(envelope.payload);
            CaptureWorldFabric(envelope.payload);
            CaptureFabrication(envelope.payload);
            CaptureGunsmithing(envelope.payload);
            CaptureSpellcrafting(envelope.payload);
            CaptureContainers(envelope.payload);
            CaptureQuestState(envelope.payload);
            CaptureSkillState(envelope.payload);
            CapturePlotState(envelope.payload);
            CaptureConsequences(envelope.payload);
            return envelope;
        }

        public static bool Save()
        {
            string error;
            return TrySave(out error);
        }

        public static bool TrySave(out string error)
        {
            error = null;
            if (LastSuccessfulSaveFrame == Time.frameCount
                && LastSavedWorldMemoryRevision == WorldMemoryRevision) return true;
            try
            {
                Directory.CreateDirectory(Application.persistentDataPath);
                var json = JsonUtility.ToJson(Capture(), true);
                File.WriteAllText(SavePath, json);
                LastSuccessfulSaveFrame = Time.frameCount;
                LastSavedWorldMemoryRevision = WorldMemoryRevision;
                return true;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                Debug.LogWarning("Concordia unified save failed: " + exception.Message);
                return false;
            }
        }

        public static PersistenceEnvelope Load()
        {
            PersistenceEnvelope envelope;
            string error;
            return TryLoad(out envelope, out error) ? envelope : null;
        }

        public static bool TryLoad(out PersistenceEnvelope envelope, out string error)
        {
            envelope = null;
            error = null;
            try
            {
                if (!File.Exists(SavePath)) return false;
                envelope = JsonUtility.FromJson<PersistenceEnvelope>(File.ReadAllText(SavePath));
                if (envelope == null || envelope.schemaVersion <= 0 || envelope.schemaVersion > CurrentSchemaVersion)
                {
                    error = "Unsupported or missing persistence schema.";
                    envelope = null;
                    return false;
                }
                Normalize(envelope);
                LastLoadedEnvelope = envelope;
                if (HasCanonicalWorldMemory(envelope.payload.world))
                    WorldMemory.ApplyPersistence(envelope.payload.world);
                return true;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                Debug.LogWarning("Concordia unified load failed: " + exception.Message);
                return false;
            }
        }

        /// <summary>
        /// Restores all state that has a live canonical runtime target. Call this
        /// after the scene has presented its player, NPCs and vehicles. If the
        /// WorldSystemsHost is installed later, call RestoreWorldSystems again.
        /// </summary>
        public static void Restore(PersistenceEnvelope envelope)
        {
            if (envelope == null || envelope.payload == null) return;
            Normalize(envelope);
            LastLoadedEnvelope = envelope;
            RestoreWorldState(envelope.payload.world);
            RestorePlayer(envelope.payload.player);
            RestoreQuestState(envelope.payload.quests);
            RestoreSkillState(envelope.payload.skills);
            RestoreNpcState(envelope.payload.npcs);
            RestoreWorldSystems(WorldSystemsHost.Active, envelope.payload.worldSystems);
            RestoreWorldSimulation(WorldSimulationHost.Active, envelope.payload.worldSimulation);
            RestoreEconomy(GameplayCoreBridge.Live == null ? null : GameplayCoreBridge.Live.Economy, envelope.payload.economy);
            RestoreWorldFabric(WorldFabricRuntime.Active, envelope.payload.worldFabric);
            RestoreFabrication(envelope.payload.fabrication);
            RestoreGunsmithing(envelope.payload.gunsmithing);
            RestoreSpellcrafting(envelope.payload.spellcrafting);
            RestoreContainers(envelope.payload.containers);
            RestoreVehicleState(envelope.payload.vehicles);
            RestoreConsequences(envelope.payload);
        }

        public static bool LoadAndRestore()
        {
            var envelope = Load();
            if (envelope == null) return false;
            Restore(envelope);
            return true;
        }

        /// <summary>Applies the loaded world-system DTO to the existing host only.</summary>
        public static bool RestoreWorldSystems()
        {
            if (LastLoadedEnvelope == null || LastLoadedEnvelope.payload == null) return false;
            return RestoreWorldSystems(WorldSystemsHost.Active, LastLoadedEnvelope.payload.worldSystems);
        }

        /// <summary>Integration hook for a host that is created after persistence restore.</summary>
        public static bool RestoreWorldSystems(WorldSystemsHost host)
        {
            if (LastLoadedEnvelope == null || LastLoadedEnvelope.payload == null) return false;
            return RestoreWorldSystems(host, LastLoadedEnvelope.payload.worldSystems);
        }

        /// <summary>Applies the loaded simulation section to the existing host only.</summary>
        public static bool RestoreWorldSimulation()
        {
            return RestoreWorldSimulation(WorldSimulationHost.Active);
        }

        /// <summary>Integration hook for a simulation host created after load.</summary>
        public static bool RestoreWorldSimulation(WorldSimulationHost host)
        {
            if (LastLoadedEnvelope == null || LastLoadedEnvelope.payload == null) return false;
            return RestoreWorldSimulation(host, LastLoadedEnvelope.payload.worldSimulation);
        }

        /// <summary>
        /// Restores a versioned simulation DTO without coupling tests or migration
        /// callers to a scene host. The target service remains the runtime owner.
        /// </summary>
        public static bool RestoreWorldSimulation(WorldSimulationService service, WorldSimulationPersistenceRecord record)
        {
            if (service == null || record == null || record.state == null
                || record.schemaVersion <= 0 || record.schemaVersion > CurrentWorldSimulationSchemaVersion
                || record.state.schemaVersion <= 0 || record.state.schemaVersion > CurrentWorldSimulationSchemaVersion)
                return false;
            service.LoadJson(JsonUtility.ToJson(record.state));
            return service.State != null && service.State.schemaVersion <= CurrentWorldSimulationSchemaVersion;
        }

        static bool RestoreWorldSimulation(WorldSimulationHost host, WorldSimulationPersistenceRecord record)
        {
            return host != null && RestoreWorldSimulation(host.Service, record);
        }

        /// <summary>
        /// Explicitly imports the legacy raw WorldSimulationState JSON. This does
        /// not write the legacy file; the next unified save owns migration output.
        /// </summary>
        public static bool TryImportLegacyWorldSimulation(string json, WorldSimulationService service, out string error)
        {
            error = null;
            if (service == null || string.IsNullOrEmpty(json))
            {
                error = "Legacy world simulation data is empty.";
                return false;
            }
            try
            {
                var state = JsonUtility.FromJson<WorldSimulationState>(json);
                if (state == null || state.schemaVersion <= 0 || state.schemaVersion > CurrentWorldSimulationSchemaVersion)
                {
                    error = "Unsupported legacy world simulation schema.";
                    return false;
                }
                service.LoadJson(json);
                return service.State != null;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
        }

        public static bool TryRestoreWorldSimulation(WorldSimulationHost host, string legacyPath, out bool importedLegacy, out string error)
        {
            importedLegacy = false;
            error = null;
            if (host == null || host.Service == null)
            {
                error = "World simulation host is not initialized.";
                return false;
            }

            if (File.Exists(SavePath))
            {
                PersistenceEnvelope envelope;
                if (!TryLoad(out envelope, out error)) return false;
                var record = envelope != null && envelope.payload != null ? envelope.payload.worldSimulation : null;
                if (record != null && record.schemaVersion > 0)
                    return RestoreWorldSimulation(host, record);
            }

            if (string.IsNullOrEmpty(legacyPath) || !File.Exists(legacyPath)) return false;
            try
            {
                if (!TryImportLegacyWorldSimulation(File.ReadAllText(legacyPath), host.Service, out error)) return false;
                importedLegacy = true;
                return true;
            }
            catch (Exception exception)
            {
                error = exception.Message;
                return false;
            }
        }

        public static bool RestoreEconomy(WorldSystemsEconomyService economy)
        {
            if (LastLoadedEnvelope == null || LastLoadedEnvelope.payload == null) return false;
            return RestoreEconomy(economy, LastLoadedEnvelope.payload.economy);
        }

        public static bool RestoreEconomy(WorldSystemsEconomyService economy, WorldSystemsEconomyPersistenceRecord record)
        {
            if (economy == null || record == null) return false;
            economy.State.simulationTime = record.simulationTime;
            economy.State.inventories.Clear();
            economy.State.gatheringSources.Clear();
            economy.State.recipes.Clear();
            economy.State.consequences.Clear();
            if (record.inventories != null) foreach (var saved in record.inventories)
            {
                if (saved == null) continue;
                var item = new WorldSystemsInventoryContract { inventoryId = saved.inventoryId, ownerId = saved.ownerId, settlementId = saved.settlementId, capacity = saved.capacity };
                if (saved.resources != null) foreach (var resource in saved.resources) if (resource != null) item.resources.Add(new WorldSystemsResourceStack(resource.resourceId, resource.quantity));
                economy.State.inventories.Add(item);
            }
            if (record.gatheringSources != null) foreach (var saved in record.gatheringSources)
            {
                if (saved == null) continue;
                BuildingKind kind;
                if (!Enum.TryParse(saved.requiredBuildingKind, true, out kind)) kind = BuildingKind.Workplace;
                economy.State.gatheringSources.Add(new WorldSystemsGatheringSourceContract { sourceId = saved.sourceId, settlementId = saved.settlementId, resourceId = saved.resourceId, yieldPerAction = saved.yieldPerAction, available = saved.available, maximumAvailable = saved.maximumAvailable, respawnSeconds = saved.respawnSeconds, respawnAt = saved.respawnAt, requiresOperationalBuilding = saved.requiresOperationalBuilding, requiredBuildingId = saved.requiredBuildingId, requiredBuildingKind = kind });
            }
            if (record.recipes != null) foreach (var saved in record.recipes)
            {
                if (saved == null) continue;
                BuildingKind kind;
                if (!Enum.TryParse(saved.requiredBuildingKind, true, out kind)) kind = BuildingKind.Workshop;
                var recipe = new WorldSystemsRecipeContract { recipeId = saved.recipeId, displayName = saved.displayName, durationSeconds = saved.durationSeconds, requiresBuilding = saved.requiresBuilding, requiredBuildingId = saved.requiredBuildingId, requiredBuildingKind = kind };
                if (saved.inputs != null) foreach (var input in saved.inputs) if (input != null) recipe.inputs.Add(new WorldSystemsResourceStack(input.resourceId, input.quantity));
                if (saved.outputs != null) foreach (var output in saved.outputs) if (output != null) recipe.outputs.Add(new WorldSystemsResourceStack(output.resourceId, output.quantity));
                economy.State.recipes.Add(recipe);
            }
            if (record.consequences != null) foreach (var saved in record.consequences)
                if (saved != null) economy.State.consequences.Add(new WorldSystemsEconomicConsequenceRecord { recordId = saved.recordId, simulationTime = saved.simulationTime, category = saved.category, actorId = saved.actorId, settlementId = saved.settlementId, resourceId = saved.resourceId, quantity = saved.quantity, value = saved.value, positive = saved.positive, description = saved.description });
            GameplayCoreBridge.Live?.RebindEconomyInventory();
            return true;
        }

        public static bool RestoreWorldFabric()
        {
            return RestoreWorldFabric(WorldFabricRuntime.Active);
        }

        public static bool RestoreWorldFabric(WorldFabricRuntime runtime)
        {
            if (LastLoadedEnvelope == null || LastLoadedEnvelope.payload == null) return false;
            return RestoreWorldFabric(runtime, LastLoadedEnvelope.payload.worldFabric);
        }

        /// <summary>
        /// Records an integration-owned consequence without coupling the service to
        /// a second event bus. These records are included in the next envelope.
        /// </summary>
        public static ConsequenceEventRecord RecordConsequence(
            string channel,
            string kind,
            string title,
            string detail,
            string sourceId = null,
            string targetId = null,
            string actionId = null,
            float value = 0f,
            WorldId? world = null)
        {
            var record = new ConsequenceEventRecord
            {
                eventId = Guid.NewGuid().ToString("N"),
                channel = channel ?? "",
                kind = kind ?? "",
                title = title ?? "",
                detail = detail ?? "",
                sourceId = sourceId ?? "",
                targetId = targetId ?? "",
                actionId = actionId ?? "",
                occurredAt = Time.unscaledTime,
                value = value,
                world = world.HasValue ? world.Value.ToString() : WorldClock.World.ToString()
            };
            RecordedConsequences.Add(record);
            // Cap growth — Force Full Hub melted with ~25GB footprint after Expand.
            const int cap = 256;
            if (RecordedConsequences.Count > cap)
                RecordedConsequences.RemoveRange(0, RecordedConsequences.Count - cap);
            return record;
        }

        static void CapturePlayer(PersistencePayload payload)
        {
            var player = ConcordiaPlayer.Live;
            if (!player) player = UnityEngine.Object.FindFirstObjectByType<ConcordiaPlayer>();
            if (!player) return;

            var record = payload.player;
            record.actorId = string.IsNullOrEmpty(player.name) ? "player" : player.name;
            record.position = new Vector3Record(player.transform.position);
            record.rotation = new QuaternionRecord(player.transform.rotation);
            record.world = player.world.ToString();
            record.hp = player.hp;
            record.stamina = player.stamina;
            record.poise = player.poise;
            record.hostility = player.hostility;
            record.heldEquipmentId = player.kitWeapon;
            record.equippedItemId = KitBag.Equipped;
            record.combatArt = KitBag.Art;
            record.inventory.Clear();
            if (KitBag.Items != null)
            {
                foreach (var item in KitBag.Items)
                {
                    if (item == null || string.IsNullOrEmpty(item.id)) continue;
                    record.inventory.Add(new ItemIdentifierRecord
                    {
                        id = item.id,
                        displayName = item.name,
                        kind = item.kind,
                        stem = item.stem,
                        affix = item.affixLine,
                        quantity = 1
                    });
                }
            }
            record.talkLog.Clear();
            if (player.talkLog != null) record.talkLog.AddRange(player.talkLog);

            var body = player.GetComponent<LivingBody>();
            if (body)
            {
                record.hunger = body.Hunger;
                record.fatigue = body.Fatigue;
            }
        }

        static void CaptureNpcState(PersistencePayload payload)
        {
            payload.npcs.Clear();
            var lives = UnityEngine.Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            foreach (var life in lives)
            {
                if (!life) continue;
                var guest = life.GetComponent<GuestNpc>();
                var record = new NpcPersistenceRecord
                {
                    actorId = NpcId(life, guest),
                    objectName = life.gameObject.name,
                    personId = guest != null ? guest.personId : "",
                    position = new Vector3Record(life.transform.position),
                    rotation = new QuaternionRecord(life.transform.rotation),
                    home = new Vector3Record(life.home),
                    workplace = new Vector3Record(life.workplace),
                    post = new Vector3Record(life.post),
                    job = life.job.ToString(),
                    activity = life.act,
                    pinned = life.pinned,
                    hailed = guest != null && guest.hailed
                };
                if (guest != null)
                {
                    AddUnique(record.socialIds, guest.personId);
                    if (guest.def != null)
                    {
                        AddUnique(record.socialIds, guest.def.id);
                        AddUnique(record.socialIds, guest.def.name);
                    }
                }
                record.bondAffinity = BondFor(record.socialIds);
                payload.npcs.Add(record);
            }
        }

        static void CaptureWorldState(PersistencePayload payload)
        {
            var record = payload.world;
            record.activeWorld = WorldClock.World.ToString();
            record.hour = WorldClock.Hour;
            record.day = WorldClock.Day;
            record.weather = WorldClock.Weather;
            record.ecology = WorldClock.Ecology;
            record.prices = WorldClock.Prices;
            record.factionHeat = WorldClock.FactionHeat;
            record.lastEvent = WorldClock.LastEvent;
            record.nearbyActivity = WorldClock.NearbyAct;
            record.slices.Clear();
            foreach (WorldId id in Enum.GetValues(typeof(WorldId)))
            {
                var slice = WorldMemory.Load(id);
                if (slice == null) continue;
                record.slices.Add(ToPersistenceSlice(slice));
            }
            var all = WorldMemory.All();
            record.plotsCsv = all.plotsCsv ?? "";
            record.travelersCsv = all.travelersCsv ?? "";
            record.crossCsv = all.crossCsv ?? "";
            record.caravansCsv = all.caravansCsv ?? "";
            record.tariffsCsv = all.tariffsCsv ?? "";
            record.borderCrossingsCsv = all.borderCrossingsCsv ?? "";
            record.eventLog.Clear();
            foreach (var source in WorldEventLog.All)
            {
                if (source == null) continue;
                record.eventLog.Add(new WorldEventPersistenceRecord
                {
                    eventId = source.eventId,
                    type = source.type,
                    world = source.world,
                    actorId = source.actorId,
                    targetId = source.targetId,
                    text = source.text,
                    occurredAt = source.occurredAt,
                    day = source.day
                });
            }
            record.factionStandings.Clear();
            foreach (var source in FactionStandingBook.All)
            {
                if (source == null) continue;
                record.factionStandings.Add(new FactionStandingPersistenceRecord
                {
                    world = source.world,
                    factionId = source.factionId,
                    standing = source.standing,
                    witnessHeat = source.witnessHeat,
                    updatedDay = source.updatedDay
                });
            }
        }

        static void CaptureVehicleState(PersistencePayload payload)
        {
            payload.vehicles.Clear();
            foreach (var vehicle in VehiclePersistenceService.Vehicles)
            {
                if (!vehicle) continue;
                var snapshot = vehicle.Snapshot();
                var motion = vehicle.Motion;
                var record = new VehiclePersistenceRecord
                {
                    entityId = vehicle.EntityId,
                    objectName = vehicle.gameObject.name,
                    kind = vehicle.Kind.ToString(),
                    authority = vehicle.Authority.ToString(),
                    position = new Vector3Record(snapshot.Position),
                    rotation = new QuaternionRecord(snapshot.Rotation),
                    velocity = new Vector3Record(snapshot.Velocity),
                    angularVelocity = new Vector3Record(motion.AngularVelocity),
                    health = vehicle.Health,
                    ownerId = vehicle.OwnerId,
                    autopilot = vehicle.Autopilot
                };
                foreach (var item in vehicle.Inventory)
                    AddVehicleItem(record.inventory, item);
                foreach (var item in vehicle.StoredItems)
                    AddVehicleItem(record.storedItems, item);
                foreach (var slot in vehicle.Equipment)
                {
                    if (slot == null) continue;
                    record.equipment.Add(new VehicleEquipmentPersistenceRecord { slotId = slot.SlotId, itemId = slot.ItemId });
                }
                foreach (var seat in vehicle.Seats)
                {
                    if (seat == null) continue;
                    var occupant = seat.Occupant;
                    record.seats.Add(new VehicleSeatPersistenceRecord
                    {
                        seatId = seat.SeatId,
                        role = seat.Role.ToString(),
                        occupantId = occupant ? occupant.name : "",
                        occupantObjectName = occupant ? occupant.name : ""
                    });
                }
                if (!string.IsNullOrEmpty(vehicle.OwnerId))
                {
                    record.relationships.Add(new VehicleRelationshipPersistenceRecord
                    {
                        actorId = vehicle.OwnerId,
                        relationship = VehicleRelationshipKind.Owner.ToString()
                    });
                }
                payload.vehicles.Add(record);
            }
        }

        static void CaptureWorldSystems(PersistencePayload payload)
        {
            payload.worldSystems.buildings.Clear();
            payload.worldSystems.storefront.Clear();
            var host = WorldSystemsHost.Active;
            if (!host || host.Simulation == null) return;
            var state = host.Simulation.State;
            foreach (var building in state.buildings)
            {
                if (building == null) continue;
                payload.worldSystems.buildings.Add(new BuildingPersistenceRecord
                {
                    buildingId = building.buildingId,
                    settlementId = building.settlementId,
                    ownerId = building.ownerId,
                    factionId = building.factionId,
                    kind = building.kind.ToString(),
                    construction = building.construction.ToString(),
                    operational = building.operational,
                    condition = building.condition,
                    plan = building.plan
                });
            }
            foreach (var item in state.storefront)
            {
                if (item == null) continue;
                payload.worldSystems.storefront.Add(new StorefrontPersistenceRecord
                {
                    itemId = item.itemId,
                    storefrontId = item.storefrontId,
                    resource = item.resource,
                    quantity = item.quantity,
                    targetStock = item.targetStock,
                    unitPrice = item.unitPrice
                });
            }
        }

        static void CaptureWorldSimulation(PersistencePayload payload)
        {
            var host = WorldSimulationHost.Active;
            payload.worldSimulation = new WorldSimulationPersistenceRecord();
            if (host == null || host.Service == null) return;
            payload.worldSimulation.schemaVersion = CurrentWorldSimulationSchemaVersion;
            payload.worldSimulation.state = CloneWorldSimulationState(host.Service.State);
        }

        public static WorldSimulationPersistenceRecord CaptureWorldSimulationState(WorldSimulationState state)
        {
            return new WorldSimulationPersistenceRecord
            {
                schemaVersion = CurrentWorldSimulationSchemaVersion,
                state = CloneWorldSimulationState(state)
            };
        }

        static WorldSimulationState CloneWorldSimulationState(WorldSimulationState state)
        {
            if (state == null) return new WorldSimulationState();
            var json = JsonUtility.ToJson(state);
            return JsonUtility.FromJson<WorldSimulationState>(json) ?? new WorldSimulationState();
        }

        static void CaptureEconomy(PersistencePayload payload)
        {
            payload.economy = new WorldSystemsEconomyPersistenceRecord();
            var bridge = GameplayCoreBridge.Live;
            var economy = bridge == null ? null : bridge.Economy;
            if (economy == null || economy.State == null) return;
            payload.economy.simulationTime = economy.State.simulationTime;
            foreach (var item in economy.State.inventories)
            {
                if (item == null) continue;
                var saved = new EconomyInventoryPersistenceRecord { inventoryId = item.inventoryId, ownerId = item.ownerId, settlementId = item.settlementId, capacity = item.capacity };
                if (item.resources != null) foreach (var resource in item.resources) if (resource != null) saved.resources.Add(new EconomyResourcePersistenceRecord { resourceId = resource.resourceId, quantity = resource.quantity });
                payload.economy.inventories.Add(saved);
            }
            foreach (var item in economy.State.gatheringSources)
            {
                if (item == null) continue;
                payload.economy.gatheringSources.Add(new EconomyGatheringSourcePersistenceRecord { sourceId = item.sourceId, settlementId = item.settlementId, resourceId = item.resourceId, yieldPerAction = item.yieldPerAction, available = item.available, maximumAvailable = item.maximumAvailable, respawnSeconds = item.respawnSeconds, respawnAt = item.respawnAt, requiresOperationalBuilding = item.requiresOperationalBuilding, requiredBuildingId = item.requiredBuildingId, requiredBuildingKind = item.requiredBuildingKind.ToString() });
            }
            foreach (var item in economy.State.recipes)
            {
                if (item == null) continue;
                var saved = new EconomyRecipePersistenceRecord { recipeId = item.recipeId, displayName = item.displayName, durationSeconds = item.durationSeconds, requiresBuilding = item.requiresBuilding, requiredBuildingId = item.requiredBuildingId, requiredBuildingKind = item.requiredBuildingKind.ToString() };
                if (item.inputs != null) foreach (var input in item.inputs) if (input != null) saved.inputs.Add(new EconomyResourcePersistenceRecord { resourceId = input.resourceId, quantity = input.quantity });
                if (item.outputs != null) foreach (var output in item.outputs) if (output != null) saved.outputs.Add(new EconomyResourcePersistenceRecord { resourceId = output.resourceId, quantity = output.quantity });
                payload.economy.recipes.Add(saved);
            }
            foreach (var item in economy.State.consequences)
                if (item != null) payload.economy.consequences.Add(new EconomyConsequencePersistenceRecord { recordId = item.recordId, simulationTime = item.simulationTime, category = item.category, actorId = item.actorId, settlementId = item.settlementId, resourceId = item.resourceId, quantity = item.quantity, value = item.value, positive = item.positive, description = item.description });
        }

        static void CaptureWorldFabric(PersistencePayload payload)
        {
            var runtime = WorldFabricRuntime.Active;
            payload.worldFabric = runtime != null && runtime.Service != null
                ? JsonUtility.FromJson<WorldFabricState>(runtime.Service.CaptureJson())
                : new WorldFabricState();
        }

        static void CaptureFabrication(PersistencePayload payload)
        {
            payload.fabrication = new FabricationPersistenceEnvelopeDto
            {
                schemaVersion = FabricationPersistence.CurrentSchemaVersion,
                savedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            };
            var bridge = GameplayCoreBridge.Live;
            if (bridge == null || bridge.FabricatedObjects == null) return;
            foreach (var item in bridge.FabricatedObjects)
            {
                var dto = FabricationPersistence.ToDto(item);
                if (dto != null) payload.fabrication.objects.Add(dto);
            }
        }

        static void CaptureGunsmithing(PersistencePayload payload)
        {
            payload.gunsmithing = new GunsmithingPersistenceEnvelopeDto { schemaVersion = GunsmithingPersistence.CurrentSchemaVersion, savedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
            var bridge = GameplayCoreBridge.Live;
            if (bridge == null || bridge.ComposedWeapons == null) return;
            foreach (var item in bridge.ComposedWeapons) { var dto = GunsmithingPersistence.ToDto(item); if (dto != null) payload.gunsmithing.weapons.Add(dto); }
        }

        static void CaptureSpellcrafting(PersistencePayload payload)
        {
            payload.spellcrafting = new SpellcraftingPersistenceEnvelopeDto { schemaVersion = SpellcraftingPersistence.CurrentSchemaVersion, savedAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) };
            var bridge = GameplayCoreBridge.Live;
            if (bridge == null || bridge.ComposedSpells == null) return;
            foreach (var item in bridge.ComposedSpells) { var dto = SpellcraftingPersistence.ToDto(item); if (dto != null) payload.spellcrafting.spells.Add(dto); }
        }

        static void CaptureContainers(PersistencePayload payload)
        {
            var bridge = GameplayCoreBridge.Live;
            payload.containers = bridge == null || bridge.Containers == null ? new CanonicalContainerPersistenceEnvelopeDto() : bridge.Containers.Capture(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture));
        }

        static void CaptureQuestState(PersistencePayload payload)
        {
            payload.quests.active.Clear();
            payload.quests.completedIds.Clear();
            foreach (var id in QuestLog.Done) AddUnique(payload.quests.completedIds, id);
            foreach (var active in QuestLog.Active)
            {
                if (active == null || active.quest == null) continue;
                var record = new ActiveQuestPersistenceRecord
                {
                    questId = active.quest.id,
                    world = active.world.ToString()
                };
                if (active.done != null) record.objectiveDone.AddRange(active.done);
                payload.quests.active.Add(record);
            }
        }

        static void CaptureSkillState(PersistencePayload payload)
        {
            payload.skills.group = SkillLattice.Group;
            payload.skills.activeSkill = SkillLattice.ActiveSkill;
            payload.skills.lastArt = SkillLedger.LastArt;
            payload.skills.catalogCount = SkillLattice.CatalogCount;
            payload.skills.trainedCount = SkillLattice.TrainedCount;
        }

        static void CapturePlotState(PersistencePayload payload)
        {
            var plot = Plots.Nearby;
            payload.plot = plot == null ? null : new PlotPersistenceRecord
            {
                id = plot.id,
                text = plot.text,
                phase = plot.phase,
                kernel = plot.kernel
            };
        }

        static void CaptureConsequences(PersistencePayload payload)
        {
            payload.consequences.Clear();
            foreach (var record in RecordedConsequences)
                if (record != null) payload.consequences.Add(record);

            for (var i = WorldClock.FeedCount - 1; i >= 0; i--)
            {
                var beat = WorldClock.FeedAt(i);
                payload.consequences.Add(new ConsequenceEventRecord
                {
                    eventId = "feed-" + i,
                    channel = beat.channel,
                    kind = "world-feed",
                    title = beat.line,
                    detail = beat.line,
                    world = WorldClock.World.ToString(),
                    occurredAt = Time.unscaledTime
                });
            }

            var bridge = GameplayCoreBridge.Live;
            if (bridge != null && bridge.CombatEvents != null)
            {
                foreach (var combat in bridge.CombatEvents.Events)
                {
                    payload.consequences.Add(new ConsequenceEventRecord
                    {
                        eventId = "combat-" + combat.Time.ToString(CultureInfo.InvariantCulture),
                        channel = "combat",
                        kind = combat.Type.ToString(),
                        title = combat.Phase.ToString(),
                        sourceId = combat.SourceId,
                        targetId = combat.TargetId,
                        actionId = combat.ActionId,
                        detail = combat.Detail,
                        world = WorldClock.World.ToString(),
                        occurredAt = combat.Time,
                        value = combat.Value
                    });
                }
            }
        }

        static void RestorePlayer(PlayerPersistenceRecord record)
        {
            if (record == null) return;
            var player = ConcordiaPlayer.Live;
            if (!player) player = UnityEngine.Object.FindFirstObjectByType<ConcordiaPlayer>();
            if (!player) return;

            WorldId world;
            if (TryWorld(record.world, out world)) player.world = world;
            player.hp = record.hp;
            player.stamina = record.stamina;
            player.poise = record.poise;
            player.hostility = record.hostility;
            if (record.position != null) player.Stand(record.position.ToVector3());
            if (record.rotation != null) player.transform.rotation = record.rotation.ToQuaternion();
            player.kitWeapon = record.heldEquipmentId;
            player.talkLog.Clear();
            if (record.talkLog != null) player.talkLog.AddRange(record.talkLog);

            KitBag.Reset();
            KitBag.Art = record.combatArt;
            if (record.inventory != null)
            {
                foreach (var item in record.inventory)
                {
                    if (item == null || string.IsNullOrEmpty(item.id)) continue;
                    KitBag.Items.Add(new KitBag.Item
                    {
                        id = item.id,
                        name = item.displayName,
                        kind = item.kind,
                        stem = item.stem,
                        affixLine = item.affix
                    });
                }
            }
            KitBag.Equipped = record.equippedItemId;
            if (!string.IsNullOrEmpty(record.heldEquipmentId) && !KitBag.Has(record.heldEquipmentId))
                KitBag.HoldWeapon(record.heldEquipmentId);

            var body = player.GetComponent<LivingBody>();
            if (body)
            {
                body.Hunger = Mathf.Clamp01(record.hunger);
                body.Fatigue = Mathf.Clamp01(record.fatigue);
            }
        }

        static void RestoreNpcState(List<NpcPersistenceRecord> records)
        {
            if (records == null) return;
            var lives = UnityEngine.Object.FindObjectsByType<NpcLife>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            foreach (var record in records)
            {
                if (record == null) continue;
                NpcLife life = null;
                GuestNpc guest = null;
                foreach (var candidate in lives)
                {
                    if (!candidate) continue;
                    var candidateGuest = candidate.GetComponent<GuestNpc>();
                    if (string.Equals(NpcId(candidate, candidateGuest), record.actorId, StringComparison.OrdinalIgnoreCase)
                        || (!string.IsNullOrEmpty(record.objectName) && candidate.gameObject.name == record.objectName))
                    {
                        life = candidate;
                        guest = candidateGuest;
                        break;
                    }
                }
                if (!life) continue;
                if (record.position != null) life.transform.position = record.position.ToVector3();
                if (record.rotation != null) life.transform.rotation = record.rotation.ToQuaternion();
                if (record.home != null) life.home = record.home.ToVector3();
                if (record.workplace != null) life.workplace = record.workplace.ToVector3();
                if (record.post != null) life.post = record.post.ToVector3();
                NpcLife.Job job;
                if (Enum.TryParse(record.job, true, out job)) life.job = job;
                life.act = record.activity ?? "idle";
                life.pinned = record.pinned;
                if (guest != null) guest.hailed = record.hailed;
                if (record.socialIds != null)
                    foreach (var socialId in record.socialIds)
                        if (!string.IsNullOrEmpty(socialId)) Bonds.Set(socialId, record.bondAffinity);
            }
        }

        static bool RestoreWorldFabric(WorldFabricRuntime runtime, WorldFabricState state)
        {
            if (!runtime || runtime.Service == null || state == null) return false;
            runtime.Service.Restore(state);
            return true;
        }

        static void RestoreFabrication(FabricationPersistenceEnvelopeDto envelope)
        {
            var bridge = GameplayCoreBridge.Live;
            if (bridge != null) bridge.RestoreFabrication(envelope);
        }

        static void RestoreGunsmithing(GunsmithingPersistenceEnvelopeDto envelope)
        {
            var bridge = GameplayCoreBridge.Live;
            if (bridge != null) bridge.RestoreGunsmithing(envelope);
        }

        static void RestoreSpellcrafting(SpellcraftingPersistenceEnvelopeDto envelope)
        {
            var bridge = GameplayCoreBridge.Live;
            if (bridge != null) bridge.RestoreSpellcrafting(envelope);
        }

        static void RestoreContainers(CanonicalContainerPersistenceEnvelopeDto envelope)
        {
            var bridge = GameplayCoreBridge.Live;
            if (bridge != null) bridge.RestoreContainers(envelope);
        }

        static bool RestoreWorldSystems(WorldSystemsHost host, WorldSystemsPersistenceRecord record)
        {
            if (!host || host.Simulation == null || record == null) return false;
            var state = host.Simulation.State;
            state.buildings.Clear();
            state.storefront.Clear();
            foreach (var building in record.buildings)
            {
                if (building == null) continue;
                BuildingKind kind;
                ConstructionStatus construction;
                if (!Enum.TryParse(building.kind, true, out kind)) kind = BuildingKind.Utility;
                if (!Enum.TryParse(building.construction, true, out construction)) construction = ConstructionStatus.Planned;
                state.buildings.Add(new BuildingState
                {
                    buildingId = building.buildingId,
                    settlementId = building.settlementId,
                    ownerId = building.ownerId,
                    factionId = building.factionId,
                    kind = kind,
                    construction = construction,
                    operational = building.operational,
                    condition = building.condition,
                    plan = building.plan
                });
            }
            foreach (var item in record.storefront)
            {
                if (item == null) continue;
                state.storefront.Add(new StorefrontItem
                {
                    itemId = item.itemId,
                    storefrontId = item.storefrontId,
                    resource = item.resource,
                    quantity = item.quantity,
                    targetStock = item.targetStock,
                    unitPrice = item.unitPrice
                });
            }
            host.Simulation.Reindex();
            return true;
        }

        static void RestoreVehicleState(List<VehiclePersistenceRecord> records)
        {
            if (records == null) return;
            foreach (var record in records)
            {
                if (record == null) continue;
                VehicleEntity vehicle = FindVehicle(record);
                if (!vehicle) continue;

                var canonical = new Concordia.Vehicles.VehiclePersistenceRecord
                {
                    // VehicleEntity.RestoreState validates its identity. Use the
                    // live identity so scene-authored vehicles with regenerated
                    // runtime ids can still restore their DTO state by object name.
                    EntityId = vehicle.EntityId,
                    Kind = (int)vehicle.Kind,
                    Px = record.position != null ? record.position.x : vehicle.transform.position.x,
                    Py = record.position != null ? record.position.y : vehicle.transform.position.y,
                    Pz = record.position != null ? record.position.z : vehicle.transform.position.z,
                    Rx = record.rotation != null ? record.rotation.x : vehicle.transform.rotation.x,
                    Ry = record.rotation != null ? record.rotation.y : vehicle.transform.rotation.y,
                    Rz = record.rotation != null ? record.rotation.z : vehicle.transform.rotation.z,
                    Rw = record.rotation != null ? record.rotation.w : vehicle.transform.rotation.w,
                    Health = record.health,
                    OwnerId = record.ownerId
                };
                foreach (var item in record.inventory)
                    if (item != null && !string.IsNullOrEmpty(item.id)) canonical.Inventory.Add(new VehicleItem(item.id, Mathf.Max(1, item.quantity)));
                foreach (var item in record.storedItems)
                    if (item != null && !string.IsNullOrEmpty(item.id)) canonical.Inventory.Add(new VehicleItem(item.id, Mathf.Max(1, item.quantity)));
                vehicle.RestoreState(canonical);
                vehicle.ApplyMotion(new VehicleMotionState
                {
                    Velocity = record.velocity == null ? Vector3.zero : record.velocity.ToVector3(),
                    AngularVelocity = record.angularVelocity == null ? Vector3.zero : record.angularVelocity.ToVector3()
                });
                vehicle.SetAutopilot(record.autopilot, record.autopilotDestination == null ? Vector3.zero : record.autopilotDestination.ToVector3());

                // RestoreState exposes the canonical base path and places all
                // items in storage. Move the recorded inventory portion back via
                // the public storage/inventory contracts.
                foreach (var item in record.inventory)
                {
                    if (item == null || string.IsNullOrEmpty(item.id) || item.quantity <= 0) continue;
                    if (vehicle.TryWithdraw(item.id, item.quantity))
                        vehicle.TryAddItem(new VehicleItem(item.id, item.quantity));
                }
                foreach (var slot in record.equipment)
                    if (slot != null && !string.IsNullOrEmpty(slot.slotId)) vehicle.TryEquip(slot.slotId, slot.itemId);
                foreach (var relationship in record.relationships)
                {
                    if (relationship == null || string.IsNullOrEmpty(relationship.actorId)) continue;
                    VehicleRelationshipKind kind;
                    if (Enum.TryParse(relationship.relationship, true, out kind)) vehicle.SetRelationship(relationship.actorId, kind);
                }
                foreach (var seat in record.seats)
                {
                    if (seat == null || string.IsNullOrEmpty(seat.seatId) || string.IsNullOrEmpty(seat.occupantObjectName)) continue;
                    var occupant = GameObject.Find(seat.occupantObjectName);
                    if (occupant) vehicle.TryEnter(occupant, seat.seatId);
                }
            }
        }

        static void RestoreWorldState(WorldPersistenceRecord record)
        {
            if (record == null) return;
            WorldId active;
            if (TryWorld(record.activeWorld, out active)) WorldClock.World = active;
            WorldClock.Hour = record.hour;
            WorldClock.Day = record.day;
            WorldClock.Weather = record.weather ?? "clear";
            WorldClock.Ecology = record.ecology;
            WorldClock.Prices = record.prices;
            WorldClock.FactionHeat = record.factionHeat;
            WorldClock.LastEvent = record.lastEvent ?? "";
            WorldClock.NearbyAct = record.nearbyActivity ?? "";

            if (record.slices != null)
            {
                foreach (var slice in record.slices)
                {
                    if (slice == null) continue;
                    WorldId id;
                    if (!TryWorld(slice.world, out id)) continue;
                    WorldMemory.Put(id, ToCanonicalSlice(slice));
                }
            }
            var all = WorldMemory.All();
            all.plotsCsv = record.plotsCsv ?? "";
            all.travelersCsv = record.travelersCsv ?? "";
            all.crossCsv = record.crossCsv ?? "";
            all.caravansCsv = record.caravansCsv ?? "";
            all.tariffsCsv = record.tariffsCsv ?? "";
            all.borderCrossingsCsv = record.borderCrossingsCsv ?? "";
            var events = new List<WorldEventRecord>();
            if (record.eventLog != null)
            {
                foreach (var source in record.eventLog)
                {
                    if (source == null) continue;
                    events.Add(new WorldEventRecord
                    {
                        eventId = source.eventId,
                        type = source.type,
                        world = source.world,
                        actorId = source.actorId,
                        targetId = source.targetId,
                        text = source.text,
                        occurredAt = source.occurredAt,
                        day = source.day
                    });
                }
            }
            WorldEventLog.Restore(events);
            var standings = new List<FactionStandingRecord>();
            if (record.factionStandings != null)
            {
                foreach (var source in record.factionStandings)
                {
                    if (source == null) continue;
                    standings.Add(new FactionStandingRecord
                    {
                        world = source.world,
                        factionId = source.factionId,
                        standing = source.standing,
                        witnessHeat = source.witnessHeat,
                        updatedDay = source.updatedDay
                    });
                }
            }
            FactionStandingBook.Restore(standings);
        }

        static void RestoreQuestState(QuestPersistenceRecord record)
        {
            if (record == null) return;
            QuestLog.Active.Clear();
            QuestLog.Done.Clear();
            if (record.completedIds != null)
                foreach (var id in record.completedIds)
                    if (!string.IsNullOrEmpty(id)) QuestLog.Done.Add(id);
            if (record.active == null) return;
            foreach (var saved in record.active)
            {
                if (saved == null || string.IsNullOrEmpty(saved.questId)) continue;
                WorldId world;
                if (!TryWorld(saved.world, out world)) world = WorldClock.World;
                var quest = WorldBook.QuestById(world, saved.questId);
                if (quest == null) continue;
                var active = new QuestLog.ActiveQuest { quest = quest, world = world, done = new bool[saved.objectiveDone.Count] };
                for (var i = 0; i < active.done.Length; i++) active.done[i] = saved.objectiveDone[i];
                QuestLog.Active.Add(active);
            }
        }

        static void RestoreSkillState(SkillPersistenceRecord record)
        {
            if (record == null) return;
            SkillLattice.Group = record.group ?? "combat";
            SkillLattice.ActiveSkill = record.activeSkill ?? "swords";
            SkillLattice.CatalogCount = record.catalogCount;
            SkillLattice.TrainedCount = record.trainedCount;
            SkillLedger.LastArt = record.lastArt;
        }

        static void RestoreConsequences(PersistencePayload payload)
        {
            RecordedConsequences.Clear();
            var feed = new List<ConsequenceEventRecord>();
            if (payload.consequences != null)
            {
                foreach (var record in payload.consequences)
                {
                    if (record == null) continue;
                    if (record.kind == "world-feed") feed.Add(record);
                    else if (record.channel != "combat") RecordedConsequences.Add(record);
                }
            }

            // FeedAt is a newest-first view. Replay oldest to newest, then put
            // the authoritative world summary back because PushFeed updates it.
            for (var i = 0; i < feed.Count; i++)
                WorldClock.PushFeed(feed[i].channel, feed[i].detail ?? feed[i].title);
            WorldClock.LastEvent = payload.world != null ? payload.world.lastEvent ?? "" : "";
            WorldClock.NearbyAct = payload.world != null ? payload.world.nearbyActivity ?? "" : "";

            if (payload.plot == null)
                Plots.Reset();
            else
            {
                Plots.Seed(payload.plot.text, payload.plot.kernel ? payload.plot.id : null);
                if (payload.plot.phase == "exposed") Plots.ResolveKernel("expose");
                else if (payload.plot.phase == "abetted") Plots.ResolveKernel("abet");
                else if (payload.plot.phase == "ignored") Plots.ResolveKernel("ignore");
            }

            var bridge = GameplayCoreBridge.Live;
            if (bridge != null && bridge.CombatEvents != null)
            {
                bridge.CombatEvents.Clear();
                if (payload.consequences != null)
                    foreach (var record in payload.consequences)
                    {
                        if (record == null || record.channel != "combat") continue;
                        CombatEventType type;
                        CombatPhase phase;
                        if (!Enum.TryParse(record.kind, true, out type)) continue;
                        if (!Enum.TryParse(record.title, true, out phase)) phase = CombatPhase.Collision;
                        bridge.CombatEvents.Record(new CombatEvent(type, phase, record.occurredAt,
                            record.sourceId, record.targetId, record.actionId, record.detail, record.value));
                    }
            }
        }

        static WorldSlicePersistenceRecord ToPersistenceSlice(WorldSliceRec source)
        {
            var result = new WorldSlicePersistenceRecord
            {
                world = source.world,
                ecology = source.ecology,
                prices = source.prices,
                factionHeat = source.factionHeat,
                hour = source.hour,
                day = source.day,
                births = source.births,
                lastEvent = source.lastEvent,
                savedAt = source.savedAt,
                deadCsv = source.deadCsv,
                stock = source.stock,
                need = source.need,
                staple = source.staple,
                imports = source.imports,
                population = source.population
            };
            if (source.regions != null)
                foreach (var region in source.regions)
                    if (region != null) result.regions.Add(new RegionPersistenceRecord
                    {
                        regionId = region.regionId,
                        discovered = region.discovered,
                        ecology = region.ecology,
                        activity = region.activity,
                        controlFactionId = region.controlFactionId
                    });
            if (source.settlements != null)
                foreach (var settlement in source.settlements)
                    if (settlement != null) result.settlements.Add(new SettlementPersistenceRecord
                    {
                        settlementId = settlement.settlementId,
                        population = settlement.population,
                        prices = settlement.prices,
                        controlFactionId = settlement.controlFactionId,
                        incidentsCsv = settlement.incidentsCsv,
                        constructionCsv = settlement.constructionCsv,
                        activitiesCsv = settlement.activitiesCsv
                    });
            return result;
        }

        static WorldSliceRec ToCanonicalSlice(WorldSlicePersistenceRecord source)
        {
            var result = new WorldSliceRec
            {
                world = source.world,
                ecology = source.ecology,
                prices = source.prices,
                factionHeat = source.factionHeat,
                hour = source.hour,
                day = source.day,
                births = source.births,
                lastEvent = source.lastEvent,
                savedAt = source.savedAt,
                deadCsv = source.deadCsv,
                stock = source.stock,
                need = source.need,
                staple = source.staple,
                imports = source.imports,
                population = source.population
            };
            if (source.regions != null)
            {
                var regions = new List<RegionSliceRec>();
                foreach (var region in source.regions)
                    if (region != null) regions.Add(new RegionSliceRec
                    {
                        regionId = region.regionId,
                        discovered = region.discovered,
                        ecology = region.ecology,
                        activity = region.activity,
                        controlFactionId = region.controlFactionId
                    });
                result.regions = regions.ToArray();
            }
            if (source.settlements != null)
            {
                var settlements = new List<SettlementSliceRec>();
                foreach (var settlement in source.settlements)
                    if (settlement != null) settlements.Add(new SettlementSliceRec
                    {
                        settlementId = settlement.settlementId,
                        population = settlement.population,
                        prices = settlement.prices,
                        controlFactionId = settlement.controlFactionId,
                        incidentsCsv = settlement.incidentsCsv,
                        constructionCsv = settlement.constructionCsv,
                        activitiesCsv = settlement.activitiesCsv
                    });
                result.settlements = settlements.ToArray();
            }
            return result;
        }

        static VehicleEntity FindVehicle(VehiclePersistenceRecord record)
        {
            foreach (var vehicle in VehiclePersistenceService.Vehicles)
            {
                if (!vehicle) continue;
                if (!string.IsNullOrEmpty(record.entityId) && vehicle.EntityId == record.entityId) return vehicle;
            }
            if (!string.IsNullOrEmpty(record.objectName))
            {
                foreach (var vehicle in VehiclePersistenceService.Vehicles)
                    if (vehicle && vehicle.gameObject.name == record.objectName) return vehicle;
            }
            return null;
        }

        static string NpcId(NpcLife life, GuestNpc guest)
        {
            if (guest != null)
            {
                if (!string.IsNullOrEmpty(guest.personId)) return guest.personId;
                if (guest.def != null)
                {
                    if (!string.IsNullOrEmpty(guest.def.id)) return guest.def.id;
                    if (!string.IsNullOrEmpty(guest.def.name)) return guest.def.name;
                }
            }
            return life != null && life.gameObject != null ? life.gameObject.name : "npc";
        }

        static float BondFor(List<string> ids)
        {
            if (ids == null) return 0f;
            foreach (var id in ids)
                if (!string.IsNullOrEmpty(id)) return Bonds.Get(id);
            return 0f;
        }

        static void AddVehicleItem(List<ItemIdentifierRecord> target, VehicleItem item)
        {
            if (item == null || string.IsNullOrEmpty(item.ItemId)) return;
            target.Add(new ItemIdentifierRecord { id = item.ItemId, quantity = Mathf.Max(1, item.Quantity) });
        }


        static void AddUnique(List<string> values, string value)
        {
            if (values == null || string.IsNullOrEmpty(value) || values.Contains(value)) return;
            values.Add(value);
        }

        static bool TryWorld(string value, out WorldId world)
        {
            return Enum.TryParse(value, true, out world);
        }

        static void Normalize(PersistenceEnvelope envelope)
        {
            if (envelope.payload == null) envelope.payload = new PersistencePayload();
            var payload = envelope.payload;
            if (payload.player == null) payload.player = new PlayerPersistenceRecord();
            if (payload.player.position == null) payload.player.position = new Vector3Record();
            if (payload.player.rotation == null) payload.player.rotation = new QuaternionRecord();
            if (payload.player.inventory == null) payload.player.inventory = new List<ItemIdentifierRecord>();
            if (payload.player.talkLog == null) payload.player.talkLog = new List<string>();
            if (payload.npcs == null) payload.npcs = new List<NpcPersistenceRecord>();
            foreach (var npc in payload.npcs)
                if (npc != null)
                {
                    if (npc.position == null) npc.position = new Vector3Record();
                    if (npc.rotation == null) npc.rotation = new QuaternionRecord();
                    if (npc.home == null) npc.home = new Vector3Record();
                    if (npc.workplace == null) npc.workplace = new Vector3Record();
                    if (npc.post == null) npc.post = new Vector3Record();
                    if (npc.socialIds == null) npc.socialIds = new List<string>();
                }
            if (payload.world == null) payload.world = new WorldPersistenceRecord();
            if (payload.world.slices == null) payload.world.slices = new List<WorldSlicePersistenceRecord>();
            if (payload.world.eventLog == null) payload.world.eventLog = new List<WorldEventPersistenceRecord>();
            if (payload.world.factionStandings == null) payload.world.factionStandings = new List<FactionStandingPersistenceRecord>();
            foreach (var slice in payload.world.slices)
                if (slice != null)
                {
                    if (slice.regions == null) slice.regions = new List<RegionPersistenceRecord>();
                    if (slice.settlements == null) slice.settlements = new List<SettlementPersistenceRecord>();
                }
            if (payload.vehicles == null) payload.vehicles = new List<VehiclePersistenceRecord>();
            foreach (var vehicle in payload.vehicles)
                if (vehicle != null)
                {
                    if (vehicle.position == null) vehicle.position = new Vector3Record();
                    if (vehicle.rotation == null) vehicle.rotation = new QuaternionRecord();
                    if (vehicle.velocity == null) vehicle.velocity = new Vector3Record();
                    if (vehicle.angularVelocity == null) vehicle.angularVelocity = new Vector3Record();
                    if (vehicle.autopilotDestination == null) vehicle.autopilotDestination = new Vector3Record();
                    if (vehicle.inventory == null) vehicle.inventory = new List<ItemIdentifierRecord>();
                    if (vehicle.storedItems == null) vehicle.storedItems = new List<ItemIdentifierRecord>();
                    if (vehicle.equipment == null) vehicle.equipment = new List<VehicleEquipmentPersistenceRecord>();
                    if (vehicle.seats == null) vehicle.seats = new List<VehicleSeatPersistenceRecord>();
                    if (vehicle.relationships == null) vehicle.relationships = new List<VehicleRelationshipPersistenceRecord>();
                }
            if (payload.worldSystems == null) payload.worldSystems = new WorldSystemsPersistenceRecord();
            if (payload.worldSystems.buildings == null) payload.worldSystems.buildings = new List<BuildingPersistenceRecord>();
            if (payload.worldSystems.storefront == null) payload.worldSystems.storefront = new List<StorefrontPersistenceRecord>();
            if (payload.worldSimulation == null) payload.worldSimulation = new WorldSimulationPersistenceRecord();
            if (payload.worldSimulation.state == null) payload.worldSimulation.state = new WorldSimulationState();
            if (payload.worldFabric == null) payload.worldFabric = new WorldFabricState();
            if (payload.worldFabric.settlements == null) payload.worldFabric.settlements = new List<WorldFabricSettlementRecord>();
            if (payload.worldFabric.buildings == null) payload.worldFabric.buildings = new List<WorldFabricBuildingRecord>();
            if (payload.worldFabric.consequences == null) payload.worldFabric.consequences = new List<WorldFabricConsequenceRecord>();
            if (payload.fabrication == null) payload.fabrication = new FabricationPersistenceEnvelopeDto();
            if (payload.fabrication.objects == null) payload.fabrication.objects = new List<FabricationObjectPersistenceDto>();
            if (payload.fabrication.containers == null) payload.fabrication.containers = new List<FabricationContainerPersistenceDto>();
            if (payload.gunsmithing == null) payload.gunsmithing = new GunsmithingPersistenceEnvelopeDto();
            if (payload.gunsmithing.weapons == null) payload.gunsmithing.weapons = new List<WeaponPersistenceDto>();
            if (payload.spellcrafting == null) payload.spellcrafting = new SpellcraftingPersistenceEnvelopeDto();
            if (payload.spellcrafting.spells == null) payload.spellcrafting.spells = new List<SpellPersistenceDto>();
            if (payload.containers == null) payload.containers = new CanonicalContainerPersistenceEnvelopeDto();
            if (payload.containers.containers == null) payload.containers.containers = new List<CanonicalContainerRecord>();
            if (payload.containers.consequences == null) payload.containers.consequences = new List<ContainerConsequenceEvent>();
            if (payload.consequences == null) payload.consequences = new List<ConsequenceEventRecord>();
            if (payload.quests == null) payload.quests = new QuestPersistenceRecord();
            if (payload.quests.active == null) payload.quests.active = new List<ActiveQuestPersistenceRecord>();
            foreach (var active in payload.quests.active)
                if (active != null && active.objectiveDone == null) active.objectiveDone = new List<bool>();
            if (payload.quests.completedIds == null) payload.quests.completedIds = new List<string>();
            if (payload.skills == null) payload.skills = new SkillPersistenceRecord();
        }
    }
}