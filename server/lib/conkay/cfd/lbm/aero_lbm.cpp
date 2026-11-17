// aero_lbm.cpp -- external aerodynamics of a closed STL body (Ahmed body, 25 deg slant, or a car) with
// OpenLB 1.9r0 on one CUDA GPU.
//
// Part of ConKay's aero.lbm case (server/lib/conkay/cfd/lbm). Built against OpenLB (GPL v2 or later)
// and run as a separate process; nothing in Concord links to it. The body surface is z >= 0 with the
// ground at z = 0, nose towards -x, flow towards +x.
//
// Model: D3Q19, single precision; collision selected by --dynamics (smagorinsky = Smagorinsky-BGK,
// rlb = Smagorinsky third-order regularised), both with a per-cell Smagorinsky constant that is raised
// in a sponge zone at the outlet (after Xue et al. 2022, as in OpenLB's nozzle3d example); Bouzidi
// interpolated bounce-back on the body STL (no wall model); fluid at rest at t = 0, inflow and
// moving-ground velocity ramped up over --ramp flow-throughs with OpenLB's fifth-order polynomial start
// curve (updated on the GPU, as in OpenLB's airfoil2d example); local velocity inlet and ground; pressure
// outlet (rho = 1); free-slip top and sides. The force on the body is the momentum exchange over the Bouzidi links
// (OpenLB SuperLatticePhysBoundaryForce3D), summed per surface region. Every key=value argument is
// recorded in the output header; defaults are the values the validated case uses.
#include <olb.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <string>
#include <fstream>
#include <vector>

using namespace olb;
using namespace olb::descriptors;
using namespace olb::names;

using MyCase = Case<NavierStokes, Lattice<float, descriptors::D3Q19<>>>;
using T = MyCase::value_t;
using DESCRIPTOR = MyCase::descriptor_t_of<NavierStokes>;

// ---- Ahmed geometry (m), identical to cfd/ahmed.geo; used only to split the force by surface region
// when --regions=ahmed ----
static const double AH_L = 1.044, AH_W = 0.389, AH_H = 0.288, AH_S = 0.222, AH_C = 0.05, AH_R = 0.1;
static const double AH_ANGLE = 25.0 * M_PI / 180.0;

struct Cfg {
  std::map<std::string, std::string> raw;
  double num(const std::string& k, double d) const { auto i = raw.find(k); return i == raw.end() ? d : std::atof(i->second.c_str()); }
  std::string str(const std::string& k, const std::string& d) const { auto i = raw.find(k); return i == raw.end() ? d : i->second; }
} cfg;

// Updates the velocity of the inflow and ground cells on the device (the airfoil2d example's SmoothInflowUpdateO).
struct SmoothInflowUpdateO {
  static constexpr OperatorScope scope = OperatorScope::PerCellWithParameters;
  struct VELOCITY : public descriptors::FIELD_BASE<0, 1> { };
  using parameters = meta::list<VELOCITY>;
  template <typename CELLS, typename PARAMETERS>
  void apply(CELLS& cells, PARAMETERS& parameters) any_platform
  {
    auto& cell = cells.template get<names::NavierStokes>();
    auto  u    = parameters.template get<VELOCITY>();
    cell.defineU(u.data());
  }
};

// Smagorinsky constant: cs0 in the bulk, raised in the sponge zone x in [xs, xe] so the eddy viscosity grows by
// K * ((x - xs)/(xe - xs))^3 + 1 (Xue et al. 2022, doi:10.1063/5.0090641; the formula in OpenLB nozzle3d/fringeZone.h option B).
class SpongeSmagorinsky : public AnalyticalF3D<T, T> {
  const T cs0, xs, xe, K;
public:
  SpongeSmagorinsky(T cs0_, T xs_, T xe_, T K_) : AnalyticalF3D<T, T>(1), cs0(cs0_), xs(xs_), xe(xe_), K(K_) { }
  bool operator()(T output[], const T input[]) override
  {
    T s = (input[0] - xs) / (xe - xs);
    s = s < 0 ? T(0) : (s > 1 ? T(1) : s);
    output[0] = cs0 * std::sqrt(T(1) + K * s * s * s);
    return true;
  }
};

// third-order regularised collision with the per-cell Smagorinsky constant (airfoil2d's fringe dynamics)
template <typename T_, typename D_, typename M_ = momenta::BulkTuple>
using LocalSmagorinskyRLB = dynamics::Tuple<
  T_, D_, M_, equilibria::ThirdOrder,
  collision::ParameterFromCell<collision::LES::SMAGORINSKY, collision::SmagorinskyEffectiveOmega<collision::ThirdOrderRLB>>>;

int main(int argc, char* argv[])
{
  initialize(&argc, &argv);
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    auto eq = a.find('=');
    if (a.rfind("--", 0) == 0 && eq != std::string::npos) cfg.raw[a.substr(2, eq - 2)] = a.substr(eq + 1);
  }
  OstreamManager clout(std::cout, "ahmed");

  const int    res      = (int)cfg.num("res", 209);        // cells along lref
  const double lref     = cfg.num("lref", AH_L);           // reference length (m)
  const double aref     = cfg.num("aref", AH_W * AH_H);    // reference (frontal) area (m2)
  const std::string regions = cfg.str("regions", "ahmed"); // "ahmed": split the force by nose/slant/base/rest; "none": total only
  const double uPhys    = cfg.num("u", 40.0);              // m/s
  const double nuPhys   = cfg.num("nu", 1.5e-5);           // m2/s
  const double rhoPhys  = cfg.num("rho", 1.225);           // kg/m3
  const double uLat     = cfg.num("ulat", 0.05);           // lattice velocity (Ma = uLat*sqrt(3))
  const double cs       = cfg.num("smago", 0.15);          // Smagorinsky constant (OpenLB default)
  const std::string dyn = cfg.str("dynamics", "smagorinsky");
  const double tEnd     = cfg.num("tend", 0.5);            // physical seconds
  const int    every    = (int)cfg.num("sample", 200);     // steps between force samples
  const double ramp     = cfg.num("ramp", 6.0);            // flow-throughs (lref/u) over which the inflow is ramped up
  const double spongeLen = cfg.num("sponge", 0.65);        // length (m) of the outlet sponge zone
  const double spongeK  = cfg.num("spongek", 1000.0);      // eddy-viscosity factor at the outlet end of the sponge
  const double xmin = cfg.num("xmin", -0.85), xmax = cfg.num("xmax", 3.4);
  const double ymax = cfg.num("ymax", 0.95), zmax = cfg.num("zmax", 1.0);
  const std::string stlPath = cfg.str("stl", "ahmed.stl");
  const std::string outPath = cfg.str("out", "forces.dat");
  const int    maxSteps = (int)cfg.num("maxsteps", 0);     // 0 = from tend

  const double dx = lref / res;
  const double qinf = 0.5 * rhoPhys * uPhys * uPhys;

  // ---- mesh ----
  Vector<T, 3> origin{(T)xmin, (T)-ymax, (T)0};
  Vector<T, 3> extend{(T)(xmax - xmin), (T)(2 * ymax), (T)zmax};
  IndicatorCuboid3D<T> domain(extend, origin);
  Mesh<T, 3> mesh(domain, (T)dx, 1);
  mesh.setOverlap(2);  // rename(from,to,test,indicator) needs overlap >= 2

  MyCase::ParametersD params;
  MyCase myCase(params, mesh);

  // ---- geometry ----
  STLreader<T> body(stlPath, (T)dx, (T)1.0, (RayMode)(int)cfg.num("ray", 1), cfg.num("probe", 0) > 0);
  auto& geometry = myCase.getGeometry();

  if (cfg.num("probe", 0) > 0) {
    const double pts[][3] = {{0.05, 0, 0.2}, {0.5, 0, 0.2}, {0.5, 0, 0.3}, {1.0, 0, 0.2}, {1.0, 0, 0.3}, {0.5, 0, 0.01}, {0.5, 0.3, 0.2}, {-0.1, 0, 0.2}};
    for (int mode = 1; mode <= 5; ++mode) {
      STLreader<T> bm(stlPath, (T)dx, (T)1.0, (RayMode)mode, false);
      int nin = 0;
      for (auto& q : pts) { bool in = false; T x[3] = {(T)q[0], (T)q[1], (T)q[2]}; bm(&in, x); nin += in; }
      clout << "ray mode " << mode << " inside count of 8 probes = " << nin << std::endl;
    }
    for (auto& q : pts) { bool in = false; T x[3] = {(T)q[0], (T)q[1], (T)q[2]}; body(&in, x); clout << "probe (" << q[0] << "," << q[1] << "," << q[2] << ") inside=" << in << std::endl; }
  }
  geometry.rename(0, 2);
  geometry.rename(2, 1, {1, 1, 1});
  // faces: inlet 3, outlet 4, ground 5, top+sides 7 (free slip); leftover edge/corner voxels 6 (bounce back)
  {
    IndicatorCuboid3D<T> inlet({(T)(2 * dx), (T)(2 * ymax + 4 * dx), (T)(zmax + 4 * dx)}, {(T)(xmin - dx), (T)(-ymax - 2 * dx), (T)(-2 * dx)});
    geometry.rename(2, 3, 1, inlet);
    IndicatorCuboid3D<T> outlet({(T)(2 * dx), (T)(2 * ymax + 4 * dx), (T)(zmax + 4 * dx)}, {(T)(xmax - dx), (T)(-ymax - 2 * dx), (T)(-2 * dx)});
    geometry.rename(2, 4, 1, outlet);
    IndicatorCuboid3D<T> ground({(T)(xmax - xmin + 4 * dx), (T)(2 * ymax + 4 * dx), (T)(2 * dx)}, {(T)(xmin - 2 * dx), (T)(-ymax - 2 * dx), (T)(-dx)});
    geometry.rename(2, 5, 1, ground);
    IndicatorCuboid3D<T> top({(T)(xmax - xmin + 4 * dx), (T)(2 * ymax + 4 * dx), (T)(2 * dx)}, {(T)(xmin - 2 * dx), (T)(-ymax - 2 * dx), (T)(zmax - dx)});
    geometry.rename(2, 7, 1, top);
    IndicatorCuboid3D<T> sideL({(T)(xmax - xmin + 4 * dx), (T)(2 * dx), (T)(zmax + 4 * dx)}, {(T)(xmin - 2 * dx), (T)(-ymax - dx), (T)(-2 * dx)});
    geometry.rename(2, 7, 1, sideL);
    IndicatorCuboid3D<T> sideR({(T)(xmax - xmin + 4 * dx), (T)(2 * dx), (T)(zmax + 4 * dx)}, {(T)(xmin - 2 * dx), (T)(ymax - dx), (T)(-2 * dx)});
    geometry.rename(2, 7, 1, sideR);
    geometry.rename(2, 6);
  }
  // body: inside the STL -> 8; for --regions=ahmed the wall layer is split into nose 9, base 11, slant 10, rest stays 8
  geometry.rename(1, 8, body);
  geometry.clean();
  const double zb = AH_C + AH_H - AH_S * std::sin(AH_ANGLE);  // z of the slant/base edge
  const double zt = AH_C + AH_H;
  const double x0 = AH_L - AH_S * std::cos(AH_ANGLE);
  if (regions == "ahmed") {
    IndicatorCuboid3D<T> nose({(T)(1.0 + AH_R), (T)2, (T)3}, {(T)-1.0, (T)-1, (T)-1});
    geometry.rename(8, 9, nose);
    IndicatorCuboid3D<T> base({(T)1.0, (T)(AH_W - 3 * dx), (T)(zb - (AH_C + 1.5 * dx))}, {(T)(AH_L - 1.5 * dx), (T)(-AH_W / 2 + 1.5 * dx), (T)(AH_C + 1.5 * dx)});
    geometry.rename(8, 11, base);
    IndicatorCuboid3D<T> slant({(T)(AH_L + dx - (x0 - 0.5 * dx)), (T)(AH_W - 3 * dx), (T)(zt + dx - (zb - dx))}, {(T)(x0 - 0.5 * dx), (T)(-AH_W / 2 + 1.5 * dx), (T)(zb - dx)});
    geometry.rename(8, 10, slant);
  }
  geometry.checkForErrors();
  geometry.print();

  // ---- lattice ----
  auto& lattice = myCase.getLattice(NavierStokes{});
  lattice.setUnitConverter<UnitConverterFromResolutionAndLatticeVelocity<T, DESCRIPTOR>>(
    (std::size_t)res, (T)uLat, (T)lref, (T)uPhys, (T)nuPhys, (T)rhoPhys);
  auto& converter = lattice.getUnitConverter();
  converter.print();
  const T omega = converter.getLatticeRelaxationFrequency();
  const T dt = converter.getPhysDeltaT();
  clout << "dx=" << dx << " m  dt=" << dt << " s  omega=" << omega << " tau=" << 1. / omega
        << " Ma=" << uLat * std::sqrt(3.0) << " Re_L=" << uPhys * lref / nuPhys << std::endl;

  auto bulk = geometry.getMaterialIndicator({1, 3, 4, 5});
  if (dyn == "rlb") {
    dynamics::set<LocalSmagorinskyRLB<T, DESCRIPTOR>>(lattice, bulk);
  } else {
    dynamics::set<LocalSmagorinskyBGKdynamics<T, DESCRIPTOR>>(lattice, bulk);
  }
  {
    SpongeSmagorinsky csF((T)cs, (T)(xmax - spongeLen), (T)xmax, (T)spongeK);
    fields::set<collision::LES::SMAGORINSKY>(lattice, bulk, csF);
  }
  // the boundary nodes keep the bulk collision (with the per-cell Smagorinsky constant), as in airfoil2d
  if (dyn == "rlb") {
    boundary::set<boundary::LocalVelocity, LocalSmagorinskyRLB>(lattice, geometry, 3);
    boundary::set<boundary::LocalVelocity, LocalSmagorinskyRLB>(lattice, geometry, 5);
    boundary::set<boundary::InterpolatedPressure, LocalSmagorinskyRLB>(lattice, geometry, 4);
  } else {
    boundary::set<boundary::LocalVelocity, LocalSmagorinskyBGKdynamics>(lattice, geometry, 3);
    boundary::set<boundary::LocalVelocity, LocalSmagorinskyBGKdynamics>(lattice, geometry, 5);
    boundary::set<boundary::InterpolatedPressure, LocalSmagorinskyBGKdynamics>(lattice, geometry, 4);
  }
  boundary::set<boundary::FullSlip>(lattice, geometry, 7);
  boundary::set<boundary::BounceBack>(lattice, geometry, 6);
  for (int m : {8, 9, 10, 11}) setBouzidiBoundary<T, DESCRIPTOR>(lattice, geometry, m, body);

  lattice.setParameter<descriptors::OMEGA>(omega);

  // fluid at rest; the inlet and the moving ground are ramped to the free-stream speed in the time loop
  Vector<T, 3> uVec{(T)0, (T)0, (T)0};
  AnalyticalConst3D<T, T> rho1((T)1);
  AnalyticalConst3D<T, T> uLatF((T)0, (T)0, (T)0);
  momenta::setVelocity(lattice, geometry.getMaterialIndicator({3, 5}), uVec);
  lattice.iniEquilibrium(geometry, 1, rho1, uLatF);
  lattice.iniEquilibrium(geometry, 3, rho1, uLatF);
  lattice.iniEquilibrium(geometry, 4, rho1, uLatF);
  lattice.iniEquilibrium(geometry, 5, rho1, uLatF);
  lattice.initialize();

  // ---- run ----
  std::size_t nSteps = maxSteps > 0 ? (std::size_t)maxSteps : converter.getLatticeTime((T)tEnd);
  const std::size_t iTupd = 4;  // steps between inflow updates
  const std::size_t iTramp = iTupd * (std::size_t)std::llround(ramp * lref / uPhys / (double)dt / (double)iTupd);
  // wall voxels per region, listed once: momentum exchange then costs a few million operations per sample instead of
  // OpenLB's full-block functor sweep (SuperSum3D visits every cell of the block, ~35 M here)
  struct Vox { int x, y, z; };
  const int regionMat[4] = {9, 10, 11, 8};
  std::vector<Vox> wall[4];
  auto& bgeo = geometry.getBlockGeometry(0);
  bgeo.forCoreSpatialLocations([&](LatticeR<3> r) {
    const int m = bgeo.get(r);
    for (int k = 0; k < 4; ++k) if (m == regionMat[k]) wall[k].push_back({r[0], r[1], r[2]});
  });
  clout << "wall voxels nose/slant/base/rest = " << wall[0].size() << "/" << wall[1].size() << "/" << wall[2].size() << "/" << wall[3].size() << std::endl;
  std::ofstream out(outPath);
  out << "# aero_lbm OpenLB 1.9r0 float D3Q19 dynamics=" << dyn << " smago=" << cs << " sponge_m=" << spongeLen << " sponge_k=" << spongeK << " ramp=" << ramp << " ramp_steps=" << iTramp << "\n";
  out << "# res=" << res << " lref=" << lref << " ftt_s=" << lref / uPhys << " dx=" << dx << " dt=" << dt << " U=" << uPhys << " nu=" << nuPhys << " rho=" << rhoPhys
      << " ulat=" << uLat << " omega=" << omega << "\n";
  out << "# domain x[" << xmin << "," << xmax << "] y[" << -ymax << "," << ymax << "] z[0," << zmax << "] nodes=" << geometry.getStatistics().getNvoxel() << "\n";
  out << "# Aref=" << aref << " qinf=" << qinf << " Cd=Fx/(qinf*Aref) regions=" << regions << " (nose, slant, base, rest = materials 9, 10, 11, 8; Fx in N, region columns are 0 when regions=none and rest is then the whole body)\n";
  out << "# step t_s Cd Cl Fx_nose Fx_slant Fx_base Fx_rest Fz_total maxU_lat rho_avg wall_s\n";
  const auto wall0 = std::chrono::steady_clock::now();

  util::Timer<T> timer(nSteps, geometry.getStatistics().getNvoxel());
  timer.start();
  SuperLatticeCoupling inflowUpdate(SmoothInflowUpdateO {}, names::NavierStokes {}, lattice);
  inflowUpdate.restrictTo(geometry.getMaterialIndicator({3, 5}));
  for (std::size_t iT = 0; iT <= nSteps; ++iT) {
    if (iT <= iTramp && iT % iTupd == 0) {
      T frac = 0;
      std::size_t it = iT;
      PolynomialStartScale<T, std::size_t>(iTramp, T(1))(&frac, &it);
      inflowUpdate.setParameter<SmoothInflowUpdateO::VELOCITY>({(T)(frac * uLat), (T)0, (T)0});
      inflowUpdate.apply();
    }
    if (iT % every == 0 && iT > 0) {
      lattice.setProcessingContext(ProcessingContext::Evaluation);
      // momentum exchange over the links from each wall voxel to its fluid neighbours (OpenLB's
      // BlockLatticePhysBoundaryForce3D formula, summed over the listed voxels): F = -sum c_q (f_q(fluid) + f_qbar(wall))
      double fx[4] = {0, 0, 0, 0}, fxT = 0, fzT = 0;
      auto& blk = lattice.getBlock(0);
      for (int k = 0; k < 4; ++k) {
        double sx = 0, sz = 0;
        for (const Vox& v : wall[k]) {
          for (int q = 1; q < DESCRIPTOR::q; ++q) {
            const Vector<int, 3> c = descriptors::c<DESCRIPTOR>(q);
            if (bgeo.get(LatticeR<3>{v.x + c[0], v.y + c[1], v.z + c[2]}) == 1) {
              const double f = (double)blk.get(v.x + c[0], v.y + c[1], v.z + c[2])[q]
                             + (double)blk.get(v.x, v.y, v.z)[descriptors::opposite<DESCRIPTOR>(q)];
              sx -= c[0] * f;
              sz -= c[2] * f;
            }
          }
        }
        fx[k] = converter.getPhysForce((T)sx);
        fxT += fx[k];
        fzT += converter.getPhysForce((T)sz);
      }
      const double maxU = lattice.getStatistics().getMaxU();
      const double rhoAvg = lattice.getStatistics().getAverageRho();
      char line[512];
      const double wall = std::chrono::duration<double>(std::chrono::steady_clock::now() - wall0).count();
      std::snprintf(line, sizeof line, "%zu %.8f %.6f %.6f %.6f %.6f %.6f %.6f %.6f %.5f %.6f %.1f\n", iT, iT * (double)dt,
                    fxT / (qinf * aref), fzT / (qinf * aref), fx[0], fx[1], fx[2], fx[3], fzT, maxU, rhoAvg, wall);
      out << line;
      out.flush();
      if (iT % (every * 10) == 0) { timer.update(iT); timer.printStep(); clout << line; }
      if (!(maxU < 0.3)) { clout << "DIVERGED maxU=" << maxU << " at step " << iT << std::endl; out << "# DIVERGED step " << iT << "\n"; return 2; }
    }
    lattice.collideAndStream();
  }
  timer.stop();
  timer.printSummary();
  out << "# done steps=" << nSteps << "\n";
  return 0;
}
