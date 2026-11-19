/**
 * Engine manifest entries — one side-effect import per engine.
 *
 * SXE-52 (FE/CFD core) registers the first five: mpi (SXE-39),
 * fenicsx (SXE-09), petsc (SXE-03), calculix (SXE-07),
 * openfoam (SXE-11). Later engine programmes (SXE-53, SXE-54)
 * append their imports here; engines/index.js imports this
 * module exactly once.
 */
import "./mpi.js";
import "./fenicsx.js";
import "./petsc.js";
import "./calculix.js";
import "./openfoam.js";
