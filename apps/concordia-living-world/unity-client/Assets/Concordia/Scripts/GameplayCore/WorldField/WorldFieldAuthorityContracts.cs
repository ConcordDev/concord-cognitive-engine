using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.WorldField
{
    public enum WorldFieldDomain
    {
        Magic,
        Technology,
        Link,
        Network,
        Ecology,
        Mobility,
        Combat,
        Recovery,
        Safety
    }

    public enum WorldFieldContributionKind
    {
        WorldInfluence,
        HubLaw,
        Anchor,
        Region,
        Terrain,
        Connectivity,
        Biome,
        Temporal,
        LocalMagic,
        LocalTechnology,
        LocalLink,
        LocalNetwork,
        LocalEcology
    }

    [Serializable]
    public sealed class WorldFieldAnchor
    {
        public string anchorId;
        public WorldId world;
        public string regionId;
        public string kind;
        public Vector2 globalKm;
        public float radiusKm = 40f;
        public float weight = 1f;
        public float magic;
        public float technology;
        public float link;
        public float network;
        public float ecology;
        public bool active = true;
    }

    [Serializable]
    public sealed class WorldFieldRegionalModifier
    {
        public string regionId;
        public WorldId world;
        public Vector2 globalKm;
        public float radiusKm = 25f;
        public string terrainId;
        public string climateId;
        public float terrainAffinity = 0.5f;
        public float biomeAffinity = 0.5f;
        public float connectivity = 0.5f;
        public float magic;
        public float technology;
        public float link;
        public float network;
        public float ecology;
        public bool active = true;
    }

    [Serializable]
    public sealed class WorldFieldProfile
    {
        public WorldId world;
        public string stableId;
        public string displayName;
        public Vector2 centerKm;
        public float radiusKm = 410f;
        public float influenceWeight = 1f;
        public float magic = 0.5f;
        public float technology = 0.5f;
        public float link = 0.5f;
        public float network = 0.5f;
        public float ecology = 0.5f;
        public float mobility = 0.5f;
        public float combat = 0.5f;
        public float recovery = 0.5f;
        public float safety = 0.5f;
        public string terrainAffinity = "";
        public string biomeAffinity = "";
        public float temporalSensitivity = 0.1f;
    }

    [Serializable]
    public sealed class WorldFieldLocalModifiers
    {
        public float magic;
        public float technology;
        public float link;
        public float network;
        public float ecology;

        public static WorldFieldLocalModifiers Neutral()
        {
            return new WorldFieldLocalModifiers();
        }
    }

    [Serializable]
    public sealed class WorldFieldQuery
    {
        public WorldId world = WorldId.Hub;
        public Vector3 localPosition;
        public Vector2 globalKm;
        public bool hasGlobalPosition;
        public string regionId;
        public string terrainId;
        public string biomeId;
        public string[] terrainTags = Array.Empty<string>();
        public string[] biomeTags = Array.Empty<string>();
        public float terrainConnectivity = 0.5f;
        public float networkConnectivity = 0.5f;
        public float linkIntegrity = 0.5f;
        public float biomeAffinity = 0.5f;
        public float localMagicModifier;
        public float localTechnologyModifier;
        public float localLinkModifier;
        public float localNetworkModifier;
        public float localEcologyModifier;
        public long tick;
        public int day;
        public float hour;
        public int interpolationRadius = 1;

        public static WorldFieldQuery At(WorldId world, Vector3 localPosition)
        {
            return new WorldFieldQuery { world = world, localPosition = localPosition };
        }
    }

    [Serializable]
    public sealed class WorldFieldContribution
    {
        public string sourceId;
        public WorldId sourceWorld;
        public WorldFieldContributionKind kind;
        public WorldFieldDomain domain;
        public float rawWeight;
        public float normalizedWeight;
        public float value;
        public float signedEffect;
        public string explanation;

        public override string ToString()
        {
            return sourceId + " " + domain + " value=" + value.ToString("0.000")
                + " weight=" + normalizedWeight.ToString("0.000") + " " + explanation;
        }
    }

    [Serializable]
    public sealed class WorldFieldSnapshot
    {
        public int schemaVersion = 1;
        public Vector2 globalKm;
        public WorldId queriedWorld;
        public string cellId;
        public string dominantInfluence;
        public bool isHubCourt;
        public bool capabilitiesPreserved = true;
        public float magic;
        public float technology;
        public float link;
        public float network;
        public float ecology;
        public float mobility;
        public float combat;
        public float recovery;
        public float safety;
        public float resolutionMultiplier = 1f;
        public float terrainConnectivity;
        public float biomeAffinity;
        public float temporalModifier;
        public List<WorldFieldContribution> contributions = new List<WorldFieldContribution>();

        public float Domain(WorldFieldDomain domain)
        {
            switch (domain)
            {
                case WorldFieldDomain.Magic: return magic;
                case WorldFieldDomain.Technology: return technology;
                case WorldFieldDomain.Link: return link;
                case WorldFieldDomain.Network: return network;
                case WorldFieldDomain.Ecology: return ecology;
                case WorldFieldDomain.Mobility: return mobility;
                case WorldFieldDomain.Combat: return combat;
                case WorldFieldDomain.Recovery: return recovery;
                case WorldFieldDomain.Safety: return safety;
                default: return 0.5f;
            }
        }

        public bool CanResolve(string capabilityId)
        {
            return capabilitiesPreserved && !string.IsNullOrEmpty(capabilityId);
        }

        public string Explain(WorldFieldDomain domain)
        {
            var lines = new List<string>();
            for (var i = 0; i < contributions.Count; i++)
            {
                var item = contributions[i];
                if (item != null && item.domain == domain) lines.Add(item.explanation);
            }
            return string.Join("; ", lines.ToArray());
        }
    }

    [Serializable]
    public sealed class WorldFieldAuthoritySettings
    {
        public int schemaVersion = 1;
        public float cellSizeKm = 32f;
        public float blendSharpness = 8f;
        public float minimumResolutionMultiplier = 0.05f;
        public float hubCourtRadiusKm = 12f;
        public float hubMetroRadiusKm = 40f;
        public float interpolationEpsilon = 0.0001f;
    }
}
