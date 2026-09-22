using System;
using System.Collections.Generic;

namespace Concordia.GameplayCore.Fabrication
{
    public enum FabricationDomain
    {
        Universal,
        Weapon,
        Armor,
        Tool,
        Furniture,
        Vehicle,
        MagicalArtifact,
        CyberEquipment,
        BuildingComponent
    }

    public enum FabricationMaterialClass
    {
        Unknown,
        Metal,
        Wood,
        Stone,
        Ceramic,
        Textile,
        Leather,
        Glass,
        Organic,
        Composite,
        Crystal,
        Polymer,
        Electronics,
        Arcane,
        Concrete,
        BioMaterial
    }

    public enum FabricationShapeKind
    {
        Custom,
        Blade,
        Plate,
        Beam,
        Vessel,
        Mechanism,
        Framework,
        Garment,
        Module,
        Component,
        Ornament,
        Structure
    }

    public enum FabricationMethodKind
    {
        Unknown,
        Forged,
        Cast,
        Carved,
        Woven,
        Sewn,
        Machined,
        Printed,
        Assembled,
        Enchanted,
        Grown,
        Modular,
        Bonded,
        Programmed
    }

    public enum FabricationQualityGrade
    {
        Damaged,
        Poor,
        Standard,
        Fine,
        Superior,
        Masterwork,
        Exceptional
    }

    public enum FabricationPropertyValueKind
    {
        Number,
        Text,
        Boolean,
        Integer
    }

    [Flags]
    public enum FabricationOwnershipFlags
    {
        None = 0,
        Owned = 1,
        Contraband = 2,
        Sacred = 4,
        Communal = 8,
        QuestBound = 16,
        Stolen = 32,
        Seized = 64,
        TransferRestricted = 128
    }

    [Serializable]
    public sealed class FabricationPropertyValue
    {
        public FabricationPropertyValueKind kind = FabricationPropertyValueKind.Number;
        public float number;
        public int integer;
        public bool boolean;
        public string text = "";

        public static FabricationPropertyValue Number(float value)
        {
            return new FabricationPropertyValue { kind = FabricationPropertyValueKind.Number, number = value };
        }

        public static FabricationPropertyValue Integer(int value)
        {
            return new FabricationPropertyValue { kind = FabricationPropertyValueKind.Integer, integer = value };
        }

        public static FabricationPropertyValue Text(string value)
        {
            return new FabricationPropertyValue { kind = FabricationPropertyValueKind.Text, text = value ?? "" };
        }

        public static FabricationPropertyValue Boolean(bool value)
        {
            return new FabricationPropertyValue { kind = FabricationPropertyValueKind.Boolean, boolean = value };
        }
    }

    [Serializable]
    public sealed class FabricationPropertyRecord
    {
        public string propertyId;
        public string displayName;
        public string unit;
        public FabricationPropertyValue value = new FabricationPropertyValue();
        public string sourceStage;
        public string sourceId;
    }

    [Serializable]
    public sealed class FabricationStatContribution
    {
        public string contributionId;
        public string statId;
        public float value;
        public string sourceStage;
        public string sourceId;
        public string reason;
    }

    [Serializable]
    public sealed class FabricationMaterialSpec
    {
        public string materialId;
        public string displayName;
        public FabricationMaterialClass materialClass = FabricationMaterialClass.Unknown;
        public float purity = 1f;
        public float density = 1f;
        public float baseQuality = 0.5f;
        public List<string> tags = new List<string>();
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationShapeSpec
    {
        public string shapeId;
        public string displayName;
        public FabricationShapeKind kind = FabricationShapeKind.Custom;
        public float scale = 1f;
        public float complexity;
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationMethodSpec
    {
        public string methodId;
        public string displayName;
        public FabricationMethodKind kind = FabricationMethodKind.Unknown;
        public float qualityModifier;
        public float durabilityModifier = 1f;
        public List<string> tags = new List<string>();
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationComponentSpec
    {
        public string componentId;
        public string displayName;
        public string role;
        public string sourceMaterialId;
        public int quantity = 1;
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationQualitySpec
    {
        public float baseScore = 0.5f;
        public float materialWeight = 0.4f;
        public float methodWeight = 0.3f;
        public float inspectionBonus;
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationDurabilitySpec
    {
        public float maximum = 100f;
        public float initialPercent = 1f;
        public float wearRate = 1f;
        public float repairability = 1f;
    }

    [Serializable]
    public sealed class FabricationOwnershipContract
    {
        public string ownerId;
        public string factionId;
        public FabricationOwnershipFlags flags;
        public bool transferable = true;
        public string claimId;
        public string acquisitionReason;
    }

    [Serializable]
    public sealed class FabricationContainerContract
    {
        public string containerId;
        public string parentContainerId;
        public string backingInventoryId;
        public string ownerId;
        public string slotId;
        public int capacity = 1;
        public bool sealedContainer;
        public List<string> containedObjectIds = new List<string>();
    }

    [Serializable]
    public sealed class FabricationProvenanceLink
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

    [Serializable]
    public sealed class FabricationProvenanceChain
    {
        public string provenanceId;
        public string rootSourceId;
        public List<FabricationProvenanceLink> links = new List<FabricationProvenanceLink>();
    }

    [Serializable]
    public sealed class FabricationWearEvent
    {
        public string eventId;
        public string reason;
        public float amount;
        public float resultingDurability;
        public string actorId;
        public string occurredAtUtc;
    }

    [Serializable]
    public sealed class FabricationDurabilityState
    {
        public float maximum = 100f;
        public float current = 100f;
        public float wearRate = 1f;
        public float repairability = 1f;
        public int repairCount;
        public bool broken;
        public string lastWearReason;
        public List<FabricationWearEvent> wearEvents = new List<FabricationWearEvent>();
    }

    [Serializable]
    public sealed class FabricationQualityState
    {
        public float score;
        public FabricationQualityGrade grade = FabricationQualityGrade.Standard;
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
    }

    [Serializable]
    public sealed class FabricationRecipeContract
    {
        public string recipeId;
        public string displayName;
        public FabricationDomain domain = FabricationDomain.Universal;
        public FabricationMaterialSpec material = new FabricationMaterialSpec();
        public FabricationShapeSpec shape = new FabricationShapeSpec();
        public FabricationMethodSpec method = new FabricationMethodSpec();
        public List<FabricationComponentSpec> components = new List<FabricationComponentSpec>();
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public FabricationQualitySpec quality = new FabricationQualitySpec();
        public FabricationDurabilitySpec durability = new FabricationDurabilitySpec();
        public List<string> tags = new List<string>();
    }

    [Serializable]
    public sealed class FabricationCompositionContext
    {
        public string instanceId;
        public string actorId;
        public string ownerId;
        public string factionId;
        public string sourceLocationId;
        public string containerId;
        public string createdAtUtc;
        public float inspectionBonus;
    }

    [Serializable]
    public sealed class FabricatedObjectRecord
    {
        public int schemaVersion = 1;
        public string objectId;
        public string recipeId;
        public string displayName;
        public FabricationDomain domain = FabricationDomain.Universal;
        public string materialId;
        public FabricationMaterialClass materialClass = FabricationMaterialClass.Unknown;
        public string shapeId;
        public FabricationShapeKind shapeKind = FabricationShapeKind.Custom;
        public string methodId;
        public FabricationMethodKind methodKind = FabricationMethodKind.Unknown;
        public List<string> tags = new List<string>();
        public List<FabricationComponentSpec> components = new List<FabricationComponentSpec>();
        public List<FabricationPropertyRecord> properties = new List<FabricationPropertyRecord>();
        public List<FabricationStatContribution> contributions = new List<FabricationStatContribution>();
        public FabricationQualityState quality = new FabricationQualityState();
        public FabricationDurabilityState durability = new FabricationDurabilityState();
        public FabricationOwnershipContract ownership = new FabricationOwnershipContract();
        public FabricationContainerContract container = new FabricationContainerContract();
        public FabricationProvenanceChain provenance = new FabricationProvenanceChain();
    }

    [Serializable]
    public sealed class FabricationValidationIssue
    {
        public string severity;
        public string code;
        public string path;
        public string detail;

        public override string ToString()
        {
            return severity + " " + code + " " + path + ": " + detail;
        }
    }

    [Serializable]
    public sealed class FabricationCompositionResult
    {
        public bool success;
        public string message;
        public FabricatedObjectRecord fabricatedObject;
        public List<FabricationValidationIssue> issues = new List<FabricationValidationIssue>();

        public static FabricationCompositionResult Fail(string message, List<FabricationValidationIssue> issues)
        {
            return new FabricationCompositionResult { success = false, message = message ?? "Fabrication failed.", issues = issues ?? new List<FabricationValidationIssue>() };
        }
    }
}
