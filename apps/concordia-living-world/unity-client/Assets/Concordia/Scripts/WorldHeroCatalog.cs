using System;
using System.Collections;
using UnityEngine;
using Concordia.ConKay;

namespace Concordia
{
    /// <summary>Presentation-only catalog for planner-approved world heroes.</summary>
    public static class WorldHeroCatalog
    {
        public const string RegistryPath = "Assets/Concordia/Generated/WorldContent/WORLD_CONTENT_REGISTRY.json";

public static WorldHeroSpec For(WorldId world)
        {
            if (world == WorldId.Hub)
                return Bound(world, WorldHeroAction.Reuse, "CourtTree.Root", "Assets/Concordia/Generated/RealWorld/Concordia_Real_Oak.prefab", "", "Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat", "hub/unburned-court-canopy", "Chunk_Hub/HubPlaza/CourtTree.Root", 40f, 3f, 2.4f, 0.9f, "planner reuse; producer verified one oak prefab; HubLook source-aware resolver", new[] { "Assets/Concordia/Resources/Concordia/Canon/concordia-hub/lore.json#hub_the_heart_claimed", "Assets/Concordia/Resources/Concordia/Canon/concordia-hub/lore.json#hub_the_ring_of_doors", "Assets/Concordia/Resources/Concordia/Canon/concordia-hub/lore.json#hub_the_one_conquest_attempt" }, new string[0]);

            if (world == WorldId.Ruins)
                return Bound(world, WorldHeroAction.Generate, "RefusalCascadeArchive", "Assets/Generated_Models/RefusalCascadeArchive/RefusalCascadeArchive.fbx", "Assets/Generated_Models/RefusalCascadeArchive/RefusalCascadeArchive_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat", "ruins/refusal-cascade-archive", "Chunk_Ruins/VisualFidelity/RefusalCascadeArchive", 18f, 2.4f, 3.2f, 1.0f, "producer generated bespoke hero from planner brief", new[] { "Assets/Concordia/Resources/Concordia/Canon/sovereign-ruins/lore.json#ruins_lore_glyph_discovery", "Assets/Concordia/Resources/Concordia/Canon/sovereign-ruins/lore.json#ruins_lore_the_cascade", "Assets/Concordia/Resources/Concordia/Canon/sovereign-ruins/lore.json#ruins_lore_evacuation", "Assets/Concordia/Resources/Concordia/Canon/sovereign-ruins/factions.json#ruins_archivists" }, "archive", "cascade", "ruin");
            if (world == WorldId.Tunya)
                return Bound(world, WorldHeroAction.Reuse, "ForgePresentation", "Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge.fbx", "Assets/Generated_Models/Concordia_Sangree_Fire_Forge/Concordia_Sangree_Fire_Forge_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_ObsidianAshForgeStone.mat", "concordia_real_forge", "Chunk_Tunya/GoldenSlice_SandrunSanguire/ForgePresentation", 0f, 0f, 3.2f, 1.0f, "producer reused existing asset; GoldenSliceRuntime remains authoritative", new[] { "Assets/Concordia/Resources/Concordia/Canon/tunya/lore.json#lore_vrellan_arrival", "Assets/Concordia/Resources/Concordia/Canon/tunya/countries.json#sangree", "Assets/Concordia/Resources/Concordia/Canon/tunya/factions.json#sandrun_sanguire", "Assets/Concordia/Resources/Concordia/Canon/tunya/npcs.json#sangree_smith_orla" }, "sandrun", "forge", "workshop");
            if (world == WorldId.Fantasy)
                return Bound(world, WorldHeroAction.Generate, "RootCurseForestShrine", "Assets/Generated_Models/RootCurseForestShrine/RootCurseForestShrine.fbx", "Assets/Generated_Models/RootCurseForestShrine/RootCurseForestShrine_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_RootCurseOrganic.mat", "fantasy/root-curse-forest-shrine", "Chunk_Fantasy/VisualFidelity/RootCurseForestShrine", 16f, 2.2f, 3.0f, 0.95f, "producer generated bespoke hero from planner brief", new[] { "Assets/Concordia/Resources/Concordia/Canon/fantasy/lore.json#fantasy_the_unwatched_realm", "Assets/Concordia/Resources/Concordia/Canon/fantasy/lore.json#lore_root_curse", "Assets/Concordia/Resources/Concordia/Canon/fantasy/lore.json#fantasy_quiet_grove", "Assets/Concordia/Resources/Concordia/Canon/fantasy/factions.json#wildwood_circle", "Assets/Concordia/Resources/Concordia/Canon/fantasy/factions.json#fantasy_obsidian_crown" }, "grove", "root", "wild");
            if (world == WorldId.Frontier)
                return Bound(world, WorldHeroAction.Generate, "FrontierMeshGate", "Assets/Generated_Models/FrontierMeshGate/FrontierMeshGate.fbx", "Assets/Generated_Models/FrontierMeshGate/FrontierMeshGate_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat", "frontier/mesh-gate", "Chunk_Frontier/VisualFidelity/FrontierMeshGate", 12f, 2.1f, 2.8f, 0.9f, "producer generated one bespoke hero at deterministic center", new[] { "Assets/Concordia/Resources/Concordia/Canon/concord-link-frontier/lore.json#frontier_lore_the_mesh_gate", "Assets/Concordia/Resources/Concordia/Canon/concord-link-frontier/lore.json#frontier_lore_handshake_protocol", "Assets/Concordia/Resources/Concordia/Canon/concord-link-frontier/lore.json#frontier_lore_freenode_emergence", "Assets/Concordia/Resources/Concordia/Canon/concord-link-frontier/factions.json#frontier_couriers_guild", "Assets/Concordia/Resources/Concordia/Canon/concord-link-frontier/factions.json#frontier_freenodes" });
            if (world == WorldId.Crime)
                return Bound(world, WorldHeroAction.Generate, "CrimeHero", "Assets/Generated_Models/CrimeHero/CrimeHero.fbx", "Assets/Generated_Models/CrimeHero/CrimeHero_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_WetCourtStone.mat", "crime/dockside-warehouse-evidence", "Chunk_Crime/VisualFidelity/CrimeHero", 16f, 2.2f, 3.0f, 1.0f, "generated exactly once from the audited Crime brief; evidence remains unresolved", new[] { "Assets/Concordia/Resources/Concordia/Canon/crime/lore.json#lore_first_truce", "Assets/Concordia/Resources/Concordia/Canon/crime/lore.json#crime_anchor_disaster", "Assets/Concordia/Resources/Concordia/Canon/crime/lore.json#lore_drone_swarm_aftermath", "Assets/Concordia/Resources/Concordia/Canon/crime/factions.json#ghost_network", "Assets/Concordia/Resources/Concordia/Canon/crime/factions.json#iron_rose_syndicate" }, "dock", "warehouse", "district");
            if (world == WorldId.Cyber)
                return Bound(world, WorldHeroAction.Generate, "GridHero", "Assets/Generated_Models/GridHero/GridHero.fbx", "Assets/Generated_Models/GridHero/GridHero_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat", "cyber/mainframe-substation-blackout-contrast", "Chunk_Cyber/VisualFidelity/GridHero", 18f, 2.5f, 3.2f, 1.0f, "generated exactly once from the audited Grid brief; blackout contrast remains authored context", new[] { "Assets/Concordia/Resources/Concordia/Canon/cyber/lore.json#lore_the_upload", "Assets/Concordia/Resources/Concordia/Canon/cyber/lore.json#lore_first_blackout", "Assets/Concordia/Resources/Concordia/Canon/cyber/lore.json#cyber_quarter_blackout", "Assets/Concordia/Resources/Concordia/Canon/cyber/factions.json#zero_collective", "Assets/Concordia/Resources/Concordia/Canon/cyber/factions.json#blackout_resistance" }, "mainframe", "substation", "blackout", "grid");
            if (world == WorldId.Superhero)
                return Bound(world, WorldHeroAction.Generate, "PermanentDawnHero", "Assets/Generated_Models/PermanentDawnHero/PermanentDawnHero.fbx", "Assets/Generated_Models/PermanentDawnHero/PermanentDawnHero_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_FrontierWeatheredMetal.mat", "superhero/unfinished-dawn-rooftop", "Chunk_Superhero/VisualFidelity/PermanentDawnHero", 20f, 2.6f, 3.4f, 1.0f, "generated exactly once from the audited Permanent Dawn brief; conflict remains unresolved", new[] { "Assets/Concordia/Resources/Concordia/Canon/superhero/lore.json#lore_first_battle_at_dawn", "Assets/Concordia/Resources/Concordia/Canon/superhero/lore.json#lore_first_sighting", "Assets/Concordia/Resources/Concordia/Canon/superhero/lore.json#lore_drone_swarm_incident", "Assets/Concordia/Resources/Concordia/Canon/superhero/factions.json#enforcers_movement", "Assets/Concordia/Resources/Concordia/Canon/superhero/factions.json#luminary_empire" }, "dawn", "rooftop", "luminary", "vertical");
            if (world == WorldId.Crucible)
                return Bound(world, WorldHeroAction.Generate, "SevenDoors", "Assets/Generated_Models/SevenDoors/SevenDoors.fbx", "Assets/Generated_Models/SevenDoors/SevenDoors_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat", "crucible/seven-doors-unclassified", "Chunk_Crucible/VisualFidelity/SevenDoors", 16f, 2.4f, 3.2f, 1.0f, "generated exactly once from the audited Seven Doors brief; seventh door remains unclassified", new[] { "Assets/Concordia/Resources/Concordia/Canon/lattice-crucible/lore.json#crucible_lore_seven_doors", "Assets/Concordia/Resources/Concordia/Canon/lattice-crucible/lore.json#crucible_lore_charter_question", "Assets/Concordia/Resources/Concordia/Canon/lattice-crucible/lore.json#crucible_lore_seventh_door_origin", "Assets/Concordia/Resources/Concordia/Canon/lattice-crucible/lore.json#crucible_lore_drift_walker", "Assets/Concordia/Resources/Concordia/Canon/lattice-crucible/factions.json#crucible_witnesses" }, "central", "observation", "door", "drift");
            if (world == WorldId.Sere)
                return Bound(world, WorldHeroAction.Generate, "FirstLaunchCradle", "Assets/Generated_Models/FirstLaunchCradle/FirstLaunchCradle.fbx", "Assets/Generated_Models/FirstLaunchCradle/FirstLaunchCradle_Material.mat", "Assets/Concordia/Materials/Masters/Concordia_Master_RuinsArchiveStone.mat", "sere/first-launch-cradle", "Chunk_Sere/VisualFidelity/FirstLaunchCradle", 16f, 2.3f, 3.0f, 1.0f, "generated exactly once from the audited First Launch Cradle brief; Deep Watcher remains unpictured", new[] { "Assets/Concordia/Resources/Concordia/Canon/sere/lore.json#lore_sere_the_ark_exodus", "Assets/Concordia/Resources/Concordia/Canon/sere/lore.json#lore_sere_the_quiet_fall", "Assets/Concordia/Resources/Concordia/Canon/sere/lore.json#lore_sere_second_twin_siege", "Assets/Concordia/Resources/Concordia/Canon/sere/factions.json#the_open_table", "Assets/Concordia/Resources/Concordia/Canon/sere/factions.json#the_clearing_spire" }, "launch", "ark", "cradle", "furnace");
            return null;
        }

        public static void BindImmediate(Transform chunk, WorldId world) { Bind(chunk, world); }

public static IEnumerator BindStaged(Transform chunk, WorldId world)
        {
            Bind(chunk, world);
            yield return null;
            yield return null;
        }

        public static void ValidateHubCourt(Transform hubRoot)
        {
            var tree = GameObject.Find("CourtHeroTree");
            if (!tree)
            {
                Debug.LogWarning("[Concordia] WorldContent Hub: CourtHeroTree not present; wrapper validation deferred.");
                return;
            }
            var wrapper = hubRoot == null ? null : hubRoot.Find("CourtTree.Root");
            if (!wrapper && hubRoot != null)
            {
                wrapper = new GameObject("CourtTree.Root").transform;
                wrapper.SetParent(hubRoot, false);
            }
            if (wrapper && tree.transform.parent != wrapper) tree.transform.SetParent(wrapper, true);
            var host = wrapper != null ? wrapper.gameObject : tree;
            var marker = host.GetComponent<WorldHeroMarker>() ?? host.AddComponent<WorldHeroMarker>();
            marker.Bind(For(WorldId.Hub), "bound-editor-wrapper; oak mesh resolved by HubLook.EnsureCourtTreeCanopy");
            marker.verificationState = "reused-existing-prefab; wrapper-and-socket-validation-staged";
            AliasSocket(tree.transform, "CourtTree_BannerSocket_N", "CourtTree.BannerSocket.North");
            AliasSocket(tree.transform, "CourtTree_BannerSocket_E", "CourtTree.BannerSocket.East");
            AliasSocket(tree.transform, "CourtTree_BannerSocket_S", "CourtTree.BannerSocket.South");
            AliasSocket(tree.transform, "CourtTree_BannerSocket_W", "CourtTree.BannerSocket.West");
            if (!wrapper) return;
            var stone = wrapper.Find("CourtStone");
            if (!stone)
            {
                stone = new GameObject("CourtStone").transform;
                stone.SetParent(wrapper, false);
            }
            GroundedSocket(stone, "CourtStone.LanternSocket.North", new Vector3(-10.5f, 0f, 9.5f));
            GroundedSocket(stone, "CourtStone.LanternSocket.East", new Vector3(10.5f, 0f, 9.5f));
            GroundedSocket(stone, "CourtStone.LanternSocket.South", new Vector3(12.5f, 0f, -5.5f));
            GroundedSocket(stone, "CourtStone.LanternSocket.West", new Vector3(-12.5f, 0f, -5.5f));
        }

static void Bind(Transform chunk, WorldId world)
        {
            if (!chunk) return;
            var spec = For(world);
            if (spec == null) return;
            if (world == WorldId.Tunya)
            {
                BindTunyaExisting(chunk, spec);
                return;
            }
            if (spec.action == WorldHeroAction.Defer || world == WorldId.Hub) return;
            var root = chunk.Find("VisualFidelity") ?? chunk;
            if (!root || root.Find(spec.objectName)) return;
            var hero = new GameObject(spec.objectName);
            hero.transform.SetParent(root, false);
            hero.transform.localPosition = ResolvePosition(world, spec);
            var marker = hero.AddComponent<WorldHeroMarker>();
            marker.Bind(spec, "staged-editor-asset-bind; existing resolver hooks only");
            var prefab = FreePacks.Load<GameObject>(spec.assetPath);
            if (prefab)
            {
                var art = UnityEngine.Object.Instantiate(prefab, hero.transform);
                art.name = "Asset";
                art.transform.localPosition = Vector3.zero;
                art.transform.localRotation = Quaternion.identity;
                art.transform.localScale = Vector3.one;
                FreePacks.FitMax(art, spec.maxDimension);
                if (!string.IsNullOrEmpty(spec.masterMaterialPath))
                {
                    FreePacks.ApplyMat(art, spec.masterMaterialPath);
                    marker.materialAssignmentState = "master-material-applied-through-FreePacks.ApplyMat";
                }
                else marker.materialAssignmentState = "generated-material-retained";
                FreePacks.MakeWalkable(art);
                FreePacks.EnsureCollider(hero, spec.colliderHeight);
                Concordia.GameplayCore.Presentation.PresentationSurfaceFidelity.ApplySurfaceAging(art, world, spec.surfaceKey, 0.42f, StableHash(spec.semanticId));
                marker.colliderState = "hero-root-capsule-plus-asset-walkable-collider";
            }
            else
            {
                marker.materialAssignmentState = "asset-unavailable; no visual fallback fabricated";
                marker.colliderState = "not-validated; asset unavailable";
                Debug.LogWarning("[Concordia] WorldContent " + world + ": asset unavailable at " + spec.assetPath + "; keeping a non-visual marker.");
            }
            var inspect = new GameObject("InspectionAnchor");
            inspect.transform.SetParent(hero.transform, false);
            inspect.transform.localPosition = Vector3.up * spec.inspectionHeight;
            var identity = inspect.AddComponent<ConKayIdentity>();
            identity.recordId = spec.semanticId;
            identity.recordKind = ConKayInspectionKind.Object;
            identity.authority = "WorldVisualDirector staged hero presentation";
            marker.inspectionIdentity = spec.semanticId;
            marker.lodPolicy = spec.lodPolicy;
            marker.stagedStatus = spec.stagedStatus;
        }

static void BindTunyaExisting(Transform visualRoot, WorldHeroSpec spec)
        {
            var chunk = visualRoot.parent;
            var holder = chunk ? chunk.Find("GoldenSlice_SandrunSanguire") : null;
            var forge = holder ? holder.Find("ForgePresentation") : null;
            if (!forge)
            {
                Debug.LogWarning("[Concordia] WorldContent Tunya: GoldenSliceRuntime ForgePresentation not ready; no second forge was created.");
                return;
            }
            var marker = forge.GetComponent<WorldHeroMarker>() ?? forge.gameObject.AddComponent<WorldHeroMarker>();
            marker.Bind(spec, "existing GoldenSliceRuntime presentation; catalog does not instantiate Tunya hero");
            if (!string.IsNullOrEmpty(spec.masterMaterialPath))
            {
                FreePacks.ApplyMat(forge.gameObject, spec.masterMaterialPath);
                marker.materialAssignmentState = "master-material-applied-through-FreePacks.ApplyMat; GoldenSliceRuntime remains authority";
            }
            FreePacks.EnsureCollider(forge.gameObject, spec.colliderHeight);
            var identity = forge.GetComponent<ConKayIdentity>() ?? forge.gameObject.AddComponent<ConKayIdentity>();
            identity.recordId = spec.semanticId;
            identity.recordKind = ConKayInspectionKind.Building;
            identity.authority = "GoldenSliceRuntime canonical Tunya forge";
            marker.colliderState = "GoldenSliceRuntime collider preserved; catalog validation hook applied";
            marker.inspectionIdentity = spec.semanticId;
            marker.lodPolicy = "GoldenSliceRuntime presentation; ContinentStream retains L1 impostor and L2/L3 chunk policy";
            marker.stagedStatus = "golden-slice-presented-before-visual-director; validated in staged pass";
        }

        static int StableHash(string text)
        {
            unchecked
            {
                var hash = 23;
                if (!string.IsNullOrEmpty(text))
                    for (var i = 0; i < text.Length; i++) hash = hash * 31 + text[i];
                return hash & 0x7fffffff;
            }
        }


        static Vector3 ResolvePosition(WorldId world, WorldHeroSpec spec)
        {
            if (world == WorldId.Frontier) return Vector3.zero;
            var places = WorldGeography.Places(world);
            for (var i = 0; i < places.Count; i++)
            {
                var place = places[i];
                if (place == null) continue;
                var haystack = ((place.id == null ? "" : place.id.value) + " " + place.kind + " " + place.name).ToLowerInvariant();
                for (var t = 0; t < spec.placeTokens.Length; t++)
                    if (haystack.Contains(spec.placeTokens[t])) return new Vector3(place.localPosition.x, 0f, place.localPosition.y);
            }
            return Vector3.zero;
        }

        static void AliasSocket(Transform parent, string sourceName, string aliasName)
        {
            if (!parent) return;
            var source = parent.Find(sourceName);
            if (!source || parent.Find(aliasName)) return;
            var alias = new GameObject(aliasName).transform;
            alias.SetParent(parent, false);
            alias.position = source.position;
            alias.rotation = source.rotation;
        }

        static void GroundedSocket(Transform parent, string name, Vector3 localPosition)
        {
            var socket = parent.Find(name);
            if (!socket)
            {
                socket = new GameObject(name).transform;
                socket.SetParent(parent, false);
            }
            socket.localPosition = localPosition;
            socket.localRotation = Quaternion.identity;
        }

        static WorldHeroSpec Deferred(WorldId world, string objectName, string bindingPath)
        {
            return Spec(world, WorldHeroAction.Defer, objectName, "", "", world.ToString().ToLowerInvariant() + "/hero-deferred", bindingPath, 0f, 0f, "planner and producer explicitly deferred; no asset fabricated", new string[0]);
        }

static WorldHeroSpec Bound(WorldId world, WorldHeroAction action, string objectName, string assetPath, string materialPath, string masterMaterialPath, string semanticId, string bindingPath, float maxDimension, float inspectionHeight, float colliderHeight, float colliderRadius, string provenance, string[] loreSources, params string[] tokens)
        {
            var spec = Spec(world, action, objectName, assetPath, materialPath, semanticId, bindingPath, maxDimension, inspectionHeight, provenance, tokens);
            spec.masterMaterialPath = masterMaterialPath;
            spec.loreSources = loreSources ?? new string[0];
            spec.colliderHeight = colliderHeight;
            spec.colliderRadius = colliderRadius;
            spec.lodPolicy = "ContinentStream L1 impostor retention; staged full chunk at L2; near interaction at L3";
            spec.inspectionIdentity = semanticId;
            spec.stagedStatus = "WorldVisualDirector.BuildChunkStaged after region boundaries; two-frame hero yield";
            spec.surfaceKey = world == WorldId.Cyber || world == WorldId.Superhero ? "metal_plate" : world == WorldId.Fantasy ? "bark_brown_02" : world == WorldId.Ruins || world == WorldId.Crucible || world == WorldId.Sere ? "old_stone_wall_02" : world == WorldId.Frontier ? "metal_plate_02" : "wet_asphalt";
            return spec;
        }


        static WorldHeroSpec Spec(WorldId world, WorldHeroAction action, string objectName, string assetPath, string materialPath, string semanticId, string bindingPath, float maxDimension, float inspectionHeight, string provenance, string[] tokens)
        {
            return new WorldHeroSpec { world = world, action = action, objectName = objectName, assetPath = assetPath, materialPath = materialPath, semanticId = semanticId, bindingPath = bindingPath, maxDimension = maxDimension, inspectionHeight = inspectionHeight, provenance = provenance, placeTokens = tokens, verificationState = action == WorldHeroAction.Defer ? "deferred" : "registry-bound; staged-presentation" };
        }
    }

    public enum WorldHeroAction { Reuse, Generate, Defer }

    [Serializable]
    public sealed class WorldHeroSpec
    {
        public WorldId world;
        public WorldHeroAction action;
        public string objectName;
        public string assetPath;
        public string materialPath;
        public string masterMaterialPath;
        public string semanticId;
        public string bindingPath;
        public string verificationState;
        public string provenance;
        public string[] loreSources = new string[0];
        public string[] placeTokens = new string[0];
        public string lodPolicy;
        public string inspectionIdentity;
        public string stagedStatus;
        public string surfaceKey;
        public float colliderHeight;
        public float colliderRadius;
        public float maxDimension;
        public float inspectionHeight;
    }

    [DisallowMultipleComponent]
    public sealed class WorldHeroMarker : MonoBehaviour
    {
        public string worldId;
        public string action;
        public string assetPath;
        public string materialPath;
        public string masterMaterialPath;
        public string semanticId;
        public string bindingPath;
        public string verificationState;
        public string provenance;
        public string resolutionNote;
        public string[] loreSources = new string[0];
        public string colliderState;
        public string materialAssignmentState;
        public string lodPolicy;
        public string inspectionIdentity;
        public string stagedStatus;

        public void Bind(WorldHeroSpec spec, string note)
        {
            if (spec == null) return;
            worldId = spec.world.ToString();
            action = spec.action.ToString();
            assetPath = spec.assetPath;
            materialPath = spec.materialPath;
            masterMaterialPath = spec.masterMaterialPath;
            semanticId = spec.semanticId;
            bindingPath = spec.bindingPath;
            verificationState = spec.verificationState;
            provenance = spec.provenance;
            resolutionNote = note;
            loreSources = spec.loreSources;
            lodPolicy = spec.lodPolicy;
            inspectionIdentity = spec.inspectionIdentity;
            stagedStatus = spec.stagedStatus;
        }
    }
}


