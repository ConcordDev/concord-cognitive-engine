/**
 * Engine manifest entries — one side-effect import per engine.
 *
 * SXE-52 (FE/CFD core) registers the first five: mpi (SXE-39),
 * fenicsx (SXE-09), petsc (SXE-03), calculix (SXE-07),
 * openfoam (SXE-11). SXE-53 (car-chain) appends fourteen:
 * chrono + pinocchio (SXE-14), openmodelica (SXE-15),
 * ngspice (SXE-16), curaengine + prusaslicer (SXE-38),
 * openradioss (SXE-13), elmer (SXE-10), su2 (SXE-12),
 * code-aster (SXE-08), control + casadi + acados (SXE-20),
 * pybamm (SXE-25). Later engine programmes (SXE-54) append
 * their imports here; engines/index.js imports this module
 * exactly once.
 */
import "./mpi.js";
import "./fenicsx.js";
import "./petsc.js";
import "./calculix.js";
import "./openfoam.js";
import "./chrono.js";
import "./pinocchio.js";
import "./openmodelica.js";
import "./ngspice.js";
import "./curaengine.js";
import "./prusaslicer.js";
import "./openradioss.js";
import "./elmer.js";
import "./su2.js";
import "./code-aster.js";
import "./control.js";
import "./casadi.js";
import "./acados.js";
import "./pybamm.js";
