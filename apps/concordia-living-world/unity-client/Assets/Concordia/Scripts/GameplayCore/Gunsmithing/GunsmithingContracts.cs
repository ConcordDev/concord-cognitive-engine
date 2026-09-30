using System;
using System.Collections.Generic;
using Concordia;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.WorldField;

namespace Concordia.GameplayCore.Gunsmithing
{
    public enum GunsmithingPartSlot { Receiver, Barrel, ChamberCaliber, Action, Magazine, Ammunition, Optic, Stock, Grip, MuzzleDevice, Attachment }

    [Serializable]
    public sealed class WeaponStatContributionDto
    {
        public float damage;
        public float muzzleVelocity;
        public float penetration;
        public float effectiveRange;
        public float accuracy;
        public float recoil;
        public float handling;
        public float heatPerShot;
        public float noise;
        public float reliability;
        public float magazineCapacity;
        public float rateOfFire;
        public float reloadTime;
        public float maintenance;
        public string reason;

        public WeaponStatContributionDto Copy()
        {
            return new WeaponStatContributionDto { damage = damage, muzzleVelocity = muzzleVelocity, penetration = penetration, effectiveRange = effectiveRange, accuracy = accuracy, recoil = recoil, handling = handling, heatPerShot = heatPerShot, noise = noise, reliability = reliability, magazineCapacity = magazineCapacity, rateOfFire = rateOfFire, reloadTime = reloadTime, maintenance = maintenance, reason = reason };
        }
    }

    [Serializable]
    public sealed class WeaponPartDto
    {
        public string partId;
        public string displayName;
        public GunsmithingPartSlot slot;
        public string fabricationObjectId;
        public string materialId;
        public string caliberId;
        public string actionId;
        public List<string> compatibilityTags = new List<string>();
        public WeaponStatContributionDto contribution = new WeaponStatContributionDto();
        public float quality = 0.5f;
        public float condition = 1f;

        public bool IsUsable()
        {
            return !string.IsNullOrEmpty(partId) && condition > 0f;
        }
    }

    [Serializable]
    public sealed class WeaponQualityDto
    {
        public float score = 0.5f;
        public FabricationQualityGrade grade = FabricationQualityGrade.Standard;
        public float reliabilityBonus;
        public float accuracyBonus;
        public float handlingBonus;
        public string inspectionId;
    }

    [Serializable]
    public sealed class WeaponWearStateDto
    {
        public float maximumDurability = 100f;
        public float currentDurability = 100f;
        public float fouling;
        public float heat;
        public int shotsFired;
        public int misfireCount;
        public int repairCount;
        public string lastMaintenanceAtUtc;
        public string lastWearReason;
        public List<WeaponWearEventDto> events = new List<WeaponWearEventDto>();

        public float WearFraction()
        {
            if (maximumDurability <= 0f) return 1f;
            return Clamp01(1f - currentDurability / maximumDurability);
        }

        static float Clamp01(float value) { return value < 0f ? 0f : value > 1f ? 1f : value; }
    }

    [Serializable]
    public sealed class WeaponWearEventDto
    {
        public string eventId;
        public string reason;
        public float durabilityDelta;
        public float foulingDelta;
        public float resultingDurability;
        public string actorId;
        public string occurredAtUtc;
    }

    [Serializable]
    public sealed class WeaponReliabilityDto
    {
        public float baseReliability = 0.9f;
        public float wearSensitivity = 0.5f;
        public float foulingSensitivity = 0.25f;
        public float heatSensitivity = 0.15f;
        public float maintenanceEffect = 0.25f;
        public float minimumFireReliability = 0.05f;
    }

    [Serializable]
    public sealed class WeaponMaintenanceDto
    {
        public float maintenanceQuality = 0.5f;
        public float repairability = 1f;
        public float cleanAmount = 0.25f;
        public float repairAmount = 10f;
        public string maintenanceProfileId;
    }

    [Serializable]
    public sealed class WeaponConfigurationDto
    {
        public int schemaVersion = 1;
        public string weaponTemplateId;
        public string displayName;
        public string recipeId;
        public string sourceFabricationObjectId;
        public FabricationDomain fabricationDomain = FabricationDomain.Weapon;
        public string ownerId;
        public WorldId originWorld = WorldId.Hub;
        public WeaponPartDto receiver = new WeaponPartDto { slot = GunsmithingPartSlot.Receiver };
        public WeaponPartDto barrel = new WeaponPartDto { slot = GunsmithingPartSlot.Barrel };
        public WeaponPartDto chamberCaliber = new WeaponPartDto { slot = GunsmithingPartSlot.ChamberCaliber };
        public WeaponPartDto action = new WeaponPartDto { slot = GunsmithingPartSlot.Action };
        public WeaponPartDto magazine = new WeaponPartDto { slot = GunsmithingPartSlot.Magazine };
        public WeaponPartDto ammunition = new WeaponPartDto { slot = GunsmithingPartSlot.Ammunition };
        public WeaponPartDto optic = new WeaponPartDto { slot = GunsmithingPartSlot.Optic };
        public WeaponPartDto stock = new WeaponPartDto { slot = GunsmithingPartSlot.Stock };
        public WeaponPartDto grip = new WeaponPartDto { slot = GunsmithingPartSlot.Grip };
        public WeaponPartDto muzzleDevice = new WeaponPartDto { slot = GunsmithingPartSlot.MuzzleDevice };
        public List<WeaponPartDto> attachments = new List<WeaponPartDto>();
        public WeaponQualityDto quality = new WeaponQualityDto();
        public WeaponWearStateDto wear = new WeaponWearStateDto();
        public WeaponReliabilityDto reliability = new WeaponReliabilityDto();
        public WeaponMaintenanceDto maintenance = new WeaponMaintenanceDto();
        public List<string> tags = new List<string>();
    }

    [Serializable]
    public sealed class WeaponProvenanceLinkDto
    {
        public string linkId;
        public string parentLinkId;
        public string stage;
        public string sourceId;
        public string fabricationObjectId;
        public string actorId;
        public string worldId;
        public string locationId;
        public string occurredAtUtc;
        public string detail;
    }

    [Serializable]
    public sealed class WeaponProvenanceChainDto
    {
        public string provenanceId;
        public string rootFabricationObjectId;
        public List<WeaponProvenanceLinkDto> links = new List<WeaponProvenanceLinkDto>();
    }

    [Serializable]
    public sealed class WeaponResolvedStatsDto
    {
        public float damage;
        public float muzzleVelocity;
        public float penetration;
        public float effectiveRange;
        public float accuracy;
        public float recoil;
        public float handling;
        public float heatPerShot;
        public float noise;
        public float reliability;
        public float magazineCapacity;
        public float rateOfFire;
        public float reloadTime;
        public float maintenance;
        public List<WeaponResolutionContributionDto> explanations = new List<WeaponResolutionContributionDto>();
    }

    [Serializable]
    public sealed class WeaponResolutionContributionDto
    {
        public string statId;
        public float value;
        public string sourceId;
        public string stage;
        public string reason;
    }

    [Serializable]
    public sealed class WeaponEnvironmentalModifierDto
    {
        public WorldId targetWorld;
        public bool foreignWorld;
        public float resolutionMultiplier = 1f;
        public float accuracyMultiplier = 1f;
        public float reliabilityMultiplier = 1f;
        public float recoilMultiplier = 1f;
        public float heatMultiplier = 1f;
        public float noiseMultiplier = 1f;
        public float rangeMultiplier = 1f;
        public string dominantInfluence;
        public List<string> explanations = new List<string>();
    }

    [Serializable]
    public sealed class ComposedWeaponRecord
    {
        public int schemaVersion = 1;
        public string persistentWeaponId;
        public WeaponConfigurationDto configuration = new WeaponConfigurationDto();
        public WeaponProvenanceChainDto provenance = new WeaponProvenanceChainDto();
        public WeaponResolvedStatsDto lastResolvedStats = new WeaponResolvedStatsDto();
        public WeaponEnvironmentalModifierDto lastEnvironment = new WeaponEnvironmentalModifierDto();
        public string composedAtUtc;
    }

    [Serializable]
    public sealed class WeaponCompositionContext
    {
        public string instanceId;
        public string actorId;
        public string locationId;
        public string createdAtUtc;
        public string sourceWorldId;
    }

    [Serializable]
    public sealed class WeaponWorldContext
    {
        public WorldFieldQuery query;
        public WorldFieldSnapshot snapshot;
    }

    [Serializable]
    public sealed class WeaponFireRequest
    {
        public string actorId;
        public string ammunitionId;
        public int ammunitionAvailable = 1;
        public bool chambered = true;
        public bool operatorAuthorized = true;
        public float currentHeat;
        public float heatLimit = 100f;
        public WeaponWorldContext world = new WeaponWorldContext();
    }

    [Serializable]
    public sealed class WeaponEligibilityReason
    {
        public string code;
        public string severity;
        public string detail;

        public override string ToString() { return severity + " " + code + ": " + detail; }
    }

    [Serializable]
    public sealed class WeaponFireEligibilityDto
    {
        public bool canFire;
        public bool foreignWorldUse;
        public string persistentWeaponId;
        public string reasonCode;
        public string provenanceId;
        public WeaponEnvironmentalModifierDto environment = new WeaponEnvironmentalModifierDto();
        public WeaponResolvedStatsDto resolvedStats = new WeaponResolvedStatsDto();
        public List<WeaponEligibilityReason> reasons = new List<WeaponEligibilityReason>();
    }

    [Serializable]
    public sealed class GunsmithingValidationIssue
    {
        public string severity;
        public string code;
        public string path;
        public string detail;

        public override string ToString() { return severity + " " + code + " " + path + ": " + detail; }
    }

    [Serializable]
    public sealed class WeaponCompositionResult
    {
        public bool success;
        public string message;
        public ComposedWeaponRecord weapon;
        public List<GunsmithingValidationIssue> issues = new List<GunsmithingValidationIssue>();

        public static WeaponCompositionResult Fail(string message, List<GunsmithingValidationIssue> issues)
        {
            return new WeaponCompositionResult { success = false, message = message ?? "Weapon composition failed.", issues = issues ?? new List<GunsmithingValidationIssue>() };
        }
    }
}
