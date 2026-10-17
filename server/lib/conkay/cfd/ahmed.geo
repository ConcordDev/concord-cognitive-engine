// Ahmed body, 25 deg slant. Geometry per calibrated-drag.js AHMED_GEOMETRY:
// L 1.044, W 0.389, H 0.288, slant 0.222 along the surface, clearance 0.05,
// front edge radius 0.100 (Ahmed, Ramm & Faltin SAE 840300, Fig. 1 body geometry; not tabulated in
// calibrated-drag.js). Stilts (4 x 30 mm) omitted. Patches: nose / slant / base / rest.
SetFactory("OpenCASCADE");
L = 1.044; W = 0.389; H = 0.288; c = 0.05; R = 0.1; S = 0.222; a = 25*Pi/180;
Box(1) = {0, -W/2, c, L, W, H};
e() = Curve In BoundingBox{-1e-3, -1, -1, 1e-3, 1, 1};
f() = Fillet{1}{e()}{R};
x0 = L - S*Cos(a); zt = c + H; x1 = L + 0.02; z1 = zt - Tan(a)*(x1 - x0);
Point(101) = {x0, -1, zt}; Point(102) = {x1, -1, z1};
Point(103) = {x1, -1, 1};  Point(104) = {x0, -1, 1};
Line(201) = {101,102}; Line(202) = {102,103}; Line(203) = {103,104}; Line(204) = {104,101};
Curve Loop(301) = {201,202,203,204}; Plane Surface(301) = {301};
w() = Extrude{0, 2, 0}{ Surface{301}; };
BooleanDifference{ Volume{f()}; Delete; }{ Volume{w(1)}; Delete; }
e2 = 1e-4;
nose() = Surface In BoundingBox{-e2, -1, -1, R+e2, 1, 1};
base() = Surface In BoundingBox{L-e2, -1, -1, L+e2, 1, 1};
slant() = Surface In BoundingBox{x0-e2, -1, zt-S*Sin(a)-e2, L+e2, 1, zt+e2};
rest() = Surface{:}; rest() -= nose(); rest() -= base(); rest() -= slant();
Printf("nose %g base %g slant %g rest %g", #nose(), #base(), #slant(), #rest());
Physical Surface("nose") = {nose()}; Physical Surface("slant") = {slant()};
Physical Surface("base") = {base()}; Physical Surface("rest") = {rest()};
Mesh.StlOneSolidPerSurface = 2;
Mesh.MeshSizeMax = 0.004; Mesh.MeshSizeMin = 0.001;
Mesh.MeshSizeFromCurvature = 24;
