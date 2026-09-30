using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;
using Concordia;
using Concordia.ConKay;
using Concordia.GameplayCore.Containers;
using Concordia.GameplayCore.Fabrication;
using Concordia.GameplayCore.Gunsmithing;
using Concordia.GameplayCore.Persistence;
using Concordia.GameplayCore.WorldFabric;
using Concordia.WorldSystems;

namespace Concordia.GameplayCore.GoldenSlice
{
    public enum GoldenSliceMarkerKind { OreSource, ForgeStation, OutputContainer }

    [DisallowMultipleComponent]
    public sealed class GoldenSliceMarker : MonoBehaviour
    {
        public GoldenSliceMarkerKind kind;
        public string semanticId;
        public string provenanceId;
    }

    /// <summary>
    /// One authored Tunya mine-to-forge-to-equipment path. This is glue only: economy,
    /// WorldFabric, composition, containers, player equipment, persistence, and ConKay
    /// remain the authorities for their respective records.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class GoldenSliceRuntime : MonoBehaviour
    {
        public const string SettlementId = "settlement/tunya/sandrun_sanguire";
        public const string RegionId = "tunya/region/sangree";
        public const string ForgeBuildingId = "building/tunya/sandrun_sanguire/forge_quarter/workshop";
        public const string MineBuildingId = "building/tunya/sandrun_sanguire/forge_quarter/ore_source";
        public const string OreObjectId = "object/tunya/sandrun_sanguire/forge_quarter/iron_ore_vein";
        public const string OreSourceId = "source/tunya/sandrun_sanguire/iron_ore_vein";
        public const string OutputContainerId = "container/tunya/sandrun_sanguire/forge_output";
        public const string RecipeId = "recipe/tunya/sandrun_sanguire/iron_ingot";
        public const string MaterialId = "iron-ingot";
        public const string HorseAssetId = "asset/generated/concordia_pack_horse";
        public const string HorseAvailabilityId = "vehicle-asset/tunya/pack-horse/available";
        public const string OreAssetPath = "Assets/Generated_Models/Concordia_IronOreVein/Concordia_IronOreVein.fbx";
        public const string WorkbenchAssetPath = "Assets/Generated_Models/Concordia_GunsmithWorkbench/Concordia_GunsmithWorkbench.fbx";
        public const string ForgePrefabPath = "Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge.fbx";
        public const string HorseAssetPath = "Assets/Generated_Models/Concordia_PackHorse/Concordia_PackHorse.fbx";

        public GameplayCoreBridge Bridge { get; private set; }
        public GameObject OrePresentation { get; private set; }
        public GameObject WorkbenchPresentation { get; private set; }
        public GameObject ForgePresentation { get; private set; }
        public string CompletedWeaponId { get; private set; }
        public bool IsCanonicalSettlement => Bridge != null && Bridge.Player != null && Bridge.Player.world == WorldId.Tunya;
        public bool IsConfigured { get; private set; }
        public bool HorseRegisteredAvailableOnly { get; private set; }

        static readonly Color ForgeGlow = new Color(1f, 0.24f, 0.06f);

        public void Bind(GameplayCoreBridge bridge)
        {
            Bridge = bridge;
            EnsurePresentation();
        }

        public void Configure()
        {
            if (Bridge == null || Bridge.Player == null || Bridge.Fabric == null || Bridge.Economy == null) return;
            if (Bridge.Player.world != WorldId.Tunya) return;
            EnsurePresentation();
            EnsureWorldFabricRecords();
            EnsureEconomyContracts();
            EnsureOutputContainer();
            RebindCompletedWeapon();
            IsConfigured = true;
        }

        public static void Present(WorldDef world, Transform root)
        {
            if (world == null || world.id != WorldId.Tunya || root == null) return;
            var holder = root.Find("GoldenSlice_SandrunSanguire");
            if (holder != null) return;
            var go = new GameObject("GoldenSlice_SandrunSanguire");
            go.transform.SetParent(root, false);
            var city = FindCity();
            var origin = city == null ? new Vector3(-4.43f, 0f, -65.85f) : new Vector3(city.x, 0f, city.z);
            go.transform.position = origin;
            SpawnVisuals(go.transform);
        }

        static WorldBook.CityDef FindCity()
        {
            var cities = CityAtlas.For(WorldId.Tunya);
            if (cities == null) return null;
            for (var i = 0; i < cities.Length; i++)
                if (cities[i] != null && string.Equals(cities[i].id, "sandrun_sanguire", StringComparison.OrdinalIgnoreCase)) return cities[i];
            return cities.Length > 0 ? cities[0] : null;
        }

        void EnsurePresentation()
        {
            if (Bridge == null || Bridge.Player == null || Bridge.Player.world != WorldId.Tunya) return;
            var worldRoot = GameObject.Find("Megaworld") ?? GameObject.Find("World");
            var existingHolder = GameObject.Find("GoldenSlice_SandrunSanguire");
            var holder = existingHolder == null ? null : existingHolder.transform;
            if (holder == null && worldRoot != null)
            {
                Present(Canon.Get(WorldId.Tunya), worldRoot.transform);
                existingHolder = GameObject.Find("GoldenSlice_SandrunSanguire");
                holder = existingHolder == null ? null : existingHolder.transform;
            }
            if (holder == null) return;
            var forge = holder.Find("ForgePresentation");
            if (forge != null) ForgePresentation = forge.gameObject;
            var ore = holder.Find("Concordia_IronOreVein");
            if (ore != null) OrePresentation = ore.gameObject;
            var workbench = holder.Find("Concordia_GunsmithWorkbench");
            if (workbench != null) WorkbenchPresentation = workbench.gameObject;
            if (OrePresentation == null)
            {
                OrePresentation = SpawnAsset(OreAssetPath, holder, "Concordia_IronOreVein", new Vector3(11f, 0f, 8f), new Color(0.22f, 0.38f, 0.58f));
                StampMarker(OrePresentation, GoldenSliceMarkerKind.OreSource, "concordia_iron_ore_vein", OreObjectId);
            }
            if (ForgePresentation == null)
            {
                ForgePresentation = SpawnAsset(ForgePrefabPath, holder, "ForgePresentation", new Vector3(0f, 0f, 2.2f), ForgeGlow);
                if (ForgePresentation != null)
                {
                    var place = ForgePresentation.GetComponent<BuildingPlace>() ?? ForgePresentation.AddComponent<BuildingPlace>();
                    place.plan = "forge";
                    place.door = ForgePresentation.transform.position + ForgePresentation.transform.forward * -2.5f;
                    var marker = StampMarker(ForgePresentation, GoldenSliceMarkerKind.ForgeStation, "concordia_real_forge", ForgeBuildingId);
                    marker.semanticId = "concordia_real_forge";
                }
            }
            if (WorkbenchPresentation == null)
            {
                WorkbenchPresentation = SpawnAsset(WorkbenchAssetPath, holder, "Concordia_GunsmithWorkbench", new Vector3(0f, 0f, -0.8f), new Color(0.35f, 0.20f, 0.10f));
                StampMarker(WorkbenchPresentation, GoldenSliceMarkerKind.ForgeStation, "concordia_gunsmith_workbench", ForgeBuildingId);
            }
            EnsureCollider(OrePresentation);
            EnsureCollider(ForgePresentation);
            EnsureCollider(WorkbenchPresentation);
            RegisterConKayIdentity(OrePresentation, OreObjectId, ConKayInspectionKind.Object);
            RegisterConKayIdentity(WorkbenchPresentation, ForgeBuildingId, ConKayInspectionKind.Building);
            RegisterConKayIdentity(ForgePresentation, ForgeBuildingId, ConKayInspectionKind.Building);
        }

        static void SpawnVisuals(Transform holder)
        {
            var ore = SpawnAsset(OreAssetPath, holder, "Concordia_IronOreVein", new Vector3(11f, 0f, 8f), new Color(0.22f, 0.38f, 0.58f));
            StampMarker(ore, GoldenSliceMarkerKind.OreSource, "concordia_iron_ore_vein", OreObjectId);
            var forge = SpawnAsset(ForgePrefabPath, holder, "ForgePresentation", new Vector3(0f, 0f, 2.2f), ForgeGlow);
            if (forge != null)
            {
                var place = forge.GetComponent<BuildingPlace>() ?? forge.AddComponent<BuildingPlace>();
                place.plan = "forge";
                place.door = forge.transform.position + forge.transform.forward * -2.5f;
                StampMarker(forge, GoldenSliceMarkerKind.ForgeStation, "concordia_real_forge", ForgeBuildingId);
            }
            var workbench = SpawnAsset(WorkbenchAssetPath, holder, "Concordia_GunsmithWorkbench", new Vector3(0f, 0f, -0.8f), new Color(0.35f, 0.20f, 0.10f));
            StampMarker(workbench, GoldenSliceMarkerKind.ForgeStation, "concordia_gunsmith_workbench", ForgeBuildingId);
            EnsureCollider(ore); EnsureCollider(forge); EnsureCollider(workbench);
        }

        static GameObject SpawnAsset(string assetPath, Transform parent, string name, Vector3 localPosition, Color fallbackColor)
        {
            GameObject prefab = null;
#if UNITY_EDITOR
            prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
#endif
            var go = prefab != null ? UnityEngine.Object.Instantiate(prefab) : null;
            if (go == null)
            {
                go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.transform.localScale = new Vector3(2f, 1.2f, 2f);
                var renderer = go.GetComponent<Renderer>();
                if (renderer != null) renderer.sharedMaterial = HubLook.Lit(fallbackColor, 0.2f, 0.35f);
            }
            go.name = name;
            go.transform.SetParent(parent, false);
            go.transform.localPosition = localPosition;
            return go;
        }

        static GoldenSliceMarker StampMarker(GameObject target, GoldenSliceMarkerKind kind, string semanticId, string provenanceId)
        {
            if (target == null) return null;
            var marker = target.GetComponent<GoldenSliceMarker>() ?? target.AddComponent<GoldenSliceMarker>();
            marker.kind = kind;
            marker.semanticId = semanticId;
            marker.provenanceId = provenanceId;
            return marker;
        }

        static void EnsureCollider(GameObject target)
        {
            if (target == null || target.GetComponentInChildren<Collider>() != null) return;
            var renderers = target.GetComponentsInChildren<Renderer>();
            var bounds = new Bounds(target.transform.position, Vector3.one * 2f);
            for (var i = 0; i < renderers.Length; i++) if (renderers[i] != null) bounds.Encapsulate(renderers[i].bounds);
            var collider = target.AddComponent<BoxCollider>();
            collider.center = target.transform.InverseTransformPoint(bounds.center);
            collider.size = target.transform.InverseTransformVector(bounds.size);
        }

        static void RegisterConKayIdentity(GameObject target, string id, ConKayInspectionKind kind)
        {
            if (target == null) return;
            var identity = target.GetComponent<ConKayIdentity>() ?? target.AddComponent<ConKayIdentity>();
            identity.recordId = id;
            identity.recordKind = kind;
            identity.authority = "Concordia golden slice / canonical runtime";
        }

        void EnsureWorldFabricRecords()
        {
            Bridge.Fabric.EnsureSettlement(SettlementId, "Tunya", RegionId, "The Sanguire of Sandrun", "forge settlement", "tunya", "sandrun_sanguire", 50,
                new[] { "live-steel", "fire-bloodline", "sandrun_forge_quarter" },
                new[] { "WorldBook.ForPerson:sangree_smith_orla", "WorldBook.Faction:sandrun_sanguire", "SettlementDef:" + SettlementId });
            Bridge.Fabric.EnsureBuilding(ForgeBuildingId, "Tunya", RegionId, SettlementId, "workshop", "forge", "tunya", "sandrun_sanguire", "sangree_smith_orla", StableSeed(ForgeBuildingId),
                new[] { "sangree_smith_orla", "warlord_iyatte_sanguire", "sandrun_forge_quarter", WorkbenchAssetPath, ForgePrefabPath });
            var mine = Bridge.Fabric.EnsureBuilding(MineBuildingId, "Tunya", RegionId, SettlementId, "mine", "gathering", "tunya", "sandrun_sanguire", "sandrun_sanguire", StableSeed(MineBuildingId),
                new[] { OreAssetPath, "sandrun_forge_quarter" });
            if (mine != null)
            {
                var ore = Bridge.Fabric.TryGetObject(OreObjectId);
                if (ore == null)
                {
                    ore = new WorldFabricObjectRecord
                    {
                        objectId = OreObjectId,
                        kind = WorldFabricObjectKind.Resource,
                        semanticId = "concordia_iron_ore_vein",
                        displayName = "Concordia Iron Ore Vein",
                        purpose = "iron ore gathering source",
                        ownerId = "public",
                        material = "iron ore",
                        condition = 1f,
                        value = 12f,
                        quantity = 3,
                        present = true,
                        movable = false,
                        destructible = false,
                        interactive = true,
                        interaction = WorldFabricInteractionKind.Use,
                        provenance = new WorldFabricProvenance
                        {
                            assetId = OreAssetPath,
                            worldId = "Tunya",
                            regionId = RegionId,
                            cultureId = "tunya",
                            factionId = "sandrun_sanguire",
                            buildingId = MineBuildingId,
                            generationRule = "golden-slice:iron-ore-vein",
                            generatorVersion = "concordia-golden-slice-v1",
                            loreSources = new List<string> { "SettlementDef:" + SettlementId, "district:sandrun_forge_quarter" },
                            gameplayBindings = new List<string> { "WorldSystemsEconomyService.Gather", OreSourceId, "ConKay.InspectGoldenSlice" }
                        }
                    };
                    mine.objects.Add(ore);
                    Bridge.Fabric.Restore(Bridge.Fabric.State);
                }
                var availableHorse = Bridge.Fabric.TryGetObject(HorseAvailabilityId);
                if (availableHorse == null)
                {
                    mine.objects.Add(new WorldFabricObjectRecord
                    {
                        objectId = HorseAvailabilityId,
                        kind = WorldFabricObjectKind.Decoration,
                        semanticId = "concordia_pack_horse",
                        displayName = "Concordia Pack Horse (asset available)",
                        purpose = "available generated asset; not a playable mount",
                        ownerId = "",
                        material = "asset",
                        condition = 1f,
                        quantity = 1,
                        present = true,
                        movable = false,
                        interactive = false,
                        interaction = WorldFabricInteractionKind.Inspect,
                        provenance = new WorldFabricProvenance
                        {
                            assetId = HorseAssetPath,
                            worldId = "Tunya",
                            regionId = RegionId,
                            cultureId = "tunya",
                            factionId = "sandrun_sanguire",
                            buildingId = MineBuildingId,
                            generationRule = "golden-slice:available-asset-registration",
                            generatorVersion = "concordia-golden-slice-v1",
                            gameplayBindings = new List<string> { "available-asset-only", "VehicleEntity not bound" },
                            loreSources = new List<string> { "settlement alias sangree retained as canon reference" }
                        }
                    });
                    Bridge.Fabric.Restore(Bridge.Fabric.State);
                }
                var identity = OrePresentation == null ? null : OrePresentation.GetComponent<WorldFabricIdentity>() ?? OrePresentation.AddComponent<WorldFabricIdentity>();
                if (identity != null)
                {
                    identity.Bind(ore);
                    identity.objectId = OreObjectId;
                    identity.semanticId = "concordia_iron_ore_vein";
                    identity.buildingId = MineBuildingId;
                    identity.purpose = "iron ore gathering source";
                    identity.interaction = WorldFabricInteractionKind.Use;
                }
            }
            var workbenchIdentity = WorkbenchPresentation == null ? null : WorkbenchPresentation.GetComponent<WorldFabricIdentity>() ?? WorkbenchPresentation.AddComponent<WorldFabricIdentity>();
            var forge = Bridge.Fabric.TryGetBuilding(ForgeBuildingId);
            if (workbenchIdentity != null && forge != null)
            {
                var workbenchObjectId = ForgeBuildingId + "/object/workbench";
                var workbenchRecord = Bridge.Fabric.TryGetObject(workbenchObjectId);
                if (workbenchRecord == null)
                {
                    workbenchRecord = new WorldFabricObjectRecord
                    {
                        objectId = workbenchObjectId,
                        kind = WorldFabricObjectKind.Tool,
                        semanticId = "concordia_gunsmith_workbench",
                        displayName = "Concordia Gunsmith Workbench",
                        purpose = "gunsmithing and fabrication station",
                        ownerId = "sangree_smith_orla",
                        material = "iron and timber",
                        condition = 1f,
                        value = 90f,
                        quantity = 1,
                        present = true,
                        movable = false,
                        interactive = true,
                        interaction = WorldFabricInteractionKind.Use,
                        provenance = new WorldFabricProvenance
                        {
                            assetId = WorkbenchAssetPath,
                            worldId = "Tunya",
                            regionId = RegionId,
                            cultureId = "tunya",
                            factionId = "sandrun_sanguire",
                            buildingId = ForgeBuildingId,
                            generationRule = "golden-slice:generated-workbench",
                            generatorVersion = "concordia-golden-slice-v1",
                            gameplayBindings = new List<string> { "FabricationComposer", "GunsmithingComposer", "GoldenSliceRuntime" },
                            loreSources = new List<string> { "sangree_smith_orla", "sandrun_forge_quarter" }
                        }
                    };
                    forge.objects.Add(workbenchRecord);
                    Bridge.Fabric.Restore(Bridge.Fabric.State);
                }
                workbenchIdentity.Bind(workbenchRecord);
                workbenchIdentity.objectId = workbenchObjectId;
                workbenchIdentity.buildingId = ForgeBuildingId;
                workbenchIdentity.semanticId = "concordia_gunsmith_workbench";
                workbenchIdentity.purpose = "gunsmithing and fabrication station";
                workbenchIdentity.interaction = WorldFabricInteractionKind.Use;
            }
        }

        void EnsureEconomyContracts()
        {
            if (Bridge.Economy.FindGatheringSourceForGoldenSlice(OreSourceId) == null)
                Bridge.Economy.RegisterGatheringSource(new WorldSystemsGatheringSourceContract
                {
                    sourceId = OreSourceId,
                    settlementId = SettlementId,
                    resourceId = "iron-ore",
                    yieldPerAction = 1f,
                    available = 3f,
                    maximumAvailable = 3f,
                    respawnSeconds = 45f,
                    requiresOperationalBuilding = false
                });
            if (Bridge.Economy.FindRecipeForGoldenSlice(RecipeId) == null)
            {
                var recipe = new WorldSystemsRecipeContract
                {
                    recipeId = RecipeId,
                    displayName = "Sandrun forge iron ingot",
                    requiresBuilding = true,
                    requiredBuildingId = ForgeBuildingId,
                    requiredBuildingKind = BuildingKind.Workshop
                };
                recipe.inputs.Add(new WorldSystemsResourceStack("iron-ore", 1f));
                recipe.outputs.Add(new WorldSystemsResourceStack(MaterialId, 1f));
                Bridge.Economy.RegisterRecipe(recipe);
            }
            var state = Bridge.Economy.Simulation == null ? null : Bridge.Economy.Simulation.FindBuildingState(ForgeBuildingId);
            if (state == null && Bridge.Economy.Simulation != null)
            {
                state = new BuildingState { buildingId = ForgeBuildingId, settlementId = SettlementId, ownerId = "sangree_smith_orla", factionId = "sandrun_sanguire", kind = BuildingKind.Workshop, construction = ConstructionStatus.Complete, operational = true, condition = 1f, plan = "forge" };
                Bridge.Economy.Simulation.State.buildings.Add(state);
                Bridge.Economy.Simulation.Reindex();
            }
            else if (state != null) { state.kind = BuildingKind.Workshop; state.construction = ConstructionStatus.Complete; state.operational = true; state.plan = "forge"; }
            HorseRegisteredAvailableOnly = true;
        }

        void EnsureOutputContainer()
        {
            if (Bridge.Containers == null) return;
            if (Bridge.Containers.TryGet(OutputContainerId, out var existing)) return;
            var record = new CanonicalContainerRecord
            {
                containerId = OutputContainerId,
                kind = ContainerKind.Building,
                displayName = "Sandrun forge output chest",
                ownerId = "player",
                factionId = "sandrun_sanguire",
                accessRule = ContainerAccessRule.OwnerOnly,
                capacity = 8f,
                isPersistent = true,
                inventoryAuthority = ContainerInventoryAuthority.Canonical,
                authorityId = OutputContainerId,
                physicalLocation = new ContainerPhysicalLocation { worldId = "Tunya", regionId = RegionId, parentId = ForgeBuildingId, locationKind = "golden-slice-forge" },
                provenance = new ContainerProvenance
                {
                    sourceId = ForgeBuildingId,
                    sourceKind = "canonical forge output",
                    worldId = "Tunya",
                    regionId = RegionId,
                    buildingId = ForgeBuildingId,
                    generationRule = "golden-slice:forge-output",
                    gameplayBindings = new List<string> { "FabricationComposer", "GunsmithingComposer", "ConKay.InspectGoldenSlice" },
                    loreSources = new List<string> { "sangree_smith_orla", "sandrun_forge_quarter" }
                }
            };
            Bridge.Containers.Register(record);
        }

        public string TryInteract(Vector3 position)
        {
            if (!IsConfigured || Bridge == null || Bridge.Player == null || Bridge.Player.world != WorldId.Tunya) return null;
            var marker = NearestMarker(position, 3.8f);
            if (marker == null) return null;
            if (marker.kind == GoldenSliceMarkerKind.OreSource) return GatherOre();
            return ForgeOrEquip();
        }

        string GatherOre()
        {
            var result = Bridge.Economy.Gather("player", OreSourceId, Bridge.PlayerInventory.inventoryId);
            if (!result.success) return result.message;
            Bridge.RecordConsequence("golden-slice", "ore-gathered", "Iron ore gathered", "Ore came from the canonical Concordia_IronOreVein source in the Sandrun forge quarter.", "player", OreObjectId, OreSourceId, result.quantity);
            Bridge.Containers.SyncAll();
            Bridge.Save();
            return result.message + " The forge can now work it.";
        }

        string ForgeOrEquip()
        {
            RebindCompletedWeapon();
            if (!string.IsNullOrEmpty(CompletedWeaponId))
            {
                EquipCompletedWeapon();
                return "Equipped the signed Sandrun forge weapon.";
            }
            var craft = Bridge.Economy.Craft("player", RecipeId, Bridge.PlayerInventory.inventoryId, 1, ForgeBuildingId);
            if (!craft.success) return "The forge needs one gathered iron ore. " + craft.message;
            var fabricRecipe = BuildFabricationRecipe();
            var fabricContext = new FabricationCompositionContext
            {
                instanceId = "sandrun-sanguire-weapon-1",
                actorId = "player",
                ownerId = "player",
                factionId = "sandrun_sanguire",
                sourceLocationId = ForgeBuildingId,
                containerId = OutputContainerId,
                createdAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                inspectionBonus = 0.08f
            };
            var fabricated = Bridge.TryFabricate(fabricRecipe, fabricContext);
            if (!fabricated.success || fabricated.fabricatedObject == null) return fabricated.message;
            fabricated.fabricatedObject.provenance.rootSourceId = OreSourceId;
            fabricated.fabricatedObject.provenance.links.Add(new FabricationProvenanceLink
            {
                linkId = FabricationId.Create("golden-ore-link", fabricated.fabricatedObject.objectId, OreSourceId),
                parentLinkId = fabricated.fabricatedObject.provenance.links.Count == 0 ? "" : fabricated.fabricatedObject.provenance.links[fabricated.fabricatedObject.provenance.links.Count - 1].linkId,
                stage = "ore-source",
                sourceId = OreSourceId,
                actorId = "player",
                locationId = RegionId,
                occurredAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture),
                detail = "Iron ore gathered through WorldSystemsEconomyService.Gather."
            });
            var putFabric = Bridge.Containers.Put(OutputContainerId, "player", new ContainerItemStack(fabricated.fabricatedObject.objectId, 1f, 1f, fabricated.fabricatedObject.provenance.provenanceId));
            if (!putFabric.success) return putFabric.message;
            var weapon = Bridge.TryGunsmith(BuildWeapon(fabricated.fabricatedObject.objectId), new WeaponCompositionContext
            {
                instanceId = "sandrun-sanguire-weapon-1",
                actorId = "player",
                locationId = ForgeBuildingId,
                sourceWorldId = "Tunya",
                createdAtUtc = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)
            });
            if (!weapon.success || weapon.weapon == null) return weapon.message;
            CompletedWeaponId = weapon.weapon.persistentWeaponId;
            Bridge.Containers.Put(OutputContainerId, "player", new ContainerItemStack(CompletedWeaponId, 1f, 1f, weapon.weapon.provenance == null ? "" : weapon.weapon.provenance.provenanceId));
            Bridge.RecordConsequence("golden-slice", "weapon-equipped", weapon.weapon.configuration.displayName, "Gathered ore became a forged object, a gunsmithed weapon, a canonical container item, and player equipment.", OreSourceId, CompletedWeaponId, ForgeBuildingId, weapon.weapon.lastResolvedStats.damage);
            EquipCompletedWeapon();
            Bridge.Containers.SyncAll();
            Bridge.Save();
            return "Forged and equipped " + weapon.weapon.configuration.displayName + ".";
        }

        void EquipCompletedWeapon()
        {
            if (Bridge == null || Bridge.Player == null || string.IsNullOrEmpty(CompletedWeaponId)) return;
            Bridge.Player.HoldFromBag(CompletedWeaponId);
            Bridge.RecordConsequence("equipment", "equip", "Player equipment updated", "The composed weapon reached the existing ConcordiaPlayer and KitBag equipment path.", "player", CompletedWeaponId, "ConcordiaPlayer.HoldFromBag");
        }

        void RebindCompletedWeapon()
        {
            if (Bridge == null || Bridge.ComposedWeapons == null) return;
            foreach (var weapon in Bridge.ComposedWeapons)
            {
                if (weapon == null || weapon.configuration == null) continue;
                if (weapon.configuration.originWorld == WorldId.Tunya && weapon.configuration.sourceFabricationObjectId != null && weapon.configuration.sourceFabricationObjectId.Contains("fabricated-"))
                {
                    CompletedWeaponId = weapon.persistentWeaponId;
                    return;
                }
            }
        }

        GoldenSliceMarker NearestMarker(Vector3 position, float radius)
        {
            GoldenSliceMarker best = null;
            var bestDistance = radius;
            var markers = FindObjectsByType<GoldenSliceMarker>(FindObjectsInactive.Exclude, FindObjectsSortMode.None);
            for (var i = 0; i < markers.Length; i++)
            {
                var marker = markers[i];
                if (!marker || marker.transform.IsChildOf(transform)) continue;
                var distance = Vector3.Distance(position, marker.transform.position);
                if (distance < bestDistance) { bestDistance = distance; best = marker; }
            }
            return best;
        }

        FabricationRecipeContract BuildFabricationRecipe()
        {
            var recipe = new FabricationRecipeContract
            {
                recipeId = "fabrication/tunya/sandrun/signed-greatsword",
                displayName = "Signed Sandrun Greatsword Blank",
                domain = FabricationDomain.Weapon,
                material = new FabricationMaterialSpec { materialId = MaterialId, displayName = "Sandrun iron ingot", materialClass = FabricationMaterialClass.Metal, purity = 0.86f, density = 7.6f, baseQuality = 0.72f, tags = new List<string> { "tunya", "sandrun", "live-steel", "iron" } },
                shape = new FabricationShapeSpec { shapeId = "greatsword-blade", displayName = "Greatsword blade", kind = FabricationShapeKind.Blade, scale = 1.2f, complexity = 0.22f },
                method = new FabricationMethodSpec { methodId = "sangree-forged", displayName = "Sangree forge work", kind = FabricationMethodKind.Forged, qualityModifier = 0.16f, durabilityModifier = 1.12f, tags = new List<string> { "forge", "signed-work" } },
                quality = new FabricationQualitySpec { baseScore = 0.64f, materialWeight = 0.45f, methodWeight = 0.35f, inspectionBonus = 0.05f },
                durability = new FabricationDurabilitySpec { maximum = 125f, initialPercent = 1f, wearRate = 0.8f, repairability = 0.9f },
                tags = new List<string> { "weapon", "sandrun", "signed-clan-work", "golden-slice" }
            };
            recipe.components.Add(new FabricationComponentSpec { componentId = "signed-iron-core", displayName = "Signed iron core", role = "blade", sourceMaterialId = MaterialId, quantity = 1 });
            recipe.components.Add(new FabricationComponentSpec { componentId = "forge-grip", displayName = "Forge grip", role = "grip", sourceMaterialId = MaterialId, quantity = 1 });
            return recipe;
        }

        WeaponConfigurationDto BuildWeapon(string fabricatedObjectId)
        {
            var weapon = new WeaponConfigurationDto
            {
                weaponTemplateId = "sandrun-sanguire-greatsword",
                displayName = "Sandrun Signed Greatsword",
                recipeId = RecipeId,
                sourceFabricationObjectId = fabricatedObjectId,
                fabricationDomain = FabricationDomain.Weapon,
                ownerId = "player",
                originWorld = WorldId.Tunya,
                quality = new WeaponQualityDto { score = 0.82f, grade = FabricationQualityGrade.Superior, inspectionId = fabricatedObjectId },
                wear = new WeaponWearStateDto { maximumDurability = 140f, currentDurability = 140f },
                reliability = new WeaponReliabilityDto { baseReliability = 0.94f },
                tags = new List<string> { "sandrun", "greatsword", "signed-clan-work" }
            };
            weapon.receiver = Part("receiver-sandrun", GunsmithingPartSlot.Receiver, fabricatedObjectId, 2f, 0.12f);
            weapon.barrel = Part("blade-sandrun", GunsmithingPartSlot.Barrel, fabricatedObjectId, 8f, 0.1f);
            weapon.chamberCaliber = Part("greatsword-chamber", GunsmithingPartSlot.ChamberCaliber, fabricatedObjectId, 1f, 0.05f);
            weapon.action = Part("forge-action", GunsmithingPartSlot.Action, fabricatedObjectId, 3f, 0.08f);
            weapon.magazine = Part("grip-magazine", GunsmithingPartSlot.Magazine, fabricatedObjectId, 1f, 0.02f);
            weapon.ammunition = Part("iron-edge-ammunition", GunsmithingPartSlot.Ammunition, fabricatedObjectId, 4f, 0.04f);
            return weapon;
        }

        static WeaponPartDto Part(string id, GunsmithingPartSlot slot, string fabricationId, float damage, float reliability)
        {
            return new WeaponPartDto { partId = id, displayName = id, slot = slot, fabricationObjectId = fabricationId, materialId = MaterialId, quality = 0.82f, condition = 1f, contribution = new WeaponStatContributionDto { damage = damage, reliability = reliability, reason = "Sandrun signed iron work." } };
        }

        public ConKayInspectionSnapshot Inspect(string recordId)
        {
            var snapshot = ConKayInspectionSnapshot.Empty(ConKayInspectionKind.GoldenSlice, "Sandrun forge golden slice", "The slice is not configured in the canonical Tunya settlement.", "GoldenSliceRuntime / canonical authorities");
            snapshot.stableId = string.IsNullOrEmpty(recordId) ? SettlementId : recordId;
            snapshot.authoritativeRecordFound = IsConfigured;
            snapshot.why = IsConfigured ? "The selected authored settlement is the sole runtime authority; mine, forge, economy, composition, container, equipment, save, and inspection links are bound." : snapshot.why;
            snapshot.Fact("settlement", SettlementId, "GoldenSliceRuntime.SettlementId");
            snapshot.Fact("region", RegionId, "GoldenSliceRuntime.RegionId");
            snapshot.Fact("oreSource", OreSourceId, "WorldSystemsGatheringSourceContract.sourceId");
            snapshot.Fact("forgeBuilding", ForgeBuildingId, "WorldSystemsBuildingState.buildingId");
            snapshot.Fact("workbenchAsset", WorkbenchAssetPath, "generated asset binding");
            snapshot.Fact("oreAsset", OreAssetPath, "generated asset binding");
            snapshot.Fact("forgePrefab", ForgePrefabPath, "generated asset binding");
            snapshot.Fact("packHorse", HorseAssetPath + " (available-only; no VehicleEntity authority)", "safe binding decision");
            if (Bridge != null && Bridge.PlayerInventory != null) snapshot.Link(Bridge.PlayerInventory.inventoryId, "economy inventory", "ore input and ingot output", "WorldSystemsEconomyService");
            snapshot.Link(OreObjectId, "ore source", "Concordia Iron Ore Vein -> Gather", "WorldFabric + WorldSystemsEconomyService");
            snapshot.Link(ForgeBuildingId, "forge station", "Real Forge / Gunsmith Workbench", "WorldFabric + WorldSystemsSimulation");
            if (Bridge != null && Bridge.FabricatedObjects != null) foreach (var item in Bridge.FabricatedObjects) if (item != null && (string.IsNullOrEmpty(recordId) || item.objectId == recordId)) snapshot.Link(item.objectId, "fabrication", item.displayName, "FabricationComposer");
            if (Bridge != null && Bridge.ComposedWeapons != null) foreach (var item in Bridge.ComposedWeapons) if (item != null) snapshot.Link(item.persistentWeaponId, "weapon", item.configuration == null ? "" : item.configuration.displayName, "GunsmithingComposer");
            snapshot.Link(OutputContainerId, "canonical container", "forge output holds fabricated object and weapon", "CanonicalContainerService");
            if (!string.IsNullOrEmpty(CompletedWeaponId)) snapshot.Link(CompletedWeaponId, "equipment", "player.kitWeapon / KitBag.Equipped", "ConcordiaPlayer");
            return snapshot;
        }

        static int StableSeed(string value)
        {
            unchecked { var hash = 23; if (!string.IsNullOrEmpty(value)) for (var i = 0; i < value.Length; i++) hash = hash * 31 + value[i]; return hash & 0x7fffffff; }
        }
    }

    public static class GoldenSliceEconomyExtensions
    {
        public static WorldSystemsGatheringSourceContract FindGatheringSourceForGoldenSlice(this WorldSystemsEconomyService service, string id)
        {
            if (service == null || service.State == null) return null;
            for (var i = 0; i < service.State.gatheringSources.Count; i++) if (service.State.gatheringSources[i] != null && string.Equals(service.State.gatheringSources[i].sourceId, id, StringComparison.OrdinalIgnoreCase)) return service.State.gatheringSources[i];
            return null;
        }

        public static WorldSystemsRecipeContract FindRecipeForGoldenSlice(this WorldSystemsEconomyService service, string id)
        {
            if (service == null || service.State == null) return null;
            for (var i = 0; i < service.State.recipes.Count; i++) if (service.State.recipes[i] != null && string.Equals(service.State.recipes[i].recipeId, id, StringComparison.OrdinalIgnoreCase)) return service.State.recipes[i];
            return null;
        }
    }
}
