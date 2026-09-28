using System;
using System.IO;
using UnityEngine;
using Concordia.GameplayCore.Persistence;

namespace Concordia.WorldSimulation
{
    /// <summary>
    /// Optional persistence host. Placing this component in a scene opts the
    /// additive service into runtime ticking; it does not replace existing hosts.
    /// </summary>
    public sealed class WorldSimulationHost : MonoBehaviour
    {
        public static WorldSimulationHost Active { get; private set; }
        public int worldSeed;
        public string saveFileName = "concordia_world_simulation.json";
        public bool loadOnAwake = true;
        public bool saveOnApplicationQuit = true;
        public WorldSimulationService Service { get; private set; }
        public event Action<WorldSimulationEvent> EventRaised;

        string SavePath => Path.Combine(Application.persistentDataPath, string.IsNullOrEmpty(saveFileName) ? "concordia_world_simulation.json" : saveFileName);

        void Awake()
        {
            if (Active != null && Active != this) { Destroy(gameObject); return; }
            Active = this;
            Service = new WorldSimulationService(worldSeed);
            Service.EventRaised += ForwardEvent;
            if (loadOnAwake)
            {
                bool importedLegacy;
                string error;
                if (!ConcordiaPersistenceService.TryRestoreWorldSimulation(this, SavePath, out importedLegacy, out error)
                    && !string.IsNullOrEmpty(error))
                    Debug.LogWarning("World simulation load failed: " + error);
                else if (importedLegacy)
                    Debug.Log("World simulation legacy state imported into unified persistence.");
            }
        }

        void Update()
        {
            // Force Full used to Tick every frame and hang post-Dress; cadence via AllowSimHostTick.
            if (!ConcordiaHost.AllowSimHostTick()) return;
            if (Service != null) Service.Tick(Time.deltaTime);
        }

        void OnApplicationQuit()
        {
#if UNITY_EDITOR
            if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return;
#endif
            if (saveOnApplicationQuit) Save();
        }

        public void Save()
        {
            string error;
            if (!ConcordiaPersistenceService.TrySave(out error) && !string.IsNullOrEmpty(error))
                Debug.LogWarning("World simulation unified save failed: " + error);
        }

        void ForwardEvent(WorldSimulationEvent record)
        {
            EventRaised?.Invoke(record);
        }

        void OnDestroy()
        {
            if (Service != null) Service.EventRaised -= ForwardEvent;
            if (Active == this) Active = null;
        }
    }
}
