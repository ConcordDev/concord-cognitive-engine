using UnityEditor;
using UnityEngine;

namespace Concordia.Editor
{
    [InitializeOnLoad]
    static class SkyImport
    {
        const string Hdr = "Assets/Concordia/Sky/day_puresky_2k.hdr";

        static SkyImport()
        {
            EditorApplication.delayCall += Apply;
        }

        static void Apply()
        {
            var importer = AssetImporter.GetAtPath(Hdr) as TextureImporter;
            if (importer == null) return;
            if (importer.textureShape == TextureImporterShape.TextureCube) return;
            importer.textureShape = TextureImporterShape.TextureCube;
            importer.SaveAndReimport();
        }
    }
}
