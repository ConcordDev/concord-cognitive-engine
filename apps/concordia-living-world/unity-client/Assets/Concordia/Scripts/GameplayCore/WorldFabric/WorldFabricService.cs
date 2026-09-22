using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.WorldFabric
{
    /// <summary>
    /// Canonical semantic detail layer for inhabitable world content. It generates
    /// deterministic object inventories from authored context, records provenance,
    /// and keeps physical detail, economy, interaction, lore, and persistence linked
    /// without owning the renderer or replacing WorldSystemsSimulation.
    /// </summary>
    public sealed class WorldFabricService
    {
        public const string Version = "world-fabric-v1";

        readonly WorldFabricState _state = new WorldFabricState();
        readonly Dictionary<string, WorldFabricSettlementRecord> _settlements = new Dictionary<string, WorldFabricSettlementRecord>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, WorldFabricBuildingRecord> _buildings = new Dictionary<string, WorldFabricBuildingRecord>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, WorldFabricObjectRecord> _objects = new Dictionary<string, WorldFabricObjectRecord>(StringComparer.OrdinalIgnoreCase);
        int _eventCounter;

        public WorldFabricState State => _state;
        public IEnumerable<WorldFabricSettlementRecord> Settlements => _settlements.Values;
        public IEnumerable<WorldFabricBuildingRecord> Buildings => _buildings.Values;

        public WorldFabricService(WorldFabricState state = null)
        {
            if (state != null) Restore(state);
        }

        public void Restore(WorldFabricState state)
        {
            _settlements.Clear();
            _buildings.Clear();
            _objects.Clear();
            _state.schemaVersion = state != null && state.schemaVersion > 0 ? state.schemaVersion : 1;
            _state.generatorVersion = Version;
            _state.settlements = state != null && state.settlements != null
                ? state.settlements
                : new List<WorldFabricSettlementRecord>();
            _state.buildings = state != null && state.buildings != null
                ? state.buildings
                : new List<WorldFabricBuildingRecord>();
            _state.consequences = state != null && state.consequences != null
                ? state.consequences
                : new List<WorldFabricConsequenceRecord>();
            _eventCounter = _state.consequences.Count;

            for (var i = 0; i < _state.settlements.Count; i++)
            {
                var settlement = _state.settlements[i];
                if (settlement != null && !string.IsNullOrEmpty(settlement.settlementId))
                    _settlements[settlement.settlementId] = settlement;
            }
            for (var i = 0; i < _state.buildings.Count; i++)
            {
                var building = _state.buildings[i];
                if (building == null || string.IsNullOrEmpty(building.buildingId)) continue;
                _buildings[building.buildingId] = building;
                IndexObjects(building);
            }
        }

        public string CaptureJson(bool pretty = false)
        {
            return JsonUtility.ToJson(_state, pretty);
        }

        public void RestoreJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            var state = JsonUtility.FromJson<WorldFabricState>(json);
            if (state != null) Restore(state);
        }

        public WorldFabricSettlementRecord EnsureSettlement(
            string settlementId,
            string worldId,
            string regionId,
            string name,
            string settlementType,
            string cultureId,
            string factionId,
            int population,
            IEnumerable<string> culturalRules = null,
            IEnumerable<string> loreSources = null)
        {
            if (string.IsNullOrEmpty(settlementId)) return null;
            if (_settlements.TryGetValue(settlementId, out var existing))
            {
                existing.population = Mathf.Max(existing.population, population);
                return existing;
            }

            var record = new WorldFabricSettlementRecord
            {
                settlementId = settlementId,
                worldId = worldId ?? "Hub",
                regionId = regionId ?? "",
                name = name ?? settlementId,
                settlementType = settlementType ?? "settlement",
                cultureId = cultureId ?? "unassigned",
                factionId = factionId ?? "unassigned",
                population = Mathf.Max(0, population)
            };
            AddRange(record.culturalRules, culturalRules);
            AddRange(record.loreSources, loreSources);
            _settlements[settlementId] = record;
            _state.settlements.Add(record);
            return record;
        }

        public WorldFabricBuildingRecord EnsureBuilding(
            string buildingId,
            string worldId,
            string regionId,
            string settlementId,
            string buildingType,
            string purpose,
            string cultureId,
            string factionId,
            string ownerId,
            int seed,
            IEnumerable<string> loreSources = null)
        {
            if (string.IsNullOrEmpty(buildingId)) return null;
            if (_buildings.TryGetValue(buildingId, out var existing)) return existing;

            var building = new WorldFabricBuildingRecord
            {
                buildingId = buildingId,
                worldId = worldId ?? "Hub",
                regionId = regionId ?? "",
                settlementId = settlementId ?? "",
                buildingType = buildingType ?? "building",
                purpose = purpose ?? "house",
                cultureId = cultureId ?? "unassigned",
                factionId = factionId ?? "unassigned",
                ownerId = ownerId ?? "unassigned",
                provenance = NewProvenance(buildingId, worldId, regionId, cultureId, factionId, buildingId,
                    "building:" + (buildingType ?? "building"), loreSources, new[] { "BuildingPlace", "WorldFabric" })
            };

            GenerateRoomsAndObjects(building, seed);
            _buildings[buildingId] = building;
            _state.buildings.Add(building);
            IndexObjects(building);

            if (_settlements.TryGetValue(settlementId ?? "", out var settlement)
                && !settlement.buildingIds.Contains(buildingId))
                settlement.buildingIds.Add(buildingId);
            return building;
        }

        public WorldFabricObjectRecord TryGetObject(string objectId)
        {
            if (string.IsNullOrEmpty(objectId)) return null;
            return _objects.TryGetValue(objectId, out var record) ? record : null;
        }

        public WorldFabricBuildingRecord TryGetBuilding(string buildingId)
        {
            if (string.IsNullOrEmpty(buildingId)) return null;
            return _buildings.TryGetValue(buildingId, out var record) ? record : null;
        }

        public bool TryRemoveObject(string objectId, string actorId, string reason, out WorldFabricConsequenceRecord consequence)
        {
            consequence = null;
            var record = TryGetObject(objectId);
            if (record == null || !record.present) return false;
            record.present = false;
            consequence = RecordConsequence("object_removed", record.objectId,
                record.provenance != null ? record.provenance.buildingId : record.containerId,
                actorId, reason ?? "object removed", record.value);
            return true;
        }

        public bool TryChangeObjectCondition(string objectId, float delta, string actorId, string reason,
            out WorldFabricConsequenceRecord consequence)
        {
            consequence = null;
            var record = TryGetObject(objectId);
            if (record == null) return false;
            var before = record.condition;
            record.condition = Mathf.Clamp01(record.condition + delta);
            if (Mathf.Approximately(before, record.condition)) return false;
            consequence = RecordConsequence(delta < 0f ? "object_damaged" : "object_repaired",
                record.objectId, record.provenance != null ? record.provenance.buildingId : record.containerId, actorId,
                reason ?? (delta < 0f ? "object damaged" : "object repaired"), Mathf.Abs(record.condition - before));
            return true;
        }

        public int RestockBuilding(string buildingId, string actorId, int seed)
        {
            var building = TryGetBuilding(buildingId);
            if (building == null || !building.operational) return 0;
            var changed = 0;
            for (var i = 0; i < building.objects.Count; i++)
            {
                var item = building.objects[i];
                if (item == null || item.kind != WorldFabricObjectKind.Food || item.present) continue;
                if (((seed + i * 17) & 3) != 0) continue;
                item.present = true;
                item.quantity = Mathf.Max(1, item.quantity);
                changed++;
            }
            if (changed > 0)
                RecordConsequence("building_restocked", null, buildingId, actorId, "building restocked", changed);
            return changed;
        }

        public List<WorldFabricValidationIssue> Validate()
        {
            var issues = new List<WorldFabricValidationIssue>();
            foreach (var building in _buildings.Values)
            {
                if (building == null) continue;
                if (building.provenance == null || string.IsNullOrEmpty(building.provenance.cultureId))
                    issues.Add(Issue("error", "missing_culture", null, building.buildingId, "building has no cultural provenance"));
                if (string.IsNullOrEmpty(building.purpose))
                    issues.Add(Issue("error", "missing_purpose", null, building.buildingId, "building has no semantic purpose"));
                if (building.condition <= 0f && building.operational)
                    issues.Add(Issue("error", "broken_operational", null, building.buildingId, "building is operational at zero condition"));
                for (var i = 0; i < building.objects.Count; i++)
                {
                    var item = building.objects[i];
                    if (item == null) continue;
                    if (item.provenance == null || string.IsNullOrEmpty(item.provenance.generationRule))
                        issues.Add(Issue("error", "missing_generation_rule", item.objectId, building.buildingId, "object has no generation provenance"));
                    if (item.interactive && item.interaction == WorldFabricInteractionKind.None)
                        issues.Add(Issue("error", "interactive_without_action", item.objectId, building.buildingId, "interactive object has no interaction"));
                    if (item.condition < 0f || item.condition > 1f)
                        issues.Add(Issue("error", "invalid_condition", item.objectId, building.buildingId, "condition is outside [0,1]"));
                }
            }
            return issues;
        }

        public WorldFabricConsequenceRecord RecordConsequence(
            string kind,
            string objectId,
            string buildingId,
            string actorId,
            string detail,
            float value)
        {
            var eventRecord = new WorldFabricConsequenceRecord
            {
                eventId = "fabric-event-" + (++_eventCounter).ToString("D8"),
                objectId = objectId ?? "",
                buildingId = buildingId ?? "",
                actorId = actorId ?? "",
                kind = kind ?? "unknown",
                detail = detail ?? "",
                value = value,
                occurredAt = DateTime.UtcNow.ToString("O")
            };
            if (_buildings.TryGetValue(buildingId ?? "", out var building))
                eventRecord.worldId = building.worldId;
            _state.consequences.Add(eventRecord);
            return eventRecord;
        }

        void GenerateRoomsAndObjects(WorldFabricBuildingRecord building, int seed)
        {
            var purpose = (building.purpose ?? "house").ToLowerInvariant();
            var roomCount = purpose.Contains("market") || purpose.Contains("shop") ? 3 : purpose.Contains("tavern") ? 5 : 2;
            for (var i = 0; i < roomCount; i++)
            {
                var roomPurpose = i == 0 ? purpose : purpose.Contains("market") ? "storage" : i == 1 ? "living" : "work";
                building.rooms.Add(new WorldFabricRoomRecord
                {
                    roomId = building.buildingId + "/room/" + i,
                    purpose = roomPurpose,
                    capacity = roomPurpose == "storage" ? 0f : 2f + (StableHash(building.buildingId + roomPurpose + seed) % 4)
                });
            }

            AddObject(building, "door", WorldFabricObjectKind.Furniture, "door", "entrance", "public", "wood", 0.9f, 0f,
                true, true, WorldFabricInteractionKind.Open, seed);
            AddObject(building, "table", WorldFabricObjectKind.Furniture, "table", "work surface", building.ownerId, "wood", 0.95f, 0f,
                true, true, WorldFabricInteractionKind.Inspect, seed + 1);

            if (purpose.Contains("market") || purpose.Contains("shop") || purpose.Contains("tavern"))
            {
                AddObject(building, "food-apple", WorldFabricObjectKind.Food, "apple", "food", building.ownerId, "organic", 0.9f, 1.2f,
                    true, true, WorldFabricInteractionKind.Take, seed + 2, quantity: 12);
                AddObject(building, "crate-0", WorldFabricObjectKind.Container, "crate", "storage", building.ownerId, "wood", 0.85f, 8f,
                    true, true, WorldFabricInteractionKind.Open, seed + 3);
                AddObject(building, "price-board", WorldFabricObjectKind.Book, "price-board", "commerce", building.ownerId, "wood", 0.92f, 0f,
                    true, false, WorldFabricInteractionKind.Read, seed + 4);
            }
            if (purpose.Contains("forge") || purpose.Contains("work") || purpose.Contains("workshop"))
            {
                AddObject(building, "tool-anvil", WorldFabricObjectKind.Tool, "anvil", "production", building.ownerId, "iron", 0.9f, 25f,
                    true, true, WorldFabricInteractionKind.Use, seed + 5);
                AddObject(building, "tool-hammer", WorldFabricObjectKind.Tool, "hammer", "production", building.ownerId, "iron", 0.88f, 6f,
                    true, true, WorldFabricInteractionKind.Take, seed + 6);
            }
            if (purpose.Contains("archive") || purpose.Contains("library"))
            {
                AddObject(building, "book-ledger", WorldFabricObjectKind.Book, "ledger", "knowledge", building.ownerId, "paper", 0.94f, 4f,
                    true, false, WorldFabricInteractionKind.Read, seed + 7);
                AddObject(building, "book-history", WorldFabricObjectKind.Book, "regional-history", "lore", building.ownerId, "paper", 0.92f, 12f,
                    true, false, WorldFabricInteractionKind.Read, seed + 8);
            }

            var wasteCount = Mathf.Max(1, StableHash(building.buildingId + ":waste:" + seed) % 3);
            for (var i = 0; i < wasteCount; i++)
                AddObject(building, "waste-" + i, WorldFabricObjectKind.Waste, "discarded-container", "waste", "public", "mixed", 0.35f, 0f,
                    false, false, WorldFabricInteractionKind.None, seed + 20 + i);
        }

        WorldFabricObjectRecord AddObject(
            WorldFabricBuildingRecord building,
            string suffix,
            WorldFabricObjectKind kind,
            string semanticId,
            string purpose,
            string ownerId,
            string material,
            float condition,
            float value,
            bool movable,
            bool interactive,
            WorldFabricInteractionKind interaction,
            int seed,
            int quantity = 1)
        {
            var objectId = building.buildingId + "/object/" + suffix;
            var record = new WorldFabricObjectRecord
            {
                objectId = objectId,
                kind = kind,
                semanticId = semanticId,
                displayName = SemanticName(semanticId),
                purpose = purpose,
                ownerId = ownerId ?? "public",
                material = material ?? "unknown",
                condition = Mathf.Clamp01(condition),
                value = Mathf.Max(0f, value),
                quantity = Mathf.Max(1, quantity),
                movable = movable,
                destructible = kind != WorldFabricObjectKind.Book,
                interactive = interactive,
                interaction = interaction,
                provenance = NewProvenance(objectId, building.worldId, building.regionId, building.cultureId, building.factionId,
                    building.buildingId, "object:" + semanticId + ":" + (seed & 31), null,
                    new[] { "WorldFabric", "WorldSystems", "PhysicalInteraction" })
            };
            record.containerId = building.buildingId;
            building.objects.Add(record);
            return record;
        }

        void IndexObjects(WorldFabricBuildingRecord building)
        {
            if (building.objects == null) building.objects = new List<WorldFabricObjectRecord>();
            for (var i = 0; i < building.objects.Count; i++)
            {
                var item = building.objects[i];
                if (item == null || string.IsNullOrEmpty(item.objectId)) continue;
                if (item.provenance == null) item.provenance = NewProvenance(item.objectId, building.worldId, building.regionId,
                    building.cultureId, building.factionId, building.buildingId, "restored", null, null);
                item.provenance.buildingId = building.buildingId;
                _objects[item.objectId] = item;
            }
        }

        static WorldFabricProvenance NewProvenance(
            string assetId,
            string worldId,
            string regionId,
            string cultureId,
            string factionId,
            string buildingId,
            string generationRule,
            IEnumerable<string> loreSources,
            IEnumerable<string> gameplayBindings)
        {
            var provenance = new WorldFabricProvenance
            {
                assetId = assetId ?? "",
                worldId = worldId ?? "Hub",
                regionId = regionId ?? "",
                cultureId = cultureId ?? "unassigned",
                factionId = factionId ?? "unassigned",
                buildingId = buildingId ?? "",
                generationRule = generationRule ?? "unknown"
            };
            AddRange(provenance.loreSources, loreSources);
            AddRange(provenance.gameplayBindings, gameplayBindings);
            return provenance;
        }

        static WorldFabricValidationIssue Issue(string severity, string code, string objectId, string buildingId, string detail)
        {
            return new WorldFabricValidationIssue
            {
                severity = severity,
                code = code,
                objectId = objectId ?? "",
                buildingId = buildingId ?? "",
                detail = detail ?? ""
            };
        }

        static string SemanticName(string semanticId)
        {
            if (string.IsNullOrEmpty(semanticId)) return "Object";
            var value = semanticId.Replace('-', ' ').Replace('_', ' ');
            return char.ToUpperInvariant(value[0]) + value.Substring(1);
        }

        static void AddRange(List<string> destination, IEnumerable<string> source)
        {
            if (destination == null || source == null) return;
            foreach (var value in source)
                if (!string.IsNullOrEmpty(value) && !destination.Contains(value)) destination.Add(value);
        }

        static int StableHash(string value)
        {
            unchecked
            {
                var hash = 23;
                if (!string.IsNullOrEmpty(value))
                    for (var i = 0; i < value.Length; i++) hash = hash * 31 + value[i];
                return hash & 0x7fffffff;
            }
        }
    }
}
