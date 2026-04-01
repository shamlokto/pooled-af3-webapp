import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Minimal schema - this app is mostly computational, not data-persistent
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Shared types for the API
export interface ProteinInfo {
  spd_locus: string;
  gene_name: string;
  category: string;
  aa_length: number;
  sequence?: string;
}

export interface Pool {
  proteins: string[]; // protein identifiers
  totalResidues: number;
}

export interface PoolingResult {
  pools: Pool[];
  coverageMatrix: number[][];
  proteinNames: string[];
  stats: {
    totalPools: number;
    totalPairs: number;
    residuesRange: [number, number];
    meanCoverage: number;
  };
}

export interface AF3Job {
  name: string;
  modelSeeds: number[];
  sequences: { proteinChain: { sequence: string; count: number } }[];
  dialect: string;
  version: number;
}

export interface AF3BatchFile {
  filename: string;
  jobs: AF3Job[];
}

export interface DescriptionRow {
  job_number: string;
  proteins_tested: string; // :::: delimited
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
