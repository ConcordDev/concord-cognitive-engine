using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

namespace Concordia
{
    /// <summary>
    /// GET /api/evo-asset/resolve?source=&sourceId= — same IDs as world-lens.
    /// </summary>
    public class EvoResolver : MonoBehaviour
    {
        [SerializeField] string apiRoot = "https://live.concordos.ai";

        public IEnumerator Resolve(string source, string sourceId, System.Action<string> onUrl)
        {
            var url = apiRoot + "/api/evo-asset/resolve?source=" + UnityWebRequest.EscapeURL(source)
                + "&sourceId=" + UnityWebRequest.EscapeURL(sourceId);
            using var req = UnityWebRequest.Get(url);
            yield return req.SendWebRequest();
            if (req.result != UnityWebRequest.Result.Success)
            {
                onUrl?.Invoke(null);
                yield break;
            }
            var t = req.downloadHandler.text;
            var marker = "\"url\":\"";
            var i = t.IndexOf(marker, System.StringComparison.Ordinal);
            if (i < 0) { onUrl?.Invoke(null); yield break; }
            var start = i + marker.Length;
            var end = t.IndexOf('"', start);
            onUrl?.Invoke(end > start ? t.Substring(start, end - start) : null);
        }
    }
}
