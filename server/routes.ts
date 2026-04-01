import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import * as fs from "fs";
import * as path from "path";

interface ProteinInfo {
  spd_locus: string;
  gene_name: string;
  category: string;
  aa_length: number;
  sequence?: string;
}

interface Pool {
  proteins: string[];
  totalResidues: number;
}

// ---- FASTA parser ----
function parseFasta(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split("\n");
  let currentId = "";
  let currentSeq = "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(">")) {
      if (currentId && currentSeq) {
        result.set(currentId, currentSeq);
      }
      currentId = trimmed.slice(1).split(/\s+/)[0];
      currentSeq = "";
    } else if (trimmed) {
      currentSeq += trimmed;
    }
  }
  if (currentId && currentSeq) {
    result.set(currentId, currentSeq);
  }
  return result;
}

// ---- Load preset data ----
const dataDir = path.resolve(process.cwd(), "server/data");
const geneMetadata: ProteinInfo[] = JSON.parse(
  fs.readFileSync(path.join(dataDir, "gene_metadata.json"), "utf-8")
);
const subsetFasta = parseFasta(
  fs.readFileSync(path.join(dataDir, "d39w_subset.fasta"), "utf-8")
);

// Merge sequences into metadata
for (const protein of geneMetadata) {
  const fastaKey = `${protein.spd_locus}_${protein.gene_name}`;
  protein.sequence = subsetFasta.get(fastaKey) || "";
}

// ---- Pooling Algorithm ----
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generatePools(
  proteins: { id: string; length: number }[],
  maxResidues: number = 4800,
  maxProteinSize: number = 2500
): { pools: Pool[]; coverageMatrix: number[][]; proteinNames: string[] } {
  // Filter proteins > maxProteinSize
  const filtered = proteins.filter((p) => p.length <= maxProteinSize);
  const n = filtered.length;
  const proteinNames = filtered.map((p) => p.id);

  // Protein sizes map
  const sizeMap = new Map<string, number>();
  for (const p of filtered) sizeMap.set(p.id, p.length);

  // Initialize NxN pair-coverage matrix
  const coverage: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0)
  );
  // Diagonal = tested (self)
  for (let i = 0; i < n; i++) coverage[i][i] = 1;

  const pools: Pool[] = [];
  const shuffled = shuffleArray(filtered);
  const indexMap = new Map<string, number>();
  for (let i = 0; i < proteinNames.length; i++) {
    indexMap.set(proteinNames[i], i);
  }

  let maxIter = 10000;
  while (maxIter-- > 0) {
    // Check if any pair is untested
    let hasUntested = false;
    for (let i = 0; i < n && !hasUntested; i++) {
      for (let j = i + 1; j < n && !hasUntested; j++) {
        if (coverage[i][j] === 0) hasUntested = true;
      }
    }
    if (!hasUntested) break;

    // Find protein with most untested pairs
    let bestProtein = -1;
    let bestCount = -1;
    for (let i = 0; i < n; i++) {
      let count = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j && coverage[i][j] === 0) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestProtein = i;
      }
    }
    if (bestProtein === -1 || bestCount === 0) break;

    // Build pool greedily
    const poolIndices: number[] = [bestProtein];
    let totalRes = sizeMap.get(proteinNames[bestProtein]) || 0;

    while (true) {
      let bestNext = -1;
      let bestNewPairs = -1;

      for (let c = 0; c < n; c++) {
        if (poolIndices.includes(c)) continue;
        const candidateSize = sizeMap.get(proteinNames[c]) || 0;
        if (totalRes + candidateSize > maxResidues) continue;

        // Count new pairs this candidate would add
        let newPairs = 0;
        for (const pidx of poolIndices) {
          if (coverage[c][pidx] === 0) newPairs++;
        }
        if (newPairs > bestNewPairs) {
          bestNewPairs = newPairs;
          bestNext = c;
        }
      }

      if (bestNext === -1 || bestNewPairs <= 0) break;
      poolIndices.push(bestNext);
      totalRes += sizeMap.get(proteinNames[bestNext]) || 0;
    }

    // If only one protein, just skip it (all pairs tested)
    if (poolIndices.length < 2) {
      // Mark remaining: nothing to do
      break;
    }

    // Update coverage matrix
    for (let a = 0; a < poolIndices.length; a++) {
      for (let b = a + 1; b < poolIndices.length; b++) {
        coverage[poolIndices[a]][poolIndices[b]]++;
        coverage[poolIndices[b]][poolIndices[a]]++;
      }
    }

    pools.push({
      proteins: poolIndices.map((i) => proteinNames[i]),
      totalResidues: totalRes,
    });
  }

  return { pools, coverageMatrix: coverage, proteinNames };
}

// Proteome-wide pooling: query protein forced into every pool
function generateProteomeWidePools(
  queryProtein: { id: string; length: number; sequence: string },
  targets: { id: string; length: number; sequence: string }[],
  maxResidues: number = 4800,
  maxProteinSize: number = 2500
): { pools: Pool[]; proteinNames: string[] } {
  const filtered = targets.filter(
    (p) => p.length <= maxProteinSize && p.id !== queryProtein.id
  );
  const queryLen = queryProtein.length;
  const pools: Pool[] = [];
  const remaining = shuffleArray([...filtered]);
  const tested = new Set<string>();

  while (remaining.length > 0) {
    const pool: string[] = [queryProtein.id];
    let totalRes = queryLen;

    // Greedily add proteins
    const toRemove: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      if (totalRes + p.length > maxResidues) continue;
      pool.push(p.id);
      totalRes += p.length;
      tested.add(p.id);
      toRemove.push(i);
    }

    // Remove added proteins from remaining
    for (let i = toRemove.length - 1; i >= 0; i--) {
      remaining.splice(toRemove[i], 1);
    }

    if (pool.length > 1) {
      pools.push({ proteins: pool, totalResidues: totalRes });
    }
  }

  return { pools, proteinNames: [queryProtein.id, ...filtered.map((p) => p.id)] };
}

// ---- AF3 JSON generation ----
function generateAF3Jobs(
  pools: Pool[],
  sequenceMap: Map<string, string>,
  prefix: string,
  batchSize: number = 20
): { batches: any[][]; descriptions: { job_number: string; proteins_tested: string }[] } {
  const allJobs: any[] = [];
  const descriptions: { job_number: string; proteins_tested: string }[] = [];

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const jobName = `${prefix}_${i + 1}`;
    const sequences = pool.proteins
      .map((pid) => {
        const seq = sequenceMap.get(pid);
        if (!seq) return null;
        return { proteinChain: { sequence: seq, count: 1 } };
      })
      .filter(Boolean);

    allJobs.push({
      name: jobName,
      modelSeeds: [],
      sequences,
      dialect: "alphafoldserver",
      version: 1,
    });

    descriptions.push({
      job_number: jobName,
      proteins_tested: pool.proteins.join("::::"),
    });
  }

  // Split into batches
  const batches: any[][] = [];
  for (let i = 0; i < allJobs.length; i += batchSize) {
    batches.push(allJobs.slice(i, i + batchSize));
  }

  return { batches, descriptions };
}

// ---- Analysis functions ----
const SIZE_INTERCEPT = -0.036255571;
const SIZE_SLOPE = 0.004470512;

function sizeCorrection(rawIptm: number, aa1: number, aa2: number): number {
  const expected = SIZE_INTERCEPT + SIZE_SLOPE * Math.sqrt(aa1 + aa2);
  return rawIptm - expected;
}

interface AnalysisResult {
  pairwiseScores: any[];
  matrix: number[][];
  matrixLabels: string[];
  categoryOrder: string[];
}

function analyzeResults(
  confidenceFiles: { filename: string; data: any }[],
  descriptions: { job_number: string; proteins_tested: string }[],
  proteinSizes: Map<string, number>,
  proteinMeta: Map<string, ProteinInfo>
): AnalysisResult {
  // Build description map
  const descMap = new Map<string, string[]>();
  for (const d of descriptions) {
    descMap.set(d.job_number, d.proteins_tested.split("::::"));
  }

  // Collect all pairwise measurements
  const measurements = new Map<string, number[]>(); // "protA|protB" -> [values]

  for (const file of confidenceFiles) {
    // Parse job name from filename: summary_confidences_PREFIX_N_seed.json
    // or: PREFIX_N_summary_confidences_0.json
    const fname = file.filename.replace(/\.json$/i, "");
    let jobName = "";

    // Try to find matching description
    for (const [jn] of descMap) {
      if (fname.includes(jn)) {
        jobName = jn;
        break;
      }
    }

    if (!jobName) {
      // Try extracting from filename pattern
      const match = fname.match(/([a-zA-Z_]+\d+_\d+)/);
      if (match) {
        jobName = match[1];
      }
    }

    const proteins = descMap.get(jobName);
    if (!proteins || !file.data?.chain_pair_iptm) continue;

    const iptmMatrix = file.data.chain_pair_iptm;
    const n = proteins.length;

    if (!Array.isArray(iptmMatrix) || iptmMatrix.length < n) continue;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (!iptmMatrix[i] || iptmMatrix[i].length <= j) continue;
        const val = (iptmMatrix[i][j] + iptmMatrix[j][i]) / 2;
        const key = [proteins[i], proteins[j]].sort().join("|");
        if (!measurements.has(key)) measurements.set(key, []);
        measurements.get(key)!.push(val);
      }
    }
  }

  // Average across seeds, then build matrix
  const allProteins = new Set<string>();
  for (const [key] of measurements) {
    const [p1, p2] = key.split("|");
    allProteins.add(p1);
    allProteins.add(p2);
  }

  // Sort proteins by category then name
  const proteinList = Array.from(allProteins).sort((a, b) => {
    const metaA = proteinMeta.get(a);
    const metaB = proteinMeta.get(b);
    const catA = metaA?.category || "zzz";
    const catB = metaB?.category || "zzz";
    if (catA !== catB) return catA.localeCompare(catB);
    return a.localeCompare(b);
  });

  const categories = [...new Set(proteinList.map((p) => proteinMeta.get(p)?.category || "unknown"))];

  const n = proteinList.length;
  const indexMap = new Map<string, number>();
  for (let i = 0; i < n; i++) indexMap.set(proteinList[i], i);

  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(NaN));

  const pairwiseScores: any[] = [];

  for (const [key, values] of measurements) {
    const [p1, p2] = key.split("|");
    // Median
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

    const aa1 = proteinSizes.get(p1) || 300;
    const aa2 = proteinSizes.get(p2) || 300;
    const scIptm = sizeCorrection(median, aa1, aa2);

    const i = indexMap.get(p1)!;
    const j = indexMap.get(p2)!;
    if (i !== undefined && j !== undefined) {
      matrix[i][j] = scIptm;
      matrix[j][i] = scIptm;
    }

    const meta1 = proteinMeta.get(p1);
    const meta2 = proteinMeta.get(p2);

    pairwiseScores.push({
      protein1: p1,
      protein2: p2,
      gene1: meta1?.gene_name || p1,
      gene2: meta2?.gene_name || p2,
      category1: meta1?.category || "unknown",
      category2: meta2?.category || "unknown",
      aa_length1: aa1,
      aa_length2: aa2,
      raw_iptm: median,
      size_corrected_iptm: scIptm,
      cross_category: (meta1?.category || "") !== (meta2?.category || ""),
    });
  }

  // Sort by sc_iptm descending
  pairwiseScores.sort((a, b) => b.size_corrected_iptm - a.size_corrected_iptm);

  return {
    pairwiseScores,
    matrix,
    matrixLabels: proteinList,
    categoryOrder: categories,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // ---- GET /api/proteins — Return preset protein metadata ----
  app.get("/api/proteins", (_req, res) => {
    res.json(geneMetadata);
  });

  // ---- POST /api/pools/generate — Run pooling algorithm ----
  app.post("/api/pools/generate", (req, res) => {
    try {
      const { proteinIds, maxResidues = 4800, mode = "all-by-all", queryProteinId } = req.body;

      if (mode === "proteome-wide") {
        // Parse uploaded FASTA or use full proteome
        const { querySequence, queryId, queryLength, targetProteins } = req.body;

        const qProtein = { id: queryId, length: queryLength, sequence: querySequence };
        const targets = (targetProteins as any[]).map((p: any) => ({
          id: p.id,
          length: p.length,
          sequence: p.sequence,
        }));

        const result = generateProteomeWidePools(qProtein, targets, maxResidues);
        const seqMap = new Map<string, string>();
        seqMap.set(queryId, querySequence);
        for (const t of targetProteins) {
          seqMap.set(t.id, t.sequence);
        }

        const af3Result = generateAF3Jobs(result.pools, seqMap, "proteome_screen");

        return res.json({
          pools: result.pools,
          proteinNames: result.proteinNames,
          stats: {
            totalPools: result.pools.length,
            totalPairs: result.pools.reduce((s, p) => s + (p.proteins.length - 1), 0),
            residuesRange: [
              Math.min(...result.pools.map((p) => p.totalResidues)),
              Math.max(...result.pools.map((p) => p.totalResidues)),
            ],
          },
          af3Batches: af3Result.batches,
          descriptions: af3Result.descriptions,
        });
      }

      // All-by-all mode
      if (!proteinIds || !Array.isArray(proteinIds) || proteinIds.length < 2) {
        return res.status(400).json({ error: "Need at least 2 proteins" });
      }

      // Build protein list with sizes
      const proteins = proteinIds.map((id: string) => {
        const meta = geneMetadata.find(
          (g) => g.spd_locus === id || `${g.spd_locus}_${g.gene_name}` === id
        );
        const fastaKey = meta
          ? `${meta.spd_locus}_${meta.gene_name}`
          : id;
        return {
          id: fastaKey,
          length: meta?.aa_length || 0,
        };
      });

      const poolResult = generatePools(proteins, maxResidues);

      // Build sequence map for AF3 JSON generation
      const seqMap = new Map<string, string>();
      for (const p of geneMetadata) {
        const key = `${p.spd_locus}_${p.gene_name}`;
        if (p.sequence) seqMap.set(key, p.sequence);
      }

      const af3Result = generateAF3Jobs(poolResult.pools, seqMap, "spn_d39w");

      res.json({
        ...poolResult,
        stats: {
          totalPools: poolResult.pools.length,
          totalPairs: poolResult.pools.reduce(
            (sum, p) => sum + (p.proteins.length * (p.proteins.length - 1)) / 2,
            0
          ),
          residuesRange: poolResult.pools.length > 0 ? [
            Math.min(...poolResult.pools.map((p) => p.totalResidues)),
            Math.max(...poolResult.pools.map((p) => p.totalResidues)),
          ] : [0, 0],
          meanCoverage:
            poolResult.coverageMatrix.length > 0
              ? poolResult.coverageMatrix
                  .flatMap((row, i) =>
                    row.filter((_, j) => j > i).filter((v) => v > 0)
                  ).length /
                ((poolResult.proteinNames.length *
                  (poolResult.proteinNames.length - 1)) /
                  2)
              : 0,
        },
        af3Batches: af3Result.batches,
        descriptions: af3Result.descriptions,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- POST /api/analyze — Analyze uploaded confidence JSONs ----
  app.post("/api/analyze", (req, res) => {
    try {
      const { confidenceFiles, descriptions } = req.body;

      if (!confidenceFiles || !descriptions) {
        return res.status(400).json({ error: "Missing confidenceFiles or descriptions" });
      }

      // Build protein sizes map and metadata map
      const proteinSizes = new Map<string, number>();
      const proteinMeta = new Map<string, ProteinInfo>();
      for (const p of geneMetadata) {
        const key = `${p.spd_locus}_${p.gene_name}`;
        proteinSizes.set(key, p.aa_length);
        proteinMeta.set(key, p);
      }

      // Also handle custom proteins from descriptions
      for (const d of descriptions) {
        const prots = d.proteins_tested.split("::::");
        for (const p of prots) {
          if (!proteinSizes.has(p)) {
            // Try to estimate from sequence if available
            proteinSizes.set(p, 300); // fallback
          }
        }
      }

      const result = analyzeResults(confidenceFiles, descriptions, proteinSizes, proteinMeta);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- GET /api/extract-script — Download the extraction script ----
  app.get("/api/extract-script", (_req, res) => {
    const script = `#!/bin/bash
# Extract summary_confidences JSONs from AlphaFold3 result zips
# Usage: Place all AF3 result .zip files in the current directory, then run this script.

mkdir -p af3_confidences

for zip in *.zip; do
    [ -f "$zip" ] || continue
    echo "Processing: $zip"
    unzip -j -o "$zip" "*summary_confidences*.json" -d af3_confidences/ 2>/dev/null
done

echo ""
echo "Extracted $(ls af3_confidences/*.json 2>/dev/null | wc -l) confidence files."

# Create a single zip for upload
zip -j af3_confidences_all.zip af3_confidences/*.json 2>/dev/null

echo ""
echo "Created: af3_confidences_all.zip"
echo "Upload this file to the Pooled-AF3 web app for analysis."
`;
    res.setHeader("Content-Type", "application/x-shellscript");
    res.setHeader("Content-Disposition", "attachment; filename=extract_confidences.sh");
    res.send(script);
  });

  // ---- POST /api/parse-fasta — Parse uploaded FASTA ----
  app.post("/api/parse-fasta", (req, res) => {
    try {
      const { fastaContent } = req.body;
      if (!fastaContent) return res.status(400).json({ error: "No FASTA content" });

      const sequences = parseFasta(fastaContent);
      const proteins: any[] = [];
      for (const [id, seq] of sequences) {
        // Parse id for gene name: might be "SPD_XXXX_geneName" or "sp|UNIPROT|NAME"
        let geneName = id;
        let spdLocus = id;
        const match = id.match(/^(SPD_\d+)_(.+)$/);
        if (match) {
          spdLocus = match[1];
          geneName = match[2];
        }
        proteins.push({
          id,
          spd_locus: spdLocus,
          gene_name: geneName,
          aa_length: seq.length,
          sequence: seq,
          category: "custom",
        });
      }
      res.json(proteins);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- GET /api/proteome-fasta — Stream the full D39W proteome FASTA ----
  app.get("/api/proteome-fasta", (_req, res) => {
    const fastaPath = path.join(dataDir, "d39w_proteins.fasta");
    if (!fs.existsSync(fastaPath)) {
      return res.status(404).json({ error: "Proteome FASTA not found" });
    }

    const content = fs.readFileSync(fastaPath, "utf-8");
    const sequences = parseFasta(content);
    const proteins: any[] = [];
    for (const [id, seq] of sequences) {
      // UniProt header: sp|ACCESSION|NAME_SPECIES ...
      let shortName = id;
      const match = id.match(/\|([^|]+)\|(\S+)/);
      if (match) {
        shortName = match[2];
      }
      proteins.push({
        id: shortName,
        full_header: id,
        aa_length: seq.length,
        sequence: seq,
      });
    }
    res.json({ count: proteins.length, proteins });
  });

  return httpServer;
}
