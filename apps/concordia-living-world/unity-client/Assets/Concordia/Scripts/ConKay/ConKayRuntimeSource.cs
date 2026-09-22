using System;
using System.Collections.Generic;
using UnityEngine;
using Concordia.GameplayCore;
using Concordia.GameplayCore.Containers;
using Concordia.GameplayCore.Gunsmithing;
using Concordia.GameplayCore.Persistence;
using Concordia.GameplayCore.Spellcrafting;
using Concordia.GameplayCore.WorldFabric;
using Concordia.GameplayCore.GoldenSlice;
using Concordia.WorldSimulation;
using Concordia.WorldSystems;

namespace Concordia.ConKay
{
    /// <summary>
    /// Typed, read-only adapter over records already present in Concordia. It deliberately
    /// does not call gameplay operations, persistence writes, or service registration.
    /// </summary>
    public sealed class ConKayRuntimeSource : IConKayRuntimeSource
    {
        readonly GameplayCoreBridge _boundBridge;

        public ConKayRuntimeSource() { }
        public ConKayRuntimeSource(GameplayCoreBridge bridge) { _boundBridge = bridge; }

        GameplayCoreBridge Bridge => _boundBridge ?? GameplayCoreBridge.Live;
        WorldSimulationService Simulation => Bridge != null && Bridge.Simulation != null
            ? Bridge.Simulation
            : WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service;
        WorldSystemsSimulation WorldSystems => Bridge != null && Bridge.WorldHost != null
            ? Bridge.WorldHost.Simulation
            : WorldSystemsHost.Active == null ? null : WorldSystemsHost.Active.Simulation;
        WorldSystemsEconomyState EconomyState => Bridge != null && Bridge.Economy != null
            ? Bridge.Economy.State
            : null;
        WorldFabricService Fabric => Bridge != null && Bridge.Fabric != null
            ? Bridge.Fabric
            : WorldFabricRuntime.Active == null ? null : WorldFabricRuntime.Active.Service;

        public ConKayInspectionSnapshot InspectTarget(GameObject target, Vector3 worldPoint)
        {
            if (!target) return InspectWorldField(worldPoint);
            var guest = target.GetComponentInParent<GuestNpc>();
            if (guest != null) return InspectNpc(guest, worldPoint);
            var fabricIdentity = target.GetComponentInParent<WorldFabricIdentity>();
            if (fabricIdentity != null && !string.IsNullOrEmpty(fabricIdentity.objectId)) return InspectObject(fabricIdentity, worldPoint);
            var buildingAdapter = target.GetComponentInParent<WorldSystemsBuildingAdapter>();
            if (buildingAdapter != null) return InspectBuilding(buildingAdapter, worldPoint);
            var place = target.GetComponentInParent<BuildingPlace>();
            if (place != null) return InspectSceneBuilding(place, worldPoint);
            var capability = target.GetComponentInParent<SkillPylon>();
            if (capability != null) return InspectCapability(capability.gameObject);
            var container = target.GetComponentInParent<WorldFabricContainer>();
            if (container != null && !string.IsNullOrEmpty(container.containerId)) return InspectContainer(container.containerId);
            return InspectSceneObject(target, worldPoint);
        }

        public ConKayInspectionSnapshot InspectCapability(GameObject target)
        {
            var skillType = string.Empty;
            var pylon = target == null ? null : target.GetComponentInParent<SkillPylon>();
            if (pylon != null) skillType = pylon.skillType;
            if (string.IsNullOrEmpty(skillType)) skillType = SkillLattice.ActiveSkill;
            var row = SkillLattice.Find(skillType);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Capability, string.IsNullOrEmpty(skillType) ? "Capability" : skillType,
                row != null ? "The capability is present because the live SkillLattice row exists for '" + skillType + "'." : SkillLattice.FromKernel ? "The live SkillLattice is bound, but it has no row for '" + skillType + "'." : "No authoritative capability record is bound in SkillLattice.", "SkillLattice");
            snapshot.stableId = skillType;
            snapshot.authoritativeRecordFound = row != null;
            snapshot.Fact("active", skillType, "SkillLattice.ActiveSkill");
            snapshot.Fact("catalogBound", SkillLattice.FromKernel.ToString(), "SkillLattice.FromKernel");
            snapshot.Fact("catalogCount", SkillLattice.CatalogCount.ToString(), "SkillLattice.CatalogCount");
            snapshot.Fact("trainedCount", SkillLattice.TrainedCount.ToString(), "SkillLattice.TrainedCount");
            if (row != null)
            {
                snapshot.Fact("group", row.group, "SkillLattice.Row.group");
                snapshot.Fact("tier", row.tier, "SkillLattice.Row.tier");
                snapshot.Fact("element", row.element, "SkillLattice.Row.element");
                snapshot.Fact("level", row.level.ToString(), "SkillLattice.Row.level");
                snapshot.Fact("potency", row.potency.ToString("0.###"), "SkillLattice.Row.potency");
                snapshot.Fact("finisher", row.finisher.ToString(), "SkillLattice.Row.finisher");
                snapshot.Link(skillType, "capability", row.group + " / " + row.tier + " / level " + row.level, "SkillLattice.Row");
            }
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectWorldField(Vector3 worldPoint)
        {
            var player = ConcordiaPlayer.Live;
            var world = player != null ? player.world : WorldId.Hub;
            var point = player != null && worldPoint == Vector3.zero ? player.transform.position : worldPoint;
            var sample = WorldField.At(world, point, "athletics", world);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.WorldField, "World field / " + world, sample.ok ? sample.because : "WorldField returned no valid sample.", "WorldField.At");
            snapshot.stableId = world.ToString();
            snapshot.worldPosition = point;
            snapshot.authoritativeRecordFound = sample.ok;
            snapshot.Fact("world", world.ToString(), "ConcordiaPlayer.world");
            snapshot.Fact("domain", "athletics", "ConKay request");
            snapshot.Fact("dominant", sample.dominant, "WorldField.Sample.dominant");
            snapshot.Fact("localPhysics", sample.localPhysics.ToString("0.###"), "WorldField.Sample.localPhysics");
            snapshot.Fact("multiplier", sample.multiplier.ToString("0.###"), "WorldField.Sample.multiplier");
            snapshot.Fact("homeInfluence", sample.homeInfluence.ToString("0.###"), "WorldField.Sample.homeInfluence");
            snapshot.Fact("flowerLaw", sample.flowerLaw.ToString(), "WorldField.Sample.flowerLaw");
            snapshot.Fact("steelLive", sample.steelLive.ToString(), "WorldField.Sample.steelLive");
            snapshot.Link(world.ToString(), "field", sample.because, "WorldField.Sample.because");
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectEconomy(string recordId)
        {
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Economy, string.IsNullOrEmpty(recordId) ? "Economy" : "Economy / " + recordId, "No economy record matched the requested identifier.", "WorldSystemsEconomyState / WorldSystemsSimulation");
            snapshot.stableId = recordId ?? string.Empty;
            if (EconomyState != null)
            {
                snapshot.Fact("simulationTime", EconomyState.simulationTime.ToString("0.###"), "WorldSystemsEconomyState.simulationTime");
                snapshot.Fact("inventories", EconomyState.inventories.Count.ToString(), "WorldSystemsEconomyState.inventories");
                snapshot.Fact("markets", EconomyState.markets.Count.ToString(), "WorldSystemsEconomyState.markets");
                snapshot.Fact("jobs", EconomyState.jobs.Count.ToString(), "WorldSystemsEconomyState.jobs");
                snapshot.Fact("consequences", EconomyState.consequences.Count.ToString(), "WorldSystemsEconomyState.consequences");
                if (TryAddEconomyRecord(snapshot, recordId)) return snapshot;
            }
            if (WorldSystems != null)
            {
                snapshot.Fact("buildings", WorldSystems.State.buildings.Count.ToString(), "WorldSystemsState.buildings");
                snapshot.Fact("offers", WorldSystems.State.storefront.Count.ToString(), "WorldSystemsState.storefront");
                if (TryAddBuildingEconomyRecord(snapshot, recordId)) return snapshot;
                if (TryAddOfferRecord(snapshot, recordId)) return snapshot;
            }
            snapshot.why = EconomyState == null && WorldSystems == null ? "No authoritative economy service or world-systems state is live." : "The live economy state exists, but no record matched the requested identifier.";
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectConsequences(string subjectId)
        {
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Consequence, string.IsNullOrEmpty(subjectId) ? "Consequences" : "Consequences / " + subjectId, "No recorded consequence matches the requested subject.", "WorldSimulationState, WorldFabricState, Persistence consequence feed");
            snapshot.stableId = subjectId ?? string.Empty;
            var links = new List<ConKayChainLink>();
            var simulation = Simulation;
            if (simulation != null && simulation.State != null)
            {
                for (var i = 0; i < simulation.State.consequences.Count; i++)
                {
                    var record = simulation.State.consequences[i];
                    if (record == null || !Matches(subjectId, record.sourceId, record.subjectId, record.factionId)) continue;
                    links.Add(new ConKayChainLink(record.consequenceId, "simulation consequence", record.kind + ": " + record.description + " (magnitude " + record.magnitude.ToString("0.###") + ")", "WorldSimulationState.consequences"));
                }
            }
            if (EconomyState != null)
            {
                for (var i = 0; i < EconomyState.consequences.Count; i++)
                {
                    var record = EconomyState.consequences[i];
                    if (record == null || !Matches(subjectId, record.recordId, record.actorId, record.settlementId, record.resourceId)) continue;
                    links.Add(new ConKayChainLink(record.recordId, "economic consequence", record.category + ": " + record.description + " (value " + record.value.ToString("0.###") + ")", "WorldSystemsEconomyState.consequences"));
                }
            }
            var fabric = Fabric;
            if (fabric != null && fabric.State != null && fabric.State.consequences != null)
            {
                for (var i = 0; i < fabric.State.consequences.Count; i++)
                {
                    var record = fabric.State.consequences[i];
                    if (record == null || !Matches(subjectId, record.eventId, record.objectId, record.buildingId, record.actorId)) continue;
                    links.Add(new ConKayChainLink(record.eventId, "fabric consequence", record.kind + ": " + record.detail + " (value " + record.value.ToString("0.###") + ")", "WorldFabricState.consequences"));
                }
            }
            var persistence = ConcordiaPersistenceService.RecordedEvents;
            if (persistence != null)
            {
                for (var i = 0; i < persistence.Count; i++)
                {
                    var record = persistence[i];
                    if (record == null || !Matches(subjectId, record.eventId, record.sourceId, record.targetId, record.actionId)) continue;
                    links.Add(new ConKayChainLink(record.eventId, "persistence consequence", record.channel + "/" + record.kind + ": " + record.detail + " (value " + record.value.ToString("0.###") + ")", "ConcordiaPersistenceService.RecordedEvents"));
                }
            }
            links.Sort(delegate(ConKayChainLink a, ConKayChainLink b) { return string.CompareOrdinal(a.id, b.id); });
            for (var i = 0; i < links.Count; i++) snapshot.chain.Add(links[i]);
            snapshot.authoritativeRecordFound = links.Count > 0;
            snapshot.why = links.Count > 0 ? "The chain contains " + links.Count + " recorded consequence(s) whose IDs or references match the subject." : snapshot.why;
            snapshot.Fact("matched", links.Count.ToString(), "ConKay consequence join");
            snapshot.Fact("subject", string.IsNullOrEmpty(subjectId) ? "<all>" : subjectId, "ConKay request");
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectSpell(string persistentSpellId)
        {
            var bridge = Bridge;
            ComposedSpellRecord spell = null;
            if (bridge != null && bridge.ComposedSpells != null) foreach (var item in bridge.ComposedSpells) if (item != null && Same(item.persistentSpellId, persistentSpellId)) { spell = item; break; }
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Spell, spell != null && spell.configuration != null ? spell.configuration.displayName : persistentSpellId, spell != null ? "The spell is present because the canonical spellcrafting record is live; field resolution is explainable and foreign-world use is preserved." : "No canonical spellcrafting record matched the requested ID.", "GameplayCoreBridge / SpellcraftingComposer");
            snapshot.stableId = persistentSpellId ?? "";
            snapshot.authoritativeRecordFound = spell != null;
            if (spell != null)
            {
                snapshot.Fact("spellId", spell.persistentSpellId, "ComposedSpellRecord.persistentSpellId");
                snapshot.Fact("originWorld", spell.configuration.originWorld.ToString(), "SpellConfigurationDto.originWorld");
                snapshot.Fact("potency", spell.lastResolvedEffect.potency.ToString("0.###"), "SpellResolvedEffectDto.potency");
                snapshot.Fact("stability", spell.lastResolvedEffect.stability.ToString("0.###"), "SpellResolvedEffectDto.stability");
                snapshot.Fact("dominantInfluence", spell.lastEnvironment.dominantInfluence, "SpellEnvironmentalModifierDto.dominantInfluence");
                if (spell.provenance != null) foreach (var link in spell.provenance.links) if (link != null) snapshot.Link(link.linkId, link.stage, link.detail, "SpellProvenanceChainDto");
            }
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectWeapon(string persistentWeaponId)
        {
            var bridge = Bridge;
            ComposedWeaponRecord weapon = null;
            if (bridge != null && bridge.ComposedWeapons != null) foreach (var item in bridge.ComposedWeapons) if (item != null && Same(item.persistentWeaponId, persistentWeaponId)) { weapon = item; break; }
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Weapon, weapon != null && weapon.configuration != null ? weapon.configuration.displayName : persistentWeaponId, weapon != null ? "The weapon is present because the canonical gunsmithing record is live; WorldField modifiers and provenance are retained." : "No canonical gunsmithing record matched the requested ID.", "GameplayCoreBridge / GunsmithingComposer");
            snapshot.stableId = persistentWeaponId ?? "";
            snapshot.authoritativeRecordFound = weapon != null;
            if (weapon != null)
            {
                snapshot.Fact("weaponId", weapon.persistentWeaponId, "ComposedWeaponRecord.persistentWeaponId");
                snapshot.Fact("originWorld", weapon.configuration.originWorld.ToString(), "WeaponConfigurationDto.originWorld");
                snapshot.Fact("damage", weapon.lastResolvedStats.damage.ToString("0.###"), "WeaponResolvedStatsDto.damage");
                snapshot.Fact("reliability", weapon.lastResolvedStats.reliability.ToString("0.###"), "WeaponResolvedStatsDto.reliability");
                snapshot.Fact("dominantInfluence", weapon.lastEnvironment.dominantInfluence, "WeaponEnvironmentalModifierDto.dominantInfluence");
                if (weapon.provenance != null) foreach (var link in weapon.provenance.links) if (link != null) snapshot.Link(link.linkId, link.stage, link.detail, "WeaponProvenanceChainDto");
            }
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectGoldenSlice(string recordId)
        {
            var bridge = Bridge;
            if (bridge != null && bridge.GoldenSlice != null) return bridge.GoldenSlice.Inspect(recordId);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.GoldenSlice, "Sandrun forge golden slice", "No GameplayCoreBridge golden-slice runtime is live.", "GameplayCoreBridge.GoldenSlice");
            snapshot.stableId = recordId ?? GoldenSliceRuntime.SettlementId;
            return snapshot;
        }

        public ConKayInspectionSnapshot InspectContainer(string containerId)
        {
            var bridge = Bridge;
            CanonicalContainerRecord container = null;
            if (bridge != null && bridge.Containers != null) bridge.Containers.TryGet(containerId, out container);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Container, container != null ? container.displayName : containerId, container != null ? "The container is present because the canonical container record and its backing adapter are live." : "No canonical container record matched the requested ID.", "GameplayCoreBridge / CanonicalContainerService");
            snapshot.stableId = containerId ?? "";
            snapshot.authoritativeRecordFound = container != null;
            if (container != null)
            {
                snapshot.Fact("containerId", container.containerId, "CanonicalContainerRecord.containerId");
                snapshot.Fact("authority", container.inventoryAuthority.ToString(), "CanonicalContainerRecord.inventoryAuthority");
                snapshot.Fact("authorityId", container.authorityId, "CanonicalContainerRecord.authorityId");
                snapshot.Fact("owner", container.ownerId, "CanonicalContainerRecord.ownerId");
                snapshot.Fact("usedCapacity", container.UsedCapacity.ToString("0.###"), "CanonicalContainerRecord.UsedCapacity");
                snapshot.Fact("capacity", container.capacity.ToString("0.###"), "CanonicalContainerRecord.capacity");
                snapshot.Fact("accessRule", container.accessRule.ToString(), "CanonicalContainerRecord.accessRule");
                snapshot.Fact("source", container.provenance == null ? "" : container.provenance.sourceId, "ContainerProvenance.sourceId");
                snapshot.Fact("generationRule", container.provenance == null ? "" : container.provenance.generationRule, "ContainerProvenance.generationRule");
                snapshot.Link(container.containerId, "container provenance", container.provenance == null ? "" : container.provenance.generatorVersion, "ContainerProvenance");
            }
            return snapshot;
        }

        ConKayInspectionSnapshot InspectNpc(GuestNpc guest, Vector3 point)
        {
            var id = ResolveNpcId(guest);
            var state = Simulation == null ? null : Simulation.FindNpc(id);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Npc, guest.def != null && !string.IsNullOrEmpty(guest.def.name) ? guest.def.name : guest.name, state != null ? "The NPC is inspectable because its live NpcSocialState record matches '" + id + "'." : "The scene NPC exists, but no matching NpcSocialState record is live.", state != null ? "WorldSimulationState.npcs" : "GuestNpc scene component");
            snapshot.stableId = id;
            snapshot.worldPosition = point;
            snapshot.authoritativeRecordFound = state != null;
            snapshot.Fact("sceneObject", guest.name, "GuestNpc.gameObject.name");
            snapshot.Fact("personId", guest.personId, "GuestNpc.personId");
            if (guest.def != null)
            {
                snapshot.Fact("name", guest.def.name, "GuestNpc.def.name");
                snapshot.Fact("title", guest.def.title, "GuestNpc.def.title");
            }
            var life = guest.GetComponent<NpcLife>();
            if (life != null)
            {
                snapshot.Fact("activity", life.act, "NpcLife.act");
                snapshot.Fact("job", life.job.ToString(), "NpcLife.job");
            }
            if (state != null)
            {
                snapshot.Fact("displayName", state.displayName, "NpcSocialState.displayName");
                snapshot.Fact("settlement", state.settlementId, "NpcSocialState.settlementId");
                snapshot.Fact("home", state.homeId, "NpcSocialState.homeId");
                snapshot.Fact("jobId", state.jobId, "NpcSocialState.jobId");
                snapshot.Fact("faction", state.factionId, "NpcSocialState.factionId");
                snapshot.Fact("alive", state.alive.ToString(), "NpcSocialState.alive");
                snapshot.Fact("stress", state.stress.ToString(), "NpcSocialState.stress");
                snapshot.Link(id, "npc state", state.currentActivity + " / available=" + state.available, "WorldSimulationState.npcs");
            }
            AppendMatchingConsequences(snapshot, id);
            return snapshot;
        }

        ConKayInspectionSnapshot InspectObject(WorldFabricIdentity identity, Vector3 point)
        {
            var record = Fabric == null ? null : Fabric.TryGetObject(identity.objectId);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Object, record != null && !string.IsNullOrEmpty(record.displayName) ? record.displayName : identity.name, record != null ? "The object is inspectable because its WorldFabricObjectRecord is present and marked present=" + record.present + "." : "The scene identity is present, but no matching WorldFabricObjectRecord is live.", record != null ? "WorldFabricState.buildings.objects" : "WorldFabricIdentity");
            snapshot.stableId = identity.objectId;
            snapshot.worldPosition = point;
            snapshot.authoritativeRecordFound = record != null;
            snapshot.Fact("objectId", identity.objectId, "WorldFabricIdentity.objectId");
            snapshot.Fact("semanticId", identity.semanticId, "WorldFabricIdentity.semanticId");
            snapshot.Fact("buildingId", identity.buildingId, "WorldFabricIdentity.buildingId");
            snapshot.Fact("purpose", identity.purpose, "WorldFabricIdentity.purpose");
            if (record != null)
            {
                snapshot.Fact("kind", record.kind.ToString(), "WorldFabricObjectRecord.kind");
                snapshot.Fact("displayName", record.displayName, "WorldFabricObjectRecord.displayName");
                snapshot.Fact("condition", record.condition.ToString("0.###"), "WorldFabricObjectRecord.condition");
                snapshot.Fact("quantity", record.quantity.ToString(), "WorldFabricObjectRecord.quantity");
                snapshot.Fact("present", record.present.ToString(), "WorldFabricObjectRecord.present");
                snapshot.Fact("interaction", record.interaction.ToString(), "WorldFabricObjectRecord.interaction");
                if (record.provenance != null)
                {
                    snapshot.Fact("generationRule", record.provenance.generationRule, "WorldFabricProvenance.generationRule");
                    snapshot.Fact("generatorVersion", record.provenance.generatorVersion, "WorldFabricProvenance.generatorVersion");
                    snapshot.Fact("loreSources", Join(record.provenance.loreSources), "WorldFabricProvenance.loreSources");
                    snapshot.Link(record.objectId, "provenance", record.provenance.generationRule, "WorldFabricObjectRecord.provenance");
                }
            }
            AppendMatchingConsequences(snapshot, identity.objectId);
            return snapshot;
        }

        ConKayInspectionSnapshot InspectBuilding(WorldSystemsBuildingAdapter adapter, Vector3 point)
        {
            var state = WorldSystems == null ? null : WorldSystems.FindBuildingState(adapter.buildingId);
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Building, adapter.name, state != null ? "The building is inspectable because its BuildingState record matches '" + adapter.buildingId + "'." : "The scene building adapter exists, but no matching BuildingState record is live.", state != null ? "WorldSystemsState.buildings" : "WorldSystemsBuildingAdapter");
            snapshot.stableId = adapter.buildingId;
            snapshot.worldPosition = point;
            snapshot.authoritativeRecordFound = state != null;
            snapshot.Fact("buildingId", adapter.buildingId, "WorldSystemsBuildingAdapter.buildingId");
            snapshot.Fact("plan", adapter.plan, "WorldSystemsBuildingAdapter.plan");
            if (state != null) AddBuildingFacts(snapshot, state);
            var fabricBuilding = Fabric == null ? null : Fabric.TryGetBuilding(adapter.buildingId);
            if (fabricBuilding != null)
            {
                snapshot.Fact("fabricPurpose", fabricBuilding.purpose, "WorldFabricBuildingRecord.purpose");
                snapshot.Fact("fabricCondition", fabricBuilding.condition.ToString("0.###"), "WorldFabricBuildingRecord.condition");
                snapshot.Link(fabricBuilding.buildingId, "building provenance", fabricBuilding.purpose, "WorldFabricState.buildings");
            }
            AppendMatchingConsequences(snapshot, adapter.buildingId);
            return snapshot;
        }

        ConKayInspectionSnapshot InspectSceneBuilding(BuildingPlace place, Vector3 point)
        {
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.Building, place.name, "The scene building is inspectable because BuildingPlace exposes its authored plan; no live BuildingState was found for this object.", "BuildingPlace");
            snapshot.stableId = place.name;
            snapshot.worldPosition = point;
            snapshot.Fact("plan", place.plan, "BuildingPlace.plan");
            snapshot.Fact("door", place.door.ToString(), "BuildingPlace.door");
            return snapshot;
        }

        ConKayInspectionSnapshot InspectSceneObject(GameObject target, Vector3 point)
        {
            var identity = target.GetComponentInParent<ConKayIdentity>();
            var snapshot = ConKayInspectionSnapshot.Empty(identity != null ? identity.recordKind : ConKayInspectionKind.Object, target.name, identity != null && !string.IsNullOrEmpty(identity.recordId) ? "The scene object is inspectable because ConKayIdentity supplies stable record '" + identity.recordId + "'." : "No authoritative diagnostic record is attached to this scene object; only observed Unity components are shown.", identity != null ? identity.authority : "Unity scene object");
            snapshot.stableId = identity != null ? identity.recordId : target.name;
            snapshot.worldPosition = point;
            snapshot.authoritativeRecordFound = identity != null && !string.IsNullOrEmpty(identity.recordId);
            snapshot.Fact("name", target.name, "GameObject.name");
            snapshot.Fact("tag", target.tag, "GameObject.tag");
            snapshot.Fact("layer", LayerMask.LayerToName(target.layer), "GameObject.layer");
            snapshot.Fact("active", target.activeInHierarchy.ToString(), "GameObject.activeInHierarchy");
            var collider = target.GetComponentInParent<Collider>();
            snapshot.Fact("collider", collider != null ? collider.GetType().Name : "none", "GetComponentInParent<Collider>");
            var renderer = target.GetComponentInParent<Renderer>();
            snapshot.Fact("renderer", renderer != null ? renderer.GetType().Name : "none", "GetComponentInParent<Renderer>");
            if (identity != null) snapshot.Link(identity.recordId, "identity", identity.authority, "ConKayIdentity");
            return snapshot;
        }

        bool TryAddEconomyRecord(ConKayInspectionSnapshot snapshot, string recordId)
        {
            if (string.IsNullOrEmpty(recordId) || EconomyState == null) return false;
            for (var i = 0; i < EconomyState.inventories.Count; i++)
            {
                var item = EconomyState.inventories[i];
                if (item == null || !Same(recordId, item.inventoryId)) continue;
                snapshot.authoritativeRecordFound = true;
                snapshot.why = "The economy record is present because WorldSystemsInventoryContract matches '" + recordId + "'.";
                snapshot.Fact("owner", item.ownerId, "WorldSystemsInventoryContract.ownerId");
                snapshot.Fact("capacity", item.capacity.ToString("0.###"), "WorldSystemsInventoryContract.capacity");
                snapshot.Fact("resources", item.resources.Count.ToString(), "WorldSystemsInventoryContract.resources");
                snapshot.Link(item.inventoryId, "inventory", item.ownerId, "WorldSystemsEconomyState.inventories");
                return true;
            }
            for (var i = 0; i < EconomyState.markets.Count; i++)
            {
                var item = EconomyState.markets[i];
                if (item == null || (!Same(recordId, item.storefrontId) && !Same(recordId, item.resourceId))) continue;
                snapshot.authoritativeRecordFound = true;
                snapshot.why = "The economy record is present because WorldSystemsMarketContract matches the requested identifier.";
                snapshot.Fact("storefront", item.storefrontId, "WorldSystemsMarketContract.storefrontId");
                snapshot.Fact("resource", item.resourceId, "WorldSystemsMarketContract.resourceId");
                snapshot.Fact("lastPrice", item.lastPrice.ToString("0.###"), "WorldSystemsMarketContract.lastPrice");
                snapshot.Fact("targetStock", item.targetStock.ToString("0.###"), "WorldSystemsMarketContract.targetStock");
                snapshot.Link(item.storefrontId + ":" + item.resourceId, "market", item.resourceId, "WorldSystemsEconomyState.markets");
                return true;
            }
            return false;
        }

        bool TryAddBuildingEconomyRecord(ConKayInspectionSnapshot snapshot, string recordId)
        {
            if (WorldSystems == null || string.IsNullOrEmpty(recordId)) return false;
            var building = WorldSystems.FindBuildingState(recordId);
            if (building == null) return false;
            snapshot.authoritativeRecordFound = true;
            snapshot.why = "The economy record is present because BuildingState matches '" + recordId + "'.";
            AddBuildingFacts(snapshot, building);
            snapshot.Link(building.buildingId, "building economy", building.kind.ToString(), "WorldSystemsState.buildings");
            return true;
        }

        bool TryAddOfferRecord(ConKayInspectionSnapshot snapshot, string recordId)
        {
            if (WorldSystems == null || string.IsNullOrEmpty(recordId)) return false;
            for (var i = 0; i < WorldSystems.State.storefront.Count; i++)
            {
                var offer = WorldSystems.State.storefront[i];
                if (offer == null || (!Same(recordId, offer.itemId) && !Same(recordId, offer.storefrontId))) continue;
                snapshot.authoritativeRecordFound = true;
                snapshot.why = "The economy record is present because StorefrontItem matches the requested identifier.";
                snapshot.Fact("itemId", offer.itemId, "StorefrontItem.itemId");
                snapshot.Fact("storefrontId", offer.storefrontId, "StorefrontItem.storefrontId");
                snapshot.Fact("resource", offer.resource, "StorefrontItem.resource");
                snapshot.Fact("quantity", offer.quantity.ToString("0.###"), "StorefrontItem.quantity");
                snapshot.Fact("unitPrice", offer.unitPrice.ToString("0.###"), "StorefrontItem.unitPrice");
                snapshot.Link(offer.itemId, "offer", offer.resource, "WorldSystemsState.storefront");
                return true;
            }
            return false;
        }

        void AddBuildingFacts(ConKayInspectionSnapshot snapshot, BuildingState state)
        {
            snapshot.Fact("settlement", state.settlementId, "BuildingState.settlementId");
            snapshot.Fact("owner", state.ownerId, "BuildingState.ownerId");
            snapshot.Fact("faction", state.factionId, "BuildingState.factionId");
            snapshot.Fact("kind", state.kind.ToString(), "BuildingState.kind");
            snapshot.Fact("construction", state.construction.ToString(), "BuildingState.construction");
            snapshot.Fact("operational", state.operational.ToString(), "BuildingState.operational");
            snapshot.Fact("condition", state.condition.ToString("0.###"), "BuildingState.condition");
            snapshot.Link(state.buildingId, "building state", state.construction + " / operational=" + state.operational, "WorldSystemsState.buildings");
        }

        void AppendMatchingConsequences(ConKayInspectionSnapshot snapshot, string subjectId)
        {
            var consequences = InspectConsequences(subjectId);
            for (var i = 0; i < consequences.chain.Count; i++) snapshot.chain.Add(consequences.chain[i]);
        }

        static string ResolveNpcId(GuestNpc guest)
        {
            if (guest == null) return string.Empty;
            if (!string.IsNullOrEmpty(guest.personId)) return guest.personId;
            return guest.def == null ? guest.name : guest.def.id;
        }

        static bool Matches(string requested, params string[] values)
        {
            if (string.IsNullOrEmpty(requested)) return true;
            for (var i = 0; i < values.Length; i++)
                if (!string.IsNullOrEmpty(values[i]) && string.Equals(requested, values[i], StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        static bool Same(string a, string b) { return string.Equals(a ?? string.Empty, b ?? string.Empty, StringComparison.OrdinalIgnoreCase); }

        static string Join(List<string> values) { return values == null || values.Count == 0 ? string.Empty : string.Join(", ", values.ToArray()); }
    }
}
