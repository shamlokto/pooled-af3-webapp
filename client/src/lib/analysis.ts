export interface ProteinInfo {
  spd_locus: string;
  gene_name: string;
  category: string;
  aa_length: number;
  sequence?: string;
}

export interface PairwiseScore {
  protein1: string;
  protein2: string;
  gene1: string;
  gene2: string;
  category1: string;
  category2: string;
  aa_length1: number;
  aa_length2: number;
  raw_iptm: number;
  size_corrected_iptm: number;
  cross_category: boolean;
}

export interface AnalysisResult {
  pairwiseScores: PairwiseScore[];
  matrix: number[][];
  matrixLabels: string[];
  categoryOrder: string[];
}

const SIZE_INTERCEPT = -0.036255571;
const SIZE_SLOPE = 0.004470512;

function sizeCorrection(rawIptm: number, aa1: number, aa2: number): number {
  const expected = SIZE_INTERCEPT + SIZE_SLOPE * Math.sqrt(aa1 + aa2);
  return rawIptm - expected;
}

export function analyzeResults(
  confidenceFiles: { filename: string; data: any }[],
  descriptions: { job_number: string; proteins_tested: string }[],
  proteinSizes: Map<string, number>,
  proteinMeta: Map<string, ProteinInfo>
): AnalysisResult {
  const descMap = new Map<string, string[]>();
  for (const d of descriptions) {
    descMap.set(d.job_number, d.proteins_tested.split("::::"));
  }

  const measurements = new Map<string, number[]>();

  for (const file of confidenceFiles) {
    const fname = file.filename.replace(/\.json$/i, "");
    let jobName = "";

    for (const [jn] of descMap) {
      if (fname.includes(jn)) {
        jobName = jn;
        break;
      }
    }

    if (!jobName) {
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

  const allProteins = new Set<string>();
  for (const [key] of measurements) {
    const [p1, p2] = key.split("|");
    allProteins.add(p1);
    allProteins.add(p2);
  }

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

  const pairwiseScores: PairwiseScore[] = [];

  for (const [key, values] of measurements) {
    const [p1, p2] = key.split("|");
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

  pairwiseScores.sort((a, b) => b.size_corrected_iptm - a.size_corrected_iptm);

  return {
    pairwiseScores,
    matrix,
    matrixLabels: proteinList,
    categoryOrder: categories,
  };
}
