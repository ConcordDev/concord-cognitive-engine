using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia.WorldSystems
{
    /// <summary>
    /// Application service for the construction/economy vertical slice.
    /// WorldSystemsSimulation remains the authority for BuildingState and StorefrontItem;
    /// this service only coordinates additional contracts and delegates shop mutations to it.
    /// </summary>
    public sealed class WorldSystemsEconomyService
    {
        WorldSystemsHost _host;
        int _recordSequence;

        public WorldSystemsHost Host { get { return _host; } }
        public WorldSystemsSimulation Simulation { get { return _host == null ? null : _host.Simulation; } }
        public WorldSystemsEconomyState State { get; private set; }

        public WorldSystemsEconomyService(WorldSystemsHost host, WorldSystemsEconomyState state = null)
        {
            _host = host;
            State = state ?? new WorldSystemsEconomyState();
        }

        public static WorldSystemsEconomyService ForActiveHost(WorldSystemsEconomyState state = null)
        {
            return WorldSystemsHost.Active == null ? null : new WorldSystemsEconomyService(WorldSystemsHost.Active, state);
        }

        public void Bind(WorldSystemsHost host)
        {
            _host = host;
        }

        public void RegisterCatalog(WorldSystemsEconomyCatalog catalog)
        {
            if (catalog == null) return;
            RegisterAll(catalog.gatheringSources);
            RegisterAll(catalog.recipes);
            RegisterAll(catalog.markets);
            RegisterAll(catalog.jobs);
            RegisterAll(catalog.ownership);
            RegisterAll(catalog.construction);
            RegisterAll(catalog.infrastructure);
        }

        public bool RegisterInventory(WorldSystemsInventoryContract inventory)
        {
            if (inventory == null || string.IsNullOrEmpty(inventory.inventoryId)) return false;
            if (FindInventory(inventory.inventoryId) != null) return false;
            State.inventories.Add(inventory);
            return true;
        }

        public bool RegisterGatheringSource(WorldSystemsGatheringSourceContract source)
        {
            if (source == null || string.IsNullOrEmpty(source.sourceId) || string.IsNullOrEmpty(source.resourceId)) return false;
            if (FindGatheringSource(source.sourceId) != null) return false;
            if (source.maximumAvailable <= 0f) source.maximumAvailable = Mathf.Max(1f, source.available);
            if (source.available <= 0f) source.available = source.maximumAvailable;
            State.gatheringSources.Add(source);
            return true;
        }

        public bool RegisterRecipe(WorldSystemsRecipeContract recipe)
        {
            if (recipe == null || string.IsNullOrEmpty(recipe.recipeId) || recipe.outputs == null || recipe.outputs.Count == 0) return false;
            if (FindRecipe(recipe.recipeId) != null) return false;
            State.recipes.Add(recipe);
            return true;
        }

        public bool RegisterMarket(WorldSystemsMarketContract market)
        {
            if (market == null || string.IsNullOrEmpty(market.storefrontId) || string.IsNullOrEmpty(market.resourceId)) return false;
            if (FindMarket(market.storefrontId, market.resourceId) != null) return false;
            market.basePrice = Mathf.Max(0.01f, market.basePrice);
            market.lastPrice = Mathf.Clamp(market.lastPrice <= 0f ? market.basePrice : market.lastPrice, market.minimumPrice, market.maximumPrice);
            State.markets.Add(market);
            RefreshMarketPrice(market);
            return true;
        }

        public bool RegisterJob(WorldSystemsJobContract job)
        {
            if (job == null || string.IsNullOrEmpty(job.jobId) || FindJob(job.jobId) != null) return false;
            job.maximumWorkers = Mathf.Max(1, job.maximumWorkers);
            State.jobs.Add(job);
            return true;
        }

        public bool RegisterOwnership(WorldSystemsOwnershipContract ownership)
        {
            if (ownership == null || string.IsNullOrEmpty(ownership.assetId) || FindOwnership(ownership.assetId) != null) return false;
            State.ownership.Add(ownership);
            ApplyOwnershipToBuilding(ownership);
            return true;
        }

        public bool RegisterConstruction(WorldSystemsConstructionContract project)
        {
            if (project == null || string.IsNullOrEmpty(project.projectId) || string.IsNullOrEmpty(project.buildingId)) return false;
            if (FindConstruction(project.projectId) != null) return false;
            project.requiredWork = Mathf.Max(0.01f, project.requiredWork);
            project.workDone = Mathf.Clamp(project.workDone, 0f, project.requiredWork);
            State.construction.Add(project);
            EnsureBuildingForConstruction(project);
            return true;
        }

        public bool RegisterInfrastructureEffect(WorldSystemsInfrastructureEffectContract effect)
        {
            if (effect == null || string.IsNullOrEmpty(effect.effectId) || FindInfrastructure(effect.effectId) != null) return false;
            State.infrastructure.Add(effect);
            return true;
        }

        public void Tick(float deltaTime)
        {
            var delta = Mathf.Max(0f, deltaTime);
            State.simulationTime += delta;
            for (var i = 0; i < State.gatheringSources.Count; i++)
            {
                var source = State.gatheringSources[i];
                if (source == null || source.respawnSeconds <= 0f || source.available > 0f) continue;
                if (State.simulationTime < source.respawnAt) continue;
                source.available = Mathf.Max(1f, source.maximumAvailable);
            }
            for (var i = 0; i < State.markets.Count; i++)
            {
                var market = State.markets[i];
                if (market == null) continue;
                market.recentSupply = Mathf.Max(0f, market.recentSupply - delta * Mathf.Max(0f, market.recentSupply) * 0.05f);
                market.recentDemand = Mathf.Max(0f, market.recentDemand - delta * Mathf.Max(0f, market.recentDemand) * 0.05f);
                RefreshMarketPrice(market);
            }
        }

        public WorldSystemsEconomyOperationResult Gather(string actorId, string sourceId, string inventoryId)
        {
            var source = FindGatheringSource(sourceId);
            if (source == null) return WorldSystemsEconomyOperationResult.Fail("Gathering source was not found.");
            if (source.available <= 0f) return WorldSystemsEconomyOperationResult.Fail("That source is depleted.");
            if (!CanUseBuilding(source.requiredBuildingId, source.requiredBuildingKind, source.requiresOperationalBuilding, source.settlementId))
                return WorldSystemsEconomyOperationResult.Fail("The required gathering workplace is not operational.");

            var inventory = FindInventory(inventoryId);
            if (inventory == null) return WorldSystemsEconomyOperationResult.Fail("Inventory was not found.");
            var quantity = Mathf.Min(source.available, Mathf.Max(0f, source.yieldPerAction) * GetInfrastructureMultiplier(source.settlementId, WorldSystemsInfrastructureEffectKind.GatheringMultiplier, source.resourceId, null));
            if (quantity <= 0f || !CanAddResource(inventory, source.resourceId, quantity))
                return WorldSystemsEconomyOperationResult.Fail("The inventory cannot hold the gathered resource.");

            AddResourceInternal(inventory, source.resourceId, quantity);
            source.available -= quantity;
            if (source.available <= 0f && source.respawnSeconds > 0f) source.respawnAt = State.simulationTime + source.respawnSeconds;
            Record("gathering", actorId, source.settlementId, source.resourceId, quantity, 0f, true, "Gathered resource from " + source.sourceId + ".");
            return new WorldSystemsEconomyOperationResult { success = true, message = "Gathered " + quantity.ToString("0.##") + " " + source.resourceId + ".", resourceId = source.resourceId, quantity = quantity };
        }

        public WorldSystemsEconomyOperationResult Craft(string actorId, string recipeId, string inventoryId, int quantity, string buildingId)
        {
            var recipe = FindRecipe(recipeId);
            if (recipe == null) return WorldSystemsEconomyOperationResult.Fail("Recipe was not found.");
            if (quantity <= 0) return WorldSystemsEconomyOperationResult.Fail("Craft quantity must be positive.");
            if (recipe.requiresBuilding)
            {
                if (!string.IsNullOrEmpty(recipe.requiredBuildingId) && !string.IsNullOrEmpty(buildingId) && !Same(recipe.requiredBuildingId, buildingId))
                    return WorldSystemsEconomyOperationResult.Fail("The selected crafting building does not match the recipe.");
                var selectedBuildingId = string.IsNullOrEmpty(buildingId) ? recipe.requiredBuildingId : buildingId;
                if (!CanUseBuilding(selectedBuildingId, recipe.requiredBuildingKind, true, null))
                    return WorldSystemsEconomyOperationResult.Fail("The required crafting building is not operational.");
            }

            var inventory = FindInventory(inventoryId);
            if (inventory == null) return WorldSystemsEconomyOperationResult.Fail("Inventory was not found.");
            var outputMultiplier = GetInfrastructureMultiplier(null, WorldSystemsInfrastructureEffectKind.ProductionMultiplier, null, buildingId);
            for (var i = 0; i < recipe.inputs.Count; i++)
            {
                var input = recipe.inputs[i];
                if (input == null || !HasResource(inventory, input.resourceId, input.quantity * quantity))
                    return WorldSystemsEconomyOperationResult.Fail("Missing crafting input " + (input == null ? "unknown" : input.resourceId) + ".");
            }
            for (var i = 0; i < recipe.outputs.Count; i++)
            {
                var output = recipe.outputs[i];
                if (output == null || !CanAddResource(inventory, output.resourceId, output.quantity * quantity * outputMultiplier))
                    return WorldSystemsEconomyOperationResult.Fail("The inventory cannot hold the crafted output.");
            }
            for (var i = 0; i < recipe.inputs.Count; i++)
                RemoveResourceInternal(inventory, recipe.inputs[i].resourceId, recipe.inputs[i].quantity * quantity);
            var totalOutput = 0f;
            for (var i = 0; i < recipe.outputs.Count; i++)
            {
                var output = recipe.outputs[i];
                var produced = output.quantity * quantity * outputMultiplier;
                AddResourceInternal(inventory, output.resourceId, produced);
                totalOutput += produced;
                Record("production", actorId, null, output.resourceId, produced, 0f, true, "Produced " + output.resourceId + " from recipe " + recipe.recipeId + ".");
            }
            return new WorldSystemsEconomyOperationResult { success = true, message = "Crafted " + quantity + " " + (string.IsNullOrEmpty(recipe.displayName) ? recipe.recipeId : recipe.displayName) + ".", quantity = totalOutput };
        }

public WorldSystemsShopQuote GetShopQuote(string storefrontId, string itemId, float quantity)
        {
            return GetShopQuote(storefrontId, itemId, quantity, 1f);
        }

        public WorldSystemsShopQuote GetShopQuote(string storefrontId, string itemId, float quantity, float priceMultiplier)
        {
            var quote = new WorldSystemsShopQuote { storefrontId = storefrontId, itemId = itemId, requestedQuantity = Mathf.Max(0f, quantity) };
            if (Simulation == null || quote.requestedQuantity <= 0f) return quote;
            var offers = Simulation.GetOffers(storefrontId);
            for (var i = 0; i < offers.Length; i++)
            {
                var offer = offers[i];
                if (offer == null || !Same(offer.itemId, itemId)) continue;
                var market = FindMarket(storefrontId, offer.resource);
                if (market != null) RefreshMarketPrice(market);
                quote.available = offer.quantity >= quote.requestedQuantity;
                quote.resourceId = offer.resource;
                quote.availableQuantity = offer.quantity;
                quote.unitPrice = offer.unitPrice * Mathf.Max(0.01f, priceMultiplier);
                quote.totalPrice = quote.unitPrice * quote.requestedQuantity;
                return quote;
            }
            return quote;
        }

public WorldSystemsEconomyOperationResult BuyFromShop(string actorId, string storefrontId, string itemId, float quantity, string inventoryId)
        {
            return BuyFromShop(actorId, storefrontId, itemId, quantity, inventoryId, 1f);
        }

        public WorldSystemsEconomyOperationResult BuyFromShop(string actorId, string storefrontId, string itemId, float quantity, string inventoryId, float priceMultiplier)
        {
            var quote = GetShopQuote(storefrontId, itemId, quantity, priceMultiplier);
            if (!quote.available) return WorldSystemsEconomyOperationResult.Fail("The shop cannot supply that quantity.");
            var inventory = FindInventory(inventoryId);
            if (inventory == null || !CanAddResource(inventory, quote.resourceId, quote.requestedQuantity))
                return WorldSystemsEconomyOperationResult.Fail("The inventory cannot hold the purchase.");
            float price;
            if (Simulation == null || !Simulation.Buy(storefrontId, itemId, quote.requestedQuantity, out price))
                return WorldSystemsEconomyOperationResult.Fail("The shop could not complete the sale.");
            price *= Mathf.Max(0.01f, priceMultiplier);
            AddResourceInternal(inventory, quote.resourceId, quote.requestedQuantity);
            var market = FindMarket(storefrontId, quote.resourceId);
            if (market != null) market.recentDemand += quote.requestedQuantity;
            Record("shop_demand", actorId, null, quote.resourceId, quote.requestedQuantity, price, false, "Bought from storefront " + storefrontId + ".");
            return new WorldSystemsEconomyOperationResult { success = true, message = "Purchased " + quote.resourceId + ".", resourceId = quote.resourceId, quantity = quote.requestedQuantity, unitPrice = price, totalValue = price * quote.requestedQuantity };
        }

        public WorldSystemsEconomyOperationResult SupplyShop(string actorId, string storefrontId, string resourceId, float quantity, float unitPrice)
        {
            if (Simulation == null || string.IsNullOrEmpty(storefrontId) || string.IsNullOrEmpty(resourceId) || quantity <= 0f)
                return WorldSystemsEconomyOperationResult.Fail("Invalid shop supply.");
            var offers = Simulation.GetOffers(storefrontId);
            StorefrontItem offer = null;
            for (var i = 0; i < offers.Length; i++)
                if (offers[i] != null && Same(offers[i].resource, resourceId)) { offer = offers[i]; break; }
            if (offer == null)
            {
                offer = new StorefrontItem { itemId = storefrontId + ":" + resourceId, storefrontId = storefrontId, resource = resourceId, quantity = 0f, targetStock = 0f, unitPrice = Mathf.Max(0.01f, unitPrice) };
                Simulation.State.storefront.Add(offer);
            }
            offer.quantity += quantity;
            if (unitPrice > 0f) offer.unitPrice = unitPrice;
            Simulation.Reindex();
            var market = FindMarket(storefrontId, resourceId);
            if (market != null)
            {
                market.recentSupply += quantity;
                RefreshMarketPrice(market);
            }
            Record("shop_supply", actorId, null, resourceId, quantity, offer.unitPrice * quantity, true, "Supplied storefront " + storefrontId + ".");
            return new WorldSystemsEconomyOperationResult { success = true, message = "Supplied the shop.", resourceId = resourceId, quantity = quantity, unitPrice = offer.unitPrice, totalValue = offer.unitPrice * quantity };
        }

        public bool AssignJob(string actorId, string jobId)
        {
            var job = FindJob(jobId);
            if (job == null || string.IsNullOrEmpty(actorId) || job.workerIds.Contains(actorId)) return false;
            var capacity = job.maximumWorkers + Mathf.FloorToInt(GetInfrastructureValue(job.settlementId, WorldSystemsInfrastructureEffectKind.JobCapacity, null, job.buildingId));
            if (job.workerIds.Count >= Mathf.Max(1, capacity)) return false;
            if (job.requiresOperationalBuilding && !IsOperationalBuilding(job.buildingId)) return false;
            job.workerIds.Add(actorId);
            Record("job_assignment", actorId, job.settlementId, null, 1f, 0f, true, "Assigned to job " + job.jobId + ".");
            return true;
        }

        public bool ReleaseJob(string actorId, string jobId)
        {
            var job = FindJob(jobId);
            if (job == null) return false;
            var removed = job.workerIds.Remove(actorId);
            if (removed) Record("job_release", actorId, job.settlementId, null, 1f, 0f, false, "Released job " + job.jobId + ".");
            return removed;
        }

        public WorldSystemsEconomyOperationResult WorkJob(string actorId, string jobId, float seconds)
        {
            var job = FindJob(jobId);
            if (job == null || !job.workerIds.Contains(actorId) || seconds <= 0f) return WorldSystemsEconomyOperationResult.Fail("Worker is not assigned to that job.");
            var value = seconds * Mathf.Max(0f, job.wagePerSecond);
            Record("job_wage", actorId, job.settlementId, null, seconds, value, true, "Work completed for job " + job.jobId + ".");
            return new WorldSystemsEconomyOperationResult { success = true, message = "Recorded job work.", quantity = seconds, totalValue = value };
        }

        public bool TransferOwnership(string actorId, string assetId, string newOwnerId)
        {
            var ownership = FindOwnership(assetId);
            if (ownership == null || !ownership.transferable || string.IsNullOrEmpty(newOwnerId)) return false;
            if (!string.IsNullOrEmpty(ownership.ownerId) && !Same(ownership.ownerId, actorId)) return false;
            ownership.ownerId = newOwnerId;
            ApplyOwnershipToBuilding(ownership);
            Record("ownership", actorId, ownership.settlementId, null, 1f, 0f, true, "Transferred ownership of " + assetId + " to " + newOwnerId + ".");
            return true;
        }

        public bool BeginConstruction(string actorId, string projectId, string inventoryId)
        {
            var project = FindConstruction(projectId);
            if (project == null || project.status == ConstructionStatus.Complete || project.status == ConstructionStatus.Abandoned) return false;
            var inventory = FindInventory(inventoryId);
            if (inventory == null) return false;
            if (!project.materialsConsumed)
            {
                for (var i = 0; i < project.requiredMaterials.Count; i++)
                {
                    var material = project.requiredMaterials[i];
                    if (material == null || !HasResource(inventory, material.resourceId, material.quantity)) return false;
                }
                for (var i = 0; i < project.requiredMaterials.Count; i++)
                    RemoveResourceInternal(inventory, project.requiredMaterials[i].resourceId, project.requiredMaterials[i].quantity);
                project.materialsConsumed = true;
            }
            project.status = ConstructionStatus.Foundation;
            SyncBuilding(project);
            Record("construction_materials", actorId, project.settlementId, null, 1f, 0f, true, "Materials committed to " + project.projectId + ".");
            return true;
        }

        public WorldSystemsEconomyOperationResult AdvanceConstruction(string actorId, string projectId, float work)
        {
            var project = FindConstruction(projectId);
            if (project == null || project.status == ConstructionStatus.Abandoned || project.status == ConstructionStatus.Complete || work <= 0f)
                return WorldSystemsEconomyOperationResult.Fail("Construction cannot advance.");
            var speed = GetInfrastructureMultiplier(project.settlementId, WorldSystemsInfrastructureEffectKind.ConstructionSpeed, null, project.buildingId);
            project.workDone = Mathf.Clamp(project.workDone + work * speed, 0f, project.requiredWork);
            project.status = project.workDone >= project.requiredWork ? ConstructionStatus.Complete : project.workDone >= project.requiredWork * 0.75f ? ConstructionStatus.Framed : ConstructionStatus.Foundation;
            SyncBuilding(project);
            Record("construction", actorId, project.settlementId, null, work * speed, 0f, true, "Advanced construction " + project.projectId + ".");
            return new WorldSystemsEconomyOperationResult { success = true, message = "Construction is " + (project.workDone / project.requiredWork * 100f).ToString("0") + "% complete.", quantity = project.workDone / project.requiredWork };
        }

        public float GetInfrastructureValue(string settlementId, WorldSystemsInfrastructureEffectKind kind, string resourceId, string buildingId)
        {
            var value = 0f;
            for (var i = 0; i < State.infrastructure.Count; i++)
            {
                var effect = State.infrastructure[i];
                if (effect == null || !effect.enabled || effect.kind != kind || !SameOrBlank(effect.resourceId, resourceId) || !SameOrBlank(effect.targetBuildingId, buildingId)) continue;
                if (!SameOrBlank(effect.settlementId, settlementId) || !IsInfrastructureActive(effect)) continue;
                value += effect.magnitude;
            }
            return value;
        }

        public float GetInfrastructureMultiplier(string settlementId, WorldSystemsInfrastructureEffectKind kind, string resourceId, string buildingId)
        {
            return Mathf.Max(0.01f, 1f + GetInfrastructureValue(settlementId, kind, resourceId, buildingId));
        }

        public WorldSystemsEconomicConsequenceRecord[] GetConsequences(string category)
        {
            var result = new List<WorldSystemsEconomicConsequenceRecord>();
            for (var i = 0; i < State.consequences.Count; i++)
                if (State.consequences[i] != null && (string.IsNullOrEmpty(category) || Same(State.consequences[i].category, category))) result.Add(State.consequences[i]);
            return result.ToArray();
        }

        WorldSystemsInventoryContract FindInventory(string id) { return FindById(State.inventories, id, delegate(WorldSystemsInventoryContract item) { return item.inventoryId; }); }
        WorldSystemsGatheringSourceContract FindGatheringSource(string id) { return FindById(State.gatheringSources, id, delegate(WorldSystemsGatheringSourceContract item) { return item.sourceId; }); }
        WorldSystemsRecipeContract FindRecipe(string id) { return FindById(State.recipes, id, delegate(WorldSystemsRecipeContract item) { return item.recipeId; }); }
        WorldSystemsJobContract FindJob(string id) { return FindById(State.jobs, id, delegate(WorldSystemsJobContract item) { return item.jobId; }); }
        WorldSystemsOwnershipContract FindOwnership(string id) { return FindById(State.ownership, id, delegate(WorldSystemsOwnershipContract item) { return item.assetId; }); }
        WorldSystemsConstructionContract FindConstruction(string id) { return FindById(State.construction, id, delegate(WorldSystemsConstructionContract item) { return item.projectId; }); }
        WorldSystemsInfrastructureEffectContract FindInfrastructure(string id) { return FindById(State.infrastructure, id, delegate(WorldSystemsInfrastructureEffectContract item) { return item.effectId; }); }

        WorldSystemsMarketContract FindMarket(string storefrontId, string resourceId)
        {
            for (var i = 0; i < State.markets.Count; i++)
                if (State.markets[i] != null && Same(State.markets[i].storefrontId, storefrontId) && Same(State.markets[i].resourceId, resourceId)) return State.markets[i];
            return null;
        }

        void RegisterAll<T>(List<T> items) where T : class
        {
            if (items == null) return;
            for (var i = 0; i < items.Count; i++)
            {
                var item = items[i];
                if (item is WorldSystemsGatheringSourceContract) RegisterGatheringSource(item as WorldSystemsGatheringSourceContract);
                else if (item is WorldSystemsRecipeContract) RegisterRecipe(item as WorldSystemsRecipeContract);
                else if (item is WorldSystemsMarketContract) RegisterMarket(item as WorldSystemsMarketContract);
                else if (item is WorldSystemsJobContract) RegisterJob(item as WorldSystemsJobContract);
                else if (item is WorldSystemsOwnershipContract) RegisterOwnership(item as WorldSystemsOwnershipContract);
                else if (item is WorldSystemsConstructionContract) RegisterConstruction(item as WorldSystemsConstructionContract);
                else if (item is WorldSystemsInfrastructureEffectContract) RegisterInfrastructureEffect(item as WorldSystemsInfrastructureEffectContract);
            }
        }

        void RefreshMarketPrice(WorldSystemsMarketContract market)
        {
            if (market == null || Simulation == null) return;
            var stock = 0f;
            var offers = Simulation.GetOffers(market.storefrontId);
            for (var i = 0; i < offers.Length; i++) if (offers[i] != null && Same(offers[i].resource, market.resourceId)) stock += offers[i].quantity;
            var target = Mathf.Max(0.01f, market.targetStock);
            var stockPressure = (target - stock) / target;
            var flowPressure = (market.recentDemand - market.recentSupply) / target;
            market.lastPrice = Mathf.Clamp(market.basePrice * (1f + (stockPressure + flowPressure) * market.priceElasticity), market.minimumPrice, market.maximumPrice);
            for (var i = 0; i < offers.Length; i++) if (offers[i] != null && Same(offers[i].resource, market.resourceId)) offers[i].unitPrice = market.lastPrice;
        }

        bool CanUseBuilding(string buildingId, BuildingKind kind, bool required, string settlementId)
        {
            if (!required) return true;
            if (!string.IsNullOrEmpty(buildingId)) return IsOperationalBuilding(buildingId, kind);
            if (Simulation == null) return false;
            for (var i = 0; i < Simulation.State.buildings.Count; i++)
            {
                var building = Simulation.State.buildings[i];
                if (building != null && building.kind == kind && SameOrBlank(building.settlementId, settlementId) && building.construction == ConstructionStatus.Complete && building.operational) return true;
            }
            return false;
        }

        bool IsOperationalBuilding(string buildingId, BuildingKind kind)
        {
            if (Simulation == null || string.IsNullOrEmpty(buildingId)) return false;
            var building = Simulation.FindBuildingState(buildingId);
            return building != null && building.kind == kind && building.construction == ConstructionStatus.Complete && building.operational;
        }

        bool IsOperationalBuilding(string buildingId)
        {
            if (Simulation == null || string.IsNullOrEmpty(buildingId)) return false;
            var building = Simulation.FindBuildingState(buildingId);
            return building != null && building.construction == ConstructionStatus.Complete && building.operational;
        }

        bool IsInfrastructureActive(WorldSystemsInfrastructureEffectContract effect)
        {
            if (Simulation == null || string.IsNullOrEmpty(effect.infrastructureBuildingId)) return true;
            var building = Simulation.FindBuildingState(effect.infrastructureBuildingId);
            return building != null && building.construction == ConstructionStatus.Complete && building.operational;
        }

        void EnsureBuildingForConstruction(WorldSystemsConstructionContract project)
        {
            if (Simulation == null || Simulation.FindBuildingState(project.buildingId) != null) return;
            Simulation.State.buildings.Add(new BuildingState { buildingId = project.buildingId, settlementId = project.settlementId, ownerId = project.ownerId, factionId = project.factionId, kind = project.kind, construction = project.status, operational = false, condition = 1f, plan = project.plan });
            Simulation.Reindex();
        }

        void SyncBuilding(WorldSystemsConstructionContract project)
        {
            var building = Simulation == null ? null : Simulation.FindBuildingState(project.buildingId);
            if (building == null) return;
            building.construction = project.status;
            building.operational = project.status == ConstructionStatus.Complete;
            building.condition = Mathf.Clamp01(building.condition <= 0f ? 1f : building.condition);
        }

        void ApplyOwnershipToBuilding(WorldSystemsOwnershipContract ownership)
        {
            var building = Simulation == null ? null : Simulation.FindBuildingState(ownership.assetId);
            if (building != null) { building.ownerId = ownership.ownerId; building.factionId = ownership.factionId; }
        }

        void Record(string category, string actorId, string settlementId, string resourceId, float quantity, float value, bool positive, string description)
        {
            State.consequences.Add(new WorldSystemsEconomicConsequenceRecord { recordId = "econ-" + (++_recordSequence).ToString(), simulationTime = State.simulationTime, category = category, actorId = actorId, settlementId = settlementId, resourceId = resourceId, quantity = quantity, value = value, positive = positive, description = description });
        }

        static T FindById<T>(List<T> items, string id, Func<T, string> getId) where T : class
        {
            if (items == null || string.IsNullOrEmpty(id)) return null;
            for (var i = 0; i < items.Count; i++) if (items[i] != null && Same(getId(items[i]), id)) return items[i];
            return null;
        }

        static bool Same(string a, string b) { return string.Equals(a ?? string.Empty, b ?? string.Empty, StringComparison.OrdinalIgnoreCase); }
        static bool SameOrBlank(string a, string b) { return string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b) || Same(a, b); }

        static float GetResource(WorldSystemsInventoryContract inventory, string resourceId)
        {
            if (inventory == null || inventory.resources == null) return 0f;
            for (var i = 0; i < inventory.resources.Count; i++) if (inventory.resources[i] != null && Same(inventory.resources[i].resourceId, resourceId)) return Mathf.Max(0f, inventory.resources[i].quantity);
            return 0f;
        }

        static bool HasResource(WorldSystemsInventoryContract inventory, string resourceId, float quantity) { return quantity >= 0f && GetResource(inventory, resourceId) + 0.0001f >= quantity; }

        static float CurrentQuantity(WorldSystemsInventoryContract inventory)
        {
            var total = 0f;
            if (inventory == null || inventory.resources == null) return total;
            for (var i = 0; i < inventory.resources.Count; i++) if (inventory.resources[i] != null) total += Mathf.Max(0f, inventory.resources[i].quantity);
            return total;
        }

        static bool CanAddResource(WorldSystemsInventoryContract inventory, string resourceId, float quantity)
        {
            return inventory != null && !string.IsNullOrEmpty(resourceId) && quantity >= 0f && (inventory.capacity <= 0f || CurrentQuantity(inventory) + quantity <= inventory.capacity + 0.0001f);
        }

        static void AddResourceInternal(WorldSystemsInventoryContract inventory, string resourceId, float quantity)
        {
            for (var i = 0; i < inventory.resources.Count; i++) if (inventory.resources[i] != null && Same(inventory.resources[i].resourceId, resourceId)) { inventory.resources[i].quantity += quantity; return; }
            inventory.resources.Add(new WorldSystemsResourceStack(resourceId, quantity));
        }

        static void RemoveResourceInternal(WorldSystemsInventoryContract inventory, string resourceId, float quantity)
        {
            for (var i = 0; i < inventory.resources.Count; i++)
            {
                var stack = inventory.resources[i];
                if (stack == null || !Same(stack.resourceId, resourceId)) continue;
                stack.quantity = Mathf.Max(0f, stack.quantity - quantity);
                return;
            }
        }
    }

    public static class WorldSystemsHostEconomyExtensions
    {
        public static WorldSystemsEconomyService CreateEconomyService(this WorldSystemsHost host, WorldSystemsEconomyState state = null, WorldSystemsEconomyCatalog catalog = null)
        {
            if (host == null) return null;
            var service = new WorldSystemsEconomyService(host, state);
            if (catalog != null) service.RegisterCatalog(catalog);
            return service;
        }
    }
}
