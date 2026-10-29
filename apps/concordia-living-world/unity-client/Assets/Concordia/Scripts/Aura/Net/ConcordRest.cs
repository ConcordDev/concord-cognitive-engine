using System.Text;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Networking;

namespace Concordia
{
    /// <summary>
    /// HTTP to the same Concord server the socket is connected to (G-05).
    ///
    /// The origin is ConcordClient.RestOrigin, so REST only ever reaches the server
    /// the live session reached; with no session it answers {ok:false, reason:'no_gateway'}
    /// and sends nothing. The bearer is ConcordClient's own, read in place. In the web
    /// build there is none: the site's login cookie rides along with same-origin requests.
    /// The token never appears in a log line, a result, or an exception message.
    /// </summary>
    public static class ConcordRest
    {
        public struct Result
        {
            public bool ok;
            /// <summary>HTTP status, or 0 when no request reached a server.</summary>
            public long status;
            /// <summary>Why it failed: no_gateway, bad_path, unreachable, timeout, or the server's own reason.</summary>
            public string reason;
            /// <summary>The response body as the server sent it.</summary>
            public string body;

            public override string ToString() => ok ? "ok " + status : "fail " + status + " " + reason;
        }

        public const int TimeoutSeconds = 15;

        public static Task<Result> Get(string path) => Send("GET", path, null);

        public static Task<Result> Post(string path, string json) => Send("POST", path, json ?? "{}");

        static async Task<Result> Send(string method, string path, string json)
        {
            var client = ConcordClient.Live;
            var origin = client ? client.RestOrigin : null;
            if (string.IsNullOrEmpty(origin))
                return new Result { ok = false, reason = "no_gateway" };
            if (string.IsNullOrEmpty(path) || path[0] != '/' || path.StartsWith("//"))
                return new Result { ok = false, reason = "bad_path" };

            using (var req = new UnityWebRequest(origin + path, method))
            {
                req.downloadHandler = new DownloadHandlerBuffer();
                if (json != null)
                {
                    req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));
                    req.SetRequestHeader("Content-Type", "application/json");
                }
                req.SetRequestHeader("Accept", "application/json");
                var bearer = client.RestBearer;
                if (bearer != null) req.SetRequestHeader("Authorization", "Bearer " + bearer);
                req.timeout = TimeoutSeconds;

                var op = req.SendWebRequest();
                while (!op.isDone) await Task.Yield();

                var r = new Result { status = req.responseCode, body = req.downloadHandler?.text ?? "" };
                if (req.result == UnityWebRequest.Result.ConnectionError || r.status == 0)
                {
                    r.reason = (req.error ?? "").ToLowerInvariant().Contains("timed out") ? "timeout" : "unreachable";
                    Debug.LogWarning("[Concordia] ConcordRest " + method + " " + path + " " + r.reason);
                    return r;
                }
                r.ok = r.status >= 200 && r.status < 300 && !SaysNotOk(r.body);
                if (!r.ok) r.reason = ServerReason(r.body) ?? ("http_" + r.status);
                Debug.Log("[Concordia] ConcordRest " + method + " " + path + " → " + r);
                return r;
            }
        }

        /// <summary>
        /// Concord routes answer 200 with {"ok":false,...} for refusals. Only the
        /// top-level "ok" counts; a nested row's ok:false is data, not a refusal.
        /// </summary>
        public static bool SaysNotOk(string body)
        {
            if (string.IsNullOrEmpty(body)) return false;
            int depth = 0;
            bool inString = false;
            for (int i = 0; i < body.Length; i++)
            {
                var c = body[i];
                if (inString)
                {
                    if (c == '\\') { i++; continue; }
                    if (c == '"') inString = false;
                    continue;
                }
                if (c == '{' || c == '[') { depth++; continue; }
                if (c == '}' || c == ']') { depth--; continue; }
                if (c != '"') continue;
                if (depth == 1 && string.CompareOrdinal(body, i, "\"ok\"", 0, 4) == 0)
                {
                    var j = i + 4;
                    while (j < body.Length && (body[j] == ' ' || body[j] == ':')) j++;
                    return string.CompareOrdinal(body, j, "false", 0, 5) == 0;
                }
                inString = true;
            }
            return false;
        }

        [System.Serializable] class ReasonDoc { public string reason; public string error; }

        static string ServerReason(string body)
        {
            if (string.IsNullOrEmpty(body) || body[0] != '{') return null;
            try
            {
                var d = JsonUtility.FromJson<ReasonDoc>(body);
                var why = !string.IsNullOrEmpty(d?.reason) ? d.reason : d?.error;
                return string.IsNullOrEmpty(why) ? null : (why.Length > 120 ? why.Substring(0, 120) : why);
            }
            catch { return null; }
        }
    }
}
