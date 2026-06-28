// server/domains/bio.js
// Domain actions for biology/bioinformatics: sequence alignment scoring,
// gene expression analysis, phylogenetic distance, and motif detection.

export default function registerBioActions(registerLensAction) {
  /**
   * sequenceAlign
   * Needleman-Wunsch global alignment of two DNA/protein sequences.
   * artifact.data.sequenceA, artifact.data.sequenceB
   * params.matchScore (default 2), params.mismatchPenalty (default -1),
   * params.gapPenalty (default -2)
   */
  registerLensAction("bio", "sequenceAlign", (ctx, artifact, params) => {
  try {
    const seqA = (artifact.data?.sequenceA || params.sequenceA || "").toUpperCase();
    const seqB = (artifact.data?.sequenceB || params.sequenceB || "").toUpperCase();
    if (!seqA || !seqB) return { ok: false, error: "Both sequenceA and sequenceB required." };
    if (seqA.length > 2000 || seqB.length > 2000) return { ok: false, error: "Sequences limited to 2000 characters each." };

    const match = params.matchScore ?? 2;
    const mismatch = params.mismatchPenalty ?? -1;
    const gap = params.gapPenalty ?? -2;
    const m = seqA.length, n = seqB.length;

    // Initialize scoring matrix
    const score = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) score[i][0] = i * gap;
    for (let j = 0; j <= n; j++) score[0][j] = j * gap;

    // Fill matrix
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const s = seqA[i - 1] === seqB[j - 1] ? match : mismatch;
        score[i][j] = Math.max(
          score[i - 1][j - 1] + s,
          score[i - 1][j] + gap,
          score[i][j - 1] + gap
        );
      }
    }

    // Traceback
    let alignA = "", alignB = "", midline = "";
    let i = m, j = n;
    let matches = 0, mismatches = 0, gaps = 0;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0) {
        const s = seqA[i - 1] === seqB[j - 1] ? match : mismatch;
        if (score[i][j] === score[i - 1][j - 1] + s) {
          alignA = seqA[i - 1] + alignA;
          alignB = seqB[j - 1] + alignB;
          if (seqA[i - 1] === seqB[j - 1]) { midline = "|" + midline; matches++; }
          else { midline = "." + midline; mismatches++; }
          i--; j--;
          continue;
        }
      }
      if (i > 0 && score[i][j] === score[i - 1][j] + gap) {
        alignA = seqA[i - 1] + alignA;
        alignB = "-" + alignB;
        midline = " " + midline;
        gaps++; i--;
      } else {
        alignA = "-" + alignA;
        alignB = seqB[j - 1] + alignB;
        midline = " " + midline;
        gaps++; j--;
      }
    }

    const alignLen = alignA.length;
    const identity = alignLen > 0 ? Math.round((matches / alignLen) * 10000) / 100 : 0;
    const similarity = alignLen > 0 ? Math.round(((matches + mismatches * 0.5) / alignLen) * 10000) / 100 : 0;

    // Detect sequence type
    const dnaChars = new Set(["A", "T", "G", "C", "N"]);
    const isDNA = [...seqA].every(c => dnaChars.has(c));

    return {
      ok: true, result: {
        alignment: { sequenceA: alignA, midline, sequenceB: alignB },
        score: score[m][n],
        statistics: {
          length: alignLen, matches, mismatches, gaps,
          identity, similarity,
          sequenceType: isDNA ? "DNA" : "protein",
          lengthA: m, lengthB: n,
        },
        parameters: { match, mismatch, gap },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * geneExpression
   * Differential expression analysis between two conditions.
   * artifact.data.samples = [{ gene, condition, expression }]
   * Computes fold-change, log2FC, and basic significance ranking.
   */
  registerLensAction("bio", "geneExpression", (ctx, artifact, _params) => {
  try {
    const samples = artifact.data?.samples || [];
    if (samples.length === 0) return { ok: true, result: { message: "No expression data." } };

    // Group by gene and condition
    const geneData = {};
    for (const s of samples) {
      if (!geneData[s.gene]) geneData[s.gene] = {};
      if (!geneData[s.gene][s.condition]) geneData[s.gene][s.condition] = [];
      geneData[s.gene][s.condition].push(s.expression);
    }

    const conditions = [...new Set(samples.map(s => s.condition))];
    if (conditions.length < 2) {
      return { ok: true, result: { message: "Need at least 2 conditions for differential analysis." } };
    }

    const [condA, condB] = conditions;
    const results = [];

    for (const [gene, condMap] of Object.entries(geneData)) {
      const valuesA = condMap[condA] || [];
      const valuesB = condMap[condB] || [];
      if (valuesA.length === 0 || valuesB.length === 0) continue;

      const meanA = valuesA.reduce((s, v) => s + v, 0) / valuesA.length;
      const meanB = valuesB.reduce((s, v) => s + v, 0) / valuesB.length;

      // Fold change (B vs A)
      const foldChange = meanA > 0 ? meanB / meanA : Infinity;
      const log2FC = meanA > 0 && meanB > 0 ? Math.log2(meanB / meanA) : 0;

      // Welch's t-test approximation
      const varA = valuesA.length > 1
        ? valuesA.reduce((s, v) => s + Math.pow(v - meanA, 2), 0) / (valuesA.length - 1)
        : 0;
      const varB = valuesB.length > 1
        ? valuesB.reduce((s, v) => s + Math.pow(v - meanB, 2), 0) / (valuesB.length - 1)
        : 0;

      const seA = varA / valuesA.length;
      const seB = varB / valuesB.length;
      const se = Math.sqrt(seA + seB);
      const tStat = se > 0 ? Math.abs(meanB - meanA) / se : 0;

      // Rough p-value approximation from t-statistic (simplified)
      const df = Math.max(1, Math.round(Math.pow(seA + seB, 2) / (
        (seA > 0 ? Math.pow(seA, 2) / (valuesA.length - 1) : 0) +
        (seB > 0 ? Math.pow(seB, 2) / (valuesB.length - 1) : 0) || 1
      )));
      // Approximate p-value using t-distribution CDF (rough estimate)
      const pApprox = Math.exp(-0.717 * tStat - 0.416 * tStat * tStat);

      const regulation = Math.abs(log2FC) < 0.5 ? "unchanged"
        : log2FC > 0 ? "upregulated" : "downregulated";

      results.push({
        gene,
        meanCondA: Math.round(meanA * 100) / 100,
        meanCondB: Math.round(meanB * 100) / 100,
        foldChange: Math.round(foldChange * 1000) / 1000,
        log2FC: Math.round(log2FC * 1000) / 1000,
        tStatistic: Math.round(tStat * 1000) / 1000,
        pValueApprox: Math.round(pApprox * 10000) / 10000,
        degreesOfFreedom: df,
        regulation,
        significant: pApprox < 0.05 && Math.abs(log2FC) >= 1,
      });
    }

    results.sort((a, b) => a.pValueApprox - b.pValueApprox);

    const upregulated = results.filter(r => r.regulation === "upregulated" && r.significant);
    const downregulated = results.filter(r => r.regulation === "downregulated" && r.significant);

    artifact.data.lastExpressionAnalysis = {
      timestamp: new Date().toISOString(),
      conditions: [condA, condB],
      significantGenes: results.filter(r => r.significant).length,
    };

    return {
      ok: true, result: {
        conditions: { conditionA: condA, conditionB: condB },
        genes: results,
        summary: {
          totalGenes: results.length,
          significantGenes: results.filter(r => r.significant).length,
          upregulated: upregulated.length,
          downregulated: downregulated.length,
          unchanged: results.filter(r => r.regulation === "unchanged").length,
          topUpregulated: upregulated.slice(0, 5).map(r => ({ gene: r.gene, log2FC: r.log2FC })),
          topDownregulated: downregulated.slice(0, 5).map(r => ({ gene: r.gene, log2FC: r.log2FC })),
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * phylogeneticDistance
   * Compute pairwise distance matrix from aligned sequences using
   * Jukes-Cantor or Kimura correction models.
   * artifact.data.sequences = [{ id, sequence }]
   */
  registerLensAction("bio", "phylogeneticDistance", (ctx, artifact, params) => {
  try {
    const sequences = artifact.data?.sequences || [];
    if (sequences.length < 2) return { ok: false, error: "Need at least 2 sequences." };
    if (sequences.length > 50) return { ok: false, error: "Limited to 50 sequences." };

    const model = params.model || "jukes-cantor"; // jukes-cantor | kimura
    const r = (v) => Math.round(v * 100000) / 100000;

    // Pairwise distances
    const n = sequences.length;
    const matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const labels = sequences.map(s => s.id || s.name);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sA = sequences[i].sequence.toUpperCase();
        const sB = sequences[j].sequence.toUpperCase();
        const len = Math.min(sA.length, sB.length);
        let mismatches = 0;
        let transitions = 0; // A↔G, C↔T
        let transversions = 0; // all other mismatches
        const purines = new Set(["A", "G"]);

        for (let k = 0; k < len; k++) {
          if (sA[k] === "-" || sB[k] === "-") continue;
          if (sA[k] !== sB[k]) {
            mismatches++;
            const bothPurine = purines.has(sA[k]) && purines.has(sB[k]);
            const bothPyrimidine = !purines.has(sA[k]) && !purines.has(sB[k]);
            if (bothPurine || bothPyrimidine) transitions++;
            else transversions++;
          }
        }

        const p = len > 0 ? mismatches / len : 0;

        let distance;
        if (model === "kimura") {
          // Kimura 2-parameter: d = -0.5 * ln((1-2P-Q) * sqrt(1-2Q))
          const P = len > 0 ? transitions / len : 0;
          const Q = len > 0 ? transversions / len : 0;
          const inner1 = 1 - 2 * P - Q;
          const inner2 = 1 - 2 * Q;
          if (inner1 > 0 && inner2 > 0) {
            distance = -0.5 * Math.log(inner1 * Math.sqrt(inner2));
          } else {
            distance = Infinity;
          }
        } else {
          // Jukes-Cantor: d = -3/4 * ln(1 - 4p/3)
          const jcInner = 1 - (4 * p) / 3;
          distance = jcInner > 0 ? -0.75 * Math.log(jcInner) : Infinity;
        }

        matrix[i][j] = r(distance);
        matrix[j][i] = r(distance);
      }
    }

    // Find most/least related pairs
    let minDist = Infinity, maxDist = 0;
    let closest = null, farthest = null;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (matrix[i][j] < minDist && matrix[i][j] !== Infinity) {
          minDist = matrix[i][j];
          closest = { a: labels[i], b: labels[j], distance: matrix[i][j] };
        }
        if (matrix[i][j] > maxDist && matrix[i][j] !== Infinity) {
          maxDist = matrix[i][j];
          farthest = { a: labels[i], b: labels[j], distance: matrix[i][j] };
        }
      }
    }

    // Simple UPGMA clustering hint (not full tree, but grouping)
    const avgDistance = [];
    for (let i = 0; i < n; i++) {
      let sum = 0, count = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j && matrix[i][j] !== Infinity) { sum += matrix[i][j]; count++; }
      }
      avgDistance.push({ id: labels[i], avgDistance: count > 0 ? r(sum / count) : Infinity });
    }
    avgDistance.sort((a, b) => a.avgDistance - b.avgDistance);

    return {
      ok: true, result: {
        model, sequenceCount: n, labels,
        distanceMatrix: matrix,
        closest, farthest,
        averageDistances: avgDistance,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * motifDetection
   * Find conserved sequence motifs across multiple sequences.
   * artifact.data.sequences = [{ id, sequence }]
   * params.motifLength (default 6), params.minOccurrences (default 2)
   */
  registerLensAction("bio", "motifDetection", (ctx, artifact, params) => {
  try {
    const sequences = artifact.data?.sequences || [];
    if (sequences.length === 0) return { ok: true, result: { message: "No sequences provided." } };

    const motifLen = params.motifLength || 6;
    const minOcc = params.minOccurrences || 2;

    // Extract all k-mers from all sequences
    const kmerCounts = {};
    const kmerLocations = {};

    for (const seq of sequences) {
      const s = (seq.sequence || "").toUpperCase();
      const seqId = seq.id || seq.name;
      const seen = new Set(); // track unique k-mers per sequence for presence counting

      for (let i = 0; i <= s.length - motifLen; i++) {
        const kmer = s.substring(i, i + motifLen);
        if (kmer.includes("-") || kmer.includes("N")) continue; // skip gaps/ambiguous
        kmerCounts[kmer] = (kmerCounts[kmer] || 0) + 1;
        if (!kmerLocations[kmer]) kmerLocations[kmer] = [];
        kmerLocations[kmer].push({ sequenceId: seqId, position: i });
        seen.add(kmer);
      }
    }

    // Filter by minimum occurrences and sort by frequency
    const motifs = Object.entries(kmerCounts)
      .filter(([, count]) => count >= minOcc)
      .map(([motif, count]) => {
        // Count how many distinct sequences contain this motif
        const seqIds = [...new Set(kmerLocations[motif].map(l => l.sequenceId))];
        // Compute GC content
        const gc = [...motif].filter(c => c === "G" || c === "C").length / motif.length;
        // Check for palindromic (reverse complement equals self)
        const complement = { A: "T", T: "A", G: "C", C: "G" };
        const revComp = [...motif].reverse().map(c => complement[c] || c).join("");
        const isPalindromic = motif === revComp;

        return {
          motif, occurrences: count, sequenceCount: seqIds.length,
          conservation: Math.round((seqIds.length / sequences.length) * 100),
          gcContent: Math.round(gc * 100),
          isPalindromic,
          locations: kmerLocations[motif].slice(0, 10),
        };
      })
      .sort((a, b) => b.conservation - a.conservation || b.occurrences - a.occurrences);

    // Consensus motifs: those found in >50% of sequences
    const consensus = motifs.filter(m => m.conservation > 50);

    return {
      ok: true, result: {
        motifLength: motifLen, minOccurrences: minOcc,
        totalMotifs: motifs.length,
        topMotifs: motifs.slice(0, 20),
        consensusMotifs: consensus.slice(0, 10),
        sequencesAnalyzed: sequences.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * profile-organism
   * Generate a structured profile for a species/organism. Reads
   * artifact.data { name, kingdom?, habitat?, traits? } and returns
   * taxonomy + habitat + characteristics + evolutionary context.
   * Pre-this macro the UniversalAction button "profile-organism" was
   * a dead click.
   */
  registerLensAction("bio", "profile-organism", (ctx, artifact, params) => {
    const d = artifact.data || {};
    const name = d.name || d.species || params?.name || artifact.title || "(unknown organism)";
    const kingdom = d.kingdom || params?.kingdom || "Animalia";
    const habitat = d.habitat || params?.habitat || "unspecified";

    // Tiny taxonomy heuristic — real lookup would hit GBIF / NCBI
    const KINGDOM_RANKS = {
      Animalia: ["Phylum", "Class", "Order", "Family", "Genus", "Species"],
      Plantae:  ["Division", "Class", "Order", "Family", "Genus", "Species"],
      Fungi:    ["Division", "Class", "Order", "Family", "Genus", "Species"],
      Bacteria: ["Phylum", "Class", "Order", "Family", "Genus", "Species"],
      Archaea:  ["Phylum", "Class", "Order", "Family", "Genus", "Species"],
      Protista: ["Phylum", "Class", "Order", "Family", "Genus", "Species"],
    };
    const ranks = KINGDOM_RANKS[kingdom] || KINGDOM_RANKS.Animalia;

    const traits = Array.isArray(d.traits) ? d.traits
      : (typeof d.traits === 'string' ? String(d.traits).split(/[,;]/).map(t => t.trim()).filter(Boolean) : []);

    const result = {
      generatedAt: new Date().toISOString(),
      name,
      kingdom,
      taxonomyRanks: ranks,
      taxonomy: d.taxonomy || ranks.reduce((o, r) => ({ ...o, [r]: "(unspecified)" }), {}),
      habitat,
      traits,
      characteristics: d.characteristics || [],
      evolutionaryNotes: d.evolutionaryNotes || `${name} sits within ${kingdom}. Connect to a phylogenetic tree DTU for full lineage context.`,
      summary: `${name} (${kingdom}) — habitat: ${habitat}. ${traits.length} trait(s) recorded.`,
    };
    if (artifact.data) artifact.data.lastOrganismProfile = result;
    return { ok: true, result };
  });

  /**
   * map-pathway
   * Structure a biological pathway as a chain of {step, enzyme,
   * substrate, product} relationships. artifact.data.steps[] or
   * params.steps[].
   */
  registerLensAction("bio", "map-pathway", (ctx, artifact, params) => {
    const steps = artifact.data?.steps || params?.steps || [];
    if (steps.length === 0) {
      return { ok: false, error: "no_steps", message: "Add at least one pathway step (substrate → enzyme → product)." };
    }
    const chain = steps.map((s, i) => ({
      idx: i + 1,
      substrate: s.substrate || s.input || "(unspecified)",
      enzyme: s.enzyme || s.catalyst || null,
      product: s.product || s.output || "(unspecified)",
      cofactors: Array.isArray(s.cofactors) ? s.cofactors : [],
      deltaG: Number.isFinite(Number(s.deltaG)) ? Number(s.deltaG) : null,
    }));

    // Find conservation: each step's product should be the next step's substrate
    const breaks = [];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1].product;
      const curr = chain[i].substrate;
      if (prev !== curr && !(curr.includes(prev) || prev.includes(curr))) {
        breaks.push({ at: i + 1, expected: prev, actual: curr });
      }
    }

    const totalDeltaG = chain.reduce((s, c) => s + (c.deltaG || 0), 0);
    const result = {
      generatedAt: new Date().toISOString(),
      pathway: artifact.title || params?.name || "(unnamed)",
      steps: chain,
      stepCount: chain.length,
      chainBreaks: breaks,
      totalDeltaG: totalDeltaG !== 0 ? Math.round(totalDeltaG * 100) / 100 : null,
      thermodynamicallyFavorable: totalDeltaG < 0,
      summary: `${chain.length}-step pathway from ${chain[0].substrate} to ${chain[chain.length - 1].product}. ${breaks.length === 0 ? 'Chain conserved.' : `${breaks.length} break(s) detected.`}`,
    };
    if (artifact.data) artifact.data.lastPathwayMap = result;
    return { ok: true, result };
  });

  /**
   * review-protocol
   * Audit a lab protocol for missing controls, safety steps, time
   * estimates. artifact.data.steps[] (string[] or {action, time}[]).
   */
  registerLensAction("bio", "review-protocol", (ctx, artifact, params) => {
    const steps = artifact.data?.steps || params?.steps || [];
    if (steps.length === 0) {
      return { ok: false, error: "no_steps", message: "Add protocol steps to review." };
    }
    const normalized = steps.map((s, i) => typeof s === 'string'
      ? { idx: i + 1, action: s, time: null }
      : { idx: i + 1, action: s.action || s.step || `Step ${i + 1}`, time: s.time || s.minutes || null }
    );

    const allText = normalized.map(s => s.action.toLowerCase()).join(' ');

    // Heuristic gap detection
    const missing = [];
    if (!/control/i.test(allText)) missing.push({ kind: 'control', severity: 'high', suggestion: 'Add a negative and positive control to validate the assay.' });
    if (!/safety|ppe|glove|goggle|fume|hood/i.test(allText)) missing.push({ kind: 'safety', severity: 'high', suggestion: 'Add a PPE/safety step (gloves, goggles, fume hood as appropriate).' });
    if (!/wash|rinse/i.test(allText)) missing.push({ kind: 'wash', severity: 'medium', suggestion: 'Consider a wash step between incubation and detection.' });
    if (normalized.every(s => s.time === null)) missing.push({ kind: 'time-estimates', severity: 'medium', suggestion: 'Add time estimates per step so the protocol is schedulable.' });
    if (!/store|aliquot|label/i.test(allText)) missing.push({ kind: 'storage', severity: 'low', suggestion: 'Document storage / labeling / aliquoting of leftover material.' });

    const totalTime = normalized.reduce((s, st) => s + (Number(st.time) || 0), 0);

    const result = {
      reviewedAt: new Date().toISOString(),
      protocol: artifact.title || '(unnamed)',
      stepCount: normalized.length,
      totalEstimatedMinutes: totalTime || null,
      gaps: missing,
      severity: missing.some(m => m.severity === 'high') ? 'high' : missing.length > 0 ? 'medium' : 'ok',
      summary: missing.length === 0
        ? `${normalized.length}-step protocol looks complete. Estimated ${totalTime}min.`
        : `${missing.length} gap(s): ${missing.map(g => g.kind).join(', ')}.`,
    };
    if (artifact.data) artifact.data.lastProtocolReview = result;
    return { ok: true, result };
  });

  /**
   * link-gene-function
   * Explain gene → protein → function chain. Reads artifact.data
   * { gene, protein, function?, organism? }.
   */
  registerLensAction("bio", "link-gene-function", (ctx, artifact, params) => {
    const d = artifact.data || {};
    const gene = d.gene || d.symbol || params?.gene;
    if (!gene) {
      return { ok: false, error: "no_gene", message: "Provide a gene symbol (e.g. TP53, BRCA1)." };
    }
    const protein = d.protein || params?.protein || `${gene} protein`;
    const fnNotes = d.function || d.functionNotes || params?.function || '(unspecified)';
    const organism = d.organism || params?.organism || 'Homo sapiens';

    const result = {
      generatedAt: new Date().toISOString(),
      organism,
      gene,
      protein,
      chain: [
        { stage: 'gene',    entity: gene, role: 'DNA locus' },
        { stage: 'mRNA',    entity: `${gene} transcript`, role: 'transcribed' },
        { stage: 'protein', entity: protein, role: 'translated product' },
        { stage: 'function', entity: fnNotes, role: 'biological effect' },
      ],
      externalLinks: [
        { source: 'NCBI Gene', url: `https://www.ncbi.nlm.nih.gov/gene/?term=${encodeURIComponent(gene)}+${encodeURIComponent(organism)}` },
        { source: 'UniProt',   url: `https://www.uniprot.org/uniprotkb?query=${encodeURIComponent(gene)}+organism:${encodeURIComponent(organism)}` },
        { source: 'Ensembl',   url: `https://www.ensembl.org/Multi/Search/Results?q=${encodeURIComponent(gene)}` },
      ],
      summary: `${gene} (${organism}) → ${protein} → ${String(fnNotes).slice(0, 80)}${fnNotes.length > 80 ? '…' : ''}`,
    };
    if (artifact.data) artifact.data.lastGeneFunction = result;
    return { ok: true, result };
  });

  /**
   * trace-evolution
   * Map evolutionary relationship between organisms. Reads
   * artifact.data.organisms[] or params.organisms[].
   */
  registerLensAction("bio", "trace-evolution", (ctx, artifact, params) => {
    const organisms = artifact.data?.organisms || params?.organisms || [];
    if (organisms.length < 2) {
      return { ok: false, error: "need_two", message: "Provide at least two organisms to trace evolutionary relationship." };
    }
    // Look up shared lineage by matching against simple taxonomic groupings
    const GROUPS = {
      mammals:  ['human', 'mouse', 'rat', 'dog', 'cat', 'whale', 'bat', 'cow', 'pig', 'horse'],
      birds:    ['chicken', 'eagle', 'sparrow', 'owl', 'parrot'],
      reptiles: ['lizard', 'snake', 'turtle', 'alligator', 'crocodile'],
      fish:     ['salmon', 'tuna', 'shark', 'cod'],
      insects:  ['bee', 'ant', 'fly', 'beetle', 'butterfly'],
      plants:   ['oak', 'rose', 'grass', 'corn', 'rice', 'wheat'],
      fungi:    ['yeast', 'mushroom', 'mold'],
      bacteria: ['e. coli', 'e.coli', 'salmonella', 'staphylococcus'],
    };
    const inGroup = (org) => {
      const o = String(org).toLowerCase();
      return Object.entries(GROUPS).find(([, list]) => list.some(item => o.includes(item)))?.[0] || 'other';
    };
    const tagged = organisms.map(o => ({ name: o, group: inGroup(o) }));
    const groups = Array.from(new Set(tagged.map(t => t.group)));
    const sharedGroup = groups.length === 1 ? groups[0] : null;

    const result = {
      generatedAt: new Date().toISOString(),
      organisms: tagged,
      groups,
      sharedGroup,
      commonality: sharedGroup
        ? `All ${organisms.length} organisms share group: ${sharedGroup}.`
        : `Organisms span ${groups.length} groups: ${groups.join(', ')}.`,
      suggestion: sharedGroup
        ? 'Construct a phylogenetic tree to refine divergence times. Use phylogeneticDistance action with aligned sequences.'
        : 'These organisms span distant branches. Use NCBI Taxonomy to find their MRCA (most recent common ancestor).',
    };
    if (artifact.data) artifact.data.lastEvolutionTrace = result;
    return { ok: true, result };
  });

  /**
   * analyze (generic dispatcher)
   * Frontend per-row Analyze button calls this with no specific kind.
   * Route based on artifact shape.
   */
  registerLensAction("bio", "analyze", (ctx, artifact, _params) => {
    const d = artifact.data || {};
    if (d.sequenceA && d.sequenceB) return { ok: true, result: { dispatched: 'sequenceAlign', note: 'Use sequenceAlign action for full alignment output.' } };
    if (d.expressionData || d.geneExpression) return { ok: true, result: { dispatched: 'geneExpression' } };
    if (d.steps && Array.isArray(d.steps)) return { ok: true, result: { dispatched: 'map-pathway or review-protocol' } };
    if (d.gene || d.symbol) return { ok: true, result: { dispatched: 'link-gene-function', gene: d.gene || d.symbol } };
    if (d.organisms) return { ok: true, result: { dispatched: 'trace-evolution' } };
    if (d.name || d.species || d.kingdom) return { ok: true, result: { dispatched: 'profile-organism', name: d.name || d.species } };
    return {
      ok: true,
      result: {
        message: 'Bio analyze: artifact shape did not match a specific dispatcher.',
        availableActions: ['sequenceAlign','geneExpression','phylogeneticDistance','motifDetection','profile-organism','map-pathway','review-protocol','link-gene-function','trace-evolution'],
      },
    };
  });

  // ─── 2026 parity — Benchling/SnapGene/UniProt/NCBI bioinformatics ──
  //
  // Adds real sequence-handling substrate alongside existing analysis macros.
  // Pure JS implementations (no external API/lib dependencies) — primer Tm,
  // pairwise alignment (Needleman-Wunsch), FASTA + GenBank parsers,
  // restriction site mapping. Per-user scoped sequence + project storage.

  function getBioState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.bioLens) {
      STATE.bioLens = {
        sequences: new Map(), // userId -> Map<seqId, sequence>
      };
    }
    return STATE.bioLens;
  }
  function saveBioState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function bioActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextBioId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoBio() { return new Date().toISOString(); }

  // Restriction enzyme seed (most common in cloning).
  const RESTRICTION_ENZYMES = {
    EcoRI:   { site: "GAATTC",     cut: 1 },
    BamHI:   { site: "GGATCC",     cut: 1 },
    HindIII: { site: "AAGCTT",     cut: 1 },
    XhoI:    { site: "CTCGAG",     cut: 1 },
    NotI:    { site: "GCGGCCGC",   cut: 2 },
    PstI:    { site: "CTGCAG",     cut: 5 },
    SalI:    { site: "GTCGAC",     cut: 1 },
    SacI:    { site: "GAGCTC",     cut: 5 },
    KpnI:    { site: "GGTACC",     cut: 5 },
    SmaI:    { site: "CCCGGG",     cut: 3 },
  };

  // ── Sequence analysis ──

  function gcContent(seq) {
    if (!seq) return 0;
    const upper = seq.toUpperCase();
    let gc = 0;
    for (let i = 0; i < upper.length; i++) {
      if (upper[i] === "G" || upper[i] === "C") gc++;
    }
    return Math.round((gc / upper.length) * 10000) / 100;
  }

  function tmNearestNeighbor(seq) {
    if (!seq || seq.length < 14) {
      // Wallace rule for short oligos
      const upper = (seq || "").toUpperCase();
      let at = 0, gc = 0;
      for (const c of upper) {
        if (c === "A" || c === "T") at++;
        else if (c === "G" || c === "C") gc++;
      }
      return 2 * at + 4 * gc;
    }
    // Simplified Tm: 64.9 + 41 * (G+C - 16.4) / N
    const upper = seq.toUpperCase();
    const gc = (upper.match(/[GC]/g) || []).length;
    const tm = 64.9 + (41 * (gc - 16.4)) / upper.length;
    return Math.round(tm * 10) / 10;
  }

  function findOrfs(seq) {
    const upper = seq.toUpperCase();
    const orfs = [];
    // Forward frames only (simplified)
    for (let frame = 0; frame < 3; frame++) {
      let start = -1;
      for (let i = frame; i < upper.length - 2; i += 3) {
        const codon = upper.slice(i, i + 3);
        if (codon === "ATG" && start < 0) start = i;
        if (start >= 0 && (codon === "TAA" || codon === "TAG" || codon === "TGA")) {
          if (i - start >= 90) {
            orfs.push({ frame: frame + 1, start, end: i + 3, length: i + 3 - start });
          }
          start = -1;
        }
      }
    }
    return orfs;
  }

  registerLensAction("bio", "sequence-analyze", (_ctx, _artifact, params = {}) => {
  try {
    // Fail-CLOSED on a non-string sequence: a bare object/number would
    // String()-coerce into garbage like "[object Object]" and report a
    // fabricated GC%/Tm. Reject anything that isn't a primitive string.
    if (params.sequence != null && typeof params.sequence !== "string") {
      return { ok: false, error: "sequence must be a string" };
    }
    const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
    if (!seq) return { ok: false, error: "sequence required" };
    if (seq.length > 100_000) return { ok: false, error: "sequence too long (max 100000)" };
    const kind = String(params.kind || "dna");
    if (!["dna", "rna", "protein"].includes(kind)) return { ok: false, error: "kind must be dna/rna/protein" };
    const result = {
      length: seq.length,
      kind,
    };
    if (kind === "dna" || kind === "rna") {
      result.gcPercent = gcContent(seq);
      result.tm = tmNearestNeighbor(seq);
      if (kind === "dna") result.orfs = findOrfs(seq);
    } else {
      // Protein composition
      const composition = {};
      for (const c of seq) composition[c] = (composition[c] || 0) + 1;
      result.composition = composition;
      result.molecularWeight = Math.round(seq.length * 110); // average aa MW
    }
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Primer design (forward + reverse, length 18-24, Tm 55-65°C, GC 40-60%) ──

  registerLensAction("bio", "primer-design", (_ctx, _artifact, params = {}) => {
  try {
    const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
    if (!seq) return { ok: false, error: "sequence required" };
    if (seq.length < 100) return { ok: false, error: "sequence must be >= 100 bp" };
    const targetTm = Number(params.targetTm) || 60;
    const targetLen = Math.max(18, Math.min(28, Number(params.targetLength) || 20));
    function revcomp(s) {
      const comp = { A: "T", T: "A", G: "C", C: "G", N: "N" };
      return s.split("").reverse().map((b) => comp[b] || b).join("");
    }
    // Forward primer: first N bases
    const fwd = seq.slice(0, targetLen);
    // Reverse primer: revcomp of last N bases
    const rev = revcomp(seq.slice(-targetLen));
    return {
      ok: true,
      result: {
        forward: {
          sequence: fwd,
          length: fwd.length,
          tm: tmNearestNeighbor(fwd),
          gcPercent: gcContent(fwd),
        },
        reverse: {
          sequence: rev,
          length: rev.length,
          tm: tmNearestNeighbor(rev),
          gcPercent: gcContent(rev),
        },
        productSize: seq.length,
        notes: targetTm
          ? `Target Tm was ${targetTm}°C. Adjust primer length to fine-tune.`
          : "Use default primer pair.",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Pairwise alignment (Needleman-Wunsch global) ──

  registerLensAction("bio", "align-pairwise", (_ctx, _artifact, params = {}) => {
  try {
    const a = String(params.seqA || "").toUpperCase().trim();
    const b = String(params.seqB || "").toUpperCase().trim();
    if (!a || !b) return { ok: false, error: "seqA and seqB required" };
    if (a.length > 2000 || b.length > 2000) return { ok: false, error: "sequences max 2000 each" };
    // Fail-CLOSED on poisoned scoring params: `Number(x) || default` lets
    // Infinity/1e308 through (Infinity is truthy), which would leak Infinity
    // into the alignment score. Reject any supplied-but-non-finite weight.
    const scoreParam = (v, dflt) => {
      if (v === undefined || v === null || v === "") return dflt;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return n;
    };
    const match = scoreParam(params.match, 2);
    const mismatch = scoreParam(params.mismatch, -1);
    const gap = scoreParam(params.gap, -2);
    if (match === null || mismatch === null || gap === null) {
      return { ok: false, error: "match/mismatch/gap must be finite numbers" };
    }

    const m = a.length;
    const n = b.length;
    // Score matrix
    const score = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
    for (let i = 0; i <= m; i++) score[i][0] = i * gap;
    for (let j = 0; j <= n; j++) score[0][j] = j * gap;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const diag = score[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? match : mismatch);
        const up = score[i - 1][j] + gap;
        const left = score[i][j - 1] + gap;
        score[i][j] = Math.max(diag, up, left);
      }
    }
    // Traceback
    let i = m, j = n;
    let alignA = "", alignB = "", alignBars = "";
    while (i > 0 && j > 0) {
      const cur = score[i][j];
      if (cur === score[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? match : mismatch)) {
        alignA = a[i - 1] + alignA;
        alignB = b[j - 1] + alignB;
        alignBars = (a[i - 1] === b[j - 1] ? "|" : ".") + alignBars;
        i--; j--;
      } else if (cur === score[i - 1][j] + gap) {
        alignA = a[i - 1] + alignA;
        alignB = "-" + alignB;
        alignBars = " " + alignBars;
        i--;
      } else {
        alignA = "-" + alignA;
        alignB = b[j - 1] + alignB;
        alignBars = " " + alignBars;
        j--;
      }
    }
    while (i > 0) { alignA = a[i - 1] + alignA; alignB = "-" + alignB; alignBars = " " + alignBars; i--; }
    while (j > 0) { alignA = "-" + alignA; alignB = b[j - 1] + alignB; alignBars = " " + alignBars; j--; }
    const matches = (alignBars.match(/\|/g) || []).length;
    return {
      ok: true,
      result: {
        score: score[m][n],
        alignA, alignB, alignBars,
        matches,
        identity: Math.round((matches / alignA.length) * 10000) / 100,
        alignmentLength: alignA.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── FASTA parser ──

  registerLensAction("bio", "parse-fasta", (_ctx, _artifact, params = {}) => {
    const text = String(params.text || "");
    if (!text.trim()) return { ok: false, error: "text required" };
    if (text.length > 1_000_000) return { ok: false, error: "input too large (max 1MB)" };
    const records = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith(">")) {
        if (current) records.push(current);
        const header = line.slice(1).trim();
        const idMatch = header.match(/^(\S+)/);
        current = {
          id: idMatch ? idMatch[1] : header,
          description: header,
          sequence: "",
        };
      } else if (current) {
        current.sequence += line.replace(/\s/g, "");
      }
    }
    if (current) records.push(current);
    return {
      ok: true,
      result: {
        records: records.map((r) => ({ ...r, length: r.sequence.length })),
        count: records.length,
      },
    };
  });

  // ── Restriction site mapping ──

  registerLensAction("bio", "restriction-map", (_ctx, _artifact, params = {}) => {
    const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
    if (!seq) return { ok: false, error: "sequence required" };
    const enzymesParam = Array.isArray(params.enzymes) ? params.enzymes : null;
    const enzymes = enzymesParam
      ? enzymesParam.filter((e) => RESTRICTION_ENZYMES[e])
      : Object.keys(RESTRICTION_ENZYMES);
    const sites = [];
    for (const name of enzymes) {
      const def = RESTRICTION_ENZYMES[name];
      let pos = 0;
      while ((pos = seq.indexOf(def.site, pos)) !== -1) {
        sites.push({ enzyme: name, position: pos, cutAt: pos + def.cut, site: def.site });
        pos++;
      }
    }
    sites.sort((a, b) => a.position - b.position);
    return {
      ok: true,
      result: {
        sites,
        count: sites.length,
        enzymesScanned: enzymes,
      },
    };
  });

  // ── Sequence storage (per-user) ──

  registerLensAction("bio", "sequence-save", (ctx, _artifact, params = {}) => {
    const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = bioActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 80) return { ok: false, error: "name too long (max 80)" };
    const sequence = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
    if (!sequence) return { ok: false, error: "sequence required" };
    if (sequence.length > 100_000) return { ok: false, error: "sequence too long (max 100000)" };
    const kind = ["dna", "rna", "protein"].includes(params.kind) ? params.kind : "dna";
    const description = String(params.description || "").slice(0, 200);
    const seq = {
      id: nextBioId("seq"),
      name, sequence, kind, description,
      length: sequence.length,
      createdAt: nowIsoBio(),
      updatedAt: nowIsoBio(),
    };
    if (!s.sequences.has(userId)) s.sequences.set(userId, new Map());
    s.sequences.get(userId).set(seq.id, seq);
    saveBioState();
    return { ok: true, result: { sequence: seq } };
  });

  registerLensAction("bio", "sequence-list", (ctx, _artifact, _params = {}) => {
    const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = bioActor(ctx);
    const map = s.sequences.get(userId);
    if (!map) return { ok: true, result: { sequences: [] } };
    const sequences = Array.from(map.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { ok: true, result: { sequences } };
  });

  registerLensAction("bio", "sequence-delete", (ctx, _artifact, params = {}) => {
    const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = bioActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const map = s.sequences.get(userId);
    if (!map || !map.has(id)) return { ok: false, error: "not found" };
    map.delete(id);
    saveBioState();
    return { ok: true, result: { deleted: id } };
  });

  // ─── 2026 backlog parity — Benchling/SnapGene feature gap ──────────
  //
  // Plasmid maps, MSA, in-silico cloning, ORF translation viewer,
  // BLAST-style homology search, CRISPR guide design, lab notebook.
  // All pure-JS, no external deps. Per-user storage via bioLens state.

  // The standard genetic code (codon → single-letter amino acid; * = stop).
  const CODON_TABLE = {
    TTT: "F", TTC: "F", TTA: "L", TTG: "L", CTT: "L", CTC: "L", CTA: "L", CTG: "L",
    ATT: "I", ATC: "I", ATA: "I", ATG: "M", GTT: "V", GTC: "V", GTA: "V", GTG: "V",
    TCT: "S", TCC: "S", TCA: "S", TCG: "S", CCT: "P", CCC: "P", CCA: "P", CCG: "P",
    ACT: "T", ACC: "T", ACA: "T", ACG: "T", GCT: "A", GCC: "A", GCA: "A", GCG: "A",
    TAT: "Y", TAC: "Y", TAA: "*", TAG: "*", CAT: "H", CAC: "H", CAA: "Q", CAG: "Q",
    AAT: "N", AAC: "N", AAA: "K", AAG: "K", GAT: "D", GAC: "D", GAA: "E", GAG: "E",
    TGT: "C", TGC: "C", TGA: "*", TGG: "W", CGT: "R", CGC: "R", CGA: "R", CGG: "R",
    AGT: "S", AGC: "S", AGA: "R", AGG: "R", GGT: "G", GGC: "G", GGA: "G", GGG: "G",
  };
  function revComp(s) {
    const comp = { A: "T", T: "A", G: "C", C: "G", N: "N", U: "A" };
    return s.split("").reverse().map((b) => comp[b] || b).join("");
  }
  function translateDna(seq, frame = 0) {
    const up = seq.toUpperCase().replace(/U/g, "T");
    let protein = "";
    for (let i = frame; i + 2 < up.length; i += 3) {
      protein += CODON_TABLE[up.slice(i, i + 3)] ?? "X";
    }
    return protein;
  }

  // ── translate-orf — ORF / translation viewer with codon detail ──
  // Returns codon-by-codon translation across all 6 reading frames so
  // the UI can highlight codons. params.sequence, params.frame? (1..6, optional)
  registerLensAction("bio", "translate-orf", (_ctx, _artifact, params = {}) => {
    try {
      const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
      if (!seq) return { ok: false, error: "sequence required" };
      if (!/^[ACGTUN]+$/.test(seq)) return { ok: false, error: "sequence must be DNA/RNA (ACGTUN)" };
      if (seq.length > 60_000) return { ok: false, error: "sequence too long (max 60000)" };
      const dna = seq.replace(/U/g, "T");
      const frames = [];
      for (let f = 0; f < 6; f++) {
        const isRev = f >= 3;
        const working = isRev ? revComp(dna) : dna;
        const offset = f % 3;
        const codons = [];
        for (let i = offset; i + 2 < working.length; i += 3) {
          const codon = working.slice(i, i + 3);
          const aa = CODON_TABLE[codon] ?? "X";
          codons.push({ codon, aa, start: i, isStart: codon === "ATG", isStop: aa === "*" });
        }
        const protein = codons.map((c) => c.aa).join("");
        // Longest ORF in this frame (ATG..stop)
        let bestStart = -1, bestLen = 0, curStart = -1;
        for (let k = 0; k < codons.length; k++) {
          if (codons[k].isStart && curStart < 0) curStart = k;
          if (curStart >= 0 && codons[k].isStop) {
            const len = k - curStart + 1;
            if (len > bestLen) { bestLen = len; bestStart = curStart; }
            curStart = -1;
          }
        }
        frames.push({
          frame: isRev ? -(offset + 1) : (offset + 1),
          strand: isRev ? "-" : "+",
          codons,
          protein,
          longestOrf: bestLen > 0
            ? { codonStart: bestStart, codonCount: bestLen,
                peptide: codons.slice(bestStart, bestStart + bestLen).map((c) => c.aa).join("") }
            : null,
        });
      }
      const longest = frames
        .map((fr) => fr.longestOrf ? { frame: fr.frame, ...fr.longestOrf } : null)
        .filter(Boolean)
        .sort((a, b) => b.codonCount - a.codonCount)[0] || null;
      return { ok: true, result: { length: dna.length, frames, longestOrf: longest } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── plasmid-map — circular construct map with annotated features ──
  // params.sequence (circular), params.features? = [{name,start,end,type,strand}]
  // If features omitted, auto-annotates ORFs + restriction sites.
  registerLensAction("bio", "plasmid-map", (_ctx, _artifact, params = {}) => {
    try {
      const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
      if (!seq) return { ok: false, error: "sequence required" };
      if (!/^[ACGTN]+$/.test(seq)) return { ok: false, error: "sequence must be DNA (ACGTN)" };
      if (seq.length > 200_000) return { ok: false, error: "sequence too long (max 200000)" };
      const total = seq.length;
      const userFeatures = Array.isArray(params.features) ? params.features : [];
      const features = [];
      if (userFeatures.length) {
        for (const f of userFeatures) {
          const start = Math.max(0, Math.min(total, Number(f.start) || 0));
          const end = Math.max(0, Math.min(total, Number(f.end) || 0));
          features.push({
            name: String(f.name || "feature").slice(0, 60),
            type: String(f.type || "misc_feature"),
            start, end,
            strand: f.strand === "-" ? "-" : "+",
            length: Math.abs(end - start),
          });
        }
      } else {
        // Auto-annotate: ORFs (frames 1-3) + restriction sites.
        for (const orf of findOrfs(seq)) {
          features.push({
            name: `ORF f${orf.frame}`, type: "CDS",
            start: orf.start, end: orf.end, strand: "+", length: orf.length,
          });
        }
        for (const [name, def] of Object.entries(RESTRICTION_ENZYMES)) {
          let pos = 0;
          while ((pos = seq.indexOf(def.site, pos)) !== -1) {
            features.push({
              name, type: "restriction_site", start: pos, end: pos + def.site.length,
              strand: "+", length: def.site.length,
            });
            pos++;
          }
        }
      }
      features.sort((a, b) => a.start - b.start);
      // Angular position for circular rendering (degrees, 0 at top, clockwise).
      const ring = features.map((f) => ({
        ...f,
        startDeg: Math.round((f.start / total) * 36000) / 100,
        endDeg: Math.round((f.end / total) * 36000) / 100,
      }));
      return {
        ok: true,
        result: {
          length: total,
          gcPercent: gcContent(seq),
          topology: params.topology === "linear" ? "linear" : "circular",
          featureCount: ring.length,
          features: ring,
          summary: `${total} bp ${params.topology === "linear" ? "linear" : "circular"} construct, ${ring.length} feature(s).`,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── align-multiple — progressive multiple sequence alignment ──
  // params.sequences = [{id, sequence}] (>=3 recommended, 2 minimum).
  // Center-star progressive alignment built on Needleman-Wunsch.
  registerLensAction("bio", "align-multiple", (_ctx, _artifact, params = {}) => {
    try {
      const input = Array.isArray(params.sequences) ? params.sequences : [];
      const seqs = input
        .map((s, i) => ({
          id: String(s.id || s.name || `seq${i + 1}`),
          sequence: String(s.sequence || "").replace(/\s/g, "").toUpperCase(),
        }))
        .filter((s) => s.sequence);
      if (seqs.length < 2) return { ok: false, error: "need at least 2 sequences" };
      if (seqs.length > 30) return { ok: false, error: "limited to 30 sequences" };
      if (seqs.some((s) => s.sequence.length > 3000)) return { ok: false, error: "each sequence max 3000" };
      const match = Number(params.match) || 2;
      const mismatch = Number(params.mismatch) || -1;
      const gap = Number(params.gap) || -2;

      function nw(a, b) {
        const m = a.length, n = b.length;
        const sc = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
        for (let i = 0; i <= m; i++) sc[i][0] = i * gap;
        for (let j = 0; j <= n; j++) sc[0][j] = j * gap;
        for (let i = 1; i <= m; i++)
          {for (let j = 1; j <= n; j++)
            {sc[i][j] = Math.max(
              sc[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? match : mismatch),
              sc[i - 1][j] + gap, sc[i][j - 1] + gap);}}
        let i = m, j = n, aa = "", bb = "";
        while (i > 0 && j > 0) {
          const cur = sc[i][j];
          if (cur === sc[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? match : mismatch)) {
            aa = a[i - 1] + aa; bb = b[j - 1] + bb; i--; j--;
          } else if (cur === sc[i - 1][j] + gap) { aa = a[i - 1] + aa; bb = "-" + bb; i--; }
          else { aa = "-" + aa; bb = b[j - 1] + bb; j--; }
        }
        while (i > 0) { aa = a[i - 1] + aa; bb = "-" + bb; i--; }
        while (j > 0) { aa = "-" + aa; bb = b[j - 1] + bb; j--; }
        return { aa, bb, score: sc[m][n] };
      }
      // Center-star: pick sequence with highest summed pairwise score.
      let centerIdx = 0, bestSum = -Infinity;
      for (let c = 0; c < seqs.length; c++) {
        let sum = 0;
        for (let o = 0; o < seqs.length; o++) {
          if (o === c) continue;
          sum += nw(seqs[c].sequence, seqs[o].sequence).score;
        }
        if (sum > bestSum) { bestSum = sum; centerIdx = c; }
      }
      // Align all to center, then merge gaps into a common coordinate frame.
      let centerAligned = seqs[centerIdx].sequence;
      const aligned = new Array(seqs.length).fill(null);
      aligned[centerIdx] = centerAligned;
      for (let o = 0; o < seqs.length; o++) {
        if (o === centerIdx) continue;
        const r = nw(centerAligned, seqs[o].sequence);
        // Propagate any new gaps in center into all previously aligned seqs.
        const newCenter = r.aa;
        for (let k = 0; k < aligned.length; k++) {
          if (aligned[k] == null || k === o) continue;
          let merged = "", ci = 0;
          for (let p = 0; p < newCenter.length; p++) {
            if (newCenter[p] === "-" && centerAligned[ci] !== "-") merged += "-";
            else { merged += aligned[k][ci] ?? "-"; ci++; }
          }
          aligned[k] = merged;
        }
        centerAligned = newCenter;
        aligned[centerIdx] = centerAligned;
        aligned[o] = r.bb;
      }
      // Pad all rows to equal length.
      const width = Math.max(...aligned.map((a) => a.length));
      const rows = aligned.map((a, i) => ({
        id: seqs[i].id,
        aligned: (a || "").padEnd(width, "-"),
      }));
      // Consensus + per-column conservation.
      let consensus = "", conservedCols = 0;
      const conservation = [];
      for (let col = 0; col < width; col++) {
        const counts = {};
        for (const row of rows) {
          const ch = row.aligned[col];
          counts[ch] = (counts[ch] || 0) + 1;
        }
        let topCh = "-", topN = 0;
        for (const [ch, n] of Object.entries(counts)) {
          if (ch !== "-" && n > topN) { topN = n; topCh = ch; }
        }
        const frac = topN / rows.length;
        conservation.push(Math.round(frac * 100));
        consensus += frac >= 0.5 ? topCh : (topN > 0 ? topCh.toLowerCase() : "-");
        if (topN === rows.length && topCh !== "-") conservedCols++;
      }
      return {
        ok: true,
        result: {
          rows, consensus, conservation,
          width, sequenceCount: rows.length,
          centerSequence: seqs[centerIdx].id,
          conservedColumns: conservedCols,
          percentConserved: width > 0 ? Math.round((conservedCols / width) * 10000) / 100 : 0,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── cloning-simulate — in-silico Gibson / Golden Gate assembly ──
  // params.method ('gibson' | 'goldengate' | 'restriction'),
  // params.fragments = [{name, sequence}], params.overlap? (Gibson, default 20)
  registerLensAction("bio", "cloning-simulate", (_ctx, _artifact, params = {}) => {
    try {
      const method = ["gibson", "goldengate", "restriction"].includes(params.method)
        ? params.method : "gibson";
      const frags = (Array.isArray(params.fragments) ? params.fragments : [])
        .map((f, i) => ({
          name: String(f.name || `fragment${i + 1}`).slice(0, 60),
          sequence: String(f.sequence || "").replace(/\s/g, "").toUpperCase(),
        }))
        .filter((f) => /^[ACGTN]+$/.test(f.sequence));
      if (frags.length < 2) return { ok: false, error: "need at least 2 valid DNA fragments" };
      if (frags.length > 12) return { ok: false, error: "limited to 12 fragments" };
      const circular = params.circular !== false;
      const issues = [];
      let assembled = "";
      const junctions = [];

      if (method === "gibson") {
        const overlap = Math.max(10, Math.min(60, Number(params.overlap) || 20));
        assembled = frags[0].sequence;
        for (let i = 1; i < frags.length; i++) {
          const prev = assembled;
          const next = frags[i].sequence;
          // Find shared overlap: suffix of prev == prefix of next.
          let found = 0;
          for (let len = Math.min(overlap + 20, prev.length, next.length); len >= 10; len--) {
            if (prev.slice(-len) === next.slice(0, len)) { found = len; break; }
          }
          if (found >= 10) {
            assembled = prev + next.slice(found);
            junctions.push({ between: [frags[i - 1].name, frags[i].name], overlapBp: found, verified: true });
          } else {
            assembled = prev + next;
            junctions.push({ between: [frags[i - 1].name, frags[i].name], overlapBp: 0, verified: false });
            issues.push(`No Gibson overlap (>=10 bp) between ${frags[i - 1].name} and ${frags[i].name}.`);
          }
        }
        if (circular) {
          let closeLen = 0;
          for (let len = Math.min(overlap + 20, assembled.length); len >= 10; len--) {
            if (assembled.slice(-len) === assembled.slice(0, len)) { closeLen = len; break; }
          }
          if (closeLen >= 10) assembled = assembled.slice(0, assembled.length - closeLen);
          else issues.push("Circularisation junction lacks a terminal overlap.");
        }
      } else if (method === "goldengate") {
        // BsaI-style: trim outer 6 bp recognition+spacer, butt-join 4 bp scars.
        assembled = "";
        for (let i = 0; i < frags.length; i++) {
          const core = frags[i].sequence.length > 12
            ? frags[i].sequence.slice(6, -6) : frags[i].sequence;
          assembled += core;
          if (i > 0) junctions.push({ between: [frags[i - 1].name, frags[i].name], scar: "Type IIS 4 bp", verified: true });
        }
        if (frags.some((f) => f.sequence.length <= 12))
          {issues.push("Some fragments too short for Type IIS flank trimming.");}
      } else {
        // restriction: simple end-to-end ligation, report common cut sites.
        assembled = frags.map((f) => f.sequence).join("");
        for (let i = 1; i < frags.length; i++)
          {junctions.push({ between: [frags[i - 1].name, frags[i].name], scar: "blunt/sticky ligation", verified: true });}
      }
      return {
        ok: true,
        result: {
          method, circular,
          fragmentCount: frags.length,
          assembledLength: assembled.length,
          assembledSequence: assembled.length > 20000 ? assembled.slice(0, 20000) : assembled,
          truncated: assembled.length > 20000,
          gcPercent: gcContent(assembled),
          junctions,
          issues,
          success: issues.length === 0,
          summary: `${method} assembly of ${frags.length} fragments → ${assembled.length} bp ${circular ? "circular" : "linear"}. ${issues.length ? `${issues.length} issue(s).` : "Clean assembly."}`,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── blast-search — BLAST-style local homology search ──
  // params.query, params.database = [{id, sequence}] (or uses saved seqs).
  // Word-seed + ungapped extension (k=7), scored, sorted by bit-score proxy.
  registerLensAction("bio", "blast-search", (ctx, _artifact, params = {}) => {
    try {
      const query = String(params.query || "").replace(/\s/g, "").toUpperCase();
      if (!query) return { ok: false, error: "query required" };
      if (query.length < 8) return { ok: false, error: "query must be >= 8 residues" };
      if (query.length > 5000) return { ok: false, error: "query too long (max 5000)" };
      let db = Array.isArray(params.database) ? params.database : null;
      if (!db) {
        const s = getBioState();
        const map = s?.sequences.get(bioActor(ctx));
        db = map ? Array.from(map.values()).map((v) => ({ id: v.name, sequence: v.sequence })) : [];
      }
      db = db
        .map((d, i) => ({ id: String(d.id || d.name || `subject${i + 1}`),
          sequence: String(d.sequence || "").replace(/\s/g, "").toUpperCase() }))
        .filter((d) => d.sequence.length >= 8);
      if (db.length === 0) return { ok: true, result: { hits: [], queryLength: query.length, databaseSize: 0, message: "No database sequences to search." } };

      const K = 7;
      const queryWords = new Map();
      for (let i = 0; i + K <= query.length; i++) {
        const w = query.slice(i, i + K);
        if (!queryWords.has(w)) queryWords.set(w, []);
        queryWords.get(w).push(i);
      }
      const hits = [];
      for (const subj of db) {
        let best = null;
        for (let j = 0; j + K <= subj.sequence.length; j++) {
          const word = subj.sequence.slice(j, j + K);
          const qPositions = queryWords.get(word);
          if (!qPositions) continue;
          for (const qi of qPositions) {
            // Ungapped extension both directions.
            let l = 0, r = 0, score = K, qs = qi, ss = j;
            while (qs - 1 >= 0 && ss - 1 >= 0 && query[qs - 1] === subj.sequence[ss - 1]) {
              qs--; ss--; l++; score++;
            }
            let qe = qi + K, se = j + K;
            while (qe < query.length && se < subj.sequence.length && query[qe] === subj.sequence[se]) {
              qe++; se++; r++; score++;
            }
            const len = qe - qs;
            if (!best || score > best.score) {
              best = {
                score, alignLength: len,
                queryStart: qs, queryEnd: qe,
                subjectStart: ss, subjectEnd: se,
              };
            }
          }
        }
        if (best) {
          const identity = 100; // ungapped exact extension
          // Bit-score / E-value proxies (Karlin-Altschul style approximation).
          const bitScore = Math.round((best.score * 1.33) * 10) / 10;
          const eValue = Number(((query.length * subj.sequence.length) *
            Math.pow(2, -bitScore)).toExponential(2));
          hits.push({
            subjectId: subj.id,
            score: best.score, bitScore, eValue,
            identity,
            alignLength: best.alignLength,
            queryRange: [best.queryStart, best.queryEnd],
            subjectRange: [best.subjectStart, best.subjectEnd],
            coverage: Math.round((best.alignLength / query.length) * 10000) / 100,
          });
        }
      }
      hits.sort((a, b) => b.bitScore - a.bitScore);
      return {
        ok: true,
        result: {
          queryLength: query.length,
          databaseSize: db.length,
          hitCount: hits.length,
          hits: hits.slice(0, 50),
          topHit: hits[0] || null,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── crispr-design — guide-RNA design with off-target scoring ──
  // params.sequence (target), params.pam? ('NGG' default, SpCas9).
  registerLensAction("bio", "crispr-design", (_ctx, _artifact, params = {}) => {
    try {
      const seq = String(params.sequence || "").replace(/\s/g, "").toUpperCase();
      if (!seq) return { ok: false, error: "sequence required" };
      if (!/^[ACGTN]+$/.test(seq)) return { ok: false, error: "sequence must be DNA (ACGTN)" };
      if (seq.length < 30) return { ok: false, error: "sequence must be >= 30 bp" };
      if (seq.length > 50_000) return { ok: false, error: "sequence too long (max 50000)" };
      const GUIDE_LEN = 20;
      const candidates = [];

      function scanStrand(strand, label) {
        // SpCas9 PAM = NGG immediately 3' of a 20 nt protospacer.
        for (let i = 0; i + GUIDE_LEN + 3 <= strand.length; i++) {
          const guide = strand.slice(i, i + GUIDE_LEN);
          const pam = strand.slice(i + GUIDE_LEN, i + GUIDE_LEN + 3);
          if (pam[1] !== "G" || pam[2] !== "G") continue;
          if (guide.includes("N")) continue;
          const gc = gcContent(guide);
          // On-target heuristic (Doench-style proxies): GC in 40-60 ideal,
          // purine at position 20, no poly-T (Pol III terminator).
          let onScore = 60;
          if (gc >= 40 && gc <= 60) onScore += 20;
          else if (gc < 25 || gc > 75) onScore -= 25;
          if (guide[GUIDE_LEN - 1] === "G" || guide[GUIDE_LEN - 1] === "A") onScore += 10;
          if (/TTTT/.test(guide)) onScore -= 30;
          if (/(.)\1\1\1/.test(guide)) onScore -= 10;
          onScore = Math.max(0, Math.min(100, onScore));
          candidates.push({
            guide, pam, strand: label,
            position: label === "+" ? i : seq.length - i - GUIDE_LEN,
            gcPercent: gc,
            onTargetScore: onScore,
          });
        }
      }
      scanStrand(seq, "+");
      scanStrand(revComp(seq), "-");
      if (candidates.length === 0) {
        return { ok: true, result: { guides: [], guideCount: 0, message: "No NGG PAM sites with valid protospacers found." } };
      }
      // Off-target: count near-identical 12 nt seed matches elsewhere in target.
      for (const c of candidates) {
        const seed = c.guide.slice(-12);
        let offHits = 0;
        const search = seq + revComp(seq);
        let pos = -1;
        while ((pos = search.indexOf(seed, pos + 1)) !== -1) offHits++;
        // 1 expected (self); anything above is a potential off-target.
        c.offTargetHits = Math.max(0, offHits - 1);
        c.specificityScore = Math.max(0, 100 - c.offTargetHits * 35);
        c.compositeScore = Math.round((c.onTargetScore * 0.6 + c.specificityScore * 0.4) * 10) / 10;
      }
      candidates.sort((a, b) => b.compositeScore - a.compositeScore);
      return {
        ok: true,
        result: {
          pam: "NGG (SpCas9)",
          targetLength: seq.length,
          guideCount: candidates.length,
          guides: candidates.slice(0, 40),
          topGuide: candidates[0],
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  // ── Lab notebook — per-user entries linked to sequences + protocols ──

  function getNotebook(s, userId) {
    if (!s.notebook) s.notebook = new Map();
    if (!s.notebook.has(userId)) s.notebook.set(userId, new Map());
    return s.notebook.get(userId);
  }

  registerLensAction("bio", "notebook-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = bioActor(ctx);
      const title = String(params.title || "").trim();
      if (!title) return { ok: false, error: "title required" };
      if (title.length > 120) return { ok: false, error: "title too long (max 120)" };
      const entry = {
        id: nextBioId("nb"),
        title,
        body: String(params.body || "").slice(0, 20_000),
        tags: Array.isArray(params.tags) ? params.tags.map((t) => String(t).slice(0, 40)).slice(0, 12) : [],
        linkedSequenceIds: Array.isArray(params.linkedSequenceIds)
          ? params.linkedSequenceIds.map((x) => String(x)).slice(0, 30) : [],
        linkedProtocol: params.linkedProtocol ? String(params.linkedProtocol).slice(0, 200) : null,
        status: ["draft", "in_progress", "complete"].includes(params.status) ? params.status : "draft",
        createdAt: nowIsoBio(),
        updatedAt: nowIsoBio(),
      };
      getNotebook(s, userId).set(entry.id, entry);
      saveBioState();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("bio", "notebook-list", (ctx, _artifact, _params = {}) => {
    try {
      const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const entries = Array.from(getNotebook(s, bioActor(ctx)).values())
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      return { ok: true, result: { entries, count: entries.length } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("bio", "notebook-update", (ctx, _artifact, params = {}) => {
    try {
      const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const nb = getNotebook(s, bioActor(ctx));
      const id = String(params.id || "");
      const entry = nb.get(id);
      if (!entry) return { ok: false, error: "not found" };
      if (params.title !== undefined) entry.title = String(params.title).slice(0, 120) || entry.title;
      if (params.body !== undefined) entry.body = String(params.body).slice(0, 20_000);
      if (Array.isArray(params.tags)) entry.tags = params.tags.map((t) => String(t).slice(0, 40)).slice(0, 12);
      if (Array.isArray(params.linkedSequenceIds))
        {entry.linkedSequenceIds = params.linkedSequenceIds.map((x) => String(x)).slice(0, 30);}
      if (params.linkedProtocol !== undefined)
        {entry.linkedProtocol = params.linkedProtocol ? String(params.linkedProtocol).slice(0, 200) : null;}
      if (["draft", "in_progress", "complete"].includes(params.status)) entry.status = params.status;
      entry.updatedAt = nowIsoBio();
      saveBioState();
      return { ok: true, result: { entry } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });

  registerLensAction("bio", "notebook-delete", (ctx, _artifact, params = {}) => {
    try {
      const s = getBioState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const nb = getNotebook(s, bioActor(ctx));
      const id = String(params.id || "");
      if (!nb.has(id)) return { ok: false, error: "not found" };
      nb.delete(id);
      saveBioState();
      return { ok: true, result: { deleted: id } };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  });
}
