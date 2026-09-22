using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace Concordia.GameplayCore.Fabrication
{
    /// <summary>
    /// JSON-safe persistence boundary for fabricated objects. It stores scalar IDs,
    /// strings, numbers and lists only; it has no Unity object references or maps.
    /// The existing ConcordiaPersistenceService may embed these DTOs later without
    /// this framework becoming an inventory or save authority.
    /// </summary>
    [Serializable]
    public sealed class FabricationPersistenceEnvelopeDto
    {
        public int schemaVersion = 1;
        public string savedAtUtc;
        public List<FabricationObjectPersistenceDto> objects = new List<FabricationObjectPersistenceDto>();
        public List<FabricationContainerPersistenceDto> containers = new List<FabricationContainerPersistenceDto>();
    }

    [Serializable]
    public sealed class FabricationObjectPersistenceDto
    {
        public int schemaVersion = 1;
        public string objectId;
        public string recipeId;
        public string displayName;
        public string domain;
        public string materialId;
        public string materialClass;
        public string shapeId;
        public string shapeKind;
        public string methodId;
        public string methodKind;
        public List<string> tags = new List<string>();
        public List<FabricationComponentPersistenceDto> components = new List<FabricationComponentPersistenceDto>();
        public List<FabricationPropertyPersistenceDto> properties = new List<FabricationPropertyPersistenceDto>();
        public List<FabricationContributionPersistenceDto> contributions = new List<FabricationContributionPersistenceDto>();
        public FabricationQualityPersistenceDto quality = new FabricationQualityPersistenceDto();
        public FabricationDurabilityPersistenceDto durability = new FabricationDurabilityPersistenceDto();
        public FabricationOwnershipPersistenceDto ownership = new FabricationOwnershipPersistenceDto();
        public FabricationContainerPersistenceDto container = new FabricationContainerPersistenceDto();
        public FabricationProvenancePersistenceDto provenance = new FabricationProvenancePersistenceDto();
    }

    [Serializable]
    public sealed class FabricationComponentPersistenceDto
    {
        public string componentId;
        public string displayName;
        public string role;
        public string sourceMaterialId;
        public int quantity;
        public List<FabricationPropertyPersistenceDto> properties = new List<FabricationPropertyPersistenceDto>();
        public List<FabricationContributionPersistenceDto> contributions = new List<FabricationContributionPersistenceDto>();
    }

    [Serializable]
    public sealed class FabricationPropertyPersistenceDto
    {
        public string propertyId;
        public string displayName;
        public string unit;
        public string kind;
        public float number;
        public int integer;
        public bool boolean;
        public string text;
        public string sourceStage;
        public string sourceId;
    }

    [Serializable]
    public sealed class FabricationContributionPersistenceDto
    {
        public string contributionId;
        public string statId;
        public float value;
        public string sourceStage;
        public string sourceId;
        public string reason;
    }

    [Serializable]
    public sealed class FabricationQualityPersistenceDto
    {
        public float score;
        public string grade;
        public List<FabricationContributionPersistenceDto> contributions = new List<FabricationContributionPersistenceDto>();
    }

    [Serializable]
    public sealed class FabricationDurabilityPersistenceDto
    {
        public float maximum;
        public float current;
        public float wearRate;
        public float repairability;
        public int repairCount;
        public bool broken;
        public string lastWearReason;
        public List<FabricationWearPersistenceDto> wearEvents = new List<FabricationWearPersistenceDto>();
    }

    [Serializable]
    public sealed class FabricationWearPersistenceDto
    {
        public string eventId;
        public string reason;
        public float amount;
        public float resultingDurability;
        public string actorId;
        public string occurredAtUtc;
    }

    [Serializable]
    public sealed class FabricationOwnershipPersistenceDto
    {
        public string ownerId;
        public string factionId;
        public int flags;
        public bool transferable;
        public string claimId;
        public string acquisitionReason;
    }

    [Serializable]
    public sealed class FabricationContainerPersistenceDto
    {
        public string containerId;
        public string parentContainerId;
        public string backingInventoryId;
        public string ownerId;
        public string slotId;
        public int capacity;
        public bool sealedContainer;
        public List<string> containedObjectIds = new List<string>();
    }

    [Serializable]
    public sealed class FabricationProvenancePersistenceDto
    {
        public string provenanceId;
        public string rootSourceId;
        public List<FabricationProvenanceLinkPersistenceDto> links = new List<FabricationProvenanceLinkPersistenceDto>();
    }

    [Serializable]
    public sealed class FabricationProvenanceLinkPersistenceDto
    {
        public string linkId;
        public string parentLinkId;
        public string stage;
        public string sourceId;
        public string actorId;
        public string locationId;
        public string occurredAtUtc;
        public string detail;
    }

    public static class FabricationPersistence
    {
        public const int CurrentSchemaVersion = 1;

        public static FabricationObjectPersistenceDto ToDto(FabricatedObjectRecord source)
        {
            if (source == null) return null;
            var dto = new FabricationObjectPersistenceDto
            {
                schemaVersion = source.schemaVersion,
                objectId = source.objectId,
                recipeId = source.recipeId,
                displayName = source.displayName,
                domain = source.domain.ToString(),
                materialId = source.materialId,
                materialClass = source.materialClass.ToString(),
                shapeId = source.shapeId,
                shapeKind = source.shapeKind.ToString(),
                methodId = source.methodId,
                methodKind = source.methodKind.ToString(),
                tags = CopyStrings(source.tags),
                quality = ToQualityDto(source.quality),
                durability = ToDurabilityDto(source.durability),
                ownership = ToOwnershipDto(source.ownership),
                container = ToContainerDto(source.container),
                provenance = ToProvenanceDto(source.provenance)
            };
            if (source.components != null) for (var i = 0; i < source.components.Count; i++) dto.components.Add(ToComponentDto(source.components[i]));
            if (source.properties != null) for (var i = 0; i < source.properties.Count; i++) dto.properties.Add(ToPropertyDto(source.properties[i]));
            if (source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) dto.contributions.Add(ToContributionDto(source.contributions[i]));
            return dto;
        }

        public static FabricatedObjectRecord FromDto(FabricationObjectPersistenceDto source)
        {
            if (source == null) return null;
            var result = new FabricatedObjectRecord
            {
                schemaVersion = source.schemaVersion <= 0 ? 1 : source.schemaVersion,
                objectId = source.objectId ?? "",
                recipeId = source.recipeId ?? "",
                displayName = source.displayName ?? "",
                domain = ParseEnum(source.domain, FabricationDomain.Universal),
                materialId = source.materialId ?? "",
                materialClass = ParseEnum(source.materialClass, FabricationMaterialClass.Unknown),
                shapeId = source.shapeId ?? "",
                shapeKind = ParseEnum(source.shapeKind, FabricationShapeKind.Custom),
                methodId = source.methodId ?? "",
                methodKind = ParseEnum(source.methodKind, FabricationMethodKind.Unknown),
                tags = CopyStrings(source.tags),
                quality = FromQualityDto(source.quality),
                durability = FromDurabilityDto(source.durability),
                ownership = FromOwnershipDto(source.ownership),
                container = FromContainerDto(source.container),
                provenance = FromProvenanceDto(source.provenance)
            };
            if (source.components != null) for (var i = 0; i < source.components.Count; i++) result.components.Add(FromComponentDto(source.components[i]));
            if (source.properties != null) for (var i = 0; i < source.properties.Count; i++) result.properties.Add(FromPropertyDto(source.properties[i]));
            if (source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) result.contributions.Add(FromContributionDto(source.contributions[i]));
            return result;
        }

        public static string ToJson(FabricationPersistenceEnvelopeDto source, bool prettyPrint = false)
        {
            return JsonUtility.ToJson(source ?? new FabricationPersistenceEnvelopeDto(), prettyPrint);
        }

        public static FabricationPersistenceEnvelopeDto FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var result = JsonUtility.FromJson<FabricationPersistenceEnvelopeDto>(json);
            if (result == null || result.schemaVersion <= 0 || result.schemaVersion > CurrentSchemaVersion) return null;
            if (result.objects == null) result.objects = new List<FabricationObjectPersistenceDto>();
            if (result.containers == null) result.containers = new List<FabricationContainerPersistenceDto>();
            return result;
        }

        static FabricationComponentPersistenceDto ToComponentDto(FabricationComponentSpec source)
        {
            if (source == null) return null;
            var dto = new FabricationComponentPersistenceDto { componentId = source.componentId, displayName = source.displayName, role = source.role, sourceMaterialId = source.sourceMaterialId, quantity = source.quantity };
            if (source.properties != null) for (var i = 0; i < source.properties.Count; i++) dto.properties.Add(ToPropertyDto(source.properties[i]));
            if (source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) dto.contributions.Add(ToContributionDto(source.contributions[i]));
            return dto;
        }

        static FabricationComponentSpec FromComponentDto(FabricationComponentPersistenceDto source)
        {
            if (source == null) return null;
            var result = new FabricationComponentSpec { componentId = source.componentId ?? "", displayName = source.displayName ?? "", role = source.role ?? "", sourceMaterialId = source.sourceMaterialId ?? "", quantity = source.quantity };
            if (source.properties != null) for (var i = 0; i < source.properties.Count; i++) result.properties.Add(FromPropertyDto(source.properties[i]));
            if (source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) result.contributions.Add(FromContributionDto(source.contributions[i]));
            return result;
        }

        static FabricationPropertyPersistenceDto ToPropertyDto(FabricationPropertyRecord source)
        {
            if (source == null) return null;
            var value = source.value ?? new FabricationPropertyValue();
            return new FabricationPropertyPersistenceDto { propertyId = source.propertyId, displayName = source.displayName, unit = source.unit, kind = value.kind.ToString(), number = value.number, integer = value.integer, boolean = value.boolean, text = value.text ?? "", sourceStage = source.sourceStage, sourceId = source.sourceId };
        }

        static FabricationPropertyRecord FromPropertyDto(FabricationPropertyPersistenceDto source)
        {
            if (source == null) return null;
            return new FabricationPropertyRecord { propertyId = source.propertyId ?? "", displayName = source.displayName ?? "", unit = source.unit ?? "", sourceStage = source.sourceStage ?? "", sourceId = source.sourceId ?? "", value = new FabricationPropertyValue { kind = ParseEnum(source.kind, FabricationPropertyValueKind.Number), number = source.number, integer = source.integer, boolean = source.boolean, text = source.text ?? "" } };
        }

        static FabricationContributionPersistenceDto ToContributionDto(FabricationStatContribution source)
        {
            if (source == null) return null;
            return new FabricationContributionPersistenceDto { contributionId = source.contributionId, statId = source.statId, value = source.value, sourceStage = source.sourceStage, sourceId = source.sourceId, reason = source.reason };
        }

        static FabricationStatContribution FromContributionDto(FabricationContributionPersistenceDto source)
        {
            if (source == null) return null;
            return new FabricationStatContribution { contributionId = source.contributionId ?? "", statId = source.statId ?? "", value = source.value, sourceStage = source.sourceStage ?? "", sourceId = source.sourceId ?? "", reason = source.reason ?? "" };
        }

        static FabricationQualityPersistenceDto ToQualityDto(FabricationQualityState source)
        {
            var dto = new FabricationQualityPersistenceDto { score = source == null ? 0f : source.score, grade = source == null ? FabricationQualityGrade.Standard.ToString() : source.grade.ToString() };
            if (source != null && source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) dto.contributions.Add(ToContributionDto(source.contributions[i]));
            return dto;
        }

        static FabricationQualityState FromQualityDto(FabricationQualityPersistenceDto source)
        {
            var result = new FabricationQualityState { score = source == null ? 0f : source.score, grade = ParseEnum(source == null ? "" : source.grade, FabricationQualityGrade.Standard) };
            if (source != null && source.contributions != null) for (var i = 0; i < source.contributions.Count; i++) result.contributions.Add(FromContributionDto(source.contributions[i]));
            return result;
        }

        static FabricationDurabilityPersistenceDto ToDurabilityDto(FabricationDurabilityState source)
        {
            var dto = new FabricationDurabilityPersistenceDto { maximum = source == null ? 0f : source.maximum, current = source == null ? 0f : source.current, wearRate = source == null ? 0f : source.wearRate, repairability = source == null ? 0f : source.repairability, repairCount = source == null ? 0 : source.repairCount, broken = source != null && source.broken, lastWearReason = source == null ? "" : source.lastWearReason };
            if (source != null && source.wearEvents != null) for (var i = 0; i < source.wearEvents.Count; i++)
            {
                var item = source.wearEvents[i];
                if (item == null) continue;
                dto.wearEvents.Add(new FabricationWearPersistenceDto { eventId = item.eventId, reason = item.reason, amount = item.amount, resultingDurability = item.resultingDurability, actorId = item.actorId, occurredAtUtc = item.occurredAtUtc });
            }
            return dto;
        }

        static FabricationDurabilityState FromDurabilityDto(FabricationDurabilityPersistenceDto source)
        {
            var result = new FabricationDurabilityState { maximum = source == null ? 0f : source.maximum, current = source == null ? 0f : source.current, wearRate = source == null ? 0f : source.wearRate, repairability = source == null ? 0f : source.repairability, repairCount = source == null ? 0 : source.repairCount, broken = source != null && source.broken, lastWearReason = source == null ? "" : source.lastWearReason };
            if (source != null && source.wearEvents != null) for (var i = 0; i < source.wearEvents.Count; i++)
            {
                var item = source.wearEvents[i];
                if (item == null) continue;
                result.wearEvents.Add(new FabricationWearEvent { eventId = item.eventId ?? "", reason = item.reason ?? "", amount = item.amount, resultingDurability = item.resultingDurability, actorId = item.actorId ?? "", occurredAtUtc = item.occurredAtUtc ?? "" });
            }
            return result;
        }

        static FabricationOwnershipPersistenceDto ToOwnershipDto(FabricationOwnershipContract source)
        {
            return new FabricationOwnershipPersistenceDto { ownerId = source == null ? "" : source.ownerId, factionId = source == null ? "" : source.factionId, flags = source == null ? 0 : (int)source.flags, transferable = source == null || source.transferable, claimId = source == null ? "" : source.claimId, acquisitionReason = source == null ? "" : source.acquisitionReason };
        }

        static FabricationOwnershipContract FromOwnershipDto(FabricationOwnershipPersistenceDto source)
        {
            return new FabricationOwnershipContract { ownerId = source == null ? "" : source.ownerId, factionId = source == null ? "" : source.factionId, flags = source == null ? FabricationOwnershipFlags.None : (FabricationOwnershipFlags)source.flags, transferable = source == null || source.transferable, claimId = source == null ? "" : source.claimId, acquisitionReason = source == null ? "" : source.acquisitionReason };
        }

        static FabricationContainerPersistenceDto ToContainerDto(FabricationContainerContract source)
        {
            return new FabricationContainerPersistenceDto { containerId = source == null ? "" : source.containerId, parentContainerId = source == null ? "" : source.parentContainerId, backingInventoryId = source == null ? "" : source.backingInventoryId, ownerId = source == null ? "" : source.ownerId, slotId = source == null ? "" : source.slotId, capacity = source == null ? 0 : source.capacity, sealedContainer = source != null && source.sealedContainer, containedObjectIds = CopyStrings(source == null ? null : source.containedObjectIds) };
        }

        static FabricationContainerContract FromContainerDto(FabricationContainerPersistenceDto source)
        {
            return new FabricationContainerContract { containerId = source == null ? "" : source.containerId, parentContainerId = source == null ? "" : source.parentContainerId, backingInventoryId = source == null ? "" : source.backingInventoryId, ownerId = source == null ? "" : source.ownerId, slotId = source == null ? "" : source.slotId, capacity = source == null ? 0 : source.capacity, sealedContainer = source != null && source.sealedContainer, containedObjectIds = CopyStrings(source == null ? null : source.containedObjectIds) };
        }

        static FabricationProvenancePersistenceDto ToProvenanceDto(FabricationProvenanceChain source)
        {
            var dto = new FabricationProvenancePersistenceDto { provenanceId = source == null ? "" : source.provenanceId, rootSourceId = source == null ? "" : source.rootSourceId };
            if (source != null && source.links != null) for (var i = 0; i < source.links.Count; i++)
            {
                var item = source.links[i];
                if (item == null) continue;
                dto.links.Add(new FabricationProvenanceLinkPersistenceDto { linkId = item.linkId, parentLinkId = item.parentLinkId, stage = item.stage, sourceId = item.sourceId, actorId = item.actorId, locationId = item.locationId, occurredAtUtc = item.occurredAtUtc, detail = item.detail });
            }
            return dto;
        }

        static FabricationProvenanceChain FromProvenanceDto(FabricationProvenancePersistenceDto source)
        {
            var result = new FabricationProvenanceChain { provenanceId = source == null ? "" : source.provenanceId, rootSourceId = source == null ? "" : source.rootSourceId };
            if (source != null && source.links != null) for (var i = 0; i < source.links.Count; i++)
            {
                var item = source.links[i];
                if (item == null) continue;
                result.links.Add(new FabricationProvenanceLink { linkId = item.linkId ?? "", parentLinkId = item.parentLinkId ?? "", stage = item.stage ?? "", sourceId = item.sourceId ?? "", actorId = item.actorId ?? "", locationId = item.locationId ?? "", occurredAtUtc = item.occurredAtUtc ?? "", detail = item.detail ?? "" });
            }
            return result;
        }

        static List<string> CopyStrings(List<string> source)
        {
            var result = new List<string>();
            if (source == null) return result;
            for (var i = 0; i < source.Count; i++) if (!string.IsNullOrEmpty(source[i]) && !result.Contains(source[i])) result.Add(source[i]);
            return result;
        }

        static T ParseEnum<T>(string value, T fallback) where T : struct
        {
            T parsed;
            return Enum.TryParse<T>(value ?? "", true, out parsed) ? parsed : fallback;
        }
    }
}
