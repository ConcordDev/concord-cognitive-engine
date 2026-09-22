using System;
using UnityEngine;

namespace Concordia.WorldSimulation
{
    /// <summary>Opt-in bridge for an existing GuestNpc. The adapter stores IDs only.</summary>
    public sealed class WorldSimulationNpcAdapter : MonoBehaviour
    {
        public string npcId;
        public string homeId;
        public string jobId;
        public string familyId;
        public string factionId;
        public string settlementId;
        public string scheduleId;
        public bool bindOnStart;
        WorldSimulationService _service;

        void Start()
        {
            if (bindOnStart) Bind(WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service);
        }

        public bool Bind(WorldSimulationService service)
        {
            if (service == null || string.IsNullOrEmpty(npcId)) return false;
            _service = service;
            service.UpsertNpc(new NpcSocialState { npcId = npcId, homeId = homeId, jobId = jobId, familyId = familyId, factionId = factionId, settlementId = settlementId, scheduleId = scheduleId });
            return true;
        }

        public bool BindExistingGuest(WorldSimulationService service, GuestNpc guest)
        {
            if (guest == null) return false;
            var resolved = !string.IsNullOrEmpty(npcId) ? npcId : guest.personId;
            if (string.IsNullOrEmpty(resolved) && guest.def != null) resolved = guest.def.id;
            if (string.IsNullOrEmpty(resolved)) return false;
            npcId = resolved;
            var displayName = guest.def == null ? string.Empty : guest.def.name;
            if (service == null) service = WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service;
            if (service == null) return false;
            _service = service;
            service.UpsertNpc(new NpcSocialState { npcId = npcId, displayName = displayName, homeId = homeId, jobId = jobId, familyId = familyId, factionId = factionId, settlementId = settlementId, scheduleId = scheduleId });
            return true;
        }

        public void SetActivity(string activity, bool available = true)
        {
            if (_service == null) return;
            var npc = _service.FindNpc(npcId); if (npc == null) return;
            npc.currentActivity = activity ?? "idle"; npc.available = available;
        }

        public void Unbind()
        {
            _service = null;
        }
    }

    /// <summary>Opt-in bridge for an existing CreatureGenome/CreatureCompiler result.</summary>
    public sealed class WorldSimulationCreatureAdapter : MonoBehaviour
    {
        public string creatureId;
        public string speciesId;
        public string habitatId;
        public bool bindOnStart;
        WorldSimulationService _service;

        void Start()
        {
            if (bindOnStart) Bind(WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service);
        }

        public bool Bind(WorldSimulationService service)
        {
            if (service == null || string.IsNullOrEmpty(creatureId)) return false;
            _service = service;
            service.UpsertCreature(new CreatureState { creatureId = creatureId, speciesId = speciesId, habitatId = habitatId });
            return true;
        }

        public bool BindExistingGenome(WorldSimulationService service, CreatureGenome genome)
        {
            if (genome == null || string.IsNullOrEmpty(genome.id)) return false;
            creatureId = genome.id; if (string.IsNullOrEmpty(speciesId)) speciesId = genome.speciesId;
            if (service == null) service = WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service;
            return Bind(service);
        }

        public bool SetTamed(string handlerId, float progress = 1f)
        {
            return _service != null && _service.SetTaming(creatureId, handlerId, progress, progress >= 1f ? TamingStatus.Tamed : TamingStatus.Bonding);
        }
    }

    /// <summary>
    /// Imports stable region/settlement identities from WorldGeography into habitat DTOs.
    /// WorldGeography remains authoritative for geometry and placement.
    /// </summary>
    public sealed class WorldSimulationGeographyAdapter : MonoBehaviour
    {
        public WorldId world = WorldId.Hub;
        public bool syncOnStart;
        WorldSimulationService _service;

        void Start()
        {
            if (syncOnStart) Sync(WorldSimulationHost.Active == null ? null : WorldSimulationHost.Active.Service);
        }

        public int Sync(WorldSimulationService service)
        {
            if (service == null) return 0;
            _service = service; WorldGeography.EnsureBuilt(); var count = 0;
            var regions = WorldGeography.Regions(world);
            for (var i = 0; i < regions.Count; i++)
            {
                var region = regions[i]; if (region == null || region.id == null) continue;
                service.UpsertHabitat(new HabitatState { habitatId = StableWorldId.Combine("region", region.id.ToString()), regionId = region.id.ToString(), kind = HabitatKind.Unknown, quality = 1f, carryingCapacity = 100 }); count++;
            }
            var settlements = WorldGeography.Settlements(world);
            for (var i = 0; i < settlements.Count; i++)
            {
                var settlement = settlements[i]; if (settlement == null || settlement.id == null) continue;
                service.UpsertHabitat(new HabitatState { habitatId = StableWorldId.Combine("settlement", settlement.id.ToString()), regionId = settlement.region == null ? string.Empty : settlement.region.ToString(), settlementId = settlement.id.ToString(), kind = HabitatKind.Settlement, quality = 1f, carryingCapacity = Mathf.Max(1, settlement.populationBaseline) }); count++;
            }
            return count;
        }
    }
}
