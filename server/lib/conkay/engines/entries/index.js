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
 * pybamm (SXE-25). SXE-54 (breadth) appends in batches —
 * batch 1: meep + mpb (SXE-18), quantlib (SXE-23),
 * pycalphad + phreeqc (SXE-24), plasmapy + warpx (SXE-31),
 * qutip (SXE-32); batch 2: pyscf + xtb + rdkit + psi4 +
 * openbabel + quantum-espresso (SXE-26), biopython + blast +
 * mafft + iqtree + samtools + bwa + roadrunner + cobrapy +
 * vina + opensim (SXE-28), openmc + geant4 (SXE-30),
 * modflow + swmm + openquake + specfem + climlab + aermod +
 * epanet + proj (SXE-35); batch 3: openems + nec2c (SXE-17),
 * pyroomacoustics + bempp-cl (SXE-34), pandapower + pypsa +
 * opendss (SXE-19), lammps + gromacs + openmm (SXE-27);
 * batch 4: rayoptics + tmm + hcipy + poppy + radiance
 * (SXE-33), rebound + astropy + skyfield + sgp4 + spiceypy +
 * gmat + orekit (SXE-36), pvlib + openfast + energyplus +
 * pysam (SXE-37). Later engine programmes append their
 * imports here; engines/index.js imports this module
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
import "./quantlib.js";
import "./qutip.js";
import "./plasmapy.js";
import "./warpx.js";
import "./meep.js";
import "./mpb.js";
import "./pycalphad.js";
import "./phreeqc.js";
import "./pyscf.js";
import "./xtb.js";
import "./rdkit.js";
import "./psi4.js";
import "./openbabel.js";
import "./quantum-espresso.js";
import "./biopython.js";
import "./blast.js";
import "./mafft.js";
import "./iqtree.js";
import "./samtools.js";
import "./bwa.js";
import "./roadrunner.js";
import "./cobrapy.js";
import "./vina.js";
import "./opensim.js";
import "./openmc.js";
import "./geant4.js";
import "./modflow.js";
import "./swmm.js";
import "./openquake.js";
import "./specfem.js";
import "./climlab.js";
import "./aermod.js";
import "./epanet.js";
import "./proj.js";
import "./openems.js";
import "./nec2c.js";
import "./pyroomacoustics.js";
import "./bempp-cl.js";
import "./pandapower.js";
import "./pypsa.js";
import "./opendss.js";
import "./lammps.js";
import "./gromacs.js";
import "./openmm.js";
import "./rayoptics.js";
import "./tmm.js";
import "./hcipy.js";
import "./poppy.js";
import "./radiance.js";
import "./rebound.js";
import "./astropy.js";
import "./skyfield.js";
import "./sgp4.js";
import "./spiceypy.js";
import "./gmat.js";
import "./orekit.js";
import "./pvlib.js";
import "./openfast.js";
import "./energyplus.js";
import "./pysam.js";
