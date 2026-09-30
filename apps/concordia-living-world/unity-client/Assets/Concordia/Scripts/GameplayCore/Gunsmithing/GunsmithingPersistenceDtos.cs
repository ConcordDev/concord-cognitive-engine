using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.Gunsmithing
{
    [Serializable]
    public sealed class GunsmithingPersistenceEnvelopeDto
    {
        public int schemaVersion = 1;
        public string savedAtUtc;
        public List<WeaponPersistenceDto> weapons = new List<WeaponPersistenceDto>();
    }

    /// <summary>JSON-safe save DTO. It contains no Unity object references or runtime authorities.</summary>
    [Serializable]
    public sealed class WeaponPersistenceDto
    {
        public int schemaVersion = 1;
        public string persistentWeaponId;
        public WeaponConfigurationDto configuration = new WeaponConfigurationDto();
        public WeaponProvenanceChainDto provenance = new WeaponProvenanceChainDto();
        public WeaponResolvedStatsDto lastResolvedStats = new WeaponResolvedStatsDto();
        public WeaponEnvironmentalModifierDto lastEnvironment = new WeaponEnvironmentalModifierDto();
        public string composedAtUtc;
    }

    public static class GunsmithingPersistence
    {
        public const int CurrentSchemaVersion = 1;

        public static WeaponPersistenceDto ToDto(ComposedWeaponRecord source)
        {
            if (source == null) return null;
            return new WeaponPersistenceDto
            {
                schemaVersion = source.schemaVersion <= 0 ? CurrentSchemaVersion : source.schemaVersion,
                persistentWeaponId = source.persistentWeaponId ?? "",
                configuration = source.configuration ?? new WeaponConfigurationDto(),
                provenance = source.provenance ?? new WeaponProvenanceChainDto(),
                lastResolvedStats = source.lastResolvedStats ?? new WeaponResolvedStatsDto(),
                lastEnvironment = source.lastEnvironment ?? new WeaponEnvironmentalModifierDto(),
                composedAtUtc = source.composedAtUtc ?? ""
            };
        }

        public static ComposedWeaponRecord FromDto(WeaponPersistenceDto source)
        {
            if (source == null || source.schemaVersion <= 0 || source.schemaVersion > CurrentSchemaVersion) return null;
            var result = new ComposedWeaponRecord
            {
                schemaVersion = source.schemaVersion,
                persistentWeaponId = source.persistentWeaponId ?? "",
                configuration = source.configuration ?? new WeaponConfigurationDto(),
                provenance = source.provenance ?? new WeaponProvenanceChainDto(),
                lastResolvedStats = source.lastResolvedStats ?? new WeaponResolvedStatsDto(),
                lastEnvironment = source.lastEnvironment ?? new WeaponEnvironmentalModifierDto(),
                composedAtUtc = source.composedAtUtc ?? ""
            };
            if (result.configuration.attachments == null) result.configuration.attachments = new List<WeaponPartDto>();
            if (result.configuration.tags == null) result.configuration.tags = new List<string>();
            if (result.configuration.wear != null && result.configuration.wear.events == null) result.configuration.wear.events = new List<WeaponWearEventDto>();
            if (result.provenance.links == null) result.provenance.links = new List<WeaponProvenanceLinkDto>();
            if (result.lastResolvedStats.explanations == null) result.lastResolvedStats.explanations = new List<WeaponResolutionContributionDto>();
            if (result.lastEnvironment.explanations == null) result.lastEnvironment.explanations = new List<string>();
            return result;
        }

        public static string ToJson(GunsmithingPersistenceEnvelopeDto source, bool prettyPrint = false)
        {
            return JsonUtility.ToJson(source ?? new GunsmithingPersistenceEnvelopeDto(), prettyPrint);
        }

        public static GunsmithingPersistenceEnvelopeDto FromJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var result = JsonUtility.FromJson<GunsmithingPersistenceEnvelopeDto>(json);
            if (result == null || result.schemaVersion <= 0 || result.schemaVersion > CurrentSchemaVersion) return null;
            if (result.weapons == null) result.weapons = new List<WeaponPersistenceDto>();
            return result;
        }
    }
}
