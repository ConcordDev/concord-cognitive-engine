using System.Collections.Generic;
using UnityEngine;

namespace Concordia
{
    /// <summary>
    /// Generated at export by ConcordiaBuildAssetRegistry (never hand-edited):
    /// the project assets a build ships, addressed by their editor path, plus the
    /// lookup keys (FreePacks stems) the editor resolved to them. See BuildAssets.
    /// Assets too heavy for the main download are listed in <see cref="streamed"/>
    /// instead of <see cref="objects"/>: the web export ships each as its own
    /// AssetBundle (StreamingAssets/Streamed/&lt;bundle&gt;), loaded after the world is up.
    /// </summary>
    public class BuildAssetRegistry : ScriptableObject
    {
        public List<string> paths = new List<string>();
        public List<Object> objects = new List<Object>();
        public List<string> keys = new List<string>();
        public List<string> keyPaths = new List<string>();
        public List<string> streamed = new List<string>();
        public List<string> streamedBundles = new List<string>();
    }
}
