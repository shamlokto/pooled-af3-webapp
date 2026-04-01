export interface Pool {
  proteins: string[];
  totalResidues: number;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generatePools(
  proteins: { id: string; length: number }[],
  maxResidues: number = 4800,
  maxProteinSize: number = 2500
): { pools: Pool[]; coverageMatrix: number[][]; proteinNames: string[] } {
  const filtered = proteins.filter((p) => p.length <= maxProteinSize);
  const n = filtered.length;
  const proteinNames = filtered.map((p) => p.id);

  const sizeMap = new Map<string, number>();
  for (const p of filtered) sizeMap.set(p.id, p.length);

  const coverage: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0)
  );
  for (let i = 0; i < n; i++) coverage[i][i] = 1;

  const pools: Pool[] = [];
  const indexMap = new Map<string, number>();
  for (let i = 0; i < proteinNames.length; i++) {
    indexMap.set(proteinNames[i], i);
  }

  let maxIter = 10000;
  while (maxIter-- > 0) {
    let hasUntested = false;
    for (let i = 0; i < n && !hasUntested; i++) {
      for (let j = i + 1; j < n && !hasUntested; j++) {
        if (coverage[i][j] === 0) hasUntested = true;
      }
    }
    if (!hasUntested) break;

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

    const poolIndices: number[] = [bestProtein];
    let totalRes = sizeMap.get(proteinNames[bestProtein]) || 0;

    while (true) {
      let bestNext = -1;
      let bestNewPairs = -1;

      for (let c = 0; c < n; c++) {
        if (poolIndices.includes(c)) continue;
        const candidateSize = sizeMap.get(proteinNames[c]) || 0;
        if (totalRes + candidateSize > maxResidues) continue;

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

    if (poolIndices.length < 2) {
      break;
    }

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

export function generateProteomeWidePools(
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

    const toRemove: number[] = [];
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      if (totalRes + p.length > maxResidues) continue;
      pool.push(p.id);
      totalRes += p.length;
      tested.add(p.id);
      toRemove.push(i);
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      remaining.splice(toRemove[i], 1);
    }

    if (pool.length > 1) {
      pools.push({ proteins: pool, totalResidues: totalRes });
    }
  }

  return { pools, proteinNames: [queryProtein.id, ...filtered.map((p) => p.id)] };
}
