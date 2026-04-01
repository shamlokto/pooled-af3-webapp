export interface ParsedProtein {
  id: string;
  spd_locus: string;
  gene_name: string;
  aa_length: number;
  sequence: string;
  category: string;
}

export function parseFasta(content: string): Map<string, string> {
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

export function parseFastaToProteins(fastaContent: string): ParsedProtein[] {
  const sequences = parseFasta(fastaContent);
  const proteins: ParsedProtein[] = [];
  for (const [id, seq] of sequences) {
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
  return proteins;
}

export function parseProteomeFasta(fastaContent: string): { id: string; full_header: string; aa_length: number; sequence: string }[] {
  const sequences = parseFasta(fastaContent);
  const proteins: { id: string; full_header: string; aa_length: number; sequence: string }[] = [];
  for (const [id, seq] of sequences) {
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
  return proteins;
}
