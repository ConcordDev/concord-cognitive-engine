using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Materialize / dematerialize NPCs by StreamLodBand.
    /// Full = GameObject live; Simulation = husk + StreamNpcSim record;
    /// Abstract/Visual = deactivated husk + data-only schedule in StreamNpcSim.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class StreamNpcPresence : MonoBehaviour
    {
        public StreamLodBand Band { get; private set; } = StreamLodBand.Full;
        public string SimId { get; private set; }

        NpcLife _life;
        CharacterController _cc;
        Renderer[] _rend;
        bool _bound;

        void Awake() => Bind();

        public void BindSimId(string id)
        {
            if (!string.IsNullOrEmpty(id)) SimId = id;
        }

        void Bind()
        {
            if (_bound) return;
            _life = GetComponent<NpcLife>();
            _cc = GetComponent<CharacterController>();
            _rend = GetComponentsInChildren<Renderer>(true);
            _bound = true;
            if (string.IsNullOrEmpty(SimId)) SimId = gameObject.name;
        }

        void LateUpdate()
        {
            if (((Time.frameCount + (SimId ?? name).GetHashCode()) & 7) != 0) return;
            var player = ConcordiaPlayer.Live;
            if (!player) return;
            var band = WorldStreamManager.BandForDistance(
                Vector3.Distance(player.transform.position, transform.position));
            Apply(band);
        }

        public void Apply(StreamLodBand band)
        {
            if (!_bound) Bind();
            if (Band == band) return;
            var prev = Band;
            Band = band;
            switch (band)
            {
                case StreamLodBand.Full:
                    Materialize(fullAi: true);
                    if (StreamNpcSim.TryGet(SimId, out var rec))
                    {
                        rec.Body = gameObject;
                        rec.Band = StreamLodBand.Full;
                        rec.Pos = transform.position;
                    }
                    break;
                case StreamLodBand.Simulation:
                    DematerializeVisual();
                    if (_life) _life.enabled = false;
                    StreamNpcSim.ParkFromBody(gameObject, StreamLodBand.Simulation);
                    break;
                default:
                    DematerializeVisual();
                    if (_life) _life.enabled = false;
                    StreamNpcSim.ParkFromBody(gameObject, band);
                    // Keep husk for cheap rematerialize — data sim owns schedule.
                    if (gameObject.activeSelf) gameObject.SetActive(false);
                    return;
            }
            if (!gameObject.activeSelf) gameObject.SetActive(true);
            _ = prev;
        }

        void Materialize(bool fullAi)
        {
            if (!gameObject.activeSelf) gameObject.SetActive(true);
            if (_rend == null) _rend = GetComponentsInChildren<Renderer>(true);
            foreach (var r in _rend) if (r) r.enabled = true;
            if (_cc) _cc.enabled = true;
            if (_life) _life.enabled = fullAi;
        }

        void DematerializeVisual()
        {
            if (_rend == null) _rend = GetComponentsInChildren<Renderer>(true);
            foreach (var r in _rend) if (r) r.enabled = false;
            if (_cc) _cc.enabled = false;
        }
    }
}
