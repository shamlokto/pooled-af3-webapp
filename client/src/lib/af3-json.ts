import type { Pool } from "./pooling";

export interface AF3Job {
  name: string;
  modelSeeds: number[];
  sequences: { proteinChain: { sequence: string; count: number } }[];
  dialect: string;
  version: number;
}

export interface DescriptionRow {
  job_number: string;
  proteins_tested: string;
}

export function generateAF3Jobs(
  pools: Pool[],
  sequenceMap: Map<string, string>,
  prefix: string,
  batchSize: number = 20
): { batches: AF3Job[][]; descriptions: DescriptionRow[] } {
  const allJobs: AF3Job[] = [];
  const descriptions: DescriptionRow[] = [];

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i];
    const jobName = `${prefix}_${i + 1}`;
    const sequences = pool.proteins
      .map((pid) => {
        const seq = sequenceMap.get(pid);
        if (!seq) return null;
        return { proteinChain: { sequence: seq, count: 1 } };
      })
      .filter(Boolean) as { proteinChain: { sequence: string; count: number } }[];

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

  const batches: AF3Job[][] = [];
  for (let i = 0; i < allJobs.length; i += batchSize) {
    batches.push(allJobs.slice(i, i + batchSize));
  }

  return { batches, descriptions };
}
