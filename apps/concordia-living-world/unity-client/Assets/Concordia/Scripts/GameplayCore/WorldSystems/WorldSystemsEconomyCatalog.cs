using System.Collections.Generic;
using UnityEngine;

namespace Concordia.WorldSystems
{
    /// <summary>
    /// Authored, data-only definitions for the world-systems economy slice.
    /// The runtime service registers these definitions; it does not replace WorldSystemsSimulation.
    /// </summary>
    [CreateAssetMenu(menuName = "Concordia/World Systems/Economy Catalog", fileName = "WorldSystemsEconomyCatalog")]
    public sealed class WorldSystemsEconomyCatalog : ScriptableObject
    {
        public List<WorldSystemsGatheringSourceContract> gatheringSources = new List<WorldSystemsGatheringSourceContract>();
        public List<WorldSystemsRecipeContract> recipes = new List<WorldSystemsRecipeContract>();
        public List<WorldSystemsMarketContract> markets = new List<WorldSystemsMarketContract>();
        public List<WorldSystemsJobContract> jobs = new List<WorldSystemsJobContract>();
        public List<WorldSystemsOwnershipContract> ownership = new List<WorldSystemsOwnershipContract>();
        public List<WorldSystemsConstructionContract> construction = new List<WorldSystemsConstructionContract>();
        public List<WorldSystemsInfrastructureEffectContract> infrastructure = new List<WorldSystemsInfrastructureEffectContract>();

        public void RegisterWith(WorldSystemsEconomyService service)
        {
            if (service == null) return;
            service.RegisterCatalog(this);
        }
    }
}
