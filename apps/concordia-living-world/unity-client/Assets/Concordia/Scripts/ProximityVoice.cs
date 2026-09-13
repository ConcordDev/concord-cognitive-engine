using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Unity-ws proximity voice. Signalling + membership only — this client
    /// does not decode remote audio (no Unity.WebRTC). WebGL reports
    /// voice_unavailable for capture. Peer count is real.
    /// </summary>
    public static class ProximityVoice
    {
        public const float CellM = 50f;
        public static int PeerCount;
        public static string VisitId = "";
        public static string Status = "voice_idle";
        static string _joined;

        public static string HudLine
        {
            get
            {
                if (string.IsNullOrEmpty(VisitId) && PeerCount <= 0) return "";
                return "voice " + PeerCount + " nearby · " + Status;
            }
        }

        public static string CellOf(Vector3 pos, string worldId)
        {
            int cx = Mathf.FloorToInt(pos.x / CellM);
            int cz = Mathf.FloorToInt(pos.z / CellM);
            var world = string.IsNullOrEmpty(worldId) ? "concordia-hub" : worldId;
            return "concordia:" + world + ":" + cx + ":" + cz;
        }

        public static void Tick(Vector3 pos, string worldId)
        {
            var client = ConcordClient.Live;
            if (client == null || !client.Connected)
            {
                Status = "no_gateway";
                return;
            }
            var visit = CellOf(pos, worldId);
            if (visit == _joined) return;
            if (!string.IsNullOrEmpty(_joined))
                client.VoiceLeave(_joined);
            _joined = visit;
            VisitId = visit;
            PeerCount = 0;
#if UNITY_WEBGL && !UNITY_EDITOR
            Status = "voice_unavailable";
#else
            Status = "signalling";
#endif
            client.VoiceJoin(visit);
        }

        public static void OnPeerList(int n)
        {
            PeerCount = Mathf.Max(0, n);
        }

        public static void OnPeerJoined()
        {
            PeerCount++;
        }

        public static void OnPeerLeft()
        {
            if (PeerCount > 0) PeerCount--;
        }

        public static void Reset()
        {
            PeerCount = 0;
            VisitId = "";
            Status = "voice_idle";
            _joined = null;
        }
    }
}
