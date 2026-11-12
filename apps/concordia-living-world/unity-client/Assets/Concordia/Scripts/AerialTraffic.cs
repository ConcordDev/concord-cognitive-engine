using System;
using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// `world:aerial-traffic`: the Crosswind Couriers' loops between the Hub's
    /// skydocks (server/lib/aerial-traffic.js). Each frame carries the couriers'
    /// current x/y/z and heading. The server walks a deterministic route at a
    /// steady speed, so between frames a courier keeps flying along its heading.
    ///
    /// Couriers ride flight mounts (hippogriff, gryphon, wyvern). No generated
    /// model of one exists yet, so none is drawn in its place: a courier shows
    /// up only as a feed line when it passes overhead. A generated model indexed
    /// in HubKit under <see cref="CourierStem"/> is flown along the route as
    /// soon as it exists.
    /// </summary>
    public static class AerialTraffic
    {
        public const string CourierStem = "crosswind_courier";
        /// <summary>server DEFAULT_SPEED_MPS: kept under the slowest real flight mount.</summary>
        const float SpeedMps = 9f;
        /// <summary>Horizontal reach at which a pass counts as overhead.</summary>
        const float OverheadM = 90f;

        [Serializable] class Entity { public string id, kind; public float x, y, z, heading; }
        [Serializable] class Data { public string worldId; public Entity[] entities; }
        [Serializable] class Frame { public Data data; }

        static readonly Dictionary<string, AerialCourier> Live = new Dictionary<string, AerialCourier>();
        static readonly HashSet<string> Announced = new HashSet<string>();
        static Transform _hold;

        public static int Count => Live.Count;

        public static void Apply(string frameJson)
        {
            Data d = null;
            try { d = JsonUtility.FromJson<Frame>(frameJson)?.data; }
            catch (Exception e) { Debug.LogWarning("[Concordia] AerialTraffic: unreadable frame (" + e.Message + ")"); }
            if (d?.entities == null) return;

            var seen = new HashSet<string>();
            foreach (var e in d.entities)
            {
                if (e == null || string.IsNullOrEmpty(e.id)) continue;
                seen.Add(e.id);
                var at = new Vector3(e.x, e.y, e.z);
                var yaw = e.heading * Mathf.Rad2Deg;
                if (!Live.TryGetValue(e.id, out var c) || !c)
                {
                    c = Spawn(e.id);
                    Live[e.id] = c;
                    c.transform.SetPositionAndRotation(at, Quaternion.Euler(0f, yaw, 0f));
                }
                c.Correct(at, yaw);
            }

            var gone = new List<string>();
            foreach (var kv in Live) if (!seen.Contains(kv.Key)) gone.Add(kv.Key);
            foreach (var id in gone)
            {
                if (Live[id]) UnityEngine.Object.Destroy(Live[id].gameObject);
                Live.Remove(id);
                Announced.Remove(id);
            }
        }

        static AerialCourier Spawn(string id)
        {
            if (!_hold) _hold = new GameObject("AerialTraffic").transform;
            var go = new GameObject("Courier_" + id);
            go.transform.SetParent(_hold, false);
            var c = go.AddComponent<AerialCourier>();
            c.id = id;
            if (HubKit.TryGet(CourierStem, out var template) && template)
            {
                var art = UnityEngine.Object.Instantiate(template, go.transform);
                art.transform.localPosition = Vector3.zero;
                art.transform.localRotation = Quaternion.identity;
                art.SetActive(true);
            }
            return c;
        }

        internal static void NoteOverhead(AerialCourier c)
        {
            var p = ConcordiaPlayer.Live;
            if (!p || Announced.Contains(c.id)) return;
            var d = c.transform.position - p.transform.position;
            d.y = 0f;
            if (d.magnitude > OverheadM) return;
            Announced.Add(c.id);
            WorldClock.NoteAct("a Crosswind courier passes overhead");
        }

        internal static float Speed => SpeedMps;
    }

    /// <summary>Flies one courier along its heading and eases onto each server fix.</summary>
    public class AerialCourier : MonoBehaviour
    {
        public string id;
        Vector3 _offset;

        public void Correct(Vector3 at, float yaw)
        {
            // Keep flying from where we are; bleed the error out over a few seconds.
            _offset = transform.position - at;
            transform.position = at + _offset;
            transform.rotation = Quaternion.Euler(0f, yaw, 0f);
        }

        void Update()
        {
            var step = transform.forward * AerialTraffic.Speed * Time.deltaTime;
            var bleed = _offset * Mathf.Clamp01(Time.deltaTime * 0.6f);
            _offset -= bleed;
            transform.position += step - bleed;
            AerialTraffic.NoteOverhead(this);
        }
    }
}
