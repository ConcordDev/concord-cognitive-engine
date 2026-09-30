using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace Concordia.WorldSystems
{
    public enum ConstructionStatus { Planned, Foundation, Framed, Complete, Abandoned }
    public enum BuildingKind { Home, Store, Workshop, Utility, Civic, Workplace }

    [Serializable]
    public sealed class StorefrontItem
    {
        public string itemId;
        public string storefrontId;
        public string resource;
        public float quantity;
        public float targetStock;
        public float unitPrice;
    }

    [Serializable]
    public sealed class BuildingState
    {
        public string buildingId;
        public string settlementId;
        public string ownerId;
        public string factionId;
        public BuildingKind kind;
        public ConstructionStatus construction;
        public bool operational;
        public float condition = 1f;
        public string plan;
    }

    [Serializable]
    public sealed class WorldSystemsState
    {
        public readonly List<BuildingState> buildings = new List<BuildingState>();
        public readonly List<StorefrontItem> storefront = new List<StorefrontItem>();
    }

    public sealed class WorldSystemsSimulation
    {
        public WorldSystemsState State { get; } = new WorldSystemsState();
        readonly Dictionary<string, BuildingState> _buildings = new Dictionary<string, BuildingState>(StringComparer.OrdinalIgnoreCase);
        readonly Dictionary<string, List<StorefrontItem>> _offers = new Dictionary<string, List<StorefrontItem>>(StringComparer.OrdinalIgnoreCase);

        [Serializable]
        sealed class SaveData
        {
            public BuildingState[] buildings;
            public StorefrontItem[] storefront;
        }

        public string ToJson()
        {
            return JsonUtility.ToJson(new SaveData
            {
                buildings = State.buildings.ToArray(),
                storefront = State.storefront.ToArray()
            });
        }

        public void LoadJson(string json)
        {
            if (string.IsNullOrEmpty(json)) return;
            var data = JsonUtility.FromJson<SaveData>(json);
            if (data == null) return;
            State.buildings.Clear();
            State.storefront.Clear();
            if (data.buildings != null) State.buildings.AddRange(data.buildings);
            if (data.storefront != null) State.storefront.AddRange(data.storefront);
            Reindex();
        }

        public void Reindex()
        {
            _buildings.Clear();
            _offers.Clear();
            for (var i = 0; i < State.buildings.Count; i++)
            {
                var building = State.buildings[i];
                if (building != null && !string.IsNullOrEmpty(building.buildingId)) _buildings[building.buildingId] = building;
            }
            for (var i = 0; i < State.storefront.Count; i++)
            {
                var offer = State.storefront[i];
                if (offer == null || string.IsNullOrEmpty(offer.storefrontId)) continue;
                List<StorefrontItem> list;
                if (!_offers.TryGetValue(offer.storefrontId, out list)) _offers[offer.storefrontId] = list = new List<StorefrontItem>();
                list.Add(offer);
            }
        }

        public BuildingState FindBuildingState(string buildingId)
        {
            if (_buildings.Count == 0) Reindex();
            BuildingState state;
            return _buildings.TryGetValue(buildingId ?? string.Empty, out state) ? state : null;
        }

        public StorefrontItem[] GetOffers(string storefrontId)
        {
            if (_offers.Count == 0) Reindex();
            List<StorefrontItem> list;
            return _offers.TryGetValue(storefrontId ?? string.Empty, out list) ? list.ToArray() : Array.Empty<StorefrontItem>();
        }

        public void Tick(float deltaTime)
        {
            var delta = Mathf.Max(0f, deltaTime);
            for (var i = 0; i < State.buildings.Count; i++)
            {
                var building = State.buildings[i];
                if (building == null || !building.operational) continue;
                building.condition = Mathf.Clamp01(building.condition - delta * 0.00001f);
                if (building.condition <= 0.05f) building.operational = false;
            }
        }

        public bool Buy(string storefrontId, string itemId, float quantity, out float price)
        {
            price = 0f;
            var offers = GetOffers(storefrontId);
            for (var i = 0; i < offers.Length; i++)
            {
                var offer = offers[i];
                if (offer.itemId != itemId || offer.quantity < quantity) continue;
                offer.quantity -= quantity;
                price = offer.unitPrice * quantity;
                return true;
            }
            return false;
        }
    }

    public sealed class WorldSystemsHost : MonoBehaviour
    {
        public static WorldSystemsHost Active { get; private set; }
        public WorldSystemsSimulation Simulation { get; private set; }

        void Awake()
        {
            if (Active != null && Active != this) { Destroy(gameObject); return; }
            Active = this;
            Simulation = new WorldSystemsSimulation();
            var savePath = Path.Combine(Application.persistentDataPath, "concordia_worldsystems.json");
            if (File.Exists(savePath))
            {
                try { Simulation.LoadJson(File.ReadAllText(savePath)); }
                catch (System.Exception e) { Debug.LogWarning("World systems load failed: " + e.Message); }
            }
            Simulation.Reindex();
        }

        void Update() { Simulation?.Tick(Time.deltaTime); }
        public void Save()
        {
            if (Simulation == null) return;
            var savePath = Path.Combine(Application.persistentDataPath, "concordia_worldsystems.json");
            try { File.WriteAllText(savePath, Simulation.ToJson()); }
            catch (System.Exception e) { Debug.LogWarning("World systems save failed: " + e.Message); }
        }
        void OnDestroy() { if (Active == this) Active = null; }
    }

    public sealed class WorldSystemsBuildingAdapter : MonoBehaviour
    {
        public string buildingId = "building";
        public string settlementId;
        public string ownerId;
        public string factionId;
        public BuildingKind kind = BuildingKind.Store;
        public string plan = "market";
        WorldSystemsSimulation _simulation;

        public void Bind(WorldSystemsSimulation simulation)
        {
            _simulation = simulation;
            var state = _simulation.FindBuildingState(buildingId);
            if (state == null)
            {
                state = new BuildingState { buildingId = buildingId, settlementId = settlementId, ownerId = ownerId, factionId = factionId, kind = kind, construction = ConstructionStatus.Planned, operational = false, condition = 1f, plan = plan };
                _simulation.State.buildings.Add(state);
                _simulation.Reindex();
            }
        }

        public StorefrontItem[] GetOffers() => _simulation == null ? Array.Empty<StorefrontItem>() : _simulation.GetOffers(buildingId);

        public bool Buy(string itemId, float quantity, out float price)
        {
            price = 0f;
            return _simulation != null && _simulation.Buy(buildingId, itemId, quantity, out price);
        }
    }
}
