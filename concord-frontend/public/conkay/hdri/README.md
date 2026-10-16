# ConKay studio HDRI

`kloofendal_48d_partly_cloudy_puresky_1k.hdr` is Poly Haven's
"Kloofendal 48d Partly Cloudy (Pure Sky)" by Greg Zaal, CC0
(https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky), scaled from
the 2k copy in the Unity project (`apps/concordia-living-world/unity-client/
Assets/Concordia/PolyHaven/HDRIs/`) to 1024×512 with Blender.

The AssemblyViewer's Studio mode lights and reflects the car with it (the
background stays a flat studio grey), and falls back to three.js
RoomEnvironment if it fails to load. Lighting only: it never touches geometry.
