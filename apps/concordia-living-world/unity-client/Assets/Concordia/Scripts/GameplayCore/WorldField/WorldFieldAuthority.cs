using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.GameplayCore.WorldField
{
    /// <summary>
    /// Additive, deterministic field authority. It resolves conditions for an
    /// existing world; it never owns a scene, rendering, spawning, or capability
    /// registry. All output is serializable and explainable.
    /// </summary>
    public sealed class WorldFieldAuthority
    {
        public const int DomainCount = 9;
        readonly WorldFieldAuthoritySettings settings;
        readonly WorldFieldCellCache cache;

        public WorldFieldAuthority(WorldFieldAuthoritySettings settings = null)
        {
            this.settings = settings ?? new WorldFieldAuthoritySettings();
            cache = new WorldFieldCellCache(this.settings.cellSizeKm);
            WorldFieldAuthorityProfiles.EnsureBuilt();
        }

        public WorldFieldAuthoritySettings Settings { get { return settings; } }
        public int CachedCellCount { get { return cache.Count; } }
        public void ClearCache() { cache.Clear(); }

        public WorldFieldSnapshot Evaluate(WorldFieldQuery query)
        {
            if (query == null) query = new WorldFieldQuery();
            var global = ResolveGlobalPosition(query);
            var key = cache.Key(global);
            var origin = cache.Origin(key);
            var tx = Mathf.Clamp01((global.x - origin.x) / cache.CellSizeKm);
            var tz = Mathf.Clamp01((global.y - origin.y) / cache.CellSizeKm);
            var c00 = cache.GetOrAdd(key, p => EvaluateRaw(query, p));
            var c10 = cache.GetOrAdd(new WorldFieldCellKey(key.x + 1, key.z), p => EvaluateRaw(query, p));
            var c01 = cache.GetOrAdd(new WorldFieldCellKey(key.x, key.z + 1), p => EvaluateRaw(query, p));
            var c11 = cache.GetOrAdd(new WorldFieldCellKey(key.x + 1, key.z + 1), p => EvaluateRaw(query, p));
            return Interpolate(query, global, key, tx, tz, c00, c10, c01, c11);
        }

        public WorldFieldSnapshot Evaluate(WorldId world, Vector3 localPosition)
        {
            return Evaluate(WorldFieldQuery.At(world, localPosition));
        }

        public WorldFieldSnapshot EvaluateGlobal(WorldId world, Vector2 globalKm)
        {
            return Evaluate(new WorldFieldQuery { world = world, globalKm = globalKm, hasGlobalPosition = true });
        }

        public WorldFieldSnapshot EvaluateResolution(WorldFieldQuery query)
        {
            return Evaluate(query);
        }

        Vector2 ResolveGlobalPosition(WorldFieldQuery query)
        {
            if (query.hasGlobalPosition) return query.globalKm;
            return global::Concordia.WorldField.LocalToMegaworld(query.world, query.localPosition.x, query.localPosition.z);
        }

        WorldFieldRawSample EvaluateRaw(WorldFieldQuery query, Vector2 global)
        {
            var sample = new WorldFieldRawSample { globalKm = global, values = new float[DomainCount] };
            var influences = new List<Influence>(10);
            var total = 0f;
            var dominantWeight = -1f;
            var dominant = "hub";
            foreach (WorldId world in Enum.GetValues(typeof(WorldId)))
            {
                var profile = WorldFieldAuthorityProfiles.Get(world);
                var distance = Vector2.Distance(global, profile.centerKm);
                var radius = Mathf.Max(0.001f, profile.radiusKm);
                var spatial = Mathf.Exp(-Mathf.Pow(distance / radius, 2f));
                var weight = Mathf.Pow(Mathf.Max(0.0001f, spatial * profile.influenceWeight), settings.blendSharpness);
                if (world == WorldId.Hub)
                    weight = HubWeight(distance);
                influences.Add(new Influence { profile = profile, weight = weight });
                total += weight;
                if (weight > dominantWeight) { dominantWeight = weight; dominant = profile.stableId; }
            }

            var region = FindRegion(query, global);
            var anchor = FindAnchor(global);
            var terrain = TerrainModifier(query, region);
            var biome = BiomeModifier(query, region);
            var connectivity = ConnectivityModifier(query, region);
            var temporal = TemporalModifier(query);
            sample.dominantInfluence = dominant;
            sample.isHubCourt = IsHubCourt(global);
            sample.terrainConnectivity = connectivity;
            sample.biomeAffinity = biome;
            sample.temporalModifier = temporal;

            for (var d = 0; d < DomainCount; d++)
            {
                var weighted = 0f;
                for (var i = 0; i < influences.Count; i++) weighted += influences[i].weight * ProfileValue(influences[i].profile, d);
                var value = total > settings.interpolationEpsilon ? weighted / total : 0.5f;
                value += (terrain - 0.5f) * 0.10f + (biome - 0.5f) * 0.10f + (connectivity - 0.5f) * 0.08f;
                value += (temporal - 0.5f) * 0.08f;
                if (anchor != null) value = Mathf.Lerp(value, AnchorValue(anchor, d), Mathf.Clamp01(anchor.weight * AnchorFalloff(anchor, global)) * 0.35f);
                sample.values[d] = Mathf.Clamp01(value);
            }

            AddInfluenceContributions(sample, influences, total);
            AddModifierContribution(sample, "terrain", WorldFieldContributionKind.Terrain, WorldFieldDomain.Mobility, terrain - 0.5f, "Terrain connectivity modifies traversal conditions without removing traversal.");
            AddModifierContribution(sample, "biome", WorldFieldContributionKind.Biome, WorldFieldDomain.Ecology, biome - 0.5f, "Biome affinity modifies ecology conditions without deleting habitats.");
            AddModifierContribution(sample, "temporal", WorldFieldContributionKind.Temporal, WorldFieldDomain.Recovery, temporal - 0.5f, "Deterministic day/tick phase modifies recovery conditions.");
            if (region != null)
                AddModifierContribution(sample, "region/" + region.regionId, WorldFieldContributionKind.Region, WorldFieldDomain.Link, region.connectivity - 0.5f, "Canonical geography region contributes local link continuity.");
            if (anchor != null)
                AddModifierContribution(sample, anchor.anchorId, WorldFieldContributionKind.Anchor, WorldFieldDomain.Network, AnchorFalloff(anchor, global) * 0.5f, "Canonical anchor contributes a bounded regional field.");
            return sample;
        }

        WorldFieldSnapshot Interpolate(WorldFieldQuery query, Vector2 global, WorldFieldCellKey key, float tx, float tz,
            WorldFieldRawSample c00, WorldFieldRawSample c10, WorldFieldRawSample c01, WorldFieldRawSample c11)
        {
            var snapshot = new WorldFieldSnapshot
            {
                globalKm = global,
                queriedWorld = query.world,
                cellId = key.ToString(),
                dominantInfluence = Dominant(c00, c10, c01, c11, tx, tz),
                isHubCourt = IsHubCourt(global),
                terrainConnectivity = Bilinear(c00.terrainConnectivity, c10.terrainConnectivity, c01.terrainConnectivity, c11.terrainConnectivity, tx, tz),
                biomeAffinity = Bilinear(c00.biomeAffinity, c10.biomeAffinity, c01.biomeAffinity, c11.biomeAffinity, tx, tz),
                temporalModifier = Bilinear(c00.temporalModifier, c10.temporalModifier, c01.temporalModifier, c11.temporalModifier, tx, tz)
            };
            for (var d = 0; d < DomainCount; d++)
            {
                var value = Bilinear(c00.values[d], c10.values[d], c01.values[d], c11.values[d], tx, tz);
                value = ApplyQueryModifier(value, query, (WorldFieldDomain)d);
                SetDomain(snapshot, (WorldFieldDomain)d, value);
            }
            snapshot.resolutionMultiplier = ComputeResolution(snapshot);
            snapshot.capabilitiesPreserved = true;
            MergeContributions(snapshot, c00, c10, c01, c11, tx, tz);
            AddLocalContributions(snapshot, query);
            return snapshot;
        }

        void AddInfluenceContributions(WorldFieldRawSample sample, List<Influence> influences, float total)
        {
            for (var i = 0; i < influences.Count; i++)
            {
                var influence = influences[i];
                var weight = total > settings.interpolationEpsilon ? influence.weight / total : 0f;
                sample.contributions.Add(new WorldFieldContribution
                {
                    sourceId = "world/" + influence.profile.stableId,
                    sourceWorld = influence.profile.world,
                    kind = influence.profile.world == WorldId.Hub ? WorldFieldContributionKind.HubLaw : WorldFieldContributionKind.WorldInfluence,
                    domain = WorldFieldDomain.Link,
                    rawWeight = influence.weight,
                    normalizedWeight = weight,
                    value = influence.profile.link,
                    signedEffect = (influence.profile.link - 0.5f) * weight,
                    explanation = influence.profile.displayName + " contributes " + weight.ToString("0.000") + " of the normalized spatial blend."
                });
            }
        }

        void MergeContributions(WorldFieldSnapshot target, params object[] ignored)
        {
            // Overload body is replaced by the typed helper below; this signature keeps
            // interpolation call sites simple for Unity's older C# compiler.
        }

        void MergeContributions(WorldFieldSnapshot target, WorldFieldRawSample c00, WorldFieldRawSample c10,
            WorldFieldRawSample c01, WorldFieldRawSample c11, float tx, float tz)
        {
            var map = new Dictionary<string, WorldFieldContribution>(StringComparer.Ordinal);
            AddCorner(map, c00, (1f - tx) * (1f - tz));
            AddCorner(map, c10, tx * (1f - tz));
            AddCorner(map, c01, (1f - tx) * tz);
            AddCorner(map, c11, tx * tz);
            foreach (var item in map.Values) target.contributions.Add(item);
            target.contributions.Sort((a, b) => string.CompareOrdinal(a.sourceId, b.sourceId));
        }

        void AddCorner(Dictionary<string, WorldFieldContribution> map, WorldFieldRawSample sample, float cornerWeight)
        {
            for (var i = 0; i < sample.contributions.Count; i++)
            {
                var source = sample.contributions[i];
                if (source == null) continue;
                WorldFieldContribution result;
                if (!map.TryGetValue(source.sourceId, out result))
                {
                    result = new WorldFieldContribution
                    {
                        sourceId = source.sourceId,
                        sourceWorld = source.sourceWorld,
                        kind = source.kind,
                        domain = source.domain,
                        explanation = source.explanation
                    };
                    map[source.sourceId] = result;
                }
                result.rawWeight += source.rawWeight * cornerWeight;
                result.normalizedWeight += source.normalizedWeight * cornerWeight;
                result.value += source.value * cornerWeight;
                result.signedEffect += source.signedEffect * cornerWeight;
            }
        }

        void AddLocalContributions(WorldFieldSnapshot snapshot, WorldFieldQuery query)
        {
            AddSnapshotContribution(snapshot, "local/magic", WorldFieldContributionKind.LocalMagic, WorldFieldDomain.Magic, query.localMagicModifier, "Local magic modifier changes resolution conditions only.");
            AddSnapshotContribution(snapshot, "local/technology", WorldFieldContributionKind.LocalTechnology, WorldFieldDomain.Technology, query.localTechnologyModifier, "Local technology modifier changes resolution conditions only.");
            AddSnapshotContribution(snapshot, "local/link", WorldFieldContributionKind.LocalLink, WorldFieldDomain.Link, query.localLinkModifier + query.linkIntegrity - 0.5f, "Local link integrity changes connection conditions only.");
            AddSnapshotContribution(snapshot, "local/network", WorldFieldContributionKind.LocalNetwork, WorldFieldDomain.Network, query.localNetworkModifier + query.networkConnectivity - 0.5f, "Local network connectivity changes resolution conditions only.");
            AddSnapshotContribution(snapshot, "local/ecology", WorldFieldContributionKind.LocalEcology, WorldFieldDomain.Ecology, query.localEcologyModifier, "Local ecology modifier changes habitat conditions only.");
            snapshot.contributions.Sort((a, b) => string.CompareOrdinal(a.sourceId, b.sourceId));
        }

        static void AddSnapshotContribution(WorldFieldSnapshot snapshot, string id, WorldFieldContributionKind kind, WorldFieldDomain domain, float effect, string explanation)
        {
            snapshot.contributions.Add(new WorldFieldContribution { sourceId = id, kind = kind, domain = domain, normalizedWeight = 1f, value = effect, signedEffect = effect, explanation = explanation });
        }

        static void AddModifierContribution(WorldFieldRawSample sample, string id, WorldFieldContributionKind kind, WorldFieldDomain domain, float effect, string explanation)
        {
            sample.contributions.Add(new WorldFieldContribution { sourceId = id, kind = kind, domain = domain, normalizedWeight = 1f, value = effect + 0.5f, signedEffect = effect, explanation = explanation });
        }

        WorldFieldRegionalModifier FindRegion(WorldFieldQuery query, Vector2 global)
        {
            var best = default(WorldFieldRegionalModifier);
            var bestDistance = float.PositiveInfinity;
            var regions = WorldFieldAuthorityProfiles.AllRegions;
            for (var i = 0; i < regions.Count; i++)
            {
                var region = regions[i];
                if (region == null || !region.active || (region.world != query.world && !string.IsNullOrEmpty(query.regionId))) continue;
                if (!string.IsNullOrEmpty(query.regionId) && !string.Equals(region.regionId, query.regionId, StringComparison.OrdinalIgnoreCase)) continue;
                var distance = Vector2.Distance(global, region.globalKm);
                if (distance > region.radiusKm || distance >= bestDistance) continue;
                best = region;
                bestDistance = distance;
            }
            return best;
        }

        WorldFieldAnchor FindAnchor(Vector2 global)
        {
            WorldFieldAnchor best = null;
            var bestDistance = float.PositiveInfinity;
            var anchors = WorldFieldAuthorityProfiles.AllAnchors;
            for (var i = 0; i < anchors.Count; i++)
            {
                var anchor = anchors[i];
                if (anchor == null || !anchor.active) continue;
                var distance = Vector2.Distance(global, anchor.globalKm);
                if (distance <= anchor.radiusKm && distance < bestDistance) { best = anchor; bestDistance = distance; }
            }
            return best;
        }

        float HubWeight(float distance)
        {
            if (distance <= settings.hubCourtRadiusKm) return 4f;
            if (distance >= settings.hubMetroRadiusKm) return 0.001f;
            var t = (distance - settings.hubCourtRadiusKm) / Mathf.Max(0.001f, settings.hubMetroRadiusKm - settings.hubCourtRadiusKm);
            return Mathf.Max(0.001f, 4f * (1f - t * t));
        }

        bool IsHubCourt(Vector2 global) { return global.magnitude <= settings.hubCourtRadiusKm; }

        float TerrainModifier(WorldFieldQuery query, WorldFieldRegionalModifier region)
        {
            var value = Mathf.Clamp01(query.terrainConnectivity);
            if (region != null) value = Mathf.Lerp(value, region.terrainAffinity, 0.35f);
            value += TagAffinity(query.terrainTags, query.terrainId, "terrain") * 0.10f;
            return Mathf.Clamp01(value);
        }

        float BiomeModifier(WorldFieldQuery query, WorldFieldRegionalModifier region)
        {
            var value = Mathf.Clamp01(query.biomeAffinity);
            if (region != null) value = Mathf.Lerp(value, region.biomeAffinity, 0.35f);
            value += TagAffinity(query.biomeTags, query.biomeId, "biome") * 0.10f;
            return Mathf.Clamp01(value);
        }

        float ConnectivityModifier(WorldFieldQuery query, WorldFieldRegionalModifier region)
        {
            var value = (Mathf.Clamp01(query.networkConnectivity) + Mathf.Clamp01(query.linkIntegrity) + Mathf.Clamp01(query.terrainConnectivity)) / 3f;
            if (region != null) value = Mathf.Lerp(value, region.connectivity, 0.30f);
            return Mathf.Clamp01(value);
        }

        float TemporalModifier(WorldFieldQuery query)
        {
            var hour = query.hour;
            if (hour <= 0f && query.tick > 0) hour = (query.tick % 1440L) / 60f;
            var phase = Mathf.Sin((hour / 24f) * Mathf.PI * 2f + query.day * 0.17f) * 0.5f + 0.5f;
            var tickPhase = Mathf.Cos((query.tick % 997L) * 0.013f) * 0.10f;
            return Mathf.Clamp01(phase * 0.9f + 0.05f + tickPhase);
        }

        static float TagAffinity(string[] tags, string id, string salt)
        {
            var key = StableHash.Normalize(id);
            if (tags != null) for (var i = 0; i < tags.Length; i++) if (StableHash.Normalize(tags[i]) == key && key.Length > 0) return 1f;
            if (key.Length == 0) return 0f;
            return (StableHash.Value(salt + ":" + key) % 101) / 100f - 0.5f;
        }

        static float AnchorFalloff(WorldFieldAnchor anchor, Vector2 global)
        {
            return Mathf.Clamp01(1f - Vector2.Distance(global, anchor.globalKm) / Mathf.Max(0.001f, anchor.radiusKm));
        }

        static float AnchorValue(WorldFieldAnchor anchor, int domain)
        {
            switch (domain)
            {
                case 0: return anchor.magic;
                case 1: return anchor.technology;
                case 2: return anchor.link;
                case 3: return anchor.network;
                case 4: return anchor.ecology;
                default: return 0.5f;
            }
        }

        static float ProfileValue(WorldFieldProfile profile, int domain)
        {
            switch (domain)
            {
                case 0: return profile.magic;
                case 1: return profile.technology;
                case 2: return profile.link;
                case 3: return profile.network;
                case 4: return profile.ecology;
                case 5: return profile.mobility;
                case 6: return profile.combat;
                case 7: return profile.recovery;
                case 8: return profile.safety;
                default: return 0.5f;
            }
        }

        static float ApplyQueryModifier(float value, WorldFieldQuery query, WorldFieldDomain domain)
        {
            switch (domain)
            {
                case WorldFieldDomain.Magic: value += query.localMagicModifier; break;
                case WorldFieldDomain.Technology: value += query.localTechnologyModifier; break;
                case WorldFieldDomain.Link: value += query.localLinkModifier + query.linkIntegrity - 0.5f; break;
                case WorldFieldDomain.Network: value += query.localNetworkModifier + query.networkConnectivity - 0.5f; break;
                case WorldFieldDomain.Ecology: value += query.localEcologyModifier + query.biomeAffinity - 0.5f; break;
                case WorldFieldDomain.Mobility: value += query.terrainConnectivity * 0.15f - 0.075f; break;
            }
            return Mathf.Clamp01(value);
        }

        static float ComputeResolution(WorldFieldSnapshot snapshot)
        {
            var sum = snapshot.magic + snapshot.technology + snapshot.link + snapshot.network + snapshot.ecology
                + snapshot.mobility + snapshot.combat + snapshot.recovery + snapshot.safety;
            var value = 0.25f + (sum / DomainCount) * 0.75f;
            return Mathf.Clamp(value, 0.05f, 1.25f);
        }

        static float Bilinear(float a, float b, float c, float d, float x, float z)
        {
            var ab = Mathf.Lerp(a, b, x);
            var cd = Mathf.Lerp(c, d, x);
            return Mathf.Lerp(ab, cd, z);
        }

        static string Dominant(WorldFieldRawSample a, WorldFieldRawSample b, WorldFieldRawSample c, WorldFieldRawSample d, float x, float z)
        {
            var list = new[] { a, b, c, d };
            var weights = new[] { (1f - x) * (1f - z), x * (1f - z), (1f - x) * z, x * z };
            var best = "hub";
            var value = -1f;
            for (var i = 0; i < list.Length; i++) if (list[i] != null && weights[i] > value) { value = weights[i]; best = list[i].dominantInfluence; }
            return best;
        }

        static void SetDomain(WorldFieldSnapshot snapshot, WorldFieldDomain domain, float value)
        {
            switch (domain)
            {
                case WorldFieldDomain.Magic: snapshot.magic = value; break;
                case WorldFieldDomain.Technology: snapshot.technology = value; break;
                case WorldFieldDomain.Link: snapshot.link = value; break;
                case WorldFieldDomain.Network: snapshot.network = value; break;
                case WorldFieldDomain.Ecology: snapshot.ecology = value; break;
                case WorldFieldDomain.Mobility: snapshot.mobility = value; break;
                case WorldFieldDomain.Combat: snapshot.combat = value; break;
                case WorldFieldDomain.Recovery: snapshot.recovery = value; break;
                case WorldFieldDomain.Safety: snapshot.safety = value; break;
            }
        }

        struct Influence
        {
            public WorldFieldProfile profile;
            public float weight;
        }

        static class StableHash
        {
            public static string Normalize(string raw) { return string.IsNullOrEmpty(raw) ? string.Empty : raw.Trim().ToLowerInvariant().Replace(' ', '-'); }
            public static int Value(string raw)
            {
                unchecked { var value = 23; var text = raw ?? string.Empty; for (var i = 0; i < text.Length; i++) value = value * 31 + text[i]; return Math.Abs(value); }
            }
        }
    }
}
